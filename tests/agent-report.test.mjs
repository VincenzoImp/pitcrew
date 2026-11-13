import assert from "node:assert/strict";
import test from "node:test";
import { reportHead, reportStatus } from "../lib/report.ts";

test("status from the first line, tolerant of Markdown and case", () => {
  assert.equal(reportStatus("Status: done\n\nbody"), "done");
  assert.equal(reportStatus("\n**Status:** Partial — two files left"), "partial");
  assert.equal(reportStatus("## Status: blocked"), "blocked");
  assert.equal(reportStatus("Here is the report.\nStatus: done"), undefined);
  assert.equal(reportStatus(""), undefined);
});

test("a short report comes whole; a long one is cut at a line end with the path and the next line", () => {
  assert.equal(reportHead("Status: done\n\nshort\n", "/r/report.md"), "Status: done\n\nshort");
  const long = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
  const head = reportHead(long, "/r/report.md", 200);
  assert.ok(head.length < 300);
  const [kept, note] = head.split("\n\n[");
  assert.ok(long.startsWith(kept) && long[kept.length] === "\n", "cut at a line end");
  const next = kept.split("\n").length + 1;
  assert.match(note, new RegExp(`Read /r/report.md from line ${next}\\.`));
  assert.equal(long.split("\n")[next - 1], `line ${next - 1}`);
});

test("JSON from the last json block, checked against a schema", async () => {
  const { extractJson } = await import("../lib/report.ts");
  const schema = { type: "object", properties: { n: { type: "number" } }, required: ["n"] };
  assert.deepEqual(extractJson("Status: done\n```json\n{\"n\": 1}\n```\nand\n```json\n{\"n\": 2}\n```", schema), { data: { n: 2 } });
  assert.deepEqual(extractJson("[1, 2]"), { data: [1, 2] });
  assert.match(extractJson("```json\n{\"n\": \"x\"}\n```", schema).error, /\/n must be number/);
  assert.match(extractJson("Status: done, no JSON", schema).error, /no valid JSON/);
});
