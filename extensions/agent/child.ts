import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { REPORT_REMINDER, reportStatus } from "../../lib/report.ts";

// Loaded in children only (PITCREW_DEPTH >= 1):
// - the ask_parent tool: a ctx.ui.input call; in RPC mode the request reaches the parent's runner,
//   which routes it (index.ts onDialog);
// - one reminder per prompt when the final message does not start with a `Status:` line.

export const ASK_PREFIX = "ask_parent: ";

export function registerChild(pi: ExtensionAPI, askTimeoutSeconds: () => number) {
  pi.registerTool({
    name: "ask_parent",
    label: "Ask parent",
    description:
      "Ask the agent that started you one question when the answer is not yours to guess (intent, scope, a missing fact). " +
      "Blocks until it is answered. Do not use it for things you can find out by reading.",
    parameters: Type.Object({
      question: Type.String({ description: "One question, with the options you see and the one you recommend" }),
    }),
    executionMode: "sequential",
    async execute(_id, params, signal, _onUpdate, ctx) {
      const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });
      if (!ctx.hasUI) return text("No parent channel in this mode. Continue on stated assumptions or end with Status: blocked.");
      const answer = await ctx.ui.input(`${ASK_PREFIX}${params.question}`, undefined, { timeout: askTimeoutSeconds() * 1000, signal });
      if (!answer?.trim()) {
        return text("No answer. Continue on stated assumptions (list them in the report) or end with Status: blocked.");
      }
      return text(`Answer: ${answer}`);
    },
  });

  let reminded = false;
  pi.on("input", async () => { reminded = false; return { action: "continue" }; });
  pi.on("agent_before_settle", async (event) => {
    if (reminded || event.outcome !== "completed") return undefined;
    if (reportStatus(lastAssistantText(event.context.llmMessages))) return undefined;
    reminded = true;
    return {
      entries: [...event.entries, { type: "custom_message", customType: "agent-report-reminder", content: REPORT_REMINDER, display: true }],
      continue: true,
    };
  });
}

function lastAssistantText(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; content?: unknown };
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    const text = m.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n");
    if (text.trim()) return text;
  }
  return "";
}
