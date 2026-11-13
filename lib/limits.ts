import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { ownSettings } from "./settings.ts";
import { join } from "node:path";
import { pidAlive } from "./ledger.ts";

// Limits. Their only purpose is to keep one fan-out from starting too many processes at once.
// - running at once (maxRunning): slot files in the tree folder, shared by every process of the tree.
//   Each depth has its own pool. A child that holds a depth-d slot waits only for a depth-d+1 slot,
//   and the deepest children start nothing, so a wait always ends: no deadlock with nested children.
// - depth (MAX_DEPTH) and the spawn graph (agents.ts).
// No quota check and no default time limit: a provider that refuses for quota ends the child with
// the reason, and it resumes later (agent resume). maxMinutes (default off) bounds the wall clock of
// one child: then it is asked to write its report, and stopped GRACE_MS later.
// Each limit is a setting (pitcrew.agent) and can be changed for one session with /agents limits.

/** A count or a time; 0 means no limit, as everywhere in the settings. */
export type Limit = number;

export interface AgentSettings {
  maxRunning: Limit;
  askTimeoutSeconds: number;
  maxMinutes: Limit;
}

export const DEFAULTS: AgentSettings = { maxRunning: 6, askTimeoutSeconds: 600, maxMinutes: 0 };
/** A child at this depth starts no agents. */
export const MAX_DEPTH = 2;

// "off" is read as 0: the value these settings had before 0 meant no limit everywhere.
const limit = (v: unknown): Limit | undefined => (v === "off" ? 0 : typeof v === "number" && v >= 0 ? v : undefined);

/** Merge `pitcrew.agent` and then session changes over the defaults; values of the wrong type are ignored. */
export function readSettings(settings: unknown, session: Partial<AgentSettings> = {}): AgentSettings {
  const raw = ownSettings(settings)?.agent ?? {};
  const out = { ...DEFAULTS };
  for (const source of [raw, session as Record<string, unknown>]) {
    out.maxRunning = limit(source.maxRunning) ?? out.maxRunning;
    out.maxMinutes = limit(source.maxMinutes) ?? out.maxMinutes;
    if (typeof source.askTimeoutSeconds === "number" && source.askTimeoutSeconds > 0) out.askTimeoutSeconds = source.askTimeoutSeconds;
  }
  return out;
}

/** Parse `/agents limits running 3`. Throws with the reason. */
export function parseLimits(args: string): Partial<AgentSettings> {
  const words = args.trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length % 2) throw new Error("usage: /agents limits running <n> (0: no limit)");
  const out: Partial<AgentSettings> = {};
  for (let i = 0; i < words.length; i += 2) {
    const value = limit(words[i + 1] === "off" ? "off" : Number(words[i + 1]));
    if (value === undefined) throw new Error(`${words[i]}: "${words[i + 1]}" is not a number (0: no limit)`);
    if (words[i] === "running") out.maxRunning = value;
    else throw new Error(`unknown limit "${words[i]}" (running)`);
  }
  return out;
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});

/** Tree-wide running slots, stored in the top session's run folder (PITCREW_TREE). */
export class TreeBudget {
  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(join(dir, "slots"), { recursive: true, mode: 0o700 });
  }

  /**
   * Take one of `max` running slots for a child at `depth`; waits (polling) while all are taken.
   * 0: no limit. Undefined if aborted.
   */
  async acquire(max: Limit, depth: number, owner: string, signal?: AbortSignal, pollMs = 1000): Promise<(() => void) | undefined> {
    if (!max) return () => {};
    const pool = join(this.dir, "slots", String(depth));
    mkdirSync(pool, { recursive: true, mode: 0o700 });
    while (!signal?.aborted) {
      for (let i = 0; i < max; i++) {
        const file = join(pool, String(i));
        try {
          writeFileSync(file, `${process.pid} ${owner}\n`, { flag: "wx" });
          return () => { try { if (readFileSync(file, "utf8").startsWith(`${process.pid} ${owner}\n`)) unlinkSync(file); } catch { /* gone */ } };
        } catch {
          const content = safeRead(file); // empty: another process is writing it
          if (content && !pidAlive(Number(content.split(" ")[0]))) { try { unlinkSync(file); } catch { /* raced */ } i--; }
        }
      }
      await sleep(pollMs, signal);
    }
    return undefined;
  }
}

function safeRead(file: string): string {
  try { return readFileSync(file, "utf8"); } catch { return ""; }
}

/** The error of a child that ended on a provider refusal. A quota refusal says how to go on. */
export function failureText(id: string, error: string, quota: boolean): string {
  return quota ? `${error}\nProvider quota used up: nothing is lost. After the reset, resume it: agent resume ${id}, or /agents resume for all.` : error;
}

/** Time after the wrap-up request before a child over maxMinutes is stopped. */
export const GRACE_MS = 120_000;

/** The wall-clock limit of one child in ms; 0 = none. */
export const childLimit = (s: Pick<AgentSettings, "maxMinutes">): number => s.maxMinutes * 60_000;

/**
 * A provider refused a request because a plan window or quota is used up. The harness does not
 * police quota: the request fails, the run stops, and the work resumes after the reset. The
 * patterns are the error texts of the providers in use ("quota exceeded — rate limit … resets …",
 * "usage limit … Try again in …"); pi does not retry them.
 */
export const QUOTA_ERROR = /quota exceeded|usage limit|insufficient_quota|out of extra usage|rate limit reached/i;
export const isQuotaError = (text: string | undefined): boolean => Boolean(text && QUOTA_ERROR.test(text));
