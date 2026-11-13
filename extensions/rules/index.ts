import { readFileSync, realpathSync } from "node:fs";
import { ownSettings } from "../../lib/settings.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Global rules as a prompt section of the package (opt-in: "pitcrew": { "rules": "on" }).
// The text is AGENTS.global.md of this package. A child (PITCREW_DEPTH >= 1) gets a short variant
// without the sections only the top session needs. A custom section reaches every model, also
// through the Claude bridge (docs/claude-access.md), and it stays byte-stable for the whole
// session, so the prompt cache keeps it. When the same file is already loaded as a context file
// (the old AGENTS.md symlink), the section is not added again. Docs: docs/install.md.

export const SECTION = "personal_defaults";
const FILE = new URL("../../AGENTS.global.md", import.meta.url);
/** Sections of AGENTS.global.md that a child does not need: it starts no lead work and has its own skills. */
const TOP_ONLY = ["Agents", "Skills"];

/** The rules text for a session at this depth: the whole file, or the child variant. */
export function rulesText(text: string, child: boolean): string {
  const body = text.trim();
  if (!child) return body;
  const parts = body.split(/\n(?=## )/);
  return parts.filter((part) => !TOP_ONLY.some((name) => part.startsWith(`## ${name}\n`))).join("\n").trim();
}

const enabled = (value: unknown) => value === "on" || value === true;

export default function rules(pi: ExtensionAPI) {
  let text: string | undefined;
  const child = Number(process.env.PITCREW_DEPTH ?? 0) >= 1;
  try {
    text = rulesText(readFileSync(FILE, "utf8"), child);
  } catch {
    text = undefined;
  }
  const path = (() => {
    try {
      return realpathSync(FILE);
    } catch {
      return undefined;
    }
  })();

  pi.on("before_agent_start", async (event) => {
    const setting = ownSettings(pi.getSettings())?.rules;
    const sections = event.systemPromptOptions.sections;
    const loaded = (event.systemPromptOptions.contextFiles ?? []).some((file) => {
      try {
        return realpathSync(file.path) === path;
      } catch {
        return false;
      }
    });
    if (text && enabled(setting) && !loaded) sections[SECTION] = text;
    else delete sections[SECTION];
  });
}
