// Context handling: when to compact, and what a compaction keeps.
// Pure logic. extensions/context wires it to pi. Docs: docs/context.md.

export interface ContextSettings {
  compactAt: number; // percent of the context window at which the harness compacts; 0 = never
}
export const CONTEXT_DEFAULTS: ContextSettings = { compactAt: 80 };
/** The role whose model writes the summary, and the characters of each tool result it sees. */
export const SUMMARY_ROLE = "scout";
export const TOOL_RESULT_CHARS = 6000;

export function contextSettings(raw: unknown): ContextSettings {
  const given = (raw as { compactAt?: unknown } | undefined)?.compactAt;
  return { compactAt: typeof given === "number" && given >= 0 && given <= 100 ? given : CONTEXT_DEFAULTS.compactAt };
}

export const shouldCompact = (percent: number | null | undefined, compactAt: number): boolean =>
  compactAt > 0 && typeof percent === "number" && percent >= compactAt;

interface Block {
  type: string;
  text?: string;
  name?: string;
  arguments?: unknown;
}
export interface Message {
  role: string;
  content?: string | Block[];
  customType?: string;
}

const textOf = (content: Message["content"]): string =>
  typeof content === "string"
    ? content
    : (content ?? []).filter((block) => block.type === "text" && block.text).map((block) => block.text).join("\n");

/** Keep the start and the end of a long text; the middle is where the least is lost. */
export function middleCut(text: string, max: number, note = "left out"): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.65);
  const tail = max - head;
  return `${text.slice(0, head)}\n[... ${text.length - max} characters ${note} ...]\n${text.slice(-tail)}`;
}

/** The cut is the summarizer's, not the agent's: said in the marker so a summary never reports it as lost. */
export const SUMMARY_CUT_NOTE = "left out of this copy for the summary only; the agent saw the whole result";

/** The conversation as text for the summarizer. Tool results are cut in the middle, not at 2,000. */
export function serialize(messages: Message[], toolResultChars: number): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      const text = textOf(message.content);
      if (text) parts.push(`[User]: ${text}`);
    } else if (message.role === "assistant") {
      const text = textOf(message.content);
      if (text) parts.push(`[Assistant]: ${text}`);
      const calls = (Array.isArray(message.content) ? message.content : [])
        .filter((block) => block.type === "toolCall")
        .map((block) => `${block.name}(${middleCut(JSON.stringify(block.arguments ?? {}), 1500)})`);
      if (calls.length) parts.push(`[Assistant tool calls]: ${calls.join("; ")}`);
    } else if (message.role === "toolResult") {
      const text = textOf(message.content);
      if (text) parts.push(`[Tool result]: ${middleCut(text, toolResultChars, SUMMARY_CUT_NOTE)}`);
    } else if (message.role === "custom") {
      const text = textOf(message.content);
      if (text) parts.push(`[Note from ${message.customType ?? "extension"}]: ${text}`);
    }
  }
  return parts.join("\n\n");
}

/** Fit the conversation text into the summarizer's window; the most recent part is kept. */
export function fitToWindow(text: string, contextWindow: number | undefined, reserveTokens = 12000): string {
  if (!contextWindow) return text;
  const maxChars = Math.max(20000, (contextWindow - reserveTokens) * 3);
  if (text.length <= maxChars) return text;
  return `[The start of the conversation was left out: it did not fit the summarizer.]\n\n${text.slice(-maxChars)}`;
}

/** The user's latest requests, newest last. The goal of a session is what was asked last, not first. */
export function recentRequests(messages: Message[], count = 3, maxChars = 1200): string[] {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => textOf(message.content).trim())
    .filter(Boolean)
    .slice(-count)
    .map((text) => middleCut(text, maxChars));
}

/** GitHub issue and PR links mentioned in the conversation, newest last, without repeats. */
export function githubLinks(text: string, max = 12): string[] {
  const found = text.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\/\d+/g) ?? [];
  return [...new Set(found.reverse())].slice(0, max).reverse();
}

export interface State {
  requests: string[];
  mode?: string;
  profile?: string;
  branch?: string;
  changedFiles: string[];
  links: string[];
}

/** The part of the summary that code builds: facts that must not depend on a model's reading. */
export function stateBlock(state: State): string {
  const lines = ["## State when the context was compacted (built by code)"];
  if (state.requests.length) {
    lines.push("", "The user's latest requests, oldest first. The last one is the current goal:");
    for (const request of state.requests) lines.push("", `> ${request.replace(/\n/g, "\n> ")}`);
  }
  const facts = [
    state.mode && `Session mode: ${state.mode}`,
    state.profile && `Role profile: ${state.profile}`,
    state.branch && `Git branch: ${state.branch}`,
  ].filter(Boolean);
  if (facts.length) lines.push("", ...facts.map((fact) => `- ${fact}`));
  if (state.changedFiles.length) {
    lines.push("", "Uncommitted changes (`git status --short`):", "```", ...state.changedFiles, "```");
  }
  if (state.links.length) lines.push("", "Issues and pull requests mentioned:", ...state.links.map((link) => `- ${link}`));
  return lines.join("\n");
}

export function summaryPrompt(conversation: string, previousSummary?: string, instructions?: string): string {
  return [
    "Summarize the conversation below between a user and a coding agent. Your summary replaces these",
    "messages in the agent's context, so the agent must be able to continue the work from it alone.",
    "Do not continue the conversation and do not answer questions in it. Write Markdown with these sections:",
    "",
    "## Goal — what the user wants now, and any constraints or preferences they stated.",
    "## Done — work finished, with file paths, commands and results that matter later.",
    "## Decisions — each decision and its reason. Include rejected options when the reason matters.",
    "## In progress — the exact step under way, what was tried, what failed and why.",
    "## Open questions — things not known or waiting for the user.",
    "## Next steps — in order.",
    "## Facts to keep — exact names, ids, paths, numbers, error texts and URLs needed later. Copy them exactly.",
    "",
    "Be specific. Prefer exact values to descriptions. Leave a section out when it has nothing.",
    "Long tool results are shortened in the middle in your copy only; the agent saw them whole. A value the",
    "agent reported from a tool result is not missing or invented because your copy does not show it: keep it.",
    instructions ? `\nFocus given by the user: ${instructions}` : "",
    previousSummary ? `\n<previous-summary>\n${previousSummary}\n</previous-summary>\nUpdate it: keep what still holds, drop what is obsolete.` : "",
    `\n<conversation>\n${conversation}\n</conversation>`,
  ].join("\n");
}

/** The handoff request, sent as a turn of the session: the conversation is the one above it. */
export function handoffPrompt(goal: string): string {
  return [
    "Write a handoff for a coding agent that starts a new session with no memory of this conversation.",
    "The new agent reads only your text, so it must be able to do the next goal from it alone.",
    "Do not continue the work and call no tools. Reply only with Markdown in these sections:",
    "",
    "## Context — what this work is about, in a few lines.",
    "## Done — what is finished, with file paths and the results that matter.",
    "## Decisions — each decision and its reason, including constraints and preferences the user stated.",
    "## State — the exact point reached; what works, what is broken, what was tried and failed.",
    "## Next goal — restate the goal below as concrete steps, with the check that shows each is done.",
    "## Facts to keep — exact names, ids, paths, commands, numbers, error texts and URLs. Copy them exactly.",
    "",
    "Be specific. Leave out anything the next goal does not need.",
    `\nNext goal given by the user: ${goal}`,
  ].join("\n");
}

/** `2026-11-12-1530-fix-the-login-bug.md`: sortable, readable, safe as a file name. */
export function handoffFileName(date: Date, goal: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  const slug = goal.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 6).join("-");
  return `${stamp}${slug ? `-${slug}` : ""}.md`;
}
