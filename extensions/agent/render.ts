import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import type { Usage } from "../../lib/ledger.ts";
import { previewArgs, type ToolCall } from "../../lib/rpc-child.ts";

// One-line child views and tool rendering for the agent tool (layout ported from pi's subagent example).

export interface ChildView {
  id: string;
  agent: string;
  status: string;
  elapsedMs: number;
  lastTool?: string;
  usage?: Usage;
  toolCalls?: ToolCall[];
  finalText?: string;
  question?: string;
}

export interface AgentDetails { action: string; views: ChildView[]; delivered?: string[]; isError?: boolean }

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function formatUsage(u?: Usage): string {
  if (!u || !u.turns) return "";
  const parts = [`${u.turns}t`, `↑${formatTokens(u.input + u.cacheRead + u.cacheWrite)}`, `↓${formatTokens(u.output)}`];
  if (u.cost) parts.push(`$${u.cost.toFixed(3)}`);
  return parts.join(" ");
}

export const ICON: Record<string, string> = {
  queued: "…", running: "⏳", asking: "?", done: "✓", failed: "✗", timeout: "✗", stopped: "■", interrupted: "!",
};

/** One plain line per child. */
export function childLine(v: ChildView): string {
  const bits = [`${ICON[v.status] ?? "·"} ${v.id}`, v.agent, v.status, formatElapsed(v.elapsedMs)];
  if (v.question) bits.push(`asks: ${v.question.slice(0, 50)}`);
  else if (v.lastTool) bits.push(v.lastTool);
  const usage = formatUsage(v.usage);
  if (usage) bits.push(usage);
  return bits.join(" · ");
}

export function renderAgentCall(args: Record<string, any>, theme: any) {
  const action = String(args.action ?? "start");
  let text = theme.fg("toolTitle", theme.bold(`agent ${action} `));
  if (action === "start") {
    text += theme.fg("accent", String(args.agent ?? "?"));
    if (args.role) text += theme.fg("muted", ` on ${args.role}`);
    const task = String(args.task ?? "");
    text += `\n  ${theme.fg("dim", task.length > 80 ? `${task.slice(0, 80)}…` : task)}`;
  } else {
    text += theme.fg("accent", [args.id, ...(args.ids ?? [])].filter(Boolean).join(", "));
    if (args.text) text += theme.fg("dim", ` ${String(args.text).slice(0, 60)}`);
  }
  return new Text(text, 0, 0);
}

export function renderAgentResult(result: { content: { type: string; text?: string }[]; details?: unknown }, expanded: boolean, theme: any) {
  const details = result.details as AgentDetails | undefined;
  const first = result.content[0];
  if (!details?.views?.length) return new Text(first?.type === "text" ? first.text ?? "" : "", 0, 0);
  const container = new Container();
  for (const v of details.views) {
    const color = v.status === "done" ? "success" : ["failed", "timeout", "interrupted"].includes(v.status) ? "error" : "warning";
    let header = `${theme.fg(color, ICON[v.status] ?? "·")} ${theme.fg("toolTitle", theme.bold(v.id))} ${theme.fg("muted", v.agent)} ${theme.fg(color, v.status)}`;
    const usage = formatUsage(v.usage);
    if (usage) header += ` ${theme.fg("dim", usage)}`;
    container.addChild(new Text(header, 0, 0));
    if (v.question) container.addChild(new Text(theme.fg("warning", `asks: ${v.question}`), 0, 0));
    const calls = v.toolCalls ?? [];
    const shown = expanded ? calls : calls.slice(-5);
    if (calls.length > shown.length) container.addChild(new Text(theme.fg("muted", `  … ${calls.length - shown.length} earlier tool calls`), 0, 0));
    for (const c of shown) container.addChild(new Text(theme.fg("muted", "  → ") + theme.fg("accent", c.name) + theme.fg("dim", ` ${previewArgs(c.args)}`), 0, 0));
    if (expanded && v.finalText) {
      container.addChild(new Spacer(1));
      container.addChild(new Markdown(v.finalText.trim(), 0, 0, getMarkdownTheme()));
    }
  }
  if (!expanded) container.addChild(new Text(theme.fg("muted", "(Ctrl+O to expand)"), 0, 0));
  return container;
}

/** A result message in the transcript: the header and the start of the report; all of it expanded. */
export function renderResultMessage(message: { content: unknown }, options: { expanded: boolean }, theme: any) {
  const content = typeof message.content === "string" ? message.content : "";
  const [header = "", ...rest] = content.split("\n");
  if (options.expanded) return new Markdown(content, 0, 0, getMarkdownTheme());
  const preview = rest.filter((l) => l.trim()).slice(0, 6).map((l) => theme.fg("dim", `  ${l.slice(0, 160)}`));
  return new Text([theme.fg("accent", header), ...preview, theme.fg("muted", "  (Ctrl+O to expand)")].join("\n"), 0, 0);
}
