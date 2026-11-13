import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { extractText } from "unpdf";
import { safeFetch, type Policy } from "./net.ts";

// web_fetch pipeline: special URLs → safe GET → extract by content type → full text to a file,
// first maxChars (or `find` matches) inline. Ideas: pi-web-access@fed16958, amosblomqvist/pi-config@f82da563.

export const WEB_ROOT = "/tmp/pitcrew/web";
export const BANNER = "[untrusted web content]";
const MB = 1024 * 1024;
const VERSION = "0.1.0";
export const HEADERS = {
  "user-agent": `pitcrew-web/${VERSION}`,
  accept: "text/markdown, text/html;q=0.9, */*;q=0.5",
};

export type FetchParams = { url: string; maxChars?: number; raw?: boolean; find?: string };
export type FetchDetails = {
  url: string; finalUrl: string; status: number; contentType: string; title: string;
  chars: number; path: string; truncated: boolean; redirects: string[];
};
export type FetchResult = { text: string; isError: boolean; details?: FetchDetails };

export class FetchError extends Error {}

/** Rewrite or refuse special URLs. */
export function special(raw: string): { url: string; hint?: string } {
  let u: URL;
  try { u = new URL(raw); } catch { return { url: raw }; }
  const host = u.hostname.replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  if (host === "github.com" && parts.length >= 5 && parts[2] === "blob") {
    return { url: `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts.slice(3).join("/")}` };
  }
  if (host === "github.com" && parts.length === 2) {
    return {
      url: `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/HEAD/README.md`,
      hint: `repo README only. To read code: git clone --depth 1 --filter=blob:none https://github.com/${parts[0]}/${parts[1]} /tmp/<dir>, then grep.`,
    };
  }
  if (host === "github.com" && parts.length >= 4 && (parts[2] === "issues" || parts[2] === "pull")) {
    const kind = parts[2] === "pull" ? "pr" : "issue";
    return { url: raw, hint: `for full threads use gh: gh ${kind} view ${parts[3]} -R ${parts[0]}/${parts[1]} --comments` };
  }
  if (host === "youtu.be" || (host.endsWith("youtube.com") && /^\/(watch|shorts|live)/.test(u.pathname))) {
    throw new FetchError("YouTube pages have no readable text here. web_fetch has no video pipeline; get the transcript with a transcript tool (for example yt-dlp --skip-download --write-subs --write-auto-subs) if one is installed.");
  }
  return { url: raw };
}

async function readCapped(body: ReadableStream<Uint8Array> | null, cap: number): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > cap) throw new FetchError(`body over ${cap / MB} MB (cap)`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const TEXT_TYPE = /^(text\/|application\/(json|xml|javascript|x-ndjson|yaml|x-yaml|toml)|application\/[\w.+-]+\+(json|xml))/;
const IMAGE_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" };

function turndown(): TurndownService {
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  td.remove(["script", "style", "noscript", "template", "iframe", "svg"] as never);
  return td;
}

// linkedom does not create the implied <head>/<body> that minified pages omit; add them.
function withHeadAndBody(html: string): string {
  if (/<head[\s>]/i.test(html) && /<body[\s>]/i.test(html)) return html;
  const s = html.replace(/<!doctype[^>]*>/i, "").replace(/<\/?(html|head)(\s[^>]*)?>/gi, "");
  const b = s.search(/<body[\s>]/i);
  return b >= 0 ? `<html><head>${s.slice(0, b)}</head>${s.slice(b)}</html>` : `<html><head></head><body>${s}</body></html>`;
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();

/** HTML → Markdown: Readability article, or the full body when the article is too small. */
export function htmlToMarkdown(html: string, url: string): { title: string; markdown: string; clientSide: boolean } {
  html = withHeadAndBody(html);
  const page = parseHTML(html).document;
  const title = decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "");
  for (const el of page.querySelectorAll("script,style,noscript,template")) el.remove();
  const visible = (page.body?.textContent ?? "").replace(/\s+/g, " ").trim();
  const scripts = (html.match(/<script\b/gi) ?? []).length;
  if (visible.length < 200 && scripts > 0) return { title, markdown: "", clientSide: true };

  const doc = parseHTML(html.replace(/<head([^>]*)>/i, `<head$1><base href="${url.replace(/"/g, "%22")}">`)).document;
  let article: { content?: string | null; textContent?: string | null; title?: string | null } | null = null;
  try { article = new Readability(doc as never).parse(); } catch { article = null; }
  const articleChars = (article?.textContent ?? "").replace(/\s+/g, " ").trim().length;
  const useArticle = article?.content && articleChars >= 500 && articleChars >= 0.3 * visible.length;
  const source = useArticle ? article!.content! : (page.body?.innerHTML ?? html);
  const markdown = turndown().turndown(source).replace(/^(\s*)(-|\d+\.) {2,}/gm, "$1$2 ").replace(/\n{3,}/g, "\n\n").trim();
  return { title: title || (article?.title ?? "").trim(), markdown, clientSide: false };
}

export async function pdfToText(buf: Buffer): Promise<string> {
  const { text } = await extractText(new Uint8Array(buf), { mergePages: false });
  return text.map((t, i) => `--- page ${i + 1} ---\n${t.trim()}`).join("\n\n");
}

/** JSON one field per line, so `find` and grep work on one-line API bodies; other text unchanged. */
export function prettyJson(body: string): string {
  try { return JSON.stringify(JSON.parse(body), null, 1); } catch { return body; }
}

const LINE_CAP = 400;
/** A long line cut to LINE_CAP chars around the first match. */
const around = (line: string, n: string) => {
  if (line.length <= LINE_CAP) return line;
  const at = Math.max(0, line.toLowerCase().indexOf(n) - LINE_CAP / 2);
  return `${at > 0 ? "…" : ""}${line.slice(at, at + LINE_CAP)}${at + LINE_CAP < line.length ? "…" : ""}`;
};

/** Lines matching `needle` (case-insensitive) with ±3 lines of context; groups separated by "...".
 *  Lines over 400 chars are cut around the match, so one long line cannot hide it. */
export function findLines(text: string, needle: string, context = 3): string {
  const lines = text.split("\n");
  const n = needle.toLowerCase();
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    if (!l.toLowerCase().includes(n)) return;
    for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) keep.add(j);
  });
  if (!keep.size) return `find: 0 matches for "${needle}"`;
  const out: string[] = [];
  let last = -2;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i !== last + 1 && out.length) out.push("...");
    out.push(`${i + 1}: ${lines[i].toLowerCase().includes(n) ? around(lines[i], n) : lines[i].slice(0, LINE_CAP)}`);
    last = i;
  }
  return out.join("\n");
}

export const sessionDir = (session: string) => join(WEB_ROOT, session.replace(/[^\w.-]/g, "_") || "default");

export function save(dir: string, key: string, ext: string, data: string | Buffer): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${createHash("sha256").update(key).digest("hex").slice(0, 16)}.${ext}`);
  writeFileSync(path, data, { mode: 0o600 });
  return path;
}

/** Delete session folders older than `days` (run on session_start). */
export function prune(root = WEB_ROOT, days = 7, now = Date.now()): number {
  let removed = 0;
  let entries: string[] = [];
  try { entries = readdirSync(root); } catch { return 0; }
  for (const name of entries) {
    const p = join(root, name);
    try {
      if (now - statSync(p).mtimeMs > days * 86_400_000) { rmSync(p, { recursive: true, force: true }); removed++; }
    } catch { /* gone already */ }
  }
  return removed;
}

/** Header + inline slice + truncation marker. `text` is already saved at `path`. */
export function render(d: Omit<FetchDetails, "truncated">, text: string, maxChars: number, find?: string, hint?: string): { text: string; truncated: boolean } {
  const head = [`${BANNER} ${d.finalUrl} | HTTP ${d.status} | ${d.contentType || "unknown"} | "${d.title}" | ${d.chars.toLocaleString("en-US")} chars`, `saved: ${d.path}`];
  if (d.redirects.length) head.push(`redirects: ${d.redirects.join(" → ")}`);
  if (hint) head.push(`hint: ${hint}`);
  const full = find ? findLines(text, find) : text;
  const truncated = full.length > maxChars;
  const body = truncated ? full.slice(0, maxChars) : full;
  const tail = truncated
    ? `\n[truncated at ${maxChars.toLocaleString("en-US")} of ${full.length.toLocaleString("en-US")} chars; use read on the saved path with offset, or grep]`
    : "";
  return { text: `${head.join("\n")}\n\n${body}${tail}`, truncated };
}

export async function webFetch(p: FetchParams, opts: { policy: Policy; dir: string; maxChars: number; signal?: AbortSignal }): Promise<FetchResult> {
  const maxChars = Math.min(20_000, Math.max(1_000, p.maxChars ?? opts.maxChars));
  const { url, hint } = special(p.url);
  const timeout = AbortSignal.timeout(20_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const got = await safeFetch(url, opts.policy, HEADERS, signal);
  try {
    const { response, finalUrl, redirects } = got;
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const isPdf = contentType === "application/pdf" || (!contentType && /\.pdf$/i.test(new URL(finalUrl).pathname));
    const declared = Number(response.headers.get("content-length") ?? 0);
    const cap = (isPdf ? 30 : 10) * MB;
    if (declared > cap) throw new FetchError(`${isPdf ? "PDF" : "body"} over ${cap / MB} MB (content-length ${declared})`);
    const buf = await readCapped(response.body as never, cap);
    const base = { url: p.url, finalUrl, status: response.status, contentType, redirects };

    if (contentType.startsWith("image/") || (contentType && !isPdf && !TEXT_TYPE.test(contentType) && contentType !== "text/html" && contentType !== "application/xhtml+xml")) {
      const ext = IMAGE_EXT[contentType] ?? "bin";
      const path = save(opts.dir, finalUrl, ext, buf);
      const what = contentType.startsWith("image/") ? "image saved; use read on the path to view it" : "binary saved; not text";
      return { text: `${BANNER} ${finalUrl} | HTTP ${response.status} | ${contentType} | ${buf.length.toLocaleString("en-US")} bytes\nsaved: ${path}\n${what}`, isError: response.status >= 400, details: { ...base, title: "", chars: 0, path, truncated: false } };
    }

    let title = "";
    let text: string;
    if (isPdf || buf.subarray(0, 5).toString() === "%PDF-") {
      text = await pdfToText(buf);
    } else {
      const body = buf.toString("utf8");
      const html = contentType === "text/html" || contentType === "application/xhtml+xml" || (!contentType && /^\s*<(!doctype html|html)/i.test(body));
      if (html && !p.raw) {
        const md = htmlToMarkdown(body, finalUrl);
        if (md.clientSide && response.status < 400) throw new FetchError(`page renders client-side (almost no text without JavaScript): ${finalUrl}. Open it in a headless browser with the browser-check skill, or look for the same content as raw files, an API or the docs source.`);
        title = md.title;
        text = md.markdown;
      } else {
        text = /json/.test(contentType) ? prettyJson(body) : body;
        if (html) title = (body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim();
      }
    }
    const path = save(opts.dir, finalUrl, "md", text);
    const d = { ...base, title: title.replace(/\s+/g, " ").slice(0, 200), chars: text.length, path };
    if (response.status >= 400) {
      return { text: `HTTP ${response.status} from ${finalUrl}\nsaved: ${path}\n${text.slice(0, 500)}`, isError: true, details: { ...d, truncated: text.length > 500 } };
    }
    if (!text.trim()) return { text: `${BANNER} ${finalUrl} | HTTP ${response.status} | ${contentType} | empty body`, isError: true, details: { ...d, truncated: false } };
    const out = render(d, text, maxChars, p.find, hint);
    return { text: out.text, isError: false, details: { ...d, truncated: out.truncated } };
  } finally {
    await got.close();
  }
}
