import { spawnSync } from "node:child_process";

// Facts about the pi installation, read through pi's own CLI.

/** Models pi can use now (logged-in providers and local servers), as provider/model-id, without the roles. */
export function piModels(env: NodeJS.ProcessEnv = process.env): string[] {
  const r = spawnSync("pi", ["--offline", "--list-models"], { encoding: "utf8", env, timeout: 60_000 });
  if (r.status !== 0) return [];
  return parseModelList(r.stdout);
}

/** Parse the table of `pi --list-models`: `provider  model  context …`, one row per model. */
export function parseModelList(text: string): string[] {
  return text
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 2 && cols[0] && cols[0] !== "role")
    .map(([provider, id]) => `${provider}/${id}`);
}
