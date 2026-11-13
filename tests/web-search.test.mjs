import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  backendOrder, codexBackend, codexModel, exaBackend, exaKey, formatOutcome, runSearch, searchPayload, Sources,
} from "../extensions/web/search.ts";
import web, { SEARCH_CAP } from "../extensions/web/index.ts";

const q = { query: "undici connect lookup", num: 5 };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// --- exa ----------------------------------------------------------------------------------------

test("exa key: env first, then a 0600 file; a file others can read is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "exa-key-"));
  const file = join(dir, "exa-key");
  try {
    assert.equal(exaKey({ EXA_API_KEY: " k1 " }, file), "k1");
    assert.match(exaKey({}, file).missing, /no key: set EXA_API_KEY, or write the key to/);
    writeFileSync(file, "k2\n", { mode: 0o644 });
    chmodSync(file, 0o644);
    assert.match(exaKey({}, file).missing, /readable by other users/);
    chmodSync(file, 0o600);
    assert.equal(exaKey({}, file), "k2");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("exa: request shape, results mapped, HTTP errors named without the key", async () => {
  let seen;
  const f = async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return json({ results: [
      { title: "Agent | undici", url: "https://undici.nodejs.org/#/docs/api/Agent", highlights: ["connect  options", "lookup"] },
      { title: "", url: "https://example.com/x", text: "plain text" },
      { title: "no url" },
    ] });
  };
  const out = await exaBackend(() => "secret-key-1", f)({ ...q, site: ["nodejs.org"] });
  assert.equal(seen.url, "https://api.exa.ai/search");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers["x-api-key"], "secret-key-1");
  assert.deepEqual(seen.body, { query: q.query, type: "auto", numResults: 5, includeDomains: ["nodejs.org"], contents: { highlights: { maxCharacters: 300 } } });
  assert.deepEqual(out.hits, [
    { title: "Agent | undici", url: "https://undici.nodejs.org/#/docs/api/Agent", snippet: "connect options … lookup" },
    { title: "https://example.com/x", url: "https://example.com/x", snippet: "plain text" },
  ]);
  for (const [status, why] of [[401, "key rejected"], [402, "credit used up"], [429, "rate limited"]]) {
    const err = await exaBackend(() => "secret-key-1", async () => json({ error: "x" }, status))(q).catch((e) => e);
    assert.match(err.message, new RegExp(`HTTP ${status} ${why}`));
    assert.doesNotMatch(err.message, /secret-key-1/);
  }
  assert.match(await exaBackend(() => ({ missing: "no key: set EXA_API_KEY" }), f)(q), /no key/);
});

// --- codex --------------------------------------------------------------------------------------

const spec = (model) => ({ model, thinking: "high" });

test("codex model: setting first, then scout, then any role on openai-codex; else a reason", () => {
  const map = { lead: spec("llama.cpp/m"), worker: spec("openai-codex/w"), scout: spec("openai-codex/s") };
  assert.equal(codexModel(map, "openai-codex/x"), "x");
  assert.equal(codexModel(map, "x"), "x");
  assert.match(codexModel(map, "other/x").missing, /must be an openai-codex model/);
  assert.equal(codexModel(map), "s");
  assert.equal(codexModel({ lead: spec("llama.cpp/m"), second: spec("openai-codex/z") }), "z");
  assert.match(codexModel({ lead: spec("llama.cpp/m") }).missing, /set pitcrew\.web\.codexModel/);
});

test("searchPayload turns on hosted web search and keeps other include fields", () => {
  const out = searchPayload({ model: "m", include: ["reasoning.encrypted_content"], tools: [{ type: "function" }], store: true });
  assert.deepEqual(out.tools, [{ type: "web_search" }]);
  assert.equal(out.tool_choice, "required");
  assert.equal(out.store, false);
  assert.deepEqual(out.include, ["reasoning.encrypted_content", "web_search_call.action.sources"]);
  assert.equal(out.model, "m");
});

const SEARCH_EVENTS = [
  { type: "response.web_search_call.searching" },
  { type: "response.output_item.done", item: { type: "web_search_call", status: "completed", action: { sources: [
    { type: "url", url: "https://undici.nodejs.org/api" },
    { url: "javascript:alert(1)" },
    { url: "https://user:pw@evil.example/" },
  ] } } },
  { type: "response.output_text.annotation.added", annotation: { type: "url_citation", url: "https://undici.nodejs.org/api", title: "Undici API" } },
  { type: "response.output_text.annotation.added", annotation: { type: "url_citation", url: "https://github.com/nodejs/undici", title: "undici repo" } },
];

test("Sources: search-call sources and citations, deduplicated, only plain http(s)", () => {
  const s = new Sources();
  for (const e of SEARCH_EVENTS) s.observe(e);
  assert.equal(s.searched, true);
  assert.deepEqual(s.hits(5), [
    { title: "Undici API", url: "https://undici.nodejs.org/api", snippet: "" },
    { title: "undici repo", url: "https://github.com/nodejs/undici", snippet: "" },
  ]);
  assert.equal(s.hits(1).length, 1);
});

// Fake of ctx.modelRegistry: replays provider events through the options pi would get.
function registry({ events = SEARCH_EVENTS, message = {}, auth = true, known = true } = {}) {
  const calls = [];
  return {
    calls,
    find: (provider, id) => (known ? { provider, id } : undefined),
    hasConfiguredAuth: () => auth,
    streamSimple(model, context, options) {
      calls.push({ model, context, options, payload: options.onPayload({ include: [] }) });
      for (const e of events) options.onProviderStreamEvent(e);
      return {
        async *[Symbol.asyncIterator]() {},
        result: async () => ({
          stopReason: "stop", content: [{ type: "text", text: "undici 8 pins with connect.lookup." }],
          usage: { input: 900, output: 120, cacheRead: 0, totalTokens: 1020 }, ...message,
        }),
      };
    },
  };
}

test("codex: side call on the configured model with search on; returns sources, answer, tokens", async () => {
  const reg = registry();
  const out = await codexBackend(() => reg, () => "small")({ ...q, site: ["nodejs.org"] });
  const call = reg.calls[0];
  assert.deepEqual(call.model, { provider: "openai-codex", id: "small" });
  assert.equal(call.options.transport, "sse");
  assert.equal(call.options.reasoning, "low");
  assert.deepEqual(call.payload.tools, [{ type: "web_search" }]);
  assert.match(call.context.messages[0].content, /undici connect lookup \(site:nodejs\.org\)$/);
  assert.equal(out.model, "openai-codex/small");
  assert.equal(out.answer, "undici 8 pins with connect.lookup.");
  assert.equal(out.hits.length, 2);
  assert.deepEqual(out.usage, { input: 900, output: 120, cacheRead: 0, total: 1020 });
});

test("codex: not configured, not logged in, or failed calls are reported", async () => {
  assert.match(await codexBackend(() => registry(), () => ({ missing: "no openai-codex model" }))(q), /no openai-codex model/);
  assert.match(await codexBackend(() => registry({ known: false }), () => "x")(q), /not in pi's model list/);
  assert.match(await codexBackend(() => registry({ auth: false }), () => "x")(q), /not logged in to openai-codex/);
  await assert.rejects(codexBackend(() => registry({ events: [] }), () => "x")(q), /without a web search/);
  await assert.rejects(codexBackend(() => registry({ message: { stopReason: "error", errorMessage: "usage limit reached" } }), () => "x")(q), /usage limit reached/);
});

// --- order, fallback, result text ----------------------------------------------------------------

test("backend order: exa first by default (measured in #63); the setting replaces it", () => {
  assert.deepEqual(backendOrder(undefined), ["exa", "codex"]);
  assert.deepEqual(backendOrder([]), ["exa", "codex"]);
  assert.deepEqual(backendOrder(["codex", "exa"]), ["codex", "exa"]);
});

test("runSearch: order is kept; unconfigured and failing backends are skipped with the reason", async () => {
  const hit = { title: "T", url: "https://t.example/", snippet: "s" };
  const backends = {
    exa: async () => "no key: set EXA_API_KEY",
    codex: async () => { throw new Error("HTTP 429"); },
    good: async () => ({ hits: [hit] }),
  };
  const out = await runSearch(q, ["nope", "exa", "codex", "good"], backends);
  assert.equal(out.backend, "good");
  assert.deepEqual(out.skipped, ["nope: unknown backend (known: exa, codex, good)", "exa: no key: set EXA_API_KEY", "codex: failed: HTTP 429"]);
  const text = formatOutcome(q, out);
  assert.match(text, /^\[untrusted web content[^\n]*\nbackend: good\nskipped nope/);
  assert.match(text, /1 results for "undici connect lookup"\n1\. T — https:\/\/t\.example\/\n   s$/);

  const none = await runSearch(q, ["exa"], backends);
  assert.equal(none.backend, undefined);
  assert.match(formatOutcome(q, none), /^web_search: no backend worked for "undici connect lookup"\.\n- exa: no key: set EXA_API_KEY\n/);
});

test("result text shows the answering model, its tokens and the answer", () => {
  const out = { backend: "codex", skipped: ["exa: no key"], answer: { hits: [], answer: "A.", usage: { input: 9000, output: 120, total: 9120 }, model: "openai-codex/small" } };
  assert.match(formatOutcome(q, out), /backend: codex \(openai-codex\/small\), tokens: 9,000 in, 120 out\nskipped exa: no key\n\nAnswer \(written by the search model; check it in the sources\):\nA\./);
});

// --- the tool ------------------------------------------------------------------------------------

function tool(settings) {
  const tools = new Map();
  const handlers = {};
  web({ registerTool: (t) => tools.set(t.name, t), on: (ev, h) => { handlers[ev] = h; }, getSettings: () => settings });
  return { search: tools.get("web_search"), handlers };
}

test("tool: when no backend works the error says what to configure; the session cap holds", async () => {
  const saved = process.env.PITCREW_ROLES;
  process.env.PITCREW_ROLES = JSON.stringify({ profile: "local", map: { lead: spec("llama.cpp/m") } });
  try {
    const { search, handlers } = tool({ pitcrew: { web: { backends: ["codex"] } } });
    await handlers.session_start({}, {});
    const ctx = { modelRegistry: registry() };
    const r = await search.execute("id", { query: "x" }, undefined, undefined, ctx);
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /- codex: no openai-codex model: set pitcrew\.web\.codexModel/);
    for (let i = 1; i < SEARCH_CAP; i++) await search.execute("id", { query: "x" }, undefined, undefined, ctx);
    const last = await search.execute("id", { query: "x" }, undefined, undefined, ctx);
    assert.match(last.content[0].text, /search cap reached: 60/);

    const ok = await tool({ pitcrew: { web: { backends: ["codex"], codexModel: "openai-codex/small" } } }).search
      .execute("id", { query: "x" }, undefined, undefined, ctx);
    assert.equal(ok.isError, false);
    assert.equal(ok.details.backend, "codex");
    assert.equal(ok.details.usage.total, 1020);
  } finally {
    if (saved === undefined) delete process.env.PITCREW_ROLES;
    else process.env.PITCREW_ROLES = saved;
  }
});
