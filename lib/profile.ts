import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Roles are job names. A profile maps each role to a physical model and a thinking level.
// This file is pure logic; index.ts wires it to pi.

export const ROLES = ["lead", "worker", "scout", "reviewer", "second"] as const;
export const REQUIRED_ROLES = ["lead", "worker", "scout", "reviewer"] as const;
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type Role = (typeof ROLES)[number];
export type Thinking = (typeof THINKING_LEVELS)[number];
export interface RoleSpec {
  model: string; // "provider/model-id"
  thinking: Thinking;
}
export type RoleMap = Partial<Record<Role, RoleSpec>>;
export interface Active {
  profile: string;
  map: RoleMap;
  source: string;
}

/**
 * When nothing names a profile: the first of these whose models are all available (logged in or
 * served). Subscriptions first, then API keys, then a local server.
 */
export const DEFAULT_ORDER = ["claude-bridge", "codex", "anthropic", "openai", "google", "local"] as const;
export const ENV_ROLES = "PITCREW_ROLES";
export const ENV_PROFILE = "PITCREW_PROFILE";

/** The session's role map, as the roles extension publishes it for this process and its children. */
export function currentRoles(env: NodeJS.ProcessEnv = process.env): { profile?: string; map: RoleMap } {
  try {
    const r = JSON.parse(env[ENV_ROLES] ?? "{}");
    return { profile: r.profile, map: r.map ?? {} };
  } catch {
    return { map: {} };
  }
}

const isRole = (value: string): value is Role => (ROLES as readonly string[]).includes(value);
const isThinking = (value: unknown): value is Thinking => (THINKING_LEVELS as readonly unknown[]).includes(value);
const isModel = (value: unknown): value is string => typeof value === "string" && /^[^/\s]+\/\S+$/.test(value);

export function splitModel(model: string): [provider: string, id: string] {
  const slash = model.indexOf("/");
  return [model.slice(0, slash), model.slice(slash + 1)];
}

/** Check a role map. `complete` also requires every required role. Throws with the reason. */
export function checkMap(value: unknown, label: string, complete = true): RoleMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label}: not an object`);
  const map: RoleMap = {};
  for (const [role, spec] of Object.entries(value as Record<string, Partial<RoleSpec> | null>)) {
    if (!isRole(role)) throw new Error(`${label}: unknown role "${role}" (roles: ${ROLES.join(", ")})`);
    if (!isModel(spec?.model)) throw new Error(`${label}: role "${role}" needs model "provider/model-id"`);
    if (!isThinking(spec.thinking)) {
      throw new Error(`${label}: role "${role}" needs thinking, one of ${THINKING_LEVELS.join(", ")}`);
    }
    map[role] = { model: spec.model, thinking: spec.thinking };
  }
  if (complete) {
    for (const role of REQUIRED_ROLES) if (!map[role]) throw new Error(`${label}: role "${role}" is missing`);
  }
  return map;
}

/** Read `<dir>/*.json` from each directory. A later directory replaces a profile of the same name. */
export function loadProfiles(dirs: string[]): Record<string, RoleMap> {
  const profiles: Record<string, RoleMap> = {};
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith(".json")) continue;
      const path = join(dir, file);
      profiles[file.slice(0, -".json".length)] = checkMap(JSON.parse(readFileSync(path, "utf8")), path);
    }
  }
  return profiles;
}

export interface ActiveInputs {
  profiles: Record<string, RoleMap>;
  flag?: string; // --profile
  envRoles?: string; // PITCREW_ROLES: snapshot from a parent session
  envProfile?: string; // PITCREW_PROFILE
  session?: unknown; // last saved state of the session being resumed
  setting?: string; // pitcrew.profile
  available?: string[]; // models pi can use now, as provider/model-id: picks the default
}

/** The first profile of DEFAULT_ORDER whose every model is in `available`. */
export function firstWorking(profiles: Record<string, RoleMap>, available: string[]): string | undefined {
  const have = new Set(available);
  return DEFAULT_ORDER.find((name) => profiles[name] && Object.values(profiles[name]).every((spec) => have.has(spec!.model)));
}

/**
 * Pick the role map of a session. First match wins:
 * --profile, parent snapshot, PITCREW_PROFILE, saved session state, setting, the first working profile.
 * An explicit name that does not exist is an error; nothing falls back silently.
 */
export function chooseActive(inputs: ActiveInputs): Active {
  const named = (name: string, source: string): Active => {
    const map = inputs.profiles[name];
    if (!map) {
      throw new Error(`${source}: no profile "${name}" (have: ${Object.keys(inputs.profiles).join(", ") || "none"})`);
    }
    return { profile: name, map: { ...map }, source };
  };
  const saved = (text: unknown, source: string): Active => {
    const state = (typeof text === "string" ? JSON.parse(text) : text) as { profile?: unknown; map?: unknown };
    return { profile: String(state?.profile ?? "session"), map: checkMap(state?.map, source), source };
  };
  if (inputs.flag) return named(inputs.flag, "--profile");
  if (inputs.envRoles) return saved(inputs.envRoles, ENV_ROLES);
  if (inputs.envProfile) return named(inputs.envProfile, ENV_PROFILE);
  if (inputs.session) return saved(inputs.session, "session");
  if (inputs.setting) return named(inputs.setting, "pitcrew.profile");
  const first = inputs.available && firstWorking(inputs.profiles, inputs.available);
  if (first) return named(first, "first working profile");
  throw new Error(`no profile is set and no shipped profile has all its models available${inputs.available ? ` (available: ${[...new Set(inputs.available.map((m) => splitModel(m)[0]))].join(", ") || "none"})` : ""}; run \`pitcrew init\`, set pitcrew.profile, or pass --profile`);
}

/** The state saved in the session and passed to children. */
export function snapshot(active: Active): { profile: string; map: RoleMap } {
  return { profile: active.profile, map: active.map };
}

/**
 * Parse the arguments of `/role`: `<role> [provider/model][:thinking]`.
 * `lead provider/model-id:high` sets both, `scout :low` only the level, `worker provider/model-id` only the model.
 */
export function parseRoleArgs(args: string): { role: Role; model?: string; thinking?: Thinking } {
  const [role, target, ...rest] = args.trim().split(/\s+/);
  if (!role || !isRole(role)) throw new Error(`unknown role "${role ?? ""}" (roles: ${ROLES.join(", ")})`);
  if (!target || rest.length > 0) throw new Error("usage: /role <role> [provider/model][:thinking]");
  const colon = target.lastIndexOf(":");
  const suffix = colon >= 0 ? target.slice(colon + 1) : undefined;
  const thinking = isThinking(suffix) ? suffix : undefined;
  const model = thinking ? target.slice(0, colon) : target;
  if (model && !isModel(model)) throw new Error(`"${model}" is not "provider/model-id"`);
  if (!model && !thinking) throw new Error("usage: /role <role> [provider/model][:thinking]");
  return { role, model: model || undefined, thinking };
}

/** Apply a `/role` change. The result is a new Active marked as changed from its profile. */
export function withRole(active: Active, change: ReturnType<typeof parseRoleArgs>): Active {
  const current = active.map[change.role];
  const model = change.model ?? current?.model;
  if (!model) throw new Error(`role "${change.role}" has no model yet; give one`);
  const thinking = change.thinking ?? current?.thinking ?? "medium";
  const profile = active.profile.endsWith("*") ? active.profile : `${active.profile}*`;
  return { profile, map: { ...active.map, [change.role]: { model, thinking } }, source: "/role" };
}

export interface Completion {
  value: string;
  label: string;
  description?: string;
}

const contains = (item: string, part: string) => item.toLowerCase().includes(part.toLowerCase());

/**
 * Completions for the arguments of `/role`. `text` is everything after `/role `, and each value
 * replaces all of it. First word: the roles. Second word: the available models (`provider/model-id`),
 * or the thinking levels after a `:`. A word matches when it is a part of the item, in any case.
 */
export function roleCompletions(text: string, models: string[], current: RoleMap = {}): Completion[] | null {
  const words = text.trimStart().split(/\s+/);
  let items: Completion[] = [];
  if (words.length === 1) {
    items = ROLES.filter((role) => contains(role, words[0])).map((role) => {
      const spec = current[role];
      return { value: `${role} `, label: role, description: spec ? `${spec.model}  ${spec.thinking}` : "no model" };
    });
  } else if (words.length === 2 && isRole(words[0])) {
    const [role, target] = words;
    const colon = target.lastIndexOf(":");
    const part = target.slice(colon + 1);
    const levels = colon >= 0 ? THINKING_LEVELS.filter((level) => level.startsWith(part)) : [];
    items = levels.length
      ? levels.map((level) => ({ value: `${role} ${target.slice(0, colon)}:${level}`, label: `${target.slice(0, colon)}:${level}` }))
      : models.filter((model) => contains(model, target)).map((model) => ({ value: `${role} ${model}`, label: model }));
  }
  return items.length > 0 ? items : null;
}

/** Completions for `/profile`: the profile names that contain `text`. */
export function profileCompletions(text: string, names: string[]): Completion[] | null {
  const items = names.filter((name) => contains(name, text.trim())).map((name) => ({ value: name, label: name }));
  return items.length > 0 ? items : null;
}

/** One line per role, for `/profile` and `/role` output. */
export function describe(active: Active): string {
  const rows = ROLES.filter((role) => active.map[role]).map((role) => {
    const spec = active.map[role] as RoleSpec;
    return `  ${role.padEnd(9)}${spec.model}  ${spec.thinking}`;
  });
  return [`profile: ${active.profile} (from ${active.source})`, ...rows].join("\n");
}
