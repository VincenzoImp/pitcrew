// Session mode: two dials (stop, rigor) and the four switches behind rigor; tracking is a repo
// setting. Pure logic. extensions/mode wires it to pi; every other part reads it with currentMode().
// Docs: docs/mode.md.

export const STOP = ["plan", "local", "pr", "merge", "milestone"] as const;
export const RIGOR = ["fast", "standard", "strict"] as const;
export const TRACKING = ["none", "local", "github"] as const;

/** Every switch and its allowed values. The first value of each list is the most permissive. */
export const SWITCHES = {
  issueRequired: ["off", "on"], // with tracking github: a PR must close an issue
  verify: ["off", "remind", "on"], // on: the harness runs the repo's checks; remind: only a reminder
  review: ["off", "auto", "on"], // a fresh reviewer; auto: when the agent merges by itself (stop merge or milestone)
  leanCode: ["off", "warn", "block"], // PR size and test-to-code checks
} as const;

export type Stop = (typeof STOP)[number];
export type Rigor = (typeof RIGOR)[number];
export type Tracking = (typeof TRACKING)[number];
export type SwitchName = keyof typeof SWITCHES;
export type Switches = { [K in SwitchName]: (typeof SWITCHES)[K][number] };
export interface Mode {
  stop: Stop;
  rigor: Rigor;
  switches: Switches;
  /** Resolved for the session's repo (trackingFor); unset until then. */
  tracking?: Tracking;
}
/** A partial mode: what one source (settings, parent, session, flags) sets. `tracking` is not read from it. */
export interface ModeInput {
  stop?: string;
  rigor?: string;
  switches?: Record<string, string>;
  tracking?: string;
}

export const PRESETS: Record<Rigor, Switches> = {
  fast: { issueRequired: "off", verify: "on", review: "off", leanCode: "off" },
  standard: { issueRequired: "on", verify: "on", review: "auto", leanCode: "warn" },
  strict: { issueRequired: "on", verify: "on", review: "on", leanCode: "block" },
};
/** Automatic fix rounds after a failed check, per rigor. */
export const FIX_ROUNDS: Record<Rigor, number> = { fast: 1, standard: 2, strict: 2 };
export const DEFAULTS = { stop: "pr", rigor: "standard" } as const;
export const ENV_MODE = "PITCREW_MODE";

const pick = <T extends string>(value: string | undefined, allowed: readonly T[], label: string): T | undefined => {
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`${label}: "${value}" is not one of ${allowed.join(", ")}`);
  }
  return value as T;
};

/**
 * Build the mode from its sources, weakest first (settings, parent, session, flags).
 * The last source that sets a dial wins. Switches start from the preset of the final rigor;
 * then each source's own switches apply in the same order. Unknown names are skipped
 * (settingsNotice reports them); a bad value throws.
 */
export function resolveMode(...sources: (ModeInput | undefined)[]): Mode {
  const mode = { ...DEFAULTS } as { stop: Stop; rigor: Rigor };
  for (const source of sources) {
    mode.stop = pick(source?.stop, STOP, "stop") ?? mode.stop;
    mode.rigor = pick(source?.rigor, RIGOR, "rigor") ?? mode.rigor;
  }
  const switches: Record<string, string> = { ...PRESETS[mode.rigor] };
  for (const source of sources) {
    for (const [name, value] of Object.entries(source?.switches ?? {})) {
      if (name in SWITCHES) switches[name] = pick(String(value), SWITCHES[name as SwitchName], name) as string;
    }
  }
  return { stop: mode.stop, rigor: mode.rigor, switches: switches as Switches };
}

const knownTracking = (value: unknown) => ((TRACKING as readonly unknown[]).includes(value) ? { tracking: value as Tracking } : {});

/**
 * Where the plan lives in a repo: the setting `pitcrew.tracking`, else `github` when the repo has a
 * GitHub remote you can push to (`permission` from `gh repo view`), else `local`.
 */
export function trackingFor(setting: unknown, permission: string | undefined): Tracking {
  return knownTracking(setting).tracking ?? (permission && ["ADMIN", "MAINTAIN", "WRITE"].includes(permission) ? "github" : "local");
}

/** Does a fresh reviewer check the work? `auto`: only when the agent merges by itself. */
export const reviews = (mode: Mode) =>
  mode.switches.review === "on" || (mode.switches.review === "auto" && (mode.stop === "merge" || mode.stop === "milestone"));

/**
 * Apply `/mode` arguments to the session's own input: `<dial> <value>` (stop, rigor) or
 * `<switch> <value>`. A new rigor drops the session's switch changes, so the preset applies whole.
 */
export function withChange(session: ModeInput, args: string): ModeInput {
  const [name, value, ...rest] = args.trim().split(/\s+/);
  if (!name || !value || rest.length > 0) throw new Error("usage: /mode <stop|rigor|switch> <value>");
  if (name === "stop") return { ...session, stop: pick(value, STOP, name) };
  if (name === "rigor") return { ...session, rigor: pick(value, RIGOR, name), switches: {} };
  if (name === "tracking") throw new Error(`tracking is a repo setting: "pitcrew": { "tracking": "${value}" } in .pi/settings.json`);
  if (!(name in SWITCHES)) {
    throw new Error(`unknown setting "${name}" (dials: stop, rigor; switches: ${Object.keys(SWITCHES).join(", ")})`);
  }
  return { ...session, switches: { ...session.switches, [name]: pick(value, SWITCHES[name as SwitchName], name) as string } };
}

/** The mode of this process, as the mode extension last published it (with tracking). Defaults when it did not. */
export function currentMode(env: NodeJS.ProcessEnv = process.env): Mode {
  try {
    const published = env[ENV_MODE] ? (JSON.parse(env[ENV_MODE] as string) as ModeInput) : undefined;
    return { ...resolveMode(published), ...knownTracking(published?.tracking) };
  } catch {
    return resolveMode();
  }
}

/** Reduce a resolved mode to what was chosen: the dials, tracking, and the switches that differ from the preset. */
export function asInput(mode: ModeInput): ModeInput {
  const resolved = resolveMode(mode);
  const preset = PRESETS[resolved.rigor];
  const switches = Object.fromEntries(Object.entries(resolved.switches).filter(([name, value]) => value !== preset[name as SwitchName]));
  return { stop: resolved.stop, rigor: resolved.rigor, switches, ...knownTracking(mode.tracking) };
}

const STOP_TEXT: Record<Stop, string> = {
  plan: "plan only: change no files (the edit and write tools are off)",
  local: "build, verify and commit on a branch; do not push",
  pr: "go as far as a ready PR; the owner reviews and merges it",
  merge: "merge your PR yourself on its verified head, then tidy",
  milestone: "deliver every issue of the milestone (merge each), then close it and cut its release",
};
const TRACKING_TEXT: Record<Tracking, string> = {
  none: "no plan file, no GitHub objects",
  local: "plans as local Markdown files in the work folder; no GitHub objects",
  github: "work items on GitHub; choose issue, milestone or Project per piece of work",
};

/** The mode as the model reads it: one short message at session start and after each change. */
export function modeMessage(mode: Mode): string {
  const s = mode.switches;
  return [
    `Session mode; stay inside it (the owner changes it with /mode). Stop ${mode.stop}: ${STOP_TEXT[mode.stop]}.`,
    mode.tracking ? `Tracking ${mode.tracking}: ${TRACKING_TEXT[mode.tracking]}.` : "",
    `Rigor ${mode.rigor}:`,
    s.verify === "on" ? "the harness runs the repo's checks when files changed;" : s.verify === "remind" ? "run a check that exercises your change before you reply;" : "no verify check;",
    reviews(mode) ? "a fresh reviewer agent checks the change before you merge or call it done;" : "no automatic review;",
    s.leanCode === "off" ? "" : `keep changes small (\`pitcrew check\` ${s.leanCode === "block" ? "must pass" : "warns"});`,
    mode.tracking === "github" && s.issueRequired === "on" ? "a PR must close an issue (Closes #N);" : "",
    `up to ${FIX_ROUNDS[mode.rigor]} fix rounds after a failed check.`,
  ].filter(Boolean).join(" ");
}

/** Multi-line text for `/mode`. Switches that differ from the rigor preset are marked. */
export function describeMode(mode: Mode): string {
  const preset = PRESETS[mode.rigor];
  const rows = (Object.keys(SWITCHES) as SwitchName[]).map((name) => {
    const changed = mode.switches[name] !== preset[name] ? `  (preset: ${preset[name]})` : "";
    const auto = name === "review" && mode.switches.review === "auto" ? (reviews(mode) ? "  → on: the agent merges" : "  → off: you review the PR") : "";
    return `  ${name.padEnd(14)}${mode.switches[name]}${changed}${auto}`;
  });
  return [
    `stop: ${mode.stop}   rigor: ${mode.rigor}   tracking: ${mode.tracking ?? "not known yet"}`,
    ...rows,
    "This session is not sandboxed: commands run as you on this machine. Only `pitcrew run` uses the sandbox (runner.sandbox).",
  ].join("\n");
}

/** Short text for the footer: `pr · standard`, with `*` when a switch differs from the preset. */
export function shortMode(mode: Mode): string {
  const changed = (Object.keys(SWITCHES) as SwitchName[]).some((name) => mode.switches[name] !== PRESETS[mode.rigor][name]);
  return `${mode.stop} · ${mode.rigor}${changed ? "*" : ""}`;
}
