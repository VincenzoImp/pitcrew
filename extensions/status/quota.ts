import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Plan quota from push data only: Claude `anthropic-ratelimit-unified-*` headers (pi-claude-bridge
// rebuilds them from Claude Code's rate_limit_event) and Codex `codex.rate_limits` stream events
// (or `x-codex-*` headers on SSE). Every pi process writes the latest snapshot to
// <agent dir>/pitcrew/quota.json, so the footer and the agent tool see the freshest value on the
// machine. No pull, no credential reads. Parsers fail soft: unknown input gives undefined.

export type QuotaKind = "claude" | "codex";

export interface QuotaWindow {
  used: number; // percent, 0-100
  resetsAt?: number; // unix seconds
  minutes?: number; // window length
}

export interface ProviderQuota {
  provider: string;
  status?: string; // allowed | allowed_warning | rejected
  limitReached?: boolean;
  resetsAt?: number; // unix seconds, when the representative limit resets
  claim?: string; // which window the status describes (Claude "representative-claim")
  windows: Record<string, QuotaWindow>; // "5h", "7d", ...
  overage?: { status?: string; resetsAt?: number };
  credits?: { has: boolean; unlimited: boolean; balance?: string };
  plan?: string;
  observedAt: number; // ms
}

export type QuotaFile = Partial<Record<QuotaKind, ProviderQuota>>;

const CLAUDE = "anthropic-ratelimit-unified-";
const CLAUDE_MINUTES: Record<string, number> = { "5h": 300, "7d": 10080, "7d_oi": 10080 };

export function agentDir(): string {
  const dir = process.env.PI_CODING_AGENT_DIR;
  if (!dir) return join(homedir(), ".pi", "agent");
  return dir === "~" ? homedir() : dir.startsWith("~/") ? join(homedir(), dir.slice(2)) : dir;
}

export const quotaPath = () => join(agentDir(), "pitcrew", "quota.json");

export function quotaKind(provider: string | undefined): QuotaKind | undefined {
  if (provider === "claude-bridge" || provider === "anthropic") return "claude";
  if (provider === "openai-codex") return "codex";
  return undefined;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

const windowName = (minutes: number | undefined, fallback: string) =>
  minutes === 300 ? "5h" : minutes === 10080 ? "7d" : minutes ? `${minutes}m` : fallback;

export function parseClaudeHeaders(headers: Record<string, unknown> | undefined, provider: string, now = Date.now()): ProviderQuota | undefined {
  if (!headers) return undefined;
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (key.startsWith(CLAUDE) && v != null) h[key.slice(CLAUDE.length)] = String(v);
  }
  const windows: Record<string, QuotaWindow> = {};
  for (const [key, value] of Object.entries(h)) {
    const m = /^(.+)-utilization$/.exec(key);
    const used = num(value);
    if (!m || used === undefined) continue;
    windows[m[1]] = { used: Math.round(used * 1000) / 10, resetsAt: num(h[`${m[1]}-reset`]), minutes: CLAUDE_MINUTES[m[1]] };
  }
  if (!h.status && Object.keys(windows).length === 0) return undefined;
  const q: ProviderQuota = { provider, status: h.status, limitReached: h.status === "rejected", windows, observedAt: now };
  if (num(h.reset) !== undefined) q.resetsAt = num(h.reset);
  if (h["representative-claim"]) q.claim = h["representative-claim"];
  if (h["overage-status"]) q.overage = { status: h["overage-status"], resetsAt: num(h["overage-reset"]) };
  return q;
}

function codexWindow(w: any): QuotaWindow | undefined {
  const used = num(w?.used_percent);
  if (used === undefined) return undefined;
  return { used, resetsAt: num(w.reset_at), minutes: num(w.window_minutes) };
}

export function parseCodexEvent(data: any, now = Date.now()): ProviderQuota | undefined {
  if (data?.type !== "codex.rate_limits" || typeof data.rate_limits !== "object" || !data.rate_limits) return undefined;
  const rl = data.rate_limits;
  const windows: Record<string, QuotaWindow> = {};
  for (const [slot, fallback] of [["primary", "5h"], ["secondary", "7d"]] as const) {
    const w = codexWindow(rl[slot]);
    if (w) windows[windowName(w.minutes, fallback)] = w;
  }
  const limitReached = rl.limit_reached === true || rl.allowed === false;
  const q: ProviderQuota = { provider: "openai-codex", status: limitReached ? "rejected" : "allowed", limitReached, windows, observedAt: now };
  if (typeof data.plan_type === "string") q.plan = data.plan_type;
  const c = data.credits;
  if (c && typeof c === "object") q.credits = { has: c.has_credits === true, unlimited: c.unlimited === true, balance: c.balance == null ? undefined : String(c.balance) };
  return q;
}

/** SSE transport: the same data as `x-codex-{primary,secondary}-*` and `x-codex-credits-*` headers. */
export function parseCodexHeaders(headers: Record<string, unknown> | undefined, now = Date.now()): ProviderQuota | undefined {
  if (!headers) return undefined;
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase().startsWith("x-codex-") && v != null) h[k.toLowerCase().slice(8)] = String(v);
  const slot = (s: string) => {
    const used = h[`${s}-used-percent`];
    if (used === undefined) return undefined;
    const after = num(h[`${s}-reset-after-seconds`]);
    return { used_percent: used, window_minutes: h[`${s}-window-minutes`], reset_at: h[`${s}-reset-at`] ?? (after === undefined ? undefined : Math.round(now / 1000 + after)) };
  };
  const primary = slot("primary");
  const secondary = slot("secondary");
  if (!primary && !secondary) return undefined;
  const hasCredits = h["credits-has-credits"];
  const full = [primary, secondary].some((w) => w && Number(w.used_percent) >= 100);
  return parseCodexEvent({
    type: "codex.rate_limits",
    rate_limits: { primary, secondary, limit_reached: full, allowed: !full },
    credits: hasCredits === undefined ? undefined : { has_credits: hasCredits === "true", unlimited: h["credits-unlimited"] === "true", balance: h["credits-balance"] },
  }, now);
}

export function readQuota(path = quotaPath()): QuotaFile {
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/** Merge one snapshot into the shared file. Atomic: write a temp file, then rename. */
export function writeQuota(kind: QuotaKind, snapshot: ProviderQuota, path = quotaPath()): QuotaFile {
  const data = readQuota(path);
  const previous = data[kind];
  if (previous && previous.observedAt > snapshot.observedAt) return data;
  data[kind] = snapshot;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 1) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
  return data;
}

/** A window whose reset time has passed no longer applies. */
export function currentUse(w: QuotaWindow | undefined, now = Date.now()): number | undefined {
  if (!w) return undefined;
  return w.resetsAt !== undefined && w.resetsAt * 1000 <= now ? 0 : w.used;
}

/** A Codex reading older than this may hide usage from other machines or CLIs. */
export { isQuotaError, QUOTA_ERROR } from "../../lib/limits.ts";
export const CODEX_FRESH_MS = 30 * 60_000;


/** One-shot notices; `seen` holds the keys already shown in this process. */
export function quotaNotices(kind: QuotaKind, q: ProviderQuota, seen: Set<string>, now = Date.now()): string[] {
  const out: string[] = [];
  const once = (key: string, text: string) => { if (!seen.has(key)) { seen.add(key); out.push(text); } };
  const label = kind === "claude" ? "Claude" : "Codex";
  for (const [name, w] of Object.entries(q.windows)) {
    const used = currentUse(w, now) ?? 0;
    if (used >= 80) once(`${kind}:${name}:${w.resetsAt}`, `${label} ${name} quota at ${used}%`);
  }
  if (q.status === "rejected" || q.limitReached) {
    if (kind === "codex" && q.credits?.has && !q.credits.unlimited) once(`codex:credits`, `Codex plan limit reached: calls now spend credits (balance ${q.credits.balance ?? "?"})`);
    else once(`${kind}:rejected`, `${label} plan limit reached`);
  }
  return out;
}
