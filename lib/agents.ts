import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { ROLES } from "./profile.ts";

// Agent definitions: one Markdown file per agent (agents/<name>.md, then ~/.pi/agent/agents/ which
// overrides by name). Frontmatter: name, description, tools, role, spawns, skills. The body is
// appended to the child's system prompt. An agent names a role (`role/<role>` is its pi model);
// the session's profile decides model and thinking, so a file never names either.

export interface AgentDef {
  name: string;
  description: string;
  tools: string[];
  /** Role from the profile: lead, worker, scout, reviewer, second. */
  role: string;
  spawns: string[];
  /** Skills the child loads (`skills: a, b`, or `none`); undefined: every skill. */
  skills?: string[];
  prompt: string;
  file: string;
}

/** Tools an agent may list. `agent` and `ask_parent` are added by the runner, never listed. */
export const AGENT_TOOLS = new Set(["read", "grep", "find", "ls", "bash", "edit", "write", "web_search", "web_fetch"]);

const list = (value: unknown): string[] =>
  (Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [])
    .filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);

/** Parse one agent file. Throws with the file name on any invalid field. */
export function parseAgent(text: string, file: string): AgentDef {
  const { frontmatter: fm, body } = parseFrontmatter<Record<string, unknown>>(text);
  const where = basename(file);
  const name = typeof fm.name === "string" ? fm.name : basename(file, ".md");
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`${where}: invalid name "${name}"`);
  if (typeof fm.description !== "string" || !fm.description.trim()) throw new Error(`${where}: description missing`);
  if (fm.model !== undefined || fm.thinking !== undefined) throw new Error(`${where}: name a role, not a model or thinking level`);
  const tools = list(fm.tools);
  if (tools.length === 0) throw new Error(`${where}: tools missing`);
  for (const t of tools) if (!AGENT_TOOLS.has(t)) throw new Error(`${where}: unknown tool "${t}"`);
  const role = typeof fm.role === "string" ? fm.role.trim() : name;
  if (!(ROLES as readonly string[]).includes(role)) throw new Error(`${where}: role "${role}" is not one of ${ROLES.join(", ")}`);
  // No time limit per agent: one setting for every child (pitcrew.agent.maxMinutes, off by default).
  if (fm.timeout !== undefined) throw new Error(`${where}: no timeout per agent; set pitcrew.agent.maxMinutes for every child`);
  if (!body.trim()) throw new Error(`${where}: empty prompt`);
  const skills = fm.skills === undefined ? undefined : list(fm.skills).filter((s) => s !== "none");
  return { name, description: fm.description.trim(), tools, role, spawns: list(fm.spawns), skills, prompt: body.trim() + "\n", file };
}

/** Load agents from dirs in order (later dirs override earlier ones), then check the spawn graph. */
export function loadAgents(dirs: string[]): { agents: Map<string, AgentDef>; errors: string[] } {
  const agents = new Map<string, AgentDef>();
  const errors: string[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
      const file = join(dir, entry);
      try {
        const def = parseAgent(readFileSync(file, "utf8"), file);
        agents.set(def.name, def);
      } catch (error) {
        errors.push((error as Error).message);
      }
    }
  }
  // Drop agents that spawn an unknown (or dropped) agent, until the graph is closed.
  for (let changed = true; changed;) {
    changed = false;
    for (const def of agents.values()) {
      const bad = def.spawns.filter((s) => !agents.has(s));
      if (!bad.length) continue;
      errors.push(`${basename(def.file)}: spawns unknown agent ${bad.map((b) => `"${b}"`).join(", ")}`);
      agents.delete(def.name);
      changed = true;
    }
  }
  return { agents, errors };
}

/** Paths of an agent's skills: the first of `roots` that holds `<name>/SKILL.md`. Throws on an unknown name. */
export function skillPaths(def: AgentDef, roots: string[]): string[] | undefined {
  return def.skills?.map((name) => {
    const dir = roots.map((r) => join(r, name)).find((d) => existsSync(join(d, "SKILL.md")));
    if (!dir) throw new Error(`${basename(def.file)}: unknown skill "${name}"`);
    return dir;
  });
}

/** Tools passed to a child with `--tools`. A child gets `agent` only if it may spawn and is not at max depth. */
export function childTools(def: AgentDef, childDepth: number, maxDepth: number): string[] {
  const tools = [...def.tools, "ask_parent"];
  if (def.spawns.length > 0 && childDepth < maxDepth) tools.push("agent");
  return tools;
}

/**
 * Whether a caller may start agent `name`. The top session (depth 0) may start any agent; a child
 * may start only agents in its own `spawns` list (PITCREW_SPAWNS), and only below maxDepth.
 */
export function spawnRefusal(callerDepth: number, callerSpawns: string[], name: string, maxDepth: number): string | undefined {
  if (callerDepth + 1 > maxDepth) return `depth: a child at depth ${callerDepth} cannot start agents (max depth ${maxDepth})`;
  if (callerDepth > 0 && !callerSpawns.includes(name)) {
    return `agent: this agent may start only ${callerSpawns.join(", ") || "nothing"}, not ${name}`;
  }
  return undefined;
}
