import { SWITCHES } from "./mode.ts";

// The keys under `pitcrew` that the harness reads. A key it does not read (removed in an update, or a
// typo) is not an error: the session and `pitcrew run` go on and say once which keys to remove.
// Docs: docs/defaults.md.

/** Section → its keys; `true`: a value with no sub-keys. */
export const KEYS: Record<string, readonly string[] | true> = {
  profile: true,
  tracking: true,
  rules: true,
  workDir: true,
  notify: true,
  mode: ["stop", "rigor", "switches"],
  context: ["compactAt"],
  agent: ["maxRunning", "maxMinutes", "askTimeoutSeconds"],
  web: ["backends", "codexModel"],
  caps: ["worktrees", "diskGB"],
  runner: ["maxHours", "maxIssues", "maxRestarts", "workerTurns", "workerMinutes", "setup", "sandbox"],
  box: ["net", "allow", "tokenFile"],
  verifyGate: ["timeoutSeconds"],
  leanCode: ["maxLines", "maxTestRatio", "minCodeLines"],
};

/** Where a removed key went, when it went somewhere. */
const MOVED: Record<string, string> = {
  "mode.tracking": "pitcrew.tracking (none, local, github)",
  "mode.switches.sandbox": "pitcrew.runner.sandbox",
  "mode.switches.verifyFixRounds": "fixed per rigor",
  "verifyGate.mode": "the verify switch (off, remind, on)",
  "verifyGate.timeoutSec": "pitcrew.verifyGate.timeoutSeconds",
  "agent.askTimeoutSec": "pitcrew.agent.askTimeoutSeconds",
  "verifyGate.maxContinuations": "fixed per rigor",
};

/** Paths of the keys under `pitcrew` that nothing reads. */
export function unreadKeys(pitcrew: unknown): string[] {
  const out: string[] = [];
  const obj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!obj(pitcrew)) return out;
  for (const [section, value] of Object.entries(pitcrew)) {
    const keys = KEYS[section];
    if (!keys) { out.push(section); continue; }
    if (keys === true || !obj(value)) continue;
    for (const [key, inner] of Object.entries(value)) {
      if (!keys.includes(key)) out.push(`${section}.${key}`);
      else if (section === "mode" && key === "switches" && obj(inner)) {
        for (const name of Object.keys(inner)) if (!(name in SWITCHES)) out.push(`mode.switches.${name}`);
      }
    }
  }
  return out;
}

/** The harness part of a settings object: `pitcrew`, else `piEnv` (its name before the rename). */
export function ownSettings(all: unknown): Record<string, any> | undefined {
  const s = all as { pitcrew?: Record<string, any>; piEnv?: Record<string, any> } | undefined;
  return s?.pitcrew ?? s?.piEnv;
}

/** One line for the owner, or undefined when every key is read. `all`: a whole settings object. */
export function settingsNotice(all: unknown): string | undefined {
  const s = all as { pitcrew?: unknown; piEnv?: unknown } | undefined;
  const notes: string[] = [];
  if (s?.piEnv !== undefined) notes.push(`rename the key "piEnv" to "pitcrew" in settings.json (${s.pitcrew === undefined ? "read this time" : "not read: pitcrew is set"})`);
  const keys = unreadKeys(ownSettings(all));
  if (keys.length) notes.push(`settings not read, remove them from settings.json: ${keys.map((k) => `pitcrew.${k}${MOVED[k] ? ` (now: ${MOVED[k]})` : ""}`).join(", ")}`);
  return notes.length ? `pitcrew: ${notes.join("; ")}` : undefined;
}

/** Worktree and disk caps (`pitcrew.caps`): the guard and `pitcrew run` start no new worktree above them; 0 turns one off. */
export interface Caps { worktrees: number; diskGB: number }
export const DEFAULT_CAPS: Caps = { worktrees: 20, diskGB: 20 };
