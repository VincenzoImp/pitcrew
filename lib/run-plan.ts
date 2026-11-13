// `pitcrew run` and `pitcrew status`, pure part: targets, settings, the frontier, request ids and the
// digest. No I/O: lib/run.ts feeds it GitHub state and the run ledger. Docs: docs/runner.md.

/** One issue of the target, as the runner needs it. */
export interface Issue {
  number: number;
  title: string;
  open: boolean;
  labels: string[];
  /** Open issues that block this one. */
  blockers: number[];
  /** Open sub-issues: a parent is done through its children, never worked on itself. */
  openSubs: number;
  url: string;
}

/**
 * Where an issue stands in the ledger:
 * new → work (a worker ran) → gates (commits exist: verify, PR, CI, review) → done (merged),
 * or ready (PR waits for the owner, stop `pr`), local (verified branch, stop `local`), blocked.
 */
export type Phase = "new" | "work" | "gates" | "ready" | "local" | "done" | "blocked";
export interface IssueState {
  phase: Phase;
  /** Workers started for the first build of this issue (restarts after a kill or a crash count). */
  attempts: number;
  /** Fix rounds used after a failed check. */
  rounds: number;
  branch?: string;
  worktree?: string;
  pr?: number;
  reason?: string;
  tokens: number;
  turns: number;
  ms: number;
}
export interface RunEntry { id: string; startedAt: string; endedAt?: string; stop?: string; issues: number[] }
export interface Ledger { target: string; args: string[]; repo: string; issues: Record<string, IssueState>; runs: RunEntry[]; /** The release cut for this milestone. */ release?: string }

export type Target = { kind: "milestone"; title: string } | { kind: "label"; name: string } | { kind: "issues"; numbers: number[] };

/** `12 13` (issues; one issue with sub-issues is a parent), `label:<name>`, else a milestone title. */
export function parseTarget(args: string[]): Target {
  const text = args.join(" ").trim();
  if (!text) throw new Error("name a target: a milestone title, a parent issue, label:<name>, or issue numbers");
  if (args.every((a) => /^#?\d+$/.test(a))) return { kind: "issues", numbers: args.map((a) => Number(a.replace("#", ""))) };
  if (text.startsWith("label:")) return { kind: "label", name: text.slice(6).trim() };
  return { kind: "milestone", title: text };
}

export const describeTarget = (t: Target) =>
  t.kind === "milestone" ? `milestone "${t.title}"` : t.kind === "label" ? `label ${t.name}` : t.numbers.map((n) => `#${n}`).join(" ");

/** File name of the target's ledger. */
export const targetKey = (t: Target) =>
  (t.kind === "milestone" ? `milestone-${t.title}` : t.kind === "label" ? `label-${t.name}` : `issues-${t.numbers.join("-")}`)
    .toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

export interface RunnerSettings {
  /** Wall clock of one run, hours. maxHours, maxIssues, workerTurns, workerMinutes: 0 means no limit. */
  maxHours: number;
  /** Issues one run takes on. */
  maxIssues: number;
  /** Worker restarts per issue after a kill or a crash, before it is blocked. */
  maxRestarts: number;
  /** Model turns of one worker, and its minutes. */
  workerTurns: number;
  workerMinutes: number;
  /** Command run in a new worktree before the worker (for example `npm ci`). */
  setup: string;
  /** Workers and the verify command in the sandbox: `foreign` repos only, `always`, or `off`. */
  sandbox: "off" | "foreign" | "always";
}
export const RUNNER_DEFAULTS: RunnerSettings = { maxHours: 0, maxIssues: 0, maxRestarts: 2, workerTurns: 0, workerMinutes: 0, setup: "", sandbox: "foreign" };
/** Label of issues that wait for the owner. */
export const BLOCKED_LABEL = "needs-owner";

/** Merge `pitcrew.runner` sources (global, repo, flags) over the defaults; unknown keys are skipped, a wrong type is an error. */
export function runnerSettings(...sources: (Record<string, unknown> | undefined)[]): RunnerSettings {
  const out: Record<string, unknown> = { ...RUNNER_DEFAULTS };
  for (const source of sources) {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (value === undefined || !(key in RUNNER_DEFAULTS)) continue;
      const want = typeof RUNNER_DEFAULTS[key as keyof RunnerSettings];
      const v = want === "number" && typeof value === "string" && /^\d+(\.\d+)?$/.test(value) ? Number(value) : value;
      if (typeof v !== want || (want === "number" && (v as number) < 0)) throw new Error(`pitcrew.runner.${key}: "${value}" is not a ${want}`);
      out[key] = v;
    }
  }
  if (!["off", "foreign", "always"].includes(out.sandbox as string)) throw new Error("pitcrew.runner.sandbox: off, foreign or always");
  return out as unknown as RunnerSettings;
}

export const newState = (): IssueState => ({ phase: "new", attempts: 0, rounds: 0, tokens: 0, turns: 0, ms: 0 });

const WAITING: ReadonlySet<Phase> = new Set(["ready", "local", "done"]);

/**
 * What can start now, in order: open, no open blocker, no open sub-issue, not waiting for the owner
 * (blocked label, or a PR or branch handed over). Work already in progress comes first. A blocked
 * issue whose label the owner removed is given back to the runner.
 */
export function frontier(issues: Issue[], ledger: Ledger): Issue[] {
  const state = (i: Issue) => ledger.issues[i.number]?.phase ?? "new";
  const ready = issues.filter((i) => i.open && !i.blockers.length && !i.openSubs && !i.labels.includes(BLOCKED_LABEL) && !WAITING.has(state(i)));
  const busy = (i: Issue) => state(i) === "work" || state(i) === "gates";
  return [...ready.filter(busy), ...ready.filter((i) => !busy(i))];
}

/** Hidden marker that makes a GitHub write a request with a stable id: a rerun finds it and skips the write. */
export const marker = (id: string) => `<!-- pitcrew-run:${id} -->`;
export const hasMarker = (bodies: string[], id: string) => bodies.some((b) => b.includes(marker(id)));

/** `42-session-resume`: the default branch name of the github skill. */
export const branchName = (issue: Pick<Issue, "number" | "title">) =>
  `${issue.number}-${issue.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "issue"}`;

/** The next 0.x release after the repo's tags: v0.3.1 → v0.4.0. None when the repo has no 0.x release. */
export function nextRelease(tags: string[]): string | undefined {
  const found = tags.map((t) => /^(v?)0\.(\d+)\.(\d+)$/.exec(t)).filter((m) => m) as RegExpExecArray[];
  if (!found.length) return undefined;
  const top = found.sort((a, b) => Number(b[2]) - Number(a[2]) || Number(b[3]) - Number(a[3]))[0];
  return `${top[1]}0.${Number(top[2]) + 1}.0`;
}

export interface Digest {
  total: number;
  done: string[];
  progress: string[];
  review: string[];
  blocked: string[];
  waiting: string[];
  next?: number;
}

/** One digest of the target: done, in progress, in review, blocked (with reasons), waiting, next. */
export function digest(issues: Issue[], ledger: Ledger): Digest {
  const d: Digest = { total: issues.length, done: [], progress: [], review: [], blocked: [], waiting: [], next: frontier(issues, ledger)[0]?.number };
  for (const i of issues) {
    const s = ledger.issues[i.number];
    const pr = s?.pr ? ` PR #${s.pr}` : "";
    if (!i.open) d.done.push(`#${i.number}${pr}`);
    else if (i.labels.includes(BLOCKED_LABEL) || s?.phase === "blocked") d.blocked.push(`#${i.number}${pr}: ${s?.reason ?? `label ${BLOCKED_LABEL}`}`);
    else if (s?.phase === "ready" || s?.phase === "local") d.review.push(`#${i.number}${pr || ` branch ${s.branch}`}`);
    else if (s?.phase === "work" || s?.phase === "gates") d.progress.push(`#${i.number}${pr} (${s.phase}, attempt ${s.attempts}, fix round ${s.rounds})`);
    else if (i.blockers.length || i.openSubs) d.waiting.push(`#${i.number} after ${i.blockers.length ? i.blockers.map((b) => `#${b}`).join(", ") : "its sub-issues"}`);
  }
  return d;
}

export function renderDigest(d: Digest, title: string): string[] {
  const row = (name: string, items: string[]) => (items.length ? [`${name} (${items.length}): ${items.join("; ")}`] : []);
  return [
    `${title}: ${d.done.length}/${d.total} done`,
    ...row("done", d.done), ...row("in progress", d.progress), ...row("in review", d.review),
    ...row("blocked", d.blocked), ...row("waiting", d.waiting),
    `next: ${d.next ? `#${d.next}` : "none"}`,
  ];
}

/** Project status for a digest: the GitHub values ON_TRACK, AT_RISK, COMPLETE. */
export const projectStatus = (d: Digest) => (d.blocked.length ? "AT_RISK" : d.done.length === d.total ? "COMPLETE" : "ON_TRACK");

/** Why the run must stop before the next issue, if it must. */
export function budgetStop(b: { now: number; deadline: number; taken: number; maxIssues: number }): string | undefined {
  if (b.now >= b.deadline) return "wall clock budget used (maxHours)";
  if (b.maxIssues && b.taken >= b.maxIssues) return `${b.maxIssues} issues taken (maxIssues)`;
  return undefined;
}

/**
 * The time limit of one child: the smaller of its own limit and what is left of the run, at least a
 * minute. 0 for either means none; 0 back means no limit at all.
 */
export function childLimitMs(own: number, left: number): number {
  const limits = [own, left].filter((ms) => ms > 0 && Number.isFinite(ms));
  return limits.length ? Math.max(60_000, Math.min(...limits)) : 0;
}

const kTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));

/** Tokens per issue and in total, from the ledger (every worker and reviewer of the issue). */
export function tokenLine(ledger: Ledger): string | undefined {
  const rows = Object.entries(ledger.issues).filter(([, s]) => s.tokens > 0);
  if (!rows.length) return undefined;
  const total = rows.reduce((n, [, s]) => n + s.tokens, 0);
  return `tokens: ${rows.map(([n, s]) => `#${n} ${kTokens(s.tokens)}`).join(", ")}; total ${kTokens(total)}`;
}

/** The budgets with no limit, said at the start of a run. */
export function unbounded(cfg: RunnerSettings, agentLimitMs: number): string[] {
  const names = (["maxHours", "maxIssues", "workerTurns", "workerMinutes"] as const).filter((k) => !cfg[k]);
  return agentLimitMs ? names : [...names, "agent.maxMinutes"];
}

/** Why the run stopped on a quota refusal, and how to go on. */
export const quotaRefusalText = (why: string) =>
  `provider quota used up (${why.split("\n")[0].slice(0, 200)}); nothing is lost: run the same command again after the reset`;

/** The last `lines` lines of a text, for issue comments and fix prompts. */
export const tail = (text: string, lines = 40) => text.trimEnd().split("\n").slice(-lines).join("\n");
