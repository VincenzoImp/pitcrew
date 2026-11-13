import { gitOut } from "../../lib/git.ts";
import { ownSettings } from "../../lib/settings.ts";
import { uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import {
  contextSettings,
  SUMMARY_ROLE,
  TOOL_RESULT_CHARS,
  fitToWindow,
  githubLinks,
  type Message,
  recentRequests,
  serialize,
  shouldCompact,
  stateBlock,
  summaryPrompt,
} from "../../lib/context.ts";
import { currentMode, shortMode } from "../../lib/mode.ts";
import { currentRoles, splitModel } from "../../lib/profile.ts";

// Context: compaction as a safety net, and a summary that keeps the state.
// - Trigger: when a run settles with the context at or above `pitcrew.context.compactAt` percent of
//   the window (default 80), compact. The threshold is a percentage, so it fits every model.
//   pi's own compaction stays as the last net when the window is nearly full, and it is the one that
//   works inside a long run: ctx.compact() in the middle of a run aborts the run (docs/context.md).
// - Summary: a state block built by code (latest requests, mode, branch, changes, links) plus a
//   model summary written by the `scout` role. On any failure pi's default compaction runs.
// Docs: docs/context.md.

const git = (cwd: string, ...args: string[]): string => gitOut(cwd, ...args) ?? "";

const roleMap = () => currentRoles();

export default function context(pi: ExtensionAPI) {
  let compacting = false;
  const settings = () => contextSettings(ownSettings(pi.getSettings())?.context);

  pi.on("agent_settled", async (event, ctx: ExtensionContext) => {
    if (event.aborted || compacting) return;
    const usage = ctx.getContextUsage();
    const { compactAt } = settings();
    if (!shouldCompact(usage?.percent, compactAt)) return;
    compacting = true;
    if (ctx.hasUI) ctx.ui.notify(`context at ${Math.round(usage?.percent ?? 0)} %: compacting (threshold ${compactAt} %)`, "info");
    ctx.compact({
      onComplete: () => { compacting = false; },
      onError: (error) => {
        compacting = false;
        // "Nothing to compact": everything is inside the part pi keeps word for word.
        if (ctx.hasUI && !/nothing to compact/i.test(error.message)) ctx.ui.notify(`compaction failed: ${error.message}`, "error");
      },
    });
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const { preparation, customInstructions, signal } = event;
    if (signal.aborted) return;
    const summaryRole = SUMMARY_ROLE;
    const roles = roleMap();
    const spec = roles.map?.[summaryRole];
    const model = spec ? ctx.modelRegistry.find(...splitModel(spec.model)) : undefined;
    if (!model) return; // no role map or model: pi's default compaction

    const messages = convertToLlm([...preparation.messagesToSummarize, ...preparation.turnPrefixMessages]) as Message[];
    // Requests come from the whole branch, also the part that stays in context.
    const branch = event.branchEntries
      .filter((entry) => entry.type === "message")
      .map((entry) => (entry as { message: Message }).message);
    const conversation = serialize(messages, TOOL_RESULT_CHARS);
    const state = stateBlock({
      requests: recentRequests(branch),
      mode: shortMode(currentMode()),
      profile: roles.profile,
      branch: git(ctx.cwd, "rev-parse", "--abbrev-ref", "HEAD") || undefined,
      changedFiles: git(ctx.cwd, "status", "--short").split("\n").filter(Boolean).slice(0, 40),
      links: githubLinks(conversation),
    });

    try {
      const prompt = summaryPrompt(fitToWindow(conversation, model.contextWindow), preparation.previousSummary, customInstructions);
      const response = await ctx.modelRegistry.complete(
        model,
        { messages: [{ role: "user" as const, content: [{ type: "text" as const, text: prompt }], timestamp: Date.now() }] },
        { maxTokens: 8192, signal, cacheRetention: "none", sessionId: uuidv7() },
      );
      const summary = response.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (!summary) return;
      return {
        compaction: {
          summary: `${state}\n\n${summary}`,
          firstKeptEntryId: preparation.firstKeptEntryId,
          tokensBefore: preparation.tokensBefore,
          usage: response.usage,
        },
      };
    } catch (error) {
      if (!signal.aborted && ctx.hasUI) ctx.ui.notify(`summary by ${summaryRole} failed (${(error as Error).message}); using pi's default`, "warning");
      return;
    }
  });
}
