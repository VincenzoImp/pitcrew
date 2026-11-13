import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { childArgs } from "../lib/rpc-child.ts";
import { childTools, loadAgents, parseAgent, skillPaths, spawnRefusal } from "../lib/agents.ts";

const file = (fm, body = "Prompt.") => `---\n${fm}\n---\n${body}\n`;
const base = "name: x\ndescription: d\ntools: read, grep\nrole: scout";
const shipped = fileURLToPath(new URL("../agents/", import.meta.url));

test("shipped agents parse with a valid spawn graph and name roles only", () => {
  const { agents, errors } = loadAgents([shipped]);
  assert.deepEqual(errors, []);
  assert.deepEqual([...agents.keys()].sort(), ["researcher", "reviewer", "scout", "worker"]);
  assert.deepEqual(agents.get("worker").spawns, ["scout"]);
  // A researcher is a scout with web tools: same role (model), different tools.
  const roles = { researcher: "scout" };
  for (const a of agents.values()) assert.equal(a.role, roles[a.name] ?? a.name);
  for (const a of agents.values()) assert.equal("timeoutMs" in a, false, `${a.name}: no time limit per agent`);
  assert.deepEqual(agents.get("researcher").tools.filter((t) => t.startsWith("web_")), ["web_search", "web_fetch"]);
});

test("agent parsing rejects unknown tools, a model or thinking field, an unknown role", () => {
  assert.throws(() => parseAgent(file("name: x\ndescription: d\ntools: read, hack"), "x.md"), /unknown tool "hack"/);
  assert.throws(() => parseAgent(file(`${base}\nmodel: role/scout`), "x.md"), /not a model/);
  assert.throws(() => parseAgent(file(`${base}\nthinking: high`), "x.md"), /not a model/);
  assert.throws(() => parseAgent(file("name: x\ndescription: d\ntools: read"), "x.md"), /role "x" is not one of/);
  assert.throws(() => parseAgent(file(`${base}\ntimeout: 30m`), "x.md"), /pitcrew\.agent\.maxMinutes/);
  assert.throws(() => parseAgent(file(base, ""), "x.md"), /empty prompt/);
  const ok = parseAgent(file("name: verifier\ndescription: d\ntools: read, bash\nrole: reviewer"), "v.md");
  assert.equal(ok.role, "reviewer");
});

test("a spawns entry with an unknown agent is rejected, and so are its spawners", () => {
  const dir = mkdtempSync(join(tmpdir(), "agents-"));
  writeFileSync(join(dir, "a.md"), file("name: a\ndescription: d\ntools: read\nrole: worker\nspawns: ghost"));
  writeFileSync(join(dir, "b.md"), file("name: b\ndescription: d\ntools: read\nrole: worker\nspawns: [a]"));
  const { agents, errors } = loadAgents([dir]);
  assert.deepEqual([...agents.keys()], []);
  assert.match(errors[0], /a\.md: spawns unknown agent "ghost"/);
  assert.match(errors[1], /b\.md: spawns unknown agent "a"/);
});

test("depth and spawn graph", () => {
  const { agents } = loadAgents([shipped]);
  assert.ok(childTools(agents.get("worker"), 1, 2).includes("agent"));
  assert.ok(!childTools(agents.get("worker"), 2, 2).includes("agent"));
  assert.ok(!childTools(agents.get("scout"), 1, 2).includes("agent"));
  assert.ok(childTools(agents.get("scout"), 1, 2).includes("ask_parent"));
  assert.equal(spawnRefusal(0, [], "reviewer", 2), undefined);
  assert.equal(spawnRefusal(1, ["scout"], "scout", 2), undefined);
  assert.match(spawnRefusal(1, ["scout"], "reviewer", 2), /^agent:/);
  assert.match(spawnRefusal(2, ["scout"], "scout", 2), /^depth:/);
});

test("a child loads only its agent's skills; no skills key keeps them all; an unknown skill is an error", () => {
  const skills = fileURLToPath(new URL("../skills/", import.meta.url));
  const { agents } = loadAgents([shipped]);
  for (const a of agents.values()) skillPaths(a, [skills]); // every shipped skill name exists
  const worker = skillPaths(agents.get("worker"), [skills]);
  assert.ok(worker.some((d) => d.endsWith("/github")));
  const args = childArgs({ model: "role/worker", tools: ["read"], skills: worker }, "/r").join(" ");
  assert.match(args, /--no-skills --skill \S+\/github(\s|$)/);
  assert.deepEqual(skillPaths(agents.get("scout"), [skills]), []);
  assert.ok(childArgs({ model: "role/scout", tools: ["read"], skills: [] }, "/r").includes("--no-skills"));
  assert.equal(skillPaths(parseAgent(file(base), "x.md"), [skills]), undefined);
  assert.ok(!childArgs({ model: "role/x", tools: ["read"] }, "/r").includes("--no-skills"));
  assert.throws(() => skillPaths(parseAgent(file(`${base}\nskills: nope`), "x.md"), [skills]), /unknown skill "nope"/);
});
