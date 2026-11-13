#!/usr/bin/env node
// Sandbox egress proxy (docs/sandbox.md): the only route out of the box network.
// - Port 3128: HTTPS CONNECT to allow-listed hosts on port 443; everything else gets 403.
// - Port 8080 (when PITCREW_BOX_TOKEN is set): plain HTTP to the model API. The box holds only a
//   placeholder token; this proxy swaps it for the real one and sends the request on over TLS. The
//   real token never enters the box.
// One JSON log line per connection on stdout (the host keeps it).
// Env: PITCREW_BOX_ALLOW (comma list; "*.example.com" matches subdomains only), PITCREW_BOX_TOKEN,
// PITCREW_BOX_PLACEHOLDER, PITCREW_BOX_API_HOST (default api.anthropic.com).
import { createServer } from "node:http";
import { request } from "node:https";
import { connect, isIP } from "node:net";
import { pathToFileURL } from "node:url";

export const DEFAULT_ALLOW = [
  "registry.npmjs.org", "pypi.org", "files.pythonhosted.org",
  "github.com", "codeload.github.com", "objects.githubusercontent.com",
];

/** Parse "host:port" from a CONNECT target; null when malformed. */
export function parseTarget(target) {
  const m = /^([a-z0-9.-]+):(\d{1,5})$/i.exec(target ?? "");
  return m ? { host: m[1].toLowerCase().replace(/\.$/, ""), port: Number(m[2]) } : null;
}

/** True when host is listed exactly, or matches a "*.domain" entry. IP literals must be listed exactly. */
export function allowed(host, list) {
  for (const raw of list) {
    const e = raw.trim().toLowerCase();
    if (!e) continue;
    if (e === host) return true;
    if (e.startsWith("*.") && !isIP(host) && host.endsWith(e.slice(1))) return true;
  }
  return false;
}

export function decide(target, list) {
  const t = parseTarget(target);
  if (!t) return { ok: false, why: "bad target" };
  if (t.port !== 443) return { ok: false, why: "port", ...t };
  return allowed(t.host, list) ? { ok: true, ...t } : { ok: false, why: "not allowed", ...t };
}

export function startProxy({ allow = DEFAULT_ALLOW, port = 3128, log = (o) => console.log(JSON.stringify(o)) } = {}) {
  const server = createServer((req, res) => {
    log({ t: new Date().toISOString(), method: req.method, url: req.url, ok: false, why: "plain http" });
    res.writeHead(403).end("sandbox egress: only HTTPS CONNECT to allowed hosts\n");
  });
  server.on("connect", (req, client, head) => {
    const d = decide(req.url, allow);
    const rec = { t: new Date().toISOString(), host: d.host ?? req.url, port: d.port, ok: d.ok, why: d.why };
    if (!d.ok) { log(rec); client.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
    let up = 0, down = 0;
    const upstream = connect(d.port, d.host, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) { upstream.write(head); up += head.length; }
      client.on("data", (b) => { up += b.length; }).pipe(upstream);
      upstream.on("data", (b) => { down += b.length; }).pipe(client);
    });
    const done = (err) => {
      if (rec.end) return;
      rec.end = new Date().toISOString(); Object.assign(rec, { up, down }, err ? { error: err.code ?? String(err) } : {});
      log(rec); client.destroy(); upstream.destroy();
    };
    upstream.on("error", (e) => { if (!client.writableEnded && !up && !down) client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); done(e); });
    upstream.on("close", () => done()); client.on("error", done); client.on("close", () => done());
  });
  return server.listen(port);
}

/** Headers for the upstream request: the placeholder bearer becomes the real token; nothing else changes. */
export function injectHeaders(headers, { token, placeholder, host }) {
  const out = { ...headers, host };
  delete out.connection;
  delete out["proxy-connection"];
  const injected = out.authorization === `Bearer ${placeholder}`;
  if (injected) out.authorization = `Bearer ${token}`;
  return { headers: out, injected };
}

export function startInjector({ token, placeholder, host = "api.anthropic.com", port = 8080, log = (o) => console.log(JSON.stringify(o)) }) {
  return createServer((req, res) => {
    const { headers, injected } = injectHeaders(req.headers, { token, placeholder, host });
    const rec = { t: new Date().toISOString(), inject: host, method: req.method, path: String(req.url).split("?")[0], injected };
    const up = request({ host, port: 443, method: req.method, path: req.url, headers }, (r) => {
      rec.status = r.statusCode;
      log(rec);
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", (e) => { rec.error = e.code ?? String(e); log(rec); if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(up);
  }).listen(port);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const allow = (process.env.PITCREW_BOX_ALLOW ?? DEFAULT_ALLOW.join(",")).split(",").filter(Boolean);
  startProxy({ allow, port: 3128 });
  const token = process.env.PITCREW_BOX_TOKEN;
  delete process.env.PITCREW_BOX_TOKEN;
  if (token) startInjector({ token, placeholder: process.env.PITCREW_BOX_PLACEHOLDER, host: process.env.PITCREW_BOX_API_HOST || "api.anthropic.com" });
  console.log(JSON.stringify({ t: new Date().toISOString(), listening: [3128, ...(token ? [8080] : [])], allow }));
}
