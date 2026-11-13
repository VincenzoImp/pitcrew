// Session map: labels on the entries that mark progress, so `/tree` (filter: labeled only) shows
// the milestones of a long session. Labels are not sent to the model. Pure: the entries in, the
// labels out; extensions/status/index.ts applies the ones an entry does not have yet.

type Entry = { id: string; type: string; customType?: string; content?: unknown; message?: any };

const text = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? content.filter((p: any) => p?.type === "text").map((p: any) => p.text).join("\n") : "";

/** verify passes, PRs opened or merged by a bash call, agent results. */
export function sessionLabels(entries: Entry[]): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const bash = new Map<string, string>();
  for (const e of entries) {
    const m = e.message;
    if (e.type === "message" && m?.role === "assistant") {
      for (const p of m.content ?? []) if (p?.type === "toolCall" && p.name === "bash") bash.set(p.id, String(p.arguments?.command ?? ""));
    } else if (e.type === "message" && m?.role === "toolResult" && m.toolName === "bash" && !m.isError) {
      const command = bash.get(m.toolCallId) ?? "";
      const opened = /\bgh pr create\b/.test(command) && /\/pull\/(\d+)/.exec(text(m.content));
      const merged = /\bgh pr merge\s+(\d+)/.exec(command);
      if (opened) out.push({ id: e.id, label: `PR #${opened[1]} opened` });
      else if (merged) out.push({ id: e.id, label: `PR #${merged[1]} merged` });
    } else if (e.type === "custom_message" && e.customType === "verify-gate" && text(e.content).startsWith("verify ✓")) {
      out.push({ id: e.id, label: text(e.content).replace(/^verify ✓ (.*?) \(\d+s\) @tree (\w+).*$/s, "verify ✓ $1 @$2") });
    } else if (e.type === "custom_message" && e.customType === "agent-result") {
      const head = /^agent (\S+) \((\S+)\) (\w+)/.exec(text(e.content));
      if (head) out.push({ id: e.id, label: `agent ${head[1]} ${head[3]}` });
    }
  }
  return out;
}
