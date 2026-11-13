import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONTEXT_DEFAULTS,
  contextSettings,
  fitToWindow,
  githubLinks,
  middleCut,
  recentRequests,
  serialize,
  shouldCompact,
  stateBlock,
  summaryPrompt,
} from "../lib/context.ts";

test("settings: defaults, valid overrides, bad values ignored", () => {
  assert.deepEqual(contextSettings(undefined), CONTEXT_DEFAULTS);
  assert.deepEqual(contextSettings({ compactAt: 60 }), { compactAt: 60 });
  assert.deepEqual(contextSettings({ compactAt: 150 }), CONTEXT_DEFAULTS);
  assert.equal(contextSettings({ compactAt: 0 }).compactAt, 0);
});

test("shouldCompact: at or above the threshold; never when 0 or unknown", () => {
  assert.equal(shouldCompact(80, 80), true);
  assert.equal(shouldCompact(79.9, 80), false);
  assert.equal(shouldCompact(99, 0), false);
  assert.equal(shouldCompact(null, 80), false);
  assert.equal(shouldCompact(undefined, 80), false);
});

test("middleCut keeps the start and the end", () => {
  const text = `START${"x".repeat(10000)}END`;
  const cut = middleCut(text, 1000);
  assert.ok(cut.startsWith("START") && cut.endsWith("END"));
  assert.match(cut, /\[\.\.\. 9008 characters left out \.\.\.\]/);
  assert.equal(middleCut("short", 1000), "short");
});

test("serialize: every role, tool calls with arguments, long tool results cut in the middle", () => {
  const text = serialize(
    [
      { role: "user", content: "Fix the login bug" },
      { role: "assistant", content: [{ type: "text", text: "Looking." }, { type: "toolCall", name: "bash", arguments: { command: "npm test" } }] },
      { role: "toolResult", content: [{ type: "text", text: `HEAD ${"y".repeat(9000)} TAIL` }] },
      { role: "custom", customType: "verify", content: "verify ✓ npm test" },
      { role: "assistant", content: [{ type: "thinking", text: "hidden" }] },
    ],
    1000,
  );
  assert.match(text, /^\[User\]: Fix the login bug/);
  assert.match(text, /\[Assistant tool calls\]: bash\(\{"command":"npm test"\}\)/);
  // The marker says the cut is the summarizer's, so a summary does not report the value as lost (#143).
  assert.match(text, /\[Tool result\]: HEAD y+\n\[\.\.\. \d+ characters left out of this copy for the summary only; the agent saw the whole result \.\.\.\]\ny+ TAIL/);
  assert.match(text, /\[Note from verify\]: verify ✓ npm test/);
  assert.doesNotMatch(text, /hidden/);
});

test("fitToWindow keeps the most recent part", () => {
  const text = `OLD ${"a".repeat(200000)} NEW`;
  const fitted = fitToWindow(text, 32000);
  assert.ok(fitted.length < text.length && fitted.endsWith("NEW") && !fitted.includes("OLD"));
  assert.equal(fitToWindow(text, 1000000), text);
  assert.equal(fitToWindow(text, undefined), text);
});

test("recentRequests: the last three, newest last; the current goal is the last one", () => {
  const messages = ["one", "two", "three", "four"].flatMap((text) => [{ role: "user", content: text }, { role: "assistant", content: [{ type: "text", text: "ok" }] }]);
  assert.deepEqual(recentRequests(messages), ["two", "three", "four"]);
  assert.deepEqual(recentRequests([{ role: "user", content: [{ type: "text", text: " block form " }] }]), ["block form"]);
});

test("githubLinks: issues and pull requests, unique, newest last", () => {
  const text = "see https://github.com/o/r/issues/1 and https://github.com/o/r/pull/7, again https://github.com/o/r/issues/1 not https://github.com/o/r/blob/main/x";
  assert.deepEqual(githubLinks(text), ["https://github.com/o/r/pull/7", "https://github.com/o/r/issues/1"]);
});

test("stateBlock and summaryPrompt", () => {
  const block = stateBlock({ requests: ["first", "now do\nthis"], mode: "issue · pr · standard", profile: "claude*", branch: "v2/10-x", changedFiles: [" M a.ts"], links: ["https://github.com/o/r/issues/1"] });
  assert.match(block, /The last one is the current goal/);
  assert.match(block, /> now do\n> this/);
  assert.match(block, /- Session mode: issue · pr · standard\n- Role profile: claude\*\n- Git branch: v2\/10-x/);
  assert.match(block, /```\n M a\.ts\n```/);
  assert.doesNotMatch(stateBlock({ requests: [], changedFiles: [], links: [] }), /Uncommitted|Issues and/);
  const prompt = summaryPrompt("[User]: hi", "old summary", "keep the API names");
  assert.match(prompt, /Focus given by the user: keep the API names/);
  assert.match(prompt, /shortened in the middle in your copy only; the agent saw them whole/);
  assert.match(prompt, /<previous-summary>\nold summary/);
  assert.match(prompt, /<conversation>\n\[User\]: hi\n<\/conversation>$/);
});

test("handoff: file name and prompt", async () => {
  const { handoffFileName, handoffPrompt } = await import("../lib/context.ts");
  assert.equal(handoffFileName(new Date(2026, 10, 12, 15, 3), "Fix the login bug, then add tests for auth.ts & more words"), "2026-11-12-1503-fix-the-login-bug-then-add.md");
  assert.equal(handoffFileName(new Date(2026, 0, 2, 9, 5), "???"), "2026-01-02-0905.md");
  const prompt = handoffPrompt("ship it");
  assert.match(prompt, /Next goal given by the user: ship it$/);
  assert.doesNotMatch(prompt, /<conversation>/, "a turn of the session: the conversation is already above it");
});
