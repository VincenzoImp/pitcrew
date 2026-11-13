import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { addUsage, cacheHit, emptyTotals, entryUsage, formatTokens, type PlanFn, type PriceFn, type Totals } from "./usage.ts";

// /stats: cost per day, project and role, read from the session JSONL files (including nested
// headless runs that keep their sessions). The role is the latest `model_change` to provider
// "role" before each response; other selections count as "(direct)".

export type GroupBy = "day" | "project" | "role" | "model" | "session";
export interface Row extends Totals { key: string; hit: number | undefined }

export function sessionFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let names: string[];
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      const path = join(dir, name);
      if (name.endsWith(".jsonl")) out.push(path);
      else { try { if (statSync(path).isDirectory()) walk(path); } catch {} }
    }
  };
  walk(root);
  return out.sort();
}

const day = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const home = homedir();
const tilde = (p: string) => (p === home ? "~" : p.startsWith(home + "/") ? "~" + p.slice(home.length) : p);

export function parseSince(period: string | undefined, now = Date.now()): number {
  if (period === "today") { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); }
  const m = /^(\d+)d$/.exec(period ?? "7d");
  return now - (m ? Number(m[1]) : 7) * 86400_000;
}

/** Aggregate usage over JSONL lines, grouped by `by`. `since` filters by entry time (ms). */
export function aggregate(files: { path: string; text: string }[], by: GroupBy, since: number, price: PriceFn, plan?: PlanFn): Row[] {
  const rows = new Map<string, Totals & { hitRead: number; hitPrompt: number }>();
  for (const file of files) {
    let cwd = "?";
    let session = file.path;
    let role = "(direct)";
    for (const line of file.text.split("\n")) {
      if (!line.trim()) continue;
      let e: any;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.type === "session") { cwd = tilde(e.cwd ?? "?"); session = e.id ?? session; continue; }
      if (e.type === "model_change") { role = e.provider === "role" ? e.modelId : "(direct)"; continue; }
      const u = entryUsage(e);
      if (!u) continue;
      const time = e.message?.timestamp ?? Date.parse(e.timestamp);
      if (!(time >= since)) continue;
      const key = by === "day" ? day(time) : by === "project" ? cwd : by === "role" ? role : by === "model" ? `${u.provider ?? "?"}/${u.model ?? "?"}` : session;
      let row = rows.get(key);
      if (!row) rows.set(key, (row = { ...emptyTotals(), hitRead: 0, hitPrompt: 0 }));
      addUsage(row, e, price, plan);
      if (u.request) {
        row.hitRead += u.usage.cacheRead || 0;
        row.hitPrompt += (u.usage.input || 0) + (u.usage.cacheRead || 0) + (u.usage.cacheWrite || 0);
      }
    }
  }
  return [...rows.entries()]
    .map(([key, r]) => {
      const { hitRead, hitPrompt, ...totals } = r;
      return { key, ...totals, hit: hitPrompt ? (hitRead / hitPrompt) * 100 : undefined };
    })
    .sort((a, b) => (by === "day" ? b.key.localeCompare(a.key) : b.apiCost - a.apiCost));
}

export function readSessions(root: string, since: number): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const path of sessionFiles(root)) {
    try {
      if (statSync(path).mtimeMs < since) continue;
      out.push({ path, text: readFileSync(path, "utf8") });
    } catch {}
  }
  return out;
}

export function table(title: string, rows: Row[]): string[] {
  if (!rows.length) return [`${title}: no usage`];
  const total = rows.reduce((t, r) => { for (const k of ["input", "output", "cacheRead", "cacheWrite", "apiCost", "realCost", "requests"] as const) t[k] += r[k]; return t; }, emptyTotals());
  const cells = (key: string, r: Totals, hit: number | undefined) => [
    key, String(r.requests), formatTokens(r.input + r.cacheRead + r.cacheWrite), formatTokens(r.output),
    hit === undefined ? "-" : `${Math.round(hit)}%`, `≈$${r.apiCost.toFixed(2)}`, `$${r.realCost.toFixed(2)}`,
  ];
  const all = [[title, "req", "in", "out", "CH", "API-eq", "billed"], ...rows.map((r) => cells(r.key, r, r.hit)), cells("total", total, cacheHit({ input: total.input, output: 0, cacheRead: total.cacheRead, cacheWrite: total.cacheWrite }))];
  const widths = all[0].map((_, i) => Math.max(...all.map((r) => r[i].length)));
  return all.map((r) => r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  "));
}
