import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { pace, renderFooter, until } from "../extensions/status/footer.ts";
import status, { autoName } from "../extensions/status/index.ts";
import { parseClaudeHeaders, parseCodexEvent, parseCodexHeaders, isQuotaError, quotaNotices, quotaPath, readQuota, writeQuota } from "../extensions/status/quota.ts";
import { aggregate, table } from "../extensions/status/stats.ts";
import { addUsage, emptyTotals, priceCost } from "../extensions/status/usage.ts";

const fixture = (name) => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8"));
const claude = fixture("claude-headers.json");
const codex = fixture("codex-rate-limits.json");
const OPUS = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
const price = (p, m) => (p === "anthropic" && m === "claude-opus-5-5" ? OPUS : undefined);

test("Claude headers captured from the bridge", () => {
  const q = parseClaudeHeaders(claude.headers, "claude-bridge", claude.capturedAt);
  assert.deepEqual(q, {
    provider: "claude-bridge", status: "allowed", limitReached: false, observedAt: claude.capturedAt,
    resetsAt: 1794408600, claim: "five_hour", overage: { status: "rejected", resetsAt: undefined },
    windows: { "5h": { used: 38, resetsAt: 1794408600, minutes: 300 }, "7d": { used: 31, resetsAt: 1794819600, minutes: 10080 } },
  });
  const upper = Object.fromEntries(Object.entries(claude.headers).map(([k, v]) => [k.toUpperCase(), v]));
  assert.equal(parseClaudeHeaders(upper, "anthropic").windows["5h"].used, 38);
});

test("Claude headers: missing, garbage, rejected", () => {
  assert.equal(parseClaudeHeaders(undefined, "x"), undefined);
  assert.equal(parseClaudeHeaders({ "content-type": "text/event-stream" }, "x"), undefined);
  const garbage = parseClaudeHeaders({ "anthropic-ratelimit-unified-5h-utilization": "lots", "anthropic-ratelimit-unified-status": "allowed" }, "x");
  assert.deepEqual(garbage.windows, {});
  const rejected = parseClaudeHeaders({ ...claude.headers, "anthropic-ratelimit-unified-status": "rejected", "anthropic-ratelimit-unified-5h-utilization": "1.0", "anthropic-ratelimit-unified-overage-status": "allowed" }, "claude-bridge");
  assert.equal(rejected.limitReached, true);
  assert.equal(rejected.windows["5h"].used, 100);
  assert.equal(rejected.overage.status, "allowed");
});

test("Codex rate-limit event captured from the stream", () => {
  const q = parseCodexEvent(codex.data, codex.capturedAt);
  assert.deepEqual(q, {
    provider: "openai-codex", status: "rejected", limitReached: true, plan: "plus", observedAt: codex.capturedAt,
    windows: { "5h": { used: 0, resetsAt: 1794408392, minutes: 300 }, "7d": { used: 100, resetsAt: 1794824980, minutes: 10080 } },
    credits: { has: true, unlimited: false, balance: "7853.7971450000" },
  });
  assert.equal(parseCodexEvent({ type: "codex.response.metadata" }), undefined);
  assert.equal(parseCodexEvent({ type: "codex.rate_limits", rate_limits: null }), undefined);
  assert.deepEqual(parseCodexEvent({ type: "codex.rate_limits", rate_limits: { primary: { used_percent: "x" } } }).windows, {});
});

test("Codex SSE headers give the same shape", () => {
  const q = parseCodexHeaders({
    "x-codex-primary-used-percent": "12.5", "x-codex-primary-window-minutes": "300", "x-codex-primary-reset-after-seconds": "600",
    "x-codex-secondary-used-percent": "100", "x-codex-secondary-window-minutes": "10080", "x-codex-secondary-reset-at": "1794824980",
    "x-codex-credits-has-credits": "true", "x-codex-credits-balance": "10",
  }, 1_000_000_000);
  assert.deepEqual(q.windows["5h"], { used: 12.5, resetsAt: 1_000_600, minutes: 300 });
  assert.equal(q.limitReached, true);
  assert.equal(q.credits.has, true);
  assert.equal(parseCodexHeaders({ "content-type": "x" }), undefined);
});

test("quota.json: path from PI_CODING_AGENT_DIR, atomic write, merge, read", () => {
  const dir = mkdtempSync(join(tmpdir(), "pitcrew-quota-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.PI_CODING_AGENT_DIR = dir;
    const path = quotaPath();
    assert.equal(path, join(dir, "pitcrew", "quota.json"));
    assert.deepEqual(readQuota(), {});
    writeQuota("claude", parseClaudeHeaders(claude.headers, "claude-bridge", 2000));
    writeQuota("codex", parseCodexEvent(codex.data, 1000));
    writeQuota("claude", parseClaudeHeaders({ "anthropic-ratelimit-unified-5h-utilization": "0.99" }, "old", 1500)); // older: ignored
    const q = readQuota();
    assert.equal(q.claude.windows["5h"].used, 38);
    assert.equal(q.codex.credits.has, true);
    assert.deepEqual(readdirSync(join(dir, "pitcrew")), ["quota.json"]); // no temp files left
    writeFileSync(path, "{broken");
    assert.deepEqual(readQuota(), {});
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isQuotaError: the refusal texts of the providers in use, not other errors", () => {
  assert.ok(isQuotaError("Claude quota exceeded — rate limit (five_hour) — resets 7:30:00 PM: You've hit your 5-hour limit · resets 7:30pm (UTC)"));
  assert.ok(isQuotaError("You have hit your ChatGPT usage limit (plus plan). Try again in ~42 min."));
  assert.ok(isQuotaError("429 insufficient_quota"));
  assert.equal(isQuotaError("Context size has been exceeded"), false);
  assert.equal(isQuotaError("connection reset"), false);
  assert.equal(isQuotaError(undefined), false);
});

test("one-shot notices", () => {
  const seen = new Set();
  const cx = parseCodexEvent(codex.data, codex.capturedAt);
  const first = quotaNotices("codex", cx, seen, codex.capturedAt);
  assert.equal(first.length, 2);
  assert.ok(first.some((n) => n.includes("credits")));
  assert.deepEqual(quotaNotices("codex", cx, seen, codex.capturedAt), []);
  assert.deepEqual(quotaNotices("claude", parseClaudeHeaders(claude.headers, "b"), seen, claude.capturedAt), []);
});

test("the credits notice also comes when the plan limit is reached but the status still says allowed", () => {
  const q = { provider: "openai-codex", status: "allowed", limitReached: true, windows: {}, credits: { has: true, unlimited: false, balance: "5" }, observedAt: 1 };
  assert.deepEqual(quotaNotices("codex", q, new Set()), ["Codex plan limit reached: calls now spend credits (balance 5)"]);
});

test("API-equivalent cost of a bridge response", () => {
  const usage = { input: 443, output: 69, cacheRead: 3373, cacheWrite: 518, cost: { total: 0 } };
  const expected = (443 * 4 + 69 * 20 + 3373 * 0.2 + 518 * 5) / 1e6; // 0.0064166
  assert.ok(Math.abs(priceCost(usage, OPUS) - 0.0064166) < 1e-12);
  const t = emptyTotals();
  addUsage(t, { type: "message", message: { role: "assistant", provider: "claude-bridge", model: "claude-opus-5-5", usage } }, price);
  assert.ok(Math.abs(t.apiCost - expected) < 1e-12);
  assert.equal(t.realCost, 0);
});

// Fake theme with real ANSI codes, so width checks include escape sequences.
const CODES = { dim: 2, error: 31, warning: 33, success: 32, accent: 36 };
const theme = { fg: (c, s) => `\x1b[${CODES[c] ?? 39}m${s}\x1b[0m` };
const now = 1794392046955;
const base = {
  location: "~/code/pitcrew (main) • guard-retry-fix",
  selected: "role/lead", provider: "claude-bridge", routed: "claude-opus-5-5", thinking: "high",
  context: { percent: 12, tokens: 120000, window: 1000000 }, cacheHit: 97, requests: 4,
  input: 1_200_000, output: 48_000, cost: 3.41, subscription: true,
  quotaKind: "claude", quota: parseClaudeHeaders(claude.headers, "claude-bridge", now - 60_000),
  guard: "guard 1✗ 2?", gate: "verify ✓", statuses: [], now,
};
const plain = (lines) => lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));

test("footer fits every width and drops segments in order", () => {
  for (const width of [200, 120, 80, 50, 30]) {
    for (const line of renderFooter(base, width, theme)) assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
  }
  const wide = plain(renderFooter(base, 200, theme));
  assert.equal(wide.length, 2);
  assert.match(wide[0], /^~\/code\/pitcrew \(main\) • guard-retry-fix\s+\(claude-bridge\) role\/lead → opus-5-5 • high$/);
  assert.match(wide[1], /^ctx 12% 120k\/1M · CH 97% · ↑1\.2M ↓48k · ≈\$3\.41\s+5h 38% ↻4h35 4\.7× · 7d 31% ↻4d · guard 1✗ 2\? · verify ✓$/);
  const at = (w) => plain(renderFooter(base, w, theme)).join("\n");
  assert.ok(at(120).includes("(claude-bridge)") && at(120).includes("4.7×"));
  assert.ok(!at(100).includes("4.7×") && at(100).includes("↻4d")); // line 2 drops pace first
  assert.ok(!at(95).includes("↻4d") && at(95).includes("↑1.2M")); // then the 7d reset
  assert.ok(!at(90).includes("↑1.2M") && at(90).includes("↻4h35")); // then tokens
  assert.ok(at(85).includes("(claude-bridge)") && !at(80).includes("(claude-bridge)")); // line 1 drops the provider
  assert.ok(at(80).includes("role/lead → opus-5-5 • high"));
  const narrow = plain(renderFooter(base, 70, theme));
  assert.equal(narrow.length, 3); // right column on its own line
  assert.match(narrow[2], /^5h 38%/);
});

test("footer states: stale quota, limits, colours, guard and gate, init estimate, extra statuses", () => {
  const stale = plain(renderFooter({ ...base, quota: { ...base.quota, observedAt: now - 42 * 60_000 } }, 200, theme))[1];
  assert.match(stale, /42m ago/);
  const hot = { ...base, quota: { ...base.quota, status: "rejected", windows: { ...base.quota.windows, "5h": { used: 100, resetsAt: 1794408600, minutes: 300 } }, overage: { status: "allowed" } } };
  const line = renderFooter(hot, 200, theme)[1];
  assert.ok(line.includes("\x1b[31m5h 100%"));
  assert.match(plain([line])[0], /LIMIT ↻4h35 · EXTRA USAGE/);
  assert.ok(renderFooter({ ...base, quota: { ...base.quota, windows: { "5h": { used: 55, resetsAt: 1794408600, minutes: 300 } } } }, 200, theme)[1].includes("\x1b[33m5h 55%"));
  assert.ok(renderFooter({ ...base, context: { percent: 95, tokens: 950000, window: 1000000 } }, 200, theme)[1].includes("\x1b[31mctx 95%"));
  assert.ok(renderFooter({ ...base, cacheHit: 16 }, 200, theme)[1].includes("\x1b[31mCH 16%"));
  assert.ok(!renderFooter({ ...base, cacheHit: 16, requests: 1 }, 200, theme)[1].includes("\x1b[31mCH"));
  assert.ok(renderFooter({ ...base, guard: undefined }, 200, theme)[1].includes("\x1b[33mguard off"));
  assert.ok(renderFooter({ ...base, guard: "guard off" }, 200, theme)[1].includes("\x1b[31mguard off"));
  assert.ok(renderFooter({ ...base, gate: "verify ●" }, 200, theme)[1].includes("\x1b[33mverify ●"));
  assert.ok(!plain(renderFooter({ ...base, gate: undefined }, 200, theme))[1].includes("gate"));
  const init = plain(renderFooter({ ...base, requests: 0, cacheHit: undefined, input: 0, output: 0, cost: 0, initTokens: 21000 }, 200, theme))[1];
  assert.match(init, /^ctx ≥21k init · ≈\$0\.00/);
  const cx = plain(renderFooter({ ...base, quotaKind: "codex", quota: parseCodexEvent(codex.data, now - 60_000) }, 200, theme))[1];
  assert.match(cx, /cx 5h 0% · wk 100% ↻5d · credits/);
  const extra = renderFooter({ ...base, statuses: ["rewind 3", "other"] }, 200, theme);
  assert.equal(plain(extra)[2], "rewind 3 other");
  const local = plain(renderFooter({ ...base, selected: "qwen3", provider: "llama.cpp", routed: undefined, local: true, quota: undefined, quotaKind: undefined }, 200, theme));
  assert.match(local[0], /qwen3 • local • high$/);
});

test("pace and countdown match statusline.sh", () => {
  // statusline.sh: mult = (pct*win*10 + elapsed*50) / (elapsed*100), shown as mult/10
  const sh = (pct, win, elapsed) => Math.min(99, Math.floor((pct * win * 10 + elapsed * 50) / (elapsed * 100))) / 10;
  const nowS = 1_800_000_000;
  for (const [pct, minutes, left] of [[38, 300, 16553], [86, 300, 6720], [56, 10080, 345600], [5, 10080, 500000], [90, 300, 17000]]) {
    const win = minutes * 60;
    assert.equal(pace(pct, nowS + left, minutes, nowS * 1000), sh(pct, win, win - left), `${pct} ${minutes} ${left}`);
  }
  // No pace before 5 % of the window passed (m5): 10 minutes into 5 h is 3.3 %.
  assert.equal(pace(90, nowS + 17400, 300, nowS * 1000), undefined);
  assert.equal(until(6720), "1h52");
  assert.equal(until(345600), "4d");
  assert.equal(until(59), "1m");
  assert.equal(until(-5), "now");
});

test("stats aggregate fixture sessions; totals equal the footer's", () => {
  const dir = new URL("fixtures/sessions/", import.meta.url);
  const files = readdirSync(dir).map((n) => ({ path: n, text: readFileSync(new URL(n, dir), "utf8") }));
  const byRole = Object.fromEntries(aggregate(files, "role", 0, price).map((r) => [r.key, r]));
  assert.deepEqual(Object.keys(byRole).sort(), ["(direct)", "lead", "second"]);
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
  close(byRole.lead.apiCost, 0.0064166 + 0.0006 + 0.00534);
  assert.equal(byRole.lead.requests, 2);
  assert.equal(byRole.lead.realCost, 0);
  close(byRole.second.apiCost, 0.001778 + 0.01);
  close(byRole.second.realCost, 0.01); // API-key anthropic usage is billed; Codex is not
  close(byRole["(direct)"].realCost, 0.006);
  const byProject = aggregate(files, "project", 0, price).map((r) => r.key).sort();
  assert.deepEqual(byProject, ["/home/u/code/app", "/home/u/code/lib"]);
  assert.equal(aggregate(files, "day", 0, price).length, 2);
  assert.equal(aggregate(files, "role", Date.parse("2026-11-11T00:00:00Z"), price).length, 1);
  // Same entry set as the footer: sum per file with addUsage.
  for (const f of files) {
    const t = emptyTotals();
    for (const line of f.text.split("\n")) { try { addUsage(t, JSON.parse(line), price); } catch {} }
    const rows = aggregate([f], "session", 0, price);
    close(rows[0].apiCost, t.apiCost);
    assert.equal(rows[0].input, t.input);
    assert.equal(rows[0].output, t.output);
  }
  const lines = table("role", aggregate(files, "role", 0, price));
  assert.match(lines[0], /^role\s+req\s+in\s+out\s+CH\s+API-eq\s+billed$/);
  assert.match(lines.at(-1), /^total\s+5\s/);
});

test("automatic session name: set once at the first settle, never over an existing name", async () => {
  const handlers = {};
  let name;
  const pi = {
    on: (event, fn) => { handlers[event] = fn; },
    registerCommand() {}, appendEntry() {}, getThinkingLevel: () => "high",
    getSessionName: () => name, setSessionName: (n) => { name = n; },
  };
  status(pi);
  const ctx = { cwd: tmpdir(), sessionManager: { getEntries: () => [{ type: "message", message: { role: "user", content: "Plan the footer work" } }], getBranch: () => [], getLabel: () => undefined } };
  await handlers.agent_settled({}, ctx);
  assert.match(name, /: Plan the footer work$/);
  name = "mine";
  await handlers.agent_settled({}, ctx);
  assert.equal(name, "mine");
});

test("automatic session name: deterministic, first prompt only", () => {
  const entries = [
    { type: "message", message: { role: "user", content: [{ type: "text", text: "  Fix the\nlogin bug in auth.ts and add a test" }] } },
    { type: "message", message: { role: "user", content: "second" } },
  ];
  assert.equal(autoName(entries, "app"), "app: Fix the login bug in auth.ts");
  assert.equal(autoName(entries, "app"), autoName(entries, "app"));
  assert.equal(autoName([], "app"), undefined);
  assert.ok(autoName([{ type: "message", message: { role: "user", content: "x".repeat(200) } }], "app").length <= 60);
});

test("session map: labels for a verify pass, a PR opened and merged by bash, an agent result; nothing else", async () => {
  const { sessionLabels } = await import("../extensions/status/labels.ts");
  const call = (id, command) => ({ type: "message", id: `a-${id}`, message: { role: "assistant", content: [{ type: "toolCall", id, name: "bash", arguments: { command } }] } });
  const result = (id, out, isError = false) => ({ type: "message", id: `r-${id}`, message: { role: "toolResult", toolCallId: id, toolName: "bash", isError, content: [{ type: "text", text: out }] } });
  const entries = [
    call("1", "gh pr create -t x -b 'Closes #3'"), result("1", "https://github.com/me/app/pull/12\n"),
    call("2", "gh pr merge 12 --squash --match-head-commit abc"), result("2", ""),
    call("3", "gh pr merge 13"), result("3", "refused", true),
    call("4", "ls"), result("4", "a.txt"),
    { type: "custom_message", id: "v1", customType: "verify-gate", content: "verify ✓ npm run check (3s) @tree 3f2a1c0" },
    { type: "custom_message", id: "v2", customType: "verify-gate", content: "Verify gate: files changed in this run" },
    { type: "custom_message", id: "g1", customType: "agent-result", content: "agent worker-1 (worker) done, report: done · 9t\nReport: …" },
  ];
  assert.deepEqual(sessionLabels(entries), [
    { id: "r-1", label: "PR #12 opened" }, { id: "r-2", label: "PR #12 merged" },
    { id: "v1", label: "verify ✓ npm run check @3f2a1c0" }, { id: "g1", label: "agent worker-1 done" },
  ]);
});

test("# completes open issues: by number prefix, else fuzzy on the title; only after # at a word start", async () => {
  const { issueItems, issueToken } = await import("../extensions/status/issues.ts");
  assert.equal(issueToken("fix #12"), "12");
  assert.equal(issueToken("#"), "");
  assert.equal(issueToken("see a#1"), undefined);
  const issues = [{ number: 12, title: "Fix login" }, { number: 120, title: "Footer" }, { number: 7, title: "Login page" }];
  assert.deepEqual(issueItems(issues, "12").map((i) => i.value), ["#12", "#120"]);
  assert.deepEqual(issueItems(issues, "login").map((i) => i.value).sort(), ["#12", "#7"]);
});
