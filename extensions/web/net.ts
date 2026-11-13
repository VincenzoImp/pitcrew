import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch, type Response } from "undici";

// URL policy for web_fetch: http(s) only, no userinfo, every resolved address must be public, and the
// socket is pinned to the validated address (no second DNS lookup, so no rebinding).
// Redirects are followed by hand (max 5); each hop is validated again.

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
export type Policy = { allowLoopback?: boolean; resolve?: Resolver };
export type Target = { url: URL; address: string; family: number };

export class Blocked extends Error {}

const V4_BLOCKS: [string, number, string][] = [
  ["0.0.0.0", 8, "this network"], ["10.0.0.0", 8, "private range"], ["100.64.0.0", 10, "CGNAT range"],
  ["127.0.0.0", 8, "loopback"], ["169.254.0.0", 16, "link-local / cloud metadata"], ["172.16.0.0", 12, "private range"],
  ["192.0.0.0", 24, "IETF protocol range"], ["192.0.2.0", 24, "documentation range"], ["192.168.0.0", 16, "private range"],
  ["198.18.0.0", 15, "benchmark range"], ["198.51.100.0", 24, "documentation range"], ["203.0.113.0", 24, "documentation range"],
  ["224.0.0.0", 4, "multicast"], ["240.0.0.0", 4, "reserved range"],
];

const v4num = (ip: string) => ip.split(".").reduce((n, p) => n * 256 + Number(p), 0);
const v4str = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");

function blockedV4(ip: string): string | undefined {
  const n = v4num(ip);
  for (const [base, bits, why] of V4_BLOCKS) {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    if (((n & mask) >>> 0) === v4num(base)) return why;
  }
  return undefined;
}

// Expand an IPv6 address (with optional dotted v4 tail) into 8 numbers.
export function v6words(ip: string): number[] {
  let s = ip.toLowerCase().replace(/%.*$/, "");
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const n = v4num(tail[1]);
    s = s.slice(0, -tail[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, rest] = s.split("::");
  const a = head ? head.split(":") : [];
  const b = rest !== undefined && rest !== "" ? rest.split(":") : [];
  const fill = rest === undefined ? [] : Array(8 - a.length - b.length).fill("0");
  return [...a, ...fill, ...b].map((h) => parseInt(h, 16));
}

function blockedV6(ip: string): string | undefined {
  const w = v6words(ip);
  const v4 = (hi: number, lo: number) => v4str(((hi << 16) | lo) >>> 0);
  const zero = (from: number, to: number) => w.slice(from, to).every((x) => x === 0);
  if (zero(0, 6)) return ip === "::1" || zero(0, 7) ? "loopback / unspecified" : "IPv4-compatible address";
  if (zero(0, 5) && w[5] === 0xffff) return embedded(v4(w[6], w[7]), "IPv4-mapped");
  if (w[0] === 0x64 && w[1] === 0xff9b && zero(2, 6)) return embedded(v4(w[6], w[7]), "NAT64");
  if (w[0] === 0x64 && w[1] === 0xff9b && w[2] === 1) return "local NAT64 range";
  if (w[0] === 0x2002) return embedded(v4(w[1], w[2]), "6to4");
  if ((w[0] & 0xfe00) === 0xfc00) return "unique local range";
  if ((w[0] & 0xffc0) === 0xfe80) return "link-local";
  if ((w[0] & 0xffc0) === 0xfec0) return "site-local";
  if ((w[0] & 0xff00) === 0xff00) return "multicast";
  return undefined;
}

function embedded(v4: string, kind: string): string | undefined {
  const why = blockedV4(v4);
  return why ? `${kind} ${v4}: ${why}` : undefined;
}

function isLoopback(ip: string): boolean {
  if (isIP(ip) === 4) return ip.startsWith("127.");
  const w = v6words(ip);
  const zero5 = w.slice(0, 5).every((x) => x === 0);
  return (zero5 && w[5] === 0 && w[6] === 0 && w[7] === 1) || (zero5 && w[5] === 0xffff && w[6] >> 8 === 127);
}

/** Reason the address is not public, or undefined when it is allowed. */
export function blockedAddress(ip: string, allowLoopback = false): string | undefined {
  if (allowLoopback && isLoopback(ip)) return undefined;
  const kind = isIP(ip);
  if (kind === 4) return blockedV4(ip);
  if (kind === 6) return blockedV6(ip);
  return "not an IP address";
}


/** Parse and check the URL itself (scheme, userinfo, host names, domain lists). */
export function checkUrl(raw: string | URL, policy: Policy = {}): URL {
  let url: URL;
  try { url = new URL(String(raw)); } catch { throw new Blocked(`blocked: invalid URL ${String(raw)}`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Blocked(`blocked: scheme ${url.protocol} (http and https only)`);
  if (url.username || url.password) throw new Blocked("blocked: URL contains userinfo (user:pass@)");
  const host = hostOf(url);
  const literal = isIP(host) !== 0;
  if (!literal) {
    const local = host === "localhost" || host.endsWith(".localhost");
    if (local && !policy.allowLoopback) throw new Blocked(`blocked: ${host} is a local name`);
    if (!local && (host.endsWith(".local") || host.endsWith(".internal") || !host.includes("."))) {
      throw new Blocked(`blocked: ${host} is a local or internal name`);
    }
  }
  return url;
}

export const hostOf = (url: URL) => url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();

const systemResolver: Resolver = async (host) => dnsLookup(host, { all: true, verbatim: true });

/** Check the URL and resolve it; every address must pass. Returns the address to pin. */
export async function validate(raw: string | URL, policy: Policy = {}): Promise<Target> {
  const url = checkUrl(raw, policy);
  const host = hostOf(url);
  const kind = isIP(host);
  const addrs = kind ? [{ address: host, family: kind }] : await (policy.resolve ?? systemResolver)(host).catch((e: Error) => {
    throw new Blocked(`blocked: cannot resolve ${host} (${e.message})`);
  });
  if (!addrs.length) throw new Blocked(`blocked: ${host} has no address`);
  for (const a of addrs) {
    const why = blockedAddress(a.address, policy.allowLoopback);
    if (why) throw new Blocked(kind ? `blocked: ${host} is not public (${why})` : `blocked: ${host} resolves to ${a.address} (${why})`);
  }
  return { url, address: addrs[0].address, family: addrs[0].family };
}

/** undici Agent whose connect lookup always returns the validated address. */
export function pinnedAgent(t: Target, timeoutMs = 20_000): Agent {
  const lookup = (_host: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) =>
    opts?.all ? cb(null, [{ address: t.address, family: t.family }]) : cb(null, t.address, t.family);
  return new Agent({ connect: { lookup, timeout: timeoutMs } as never, headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
}

export type Fetched = { response: Response; finalUrl: string; redirects: string[]; close: () => Promise<void> };

/** GET with the URL policy applied to the first hop and every redirect. Call close() after the body is read.
 *  A redirect may reach loopback only when the first hop was already loopback (allowLoopback dev servers).
 *  `agentFor` exists for tests (connect a public-looking address to a local server). */
export async function safeFetch(raw: string, policy: Policy, headers: Record<string, string>, signal?: AbortSignal,
  agentFor: (t: Target) => Agent = (t) => pinnedAgent(t)): Promise<Fetched> {
  const redirects: string[] = [];
  let next = String(raw);
  let local = false;
  for (let hop = 0; ; hop++) {
    const target = await validate(next, hop === 0 || local ? policy : { ...policy, allowLoopback: false });
    if (hop === 0) local = isIP(target.address) !== 0 && isLoopback(target.address);
    const agent = agentFor(target);
    let response: Response;
    try {
      response = await fetch(target.url, { dispatcher: agent, redirect: "manual", headers, signal });
    } catch (e) {
      await agent.destroy().catch(() => {});
      throw e;
    }
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await agent.destroy().catch(() => {});
      if (hop >= 5) throw new Error(`too many redirects (more than 5), last: ${next}`);
      next = new URL(location, target.url).toString();
      redirects.push(next);
      continue; // only GET is used, so 301/302/303/307/308 all continue as GET
    }
    // destroy, not close: close() waits for a body we may have stopped reading (size cap).
    return { response, finalUrl: target.url.toString(), redirects, close: () => agent.destroy().catch(() => {}) };
  }
}
