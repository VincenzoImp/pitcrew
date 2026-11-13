import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { currentUse, type ProviderQuota, type QuotaKind } from "./quota.ts";
import { formatTokens } from "./usage.ts";

// Context colours: quality drops long before the window is full, so warn early and hand off.
export const CTX_YELLOW = 35;
export const CTX_RED = 60;

// Pure footer renderer: FooterState in, lines out. index.ts builds the state from the session.
//   line 1: location (cwd, branch, session name)               model route (selected → routed • thinking)
//   line 2: ctx · CH · tokens · ≈$                              quota · guard · gate
//   line 3: other extension statuses, only if any

export interface Theme {
  fg(color: string, text: string): string;
}

export interface FooterState {
  location: string; // "~/code/pitcrew (main) • name"
  selected: string; // "role/lead", or a model id when no role is selected
  provider?: string; // shown in parentheses when there is room
  routed?: string; // physical model id of the last response
  thinking?: string;
  local?: boolean;
  context?: { percent: number | null; tokens: number | null; window: number };
  initTokens?: number; // before the first response: lower bound of the first request (system prompt + tool schemas)
  cacheHit?: number;
  requests: number;
  input: number;
  output: number;
  cost: number;
  subscription: boolean;
  quotaKind?: QuotaKind;
  quota?: ProviderQuota;
  guard?: string; // status text of "pitcrew.guard"; undefined = guard not loaded
  gate?: string; // status text of "pitcrew.gate"
  statuses: string[]; // other statuses, sorted by key
  now: number;
}

const STALE_MS = 15 * 60_000;
const SEP = " · ";
const hasAnsi = (s: string) => s.includes("\x1b[");

export function until(seconds: number): string {
  if (seconds <= 0) return "now";
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}`;
  return `${Math.max(1, Math.floor(seconds / 60))}m`;
}

/** Burn rate as in the owner's statusline.sh: used% / elapsed%, 1.0 = on pace, capped at 9.9. */
export function pace(used: number, resetsAt: number, minutes: number, now: number): number | undefined {
  const window = minutes * 60;
  const elapsed = window - (resetsAt - now / 1000);
  // Early in a window one request reads as a huge rate: no pace before 5 % of it passed (15 min of 5 h).
  if (elapsed < window * 0.05 || elapsed > window) return undefined;
  return Math.min(9.9, Math.round((used * window * 10) / (elapsed * 100)) / 10);
}

const level = (pct: number) => (pct >= 80 ? "error" : pct >= 50 ? "warning" : undefined);

interface Opts {
  provider: boolean;
  pace: boolean;
  longReset: boolean;
  tokens: boolean;
}

function quotaParts(s: FooterState, t: Theme, o: Opts): string[] {
  const q = s.quota;
  if (!q || !s.quotaKind) return [];
  const out: string[] = [];
  const color = (pct: number, text: string) => (level(pct) ? t.fg(level(pct)!, text) : text);
  const win = (label: string, name: string, showReset: boolean) => {
    const w = q.windows[name];
    const used = currentUse(w, s.now);
    if (!w || used === undefined) return;
    let text = color(used, `${label} ${Math.round(used)}%`);
    if (showReset && w.resetsAt && w.resetsAt * 1000 > s.now) text += t.fg("dim", ` ↻${until(w.resetsAt - s.now / 1000)}`);
    if (o.pace && s.quotaKind === "claude" && name === "5h" && w.resetsAt && w.minutes) {
      const p = pace(used, w.resetsAt, w.minutes, s.now);
      if (p !== undefined) text += " " + (p >= 1 ? t.fg("error", `${p.toFixed(1)}×`) : t.fg("success", `${p.toFixed(1)}×`));
    }
    out.push(text);
  };
  if (s.quotaKind === "claude") {
    win("5h", "5h", true);
    win("7d", "7d", o.longReset);
    if (q.status === "rejected") {
      const reset = q.resetsAt ?? Math.max(0, ...Object.values(q.windows).filter((w) => w.used >= 100).map((w) => w.resetsAt ?? 0));
      out.push(t.fg("error", reset ? `LIMIT ↻${until(reset - s.now / 1000)}` : "LIMIT"));
      if (q.overage && /^allowed/.test(q.overage.status ?? "")) out.push(t.fg("error", "EXTRA USAGE"));
    }
  } else {
    win("cx 5h", "5h", false);
    win("wk", "7d", o.longReset);
    if (q.limitReached && q.credits?.has) out.push(t.fg("error", "credits"));
    else if (q.limitReached) out.push(t.fg("error", "LIMIT"));
  }
  const age = s.now - q.observedAt;
  if (out.length && age > STALE_MS) out.push(t.fg("dim", `${until(age / 1000)} ago`));
  return out;
}

function guardPart(s: FooterState, t: Theme): string {
  if (s.guard === undefined) return t.fg("warning", "guard off");
  const text = s.guard.trim() || "guard";
  if (hasAnsi(text)) return text;
  return /\boff\b/.test(text) ? t.fg("error", text) : t.fg("dim", text);
}

function gatePart(s: FooterState, t: Theme): string | undefined {
  const text = s.gate?.trim();
  if (!text) return undefined;
  if (hasAnsi(text)) return text;
  if (text.includes("✓")) return t.fg("success", text);
  if (text.includes("●") || text.includes("↻")) return t.fg("warning", text);
  return t.fg("dim", text);
}

function leftParts(s: FooterState, t: Theme, o: Opts): string[] {
  const parts: string[] = [];
  const c = s.context;
  if (s.requests === 0 && s.initTokens) parts.push(t.fg("dim", `ctx ≥${formatTokens(s.initTokens)} init`));
  else if (c) {
    const pct = c.percent;
    const window = formatTokens(c.window).replace(/\.0(?=[kM]$)/, "");
    const text = pct === null ? `ctx ?/${window}` : `ctx ${pct < 10 ? pct.toFixed(1) : Math.round(pct)}% ${formatTokens(c.tokens ?? 0)}/${window}`;
    parts.push(pct !== null && pct >= CTX_RED ? t.fg("error", text) : pct !== null && pct >= CTX_YELLOW ? t.fg("warning", text) : t.fg("dim", text));
  }
  if (s.cacheHit !== undefined) {
    const text = `CH ${Math.round(s.cacheHit)}%`;
    parts.push(s.requests >= 2 && s.cacheHit < 50 ? t.fg("error", text) : t.fg("dim", text));
  }
  if (o.tokens && (s.input || s.output)) parts.push(t.fg("dim", `↑${formatTokens(s.input)} ↓${formatTokens(s.output)}`));
  if (s.cost || s.subscription) parts.push(t.fg("dim", `${s.subscription ? "≈$" : "$"}${s.cost.toFixed(2)}`));
  return parts;
}

function modelText(s: FooterState, o: Opts): string {
  let text = s.selected;
  if (s.local) text += " • local";
  else if (s.routed && s.routed !== s.selected) text += ` → ${s.routed.replace(/^claude-/, "")}`;
  if (s.thinking) text += ` • ${s.thinking}`;
  if (o.provider && s.provider) text = `(${s.provider}) ${text}`;
  return text;
}

function join(left: string, right: string, width: number): string | undefined {
  const gap = width - visibleWidth(left) - visibleWidth(right);
  if (gap < 2) return undefined;
  return left + " ".repeat(gap) + right;
}

// Narrow terminals drop segments in this order: provider, pace, 7d reset, tokens; then the right
// column of line 2 moves to its own line.
const STEPS: Opts[] = [
  { provider: true, pace: true, longReset: true, tokens: true },
  { provider: false, pace: true, longReset: true, tokens: true },
  { provider: false, pace: false, longReset: true, tokens: true },
  { provider: false, pace: false, longReset: false, tokens: true },
  { provider: false, pace: false, longReset: false, tokens: false },
];

export function renderFooter(s: FooterState, width: number, t: Theme): string[] {
  const location = t.fg("dim", s.location);
  const short = t.fg("dim", modelText(s, STEPS[1]));
  const line1 =
    join(location, t.fg("dim", modelText(s, STEPS[0])), width) ??
    join(location, short, width) ??
    (width - visibleWidth(short) - 2 >= 16
      ? join(truncateToWidth(location, width - visibleWidth(short) - 2, t.fg("dim", "…")), short, width)
      : undefined) ??
    location;
  let lines: string[] = [];
  for (const o of STEPS.slice(1)) {
    const left = leftParts(s, t, o).join(t.fg("dim", SEP));
    const right = [...quotaParts(s, t, o), guardPart(s, t), gatePart(s, t)].filter(Boolean).join(t.fg("dim", SEP));
    const line2 = join(left, right, width);
    if (line2 !== undefined) { lines = [line1, line2]; break; }
    if (o === STEPS[STEPS.length - 1]) lines = [line1, left, right];
  }
  const out = lines.filter((l) => l !== "").map((l) => truncateToWidth(l, width, t.fg("dim", "…")));
  if (s.statuses.length) out.push(truncateToWidth(s.statuses.join(" "), width, t.fg("dim", "…")));
  return out;
}

/** Plain-text quota line for /stats. */
export function quotaSummary(kind: QuotaKind, quota: ProviderQuota, now = Date.now()): string {
  const plain: Theme = { fg: (_c, text) => text };
  const s = { quotaKind: kind, quota, now } as FooterState;
  const age = until((now - quota.observedAt) / 1000);
  return `${kind}: ${quotaParts(s, plain, STEPS[0]).join(SEP)} (seen ${age === "now" ? "just now" : age + " ago"})`;
}
