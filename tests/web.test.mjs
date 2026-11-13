import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Agent } from "undici";
import { Blocked, blockedAddress, checkUrl, safeFetch, validate } from "../extensions/web/net.ts";
import { findLines, htmlToMarkdown, pdfToText, prune, special, webFetch } from "../extensions/web/fetch.ts";
import web, { webSettings } from "../extensions/web/index.ts";

// --- URL policy -------------------------------------------------------------------------------

test("every blocked IPv4 range is blocked", () => {
  for (const ip of ["0.1.2.3", "10.0.0.5", "100.64.0.1", "100.127.255.255", "127.0.0.1", "127.255.0.9", "169.254.169.254",
    "172.16.0.1", "172.31.255.255", "192.0.0.8", "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.19.255.1", "198.51.100.7",
    "203.0.113.9", "224.0.0.1", "239.1.1.1", "240.0.0.1", "255.255.255.255"]) {
    assert.ok(blockedAddress(ip), ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "100.63.255.255", "100.128.0.0", "172.15.255.255", "172.32.0.0", "198.17.255.255", "93.184.216.34"]) {
    assert.equal(blockedAddress(ip), undefined, ip);
  }
});

test("every blocked IPv6 range is blocked, embedded IPv4 is checked", () => {
  for (const ip of ["::", "::1", "::127.0.0.1", "::a9fe:a9fe", "::ffff:169.254.169.254", "::ffff:7f00:1", "::ffff:10.0.0.1",
    "64:ff9b::a9fe:a9fe", "64:ff9b::10.1.1.1", "64:ff9b:1::1", "2002:7f00:1::", "2002:a9fe:a9fe::1", "fc00::1", "fdff::1",
    "fe80::1", "febf::1", "fec0::1", "feff::1", "ff02::1", "ff00::"]) {
    assert.ok(blockedAddress(ip), ip);
  }
  for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1"]) {
    assert.equal(blockedAddress(ip), undefined, ip);
  }
});

test("loopback exemption only with allowLoopback, never for metadata", () => {
  assert.equal(blockedAddress("127.0.0.1", true), undefined);
  assert.equal(blockedAddress("::1", true), undefined);
  assert.equal(blockedAddress("::ffff:127.0.0.1", true), undefined);
  assert.ok(blockedAddress("169.254.169.254", true));
  assert.ok(blockedAddress("10.0.0.1", true));
});

test("URL checks: scheme, userinfo, local names, odd IPv4 forms", () => {
  const blocked = ["file:///etc/passwd", "gopher://example.com/", "ftp://example.com/", "http://user@example.com/",
    "http://user:pw@example.com/", "http://localhost/", "http://LOCALHOST./", "http://app.localhost/", "http://printer.local/",
    "http://db.internal/", "http://intranet/", "not a url"];
  for (const u of blocked) assert.throws(() => checkUrl(u), Blocked, u);
  assert.equal(checkUrl("https://example.com/a?b=c").hostname, "example.com");
});

test("validate: literal and odd forms of loopback/metadata are blocked", async () => {
  for (const u of ["http://127.0.0.1/", "http://0x7f.1/", "http://127.1/", "http://2130706433/", "http://0177.0.0.1/",
    "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://[::ffff:169.254.169.254]/", "http://[64:ff9b::a9fe:a9fe]/",
    "http://[2002:7f00:1::]/", "http://0.0.0.0/"]) {
    await assert.rejects(validate(u), Blocked, u);
  }
});

test("validate: every resolved address must be public", async () => {
  const resolve = async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }];
  await assert.rejects(validate("https://mixed.example.com/", { resolve }), /resolves to 10\.0\.0\.5 \(private range\)/);
  const ok = await validate("https://pub.example.com/", { resolve: async () => [{ address: "93.184.216.34", family: 4 }] });
  assert.equal(ok.address, "93.184.216.34");
});

// --- local server helpers ---------------------------------------------------------------------

async function serve(handler) {
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

// Agent that connects any validated address to the local test server (a "public" host in tests).
const toLocal = () => new Agent({ connect: { lookup: (_h, o, cb) => (o?.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4)) } });
const publicResolve = async () => [{ address: "93.184.216.34", family: 4 }];

test("pinning: the socket goes to the validated address; DNS is asked once", async () => {
  const srv = await serve((_req, res) => res.end("pinned ok"));
  let calls = 0;
  const resolve = async () => (++calls === 1 ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "10.0.0.5", family: 4 }]);
  try {
    const got = await safeFetch(`http://rebind.example.com:${srv.port}/`, { resolve, allowLoopback: true }, {});
    assert.equal(await got.response.text(), "pinned ok");
    await got.close();
    assert.equal(calls, 1);
  } finally { await srv.close(); }
});

test("redirects: each hop is validated again; loopback and metadata targets are blocked; max 5", async () => {
  const srv = await serve((req, res) => {
    const m = req.url.match(/^\/chain\/(\d+)/);
    if (m && Number(m[1]) < 6) { res.writeHead(302, { location: `/chain/${Number(m[1]) + 1}` }); return res.end(); }
    if (req.url === "/to-loopback") { res.writeHead(302, { location: `http://127.0.0.1:${srv.port}/secret` }); return res.end(); }
    if (req.url === "/to-metadata") { res.writeHead(301, { location: "http://169.254.169.254/latest/meta-data" }); return res.end(); }
    if (req.url === "/to-private-name") { res.writeHead(307, { location: "http://db.internal/" }); return res.end(); }
    if (req.url === "/two") { res.writeHead(303, { location: "/final" }); return res.end(); }
    res.end(`at ${req.url} via ${req.method}`);
  });
  const base = `http://public.example.com:${srv.port}`;
  const policy = { resolve: publicResolve };
  try {
    await assert.rejects(safeFetch(`${base}/to-loopback`, policy, {}, undefined, toLocal), /blocked: 127\.0\.0\.1.*loopback/);
    await assert.rejects(safeFetch(`${base}/to-loopback`, { ...policy, allowLoopback: true }, {}, undefined, toLocal), /loopback/);
    await assert.rejects(safeFetch(`${base}/to-metadata`, policy, {}, undefined, toLocal), /169\.254\.169\.254/);
    await assert.rejects(safeFetch(`${base}/to-private-name`, policy, {}, undefined, toLocal), /internal name/);
    await assert.rejects(safeFetch(`${base}/chain/0`, policy, {}, undefined, toLocal), /too many redirects/);
    const ok = await safeFetch(`${base}/chain/1`, policy, {}, undefined, toLocal);
    assert.equal(await ok.response.text(), "at /chain/6 via GET");
    assert.equal(ok.redirects.length, 5);
    await ok.close();
    const two = await safeFetch(`${base}/two`, policy, {}, undefined, toLocal);
    assert.equal(await two.response.text(), "at /final via GET");
    await two.close();
  } finally { await srv.close(); }
});

// --- extraction -------------------------------------------------------------------------------

const para = (i) => `<p>Paragraph ${i}: the pinned resolver keeps the socket on the validated address, so a second DNS answer cannot move it to a private network.</p>`;
const ARTICLE = `<!doctype html><html><head><title>Pinning DNS</title></head><body>
<nav><a href="/">Home</a> <a href="/blog">Blog</a></nav>
<article><h1>Pinning DNS</h1>${Array.from({ length: 12 }, (_, i) => para(i)).join("")}
<pre><code>const agent = new Agent({ connect: { lookup } });</code></pre><a href="/docs/net">net docs</a></article>
<footer>© 2026 Example</footer><script>track()</script></body></html>`;
const SPA = `<!doctype html><html><head><title>App</title><script src="/a.js"></script><script src="/b.js"></script></head><body><div id="root"></div><noscript>Enable JavaScript</noscript></body></html>`;

test("HTML → Markdown via Readability, without nav/footer/scripts", () => {
  const md = htmlToMarkdown(ARTICLE, "https://example.com/post");
  assert.equal(md.title, "Pinning DNS");
  assert.equal(md.clientSide, false);
  assert.match(md.markdown, /Paragraph 11: the pinned resolver/);
  assert.match(md.markdown, /```\nconst agent = new Agent/);
  assert.doesNotMatch(md.markdown, /track\(\)|© 2026/);
  assert.match(md.markdown, /\(https:\/\/example\.com\/docs\/net\)/);
});

test("HTML fallback: short page uses the full body; SPA shell is reported as client-side", () => {
  const short = htmlToMarkdown("<html><head><title>T</title></head><body><h2>Status</h2><ul><li>api: up</li><li>db: up</li></ul><p>All systems normal on this small status page, nothing else to read here today, thanks.</p><p>More text to pass two hundred visible characters on this tiny page, for the client-side check.</p></body></html>", "https://s.example.com/");
  assert.match(short.markdown, /## Status/);
  assert.match(short.markdown, /- api: up/);
  assert.equal(htmlToMarkdown(SPA, "https://app.example.com/").clientSide, true);
});

test("minified HTML without <head>/<body> tags is still extracted", () => {
  const min = `<!doctype html><html lang=en><meta charset=utf-8><title>DNS | Docs</title><script async src=a.js></script><h1>DNS</h1>${Array.from({ length: 8 }, (_, i) => para(i)).join("")}`;
  const md = htmlToMarkdown(min, "https://docs.example.com/dns");
  assert.equal(md.clientSide, false);
  assert.equal(md.title, "DNS | Docs");
  assert.match(md.markdown, /Paragraph 7: the pinned resolver/);
});

// Minimal valid PDF with one text line per page.
function makePdf(pages) {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", null, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids = [];
  for (const text of pages) {
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const contentId = objs.length;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    kids.push(`${objs.length} 0 R`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

test("PDF → text with page markers", async () => {
  const text = await pdfToText(makePdf(["First page text", "Second page text", "Third page text"]));
  assert.match(text, /--- page 1 ---\nFirst page text/);
  assert.match(text, /--- page 3 ---\nThird page text/);
});

test("special URLs: GitHub blob → raw, repo root → README + clone hint, issues → gh hint, YouTube refused", () => {
  assert.equal(special("https://github.com/o/r/blob/main/src/a.ts").url, "https://raw.githubusercontent.com/o/r/main/src/a.ts");
  const root = special("https://github.com/o/r");
  assert.equal(root.url, "https://raw.githubusercontent.com/o/r/HEAD/README.md");
  assert.match(root.hint, /git clone --depth 1/);
  assert.match(special("https://github.com/o/r/pull/7").hint, /gh pr view 7 -R o\/r/);
  assert.throws(() => special("https://www.youtube.com/watch?v=abc"), /transcript/);
  assert.throws(() => special("https://youtu.be/abc"), /transcript/);
  assert.equal(special("https://example.com/x").url, "https://example.com/x");
});

test("findLines cuts long lines around the match", () => {
  const out = findLines(`${"a".repeat(5000)}NEEDLE${"b".repeat(5000)}`, "needle");
  assert.match(out, /^1: …a+NEEDLEb+…$/);
  assert.ok(out.length < 500);
});

test("findLines returns matches with 3 lines of context", () => {
  const text = Array.from({ length: 30 }, (_, i) => `line ${i + 1}${i === 14 ? " NEEDLE" : ""}`).join("\n");
  const out = findLines(text, "needle");
  assert.match(out, /^12: line 12\n/);
  assert.match(out, /15: line 15 NEEDLE/);
  assert.match(out, /18: line 18$/);
  assert.doesNotMatch(out, /19: /);
  assert.equal(findLines(text, "absent"), 'find: 0 matches for "absent"');
});

// --- web_fetch end to end against a local server ------------------------------------------------

test("web_fetch: banner, saved file, truncation pointer, find, content types, caps", async () => {
  const big = `<html><head><title>Big</title></head><body><article><h1>Big</h1>${Array.from({ length: 200 }, (_, i) => para(i)).join("")}<p>UNIQUE-MARKER here</p></article></body></html>`;
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const srv = await serve((req, res) => {
    if (req.url === "/big") { res.setHeader("content-type", "text/html; charset=utf-8"); return res.end(big); }
    if (req.url === "/spa") { res.setHeader("content-type", "text/html"); return res.end(SPA); }
    if (req.url === "/md") { res.setHeader("content-type", "text/markdown"); return res.end("# Hello\n\nmarkdown body"); }
    if (req.url === "/json") { res.setHeader("content-type", "application/json"); return res.end('{"a":1}'); }
    if (req.url === "/pypi") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ info: { description: "x".repeat(20000), name: "httpx", version: "0.28.1" } })); }
    if (req.url === "/img") { res.setHeader("content-type", "image/png"); return res.end(png); }
    if (req.url === "/doc.pdf") { res.setHeader("content-type", "application/pdf"); return res.end(makePdf(["Alpha", "Beta", "Gamma"])); }
    if (req.url === "/huge") { res.setHeader("content-type", "text/plain"); return res.end(Buffer.alloc(12 * 1024 * 1024, 97)); }
    if (req.url === "/missing") { res.statusCode = 404; res.setHeader("content-type", "text/plain"); return res.end("no such page"); }
    res.end("?");
  });
  const dir = mkdtempSync(join(tmpdir(), "web-test-"));
  const opts = { policy: { allowLoopback: true }, dir, maxChars: 6000 };
  const u = (p) => `http://127.0.0.1:${srv.port}${p}`;
  try {
    const r = await webFetch({ url: u("/big") }, opts);
    assert.equal(r.isError, false);
    assert.match(r.text, /^\[untrusted web content\] http:\/\/127\.0\.0\.1:\d+\/big \| HTTP 200 \| text\/html \| "Big" \| [\d,]+ chars\nsaved: /);
    assert.equal(r.details.truncated, true);
    assert.match(r.text, /\[truncated at 6,000 of [\d,]+ chars; use read on the saved path with offset, or grep\]$/);
    const saved = readFileSync(r.details.path, "utf8");
    assert.equal(saved.length, r.details.chars);
    assert.match(saved, /UNIQUE-MARKER/);
    assert.equal(statSync(r.details.path).mode & 0o777, 0o600);
    assert.equal(statSync(dir).mode & 0o777, 0o700);

    const f = await webFetch({ url: u("/big"), find: "unique-marker" }, opts);
    assert.match(f.text, /UNIQUE-MARKER here/);
    assert.equal(f.details.truncated, false);

    const small = await webFetch({ url: u("/big"), maxChars: 50 }, opts); // clamped to 1,000
    assert.match(small.text, /truncated at 1,000 of/);

    assert.match((await webFetch({ url: u("/md") }, opts)).text, /# Hello\n\nmarkdown body$/);
    assert.match((await webFetch({ url: u("/json") }, opts)).text, /\{\n "a": 1\n\}$/);
    // One-line JSON (PyPI): pretty-printed, so `find` returns the field (m7).
    const pypi = await webFetch({ url: u("/pypi"), find: "\"version\"" }, opts);
    assert.match(pypi.text, /"version": "0\.28\.1"/);
    assert.ok(pypi.text.length < 2000, `find output ${pypi.text.length} chars`);
    const img = await webFetch({ url: u("/img") }, opts);
    assert.match(img.text, /image saved; use read on the path/);
    assert.ok(existsSync(img.details.path) && img.details.path.endsWith(".png"));
    const pdf = await webFetch({ url: u("/doc.pdf") }, opts);
    assert.match(pdf.text, /--- page 3 ---\nGamma/);
    await assert.rejects(webFetch({ url: u("/spa") }, opts), /renders client-side.*browser-check skill/);
    await assert.rejects(webFetch({ url: u("/huge") }, opts), /over 10 MB/);
    const missing = await webFetch({ url: u("/missing") }, opts);
    assert.equal(missing.isError, true);
    assert.match(missing.text, /^HTTP 404 from/);
    await assert.rejects(webFetch({ url: u("/big") }, { ...opts, policy: {} }), /blocked: 127\.0\.0\.1.*loopback/);
  } finally {
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prune removes session folders older than 7 days", () => {
  const root = mkdtempSync(join(tmpdir(), "web-prune-"));
  try {
    mkdirSync(join(root, "old"));
    mkdirSync(join(root, "new"));
    const eightDays = (Date.now() - 8 * 86_400_000) / 1000;
    utimesSync(join(root, "old"), eightDays, eightDays);
    assert.equal(prune(root), 1);
    assert.ok(!existsSync(join(root, "old")) && existsSync(join(root, "new")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- registration -----------------------------------------------------------------------------

function fakePi(settings = {}) {
  const tools = new Map();
  const handlers = {};
  let active = [];
  const pi = {
    registerTool: (t) => { tools.set(t.name, t); if (t.defaultActive !== false) active.push(t.name); },
    on: (ev, h) => { handlers[ev] = h; },
    getSettings: () => settings,
    getActiveTools: () => [...active],
    setActiveTools: (names) => { active = names; },
  };
  web(pi);
  return { tools, handlers, active: () => active };
}

test("two tools; the descriptions carry the guidance and stay short", () => {
  const { tools, active } = fakePi();
  assert.deepEqual(active(), ["web_search", "web_fetch"]);
  assert.match(tools.get("web_fetch").description, /cite its URL/);
  assert.match(tools.get("web_search").description, /web_fetch.*cite the URLs/);
  for (const [name, t] of tools) assert.ok(t.description.length < 450, `${name}: ${t.description.length} chars`);
});

test("settings: backends exa then codex by default", () => {
  assert.deepEqual(webSettings().backends, ["exa", "codex"]);
});
