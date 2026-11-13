import { toplevel } from "./git.ts";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Find the project's one verify command. First match wins:
// PI_VERIFY; package.json script `verify`, then `check` (runner from the lockfile);
// Makefile or justfile target `verify`; executable `scripts/verify`. `test` is never guessed.

export interface VerifyCommand {
  /** Shell command, run from `root`. */
  command: string;
  /** Where it came from: "PI_VERIFY", "package.json", "Makefile", "justfile", "scripts/verify". */
  source: string;
  /** Project root: git top level of cwd, or cwd. */
  root: string;
}

export const gitRoot = toplevel;

function runner(root: string): string {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm run";
  if (existsSync(join(root, "yarn.lock"))) return "yarn run";
  if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))) return "bun run";
  return "npm run";
}

const read = (path: string) => { try { return readFileSync(path, "utf8"); } catch { return undefined; } };

export function discoverVerify(cwd: string, env: NodeJS.ProcessEnv = process.env): VerifyCommand | undefined {
  const root = gitRoot(cwd) ?? cwd;
  if (env.PI_VERIFY?.trim()) return { command: env.PI_VERIFY.trim(), source: "PI_VERIFY", root };

  const pkg = read(join(root, "package.json"));
  if (pkg) {
    let scripts: Record<string, unknown> = {};
    try { scripts = (JSON.parse(pkg) as { scripts?: Record<string, unknown> }).scripts ?? {}; } catch {}
    for (const name of ["verify", "check"]) {
      if (typeof scripts[name] === "string") return { command: `${runner(root)} ${name}`, source: "package.json", root };
    }
  }
  for (const [file, tool] of [["Makefile", "make"], ["makefile", "make"], ["GNUmakefile", "make"], ["justfile", "just"], ["Justfile", "just"]]) {
    const text = read(join(root, file));
    if (text && /^verify\b[^:=\n]*:(?!=)/m.test(text)) return { command: `${tool} verify`, source: file, root };
  }
  try {
    accessSync(join(root, "scripts", "verify"), constants.X_OK);
    return { command: "./scripts/verify", source: "scripts/verify", root };
  } catch {}
  return undefined;
}
