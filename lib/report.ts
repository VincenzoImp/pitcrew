import { Value } from "typebox/value";

// Child reports. A child's final message is its report, in Markdown, and its first line is
// `Status: done | partial | blocked`. The harness saves the whole text as report.md in the run
// folder and gives the parent the report up to HEAD_CHARS, cut at a line end, with the path for
// the rest. Nothing is parsed out of the body, so nothing can break on a long answer.

export const HEAD_CHARS = 30_000;
export const STATUSES = ["done", "partial", "blocked"] as const;

/** The status from the report's first non-empty line, or undefined. */
export function reportStatus(text: string): string | undefined {
  const first = text.trimStart().split("\n", 1)[0] ?? "";
  const m = /^\W*status\W*:\W*(done|partial|blocked)\b/i.exec(first);
  return m?.[1].toLowerCase();
}

/** The report for the parent: whole when short; else the head and where to read on. */
export function reportHead(text: string, path: string, max = HEAD_CHARS): string {
  const body = text.trim();
  if (body.length <= max) return body;
  const cut = body.lastIndexOf("\n", max);
  const head = body.slice(0, cut > max / 2 ? cut : max);
  const line = head.split("\n").length + 1;
  return `${head}\n\n[Report continues: ${body.length - head.length} more characters. Read ${path} from line ${line}.]`;
}

export const REPORT_REMINDER =
  "Your last message has no `Status:` line, so it is not a report. If the task is not finished, continue it. " +
  "When it is, end with your report for the parent: first line `Status: done`, `Status: partial` or `Status: blocked`, then the report.";

/** The JSON a child ends with (its last ```json block, or the whole text), checked against `schema`. */
export function extractJson(text: string, schema?: object): { data: unknown } | { error: string } {
  const blocks = [...text.matchAll(/```json[ \t]*\r?\n([\s\S]*?)\r?\n?```/g)];
  const raw = blocks.length ? blocks[blocks.length - 1][1] : text.trim();
  let data: unknown;
  try { data = JSON.parse(raw); } catch (error) { return { error: `no valid JSON block (${(error as Error).message})` }; }
  if (!schema || Value.Check(schema as never, data)) return { data };
  const problems = [...Value.Errors(schema as never, data)].slice(0, 5).map((e: any) => `${e.instancePath || "/"} ${e.message}`);
  return { error: `does not match the schema: ${problems.join("; ")}` };
}
