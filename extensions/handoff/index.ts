import { gitOut } from "../../lib/git.ts";
import { ownSettings } from "../../lib/settings.ts";
import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import { TOOL_RESULT_CHARS, githubLinks, handoffFileName, handoffPrompt, type Message, recentRequests, serialize, stateBlock } from "../../lib/context.ts";
import { currentMode, shortMode } from "../../lib/mode.ts";
import { workPath } from "../../lib/paths.ts";
import { currentRoles } from "../../lib/profile.ts";

// /handoff [next goal]: the normal way to continue when the context is large.
// Writes a handoff file (state block built by code + a handoff the model writes as a turn of this
// session) to the work folder of the repo, then opens a new session with the handoff in the editor.
// Without a terminal UI it only writes the file and prints its path.
// The branch-reading helpers follow pi's examples/extensions/handoff.ts (MIT, Mario Zechner).
// Docs: docs/context.md.

function entryToMessage(entry: SessionEntry): AgentMessage | undefined {
  if (entry.type === "message") return entry.message;
  if (entry.type === "compaction") {
    return { role: "compactionSummary", summary: entry.summary, tokensBefore: entry.tokensBefore, timestamp: new Date(entry.timestamp).getTime() };
  }
  return undefined;
}

/** Messages of the branch as the model sees them: the last compaction summary, then what follows it. */
function branchMessages(branch: SessionEntry[]): AgentMessage[] {
  const index = branch.findLastIndex((entry) => entry.type === "compaction");
  if (index < 0) return branch.map(entryToMessage).filter((message) => message !== undefined);
  const compaction = branch[index];
  const firstKept = compaction.type === "compaction" ? branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId) : -1;
  return [compaction, ...(firstKept >= 0 ? branch.slice(firstKept, index) : []), ...branch.slice(index + 1)]
    .map(entryToMessage)
    .filter((message) => message !== undefined);
}

const git = (cwd: string, ...args: string[]): string => gitOut(cwd, ...args) ?? "";

export default function handoff(pi: ExtensionAPI) {
  if (Number(process.env.PITCREW_DEPTH ?? 0) > 0) return; // a child agent hands off through its report
  // The handoff turn has ended (done, aborted with Esc, or failed).
  let onSettled: (() => void) | undefined;
  pi.on("agent_settled", async () => { onSettled?.(); onSettled = undefined; });
  pi.registerCommand("handoff", {
    description: "Write a handoff file and continue in a new session: /handoff [next goal]",
    handler: async (args, ctx) => {
      const goal = args?.trim() || "Continue the current work from where it stopped.";
      const messages = branchMessages(ctx.sessionManager.getBranch());
      if (messages.length === 0) return ctx.ui.notify("no conversation to hand off", "error");

      const roles = currentRoles();
      const llm = convertToLlm(messages) as Message[];
      const state = stateBlock({
        requests: recentRequests(llm),
        mode: shortMode(currentMode()),
        profile: roles.profile,
        branch: git(ctx.cwd, "rev-parse", "--abbrev-ref", "HEAD") || undefined,
        changedFiles: git(ctx.cwd, "status", "--short").split("\n").filter(Boolean).slice(0, 40),
        links: githubLinks(serialize(llm, TOOL_RESULT_CHARS)),
      }).replace("## State when the context was compacted (built by code)", "## State at handoff (built by code)");

      // The handoff is a turn of this session: the model reads the conversation from the prompt
      // cache instead of a second, uncached copy, and Esc cancels it like any turn.
      ctx.ui.notify("writing the handoff… (Esc cancels)", "info");
      const prompt = handoffPrompt(goal);
      const settled = new Promise<void>((resolve) => { onSettled = resolve; });
      pi.sendUserMessage(prompt);
      await settled;
      const branch = ctx.sessionManager.getBranch();
      const asked = branch.findLastIndex((e) => e.type === "message" && e.message.role === "user" && JSON.stringify(e.message.content).includes("Write a handoff for a coding agent"));
      const reply = branch.slice(asked + 1).filter((e) => e.type === "message" && e.message.role === "assistant").map((e) => (e as { message: any }).message).at(-1);
      const body = (reply?.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n").trim();
      if (asked < 0 || !body || reply?.stopReason === "aborted" || reply?.stopReason === "error") {
        return ctx.ui.notify(`handoff not written: ${reply?.stopReason === "aborted" ? "cancelled" : reply?.errorMessage ?? "no answer"}`, "error");
      }

      const workDir = ownSettings(pi.getSettings())?.workDir;
      const file = join(workPath(ctx.cwd, "handoffs", workDir), handoffFileName(new Date(), goal));
      const text = `# Handoff\n\nNext goal: ${goal}\n\n${state}\n\n${body}\n`;
      writeFileSync(file, text);
      const leaf = ctx.sessionManager.getLeafId();
      if (leaf) pi.setLabel(leaf, `handoff → ${basename(file)}`);

      if (ctx.mode !== "tui") return ctx.ui.notify(`handoff written: ${file}`, "info");
      const parentSession = ctx.sessionManager.getSessionFile();
      const result = await ctx.newSession({
        parentSession,
        withSession: async (next) => {
          next.ui.setEditorText(`Continue from this handoff (file: ${file}).\n\n${text}`);
          next.ui.notify("Handoff ready. Review it, then submit.", "info");
        },
      });
      if (result.cancelled) ctx.ui.notify(`new session cancelled; the handoff is in ${file}`, "info");
    },
  });
}
