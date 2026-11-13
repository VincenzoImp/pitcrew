import { toplevel } from "./git.ts";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Find the project's one verify command. First match wins:
// PI_VERIFY; package.json script `verify`, then `check` (runner from the lockfile);
// Makefile or justfile target `verify`; executable `scripts/verify`. Only when none of these
// exists: the package.json script `test` (not npm's placeholder that only fails), then a
// Makefile or justfile target `test`.

export interface VerifyCommand {
  /** Shell command, run from `root`. */
  command: string;
  /** Where it came from: "PI_VERIFY", "package.json", "Makefile", "justfile", "scripts/verify". */
  source: string;
  /** Project root: git top level of cwd, or cwd. */
  root: string;
  /** Why this command, for the output: "the `check` script in package.json". */
  reason: string;
}

export const gitRoot = toplevel;

/** "npm run check (the `check` script in package.json)": the command and why it was chosen. */
export const describeVerify = (v: VerifyCommand) => `${v.command} (${v.reason})`;

const FALLBACK = "no verify or check script, verify target or scripts/verify";
const NPM_PLACEHOLDER = /no test specified/;
const MAKEFILES = [["Makefile", "make"], ["makefile", "make"], ["GNUmakefile", "make"], ["justfile", "just"], ["Justfile", "just"]];

function runner(root: string): string {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm run";
  if (existsSync(join(root, "yarn.lock"))) return "yarn run";
  if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))) return "bun run";
  return "npm run";
}

const read = (path: string) => { try { return readFileSync(path, "utf8"); } catch { return undefined; } };

function makeTarget(root: string, target: string): { file: string; tool: string } | undefined {
  const rule = new RegExp(`^${target}\\b[^:=\\n]*:(?!=)`, "m");
  for (const [file, tool] of MAKEFILES) {
    const text = read(join(root, file));
    if (text && rule.test(text)) return { file, tool };
  }
  return undefined;
}

export function discoverVerify(cwd: string, env: NodeJS.ProcessEnv = process.env): VerifyCommand | undefined {
  const root = gitRoot(cwd) ?? cwd;
  if (env.PI_VERIFY?.trim()) return { command: env.PI_VERIFY.trim(), source: "PI_VERIFY", root, reason: "PI_VERIFY is set" };

  let scripts: Record<string, unknown> = {};
  const pkg = read(join(root, "package.json"));
  if (pkg) try { scripts = (JSON.parse(pkg) as { scripts?: Record<string, unknown> }).scripts ?? {}; } catch {}
  for (const name of ["verify", "check"]) {
    if (typeof scripts[name] === "string") return { command: `${runner(root)} ${name}`, source: "package.json", root, reason: `the \`${name}\` script in package.json` };
  }
  const verify = makeTarget(root, "verify");
  if (verify) return { command: `${verify.tool} verify`, source: verify.file, root, reason: `the \`verify\` target in ${verify.file}` };
  try {
    accessSync(join(root, "scripts", "verify"), constants.X_OK);
    return { command: "./scripts/verify", source: "scripts/verify", root, reason: "the executable scripts/verify" };
  } catch {}

  // Fallback: the common test entry points, after every explicit verify command.
  const test = scripts.test;
  if (typeof test === "string" && test.trim() && !NPM_PLACEHOLDER.test(test)) {
    return { command: `${runner(root)} test`, source: "package.json", root, reason: `the \`test\` script in package.json; ${FALLBACK}` };
  }
  const make = makeTarget(root, "test");
  if (make) return { command: `${make.tool} test`, source: make.file, root, reason: `the \`test\` target in ${make.file}; ${FALLBACK}` };
  return undefined;
}
