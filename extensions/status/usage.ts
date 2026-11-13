// Token and cost accounting shared by the footer and /stats. The entry set matches pi's native footer:
// usage entries, assistant messages, tool results with usage, compaction and branch summaries.

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost?: { total?: number };
}

export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface Totals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  apiCost: number; // API-equivalent $: what the tokens would cost on the API
  realCost: number; // $ actually billed (API-key providers only)
  requests: number;
}

/** Flat-rate plans: pi's own cost is 0 (bridge) or an API-rate estimate (Codex), never a bill. */
export const SUBSCRIPTION = new Set(["claude-bridge", "openai-codex"]);
const LOCAL = new Set(["llama.cpp", "ollama", "lmstudio"]);

export const emptyTotals = (): Totals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, apiCost: 0, realCost: 0, requests: 0 });

/** Usage carried by one session entry, with the provider and model that produced it. */
export function entryUsage(entry: any): { usage: Usage; provider?: string; model?: string; request: boolean } | undefined {
  if (entry?.type === "usage" && entry.usage) return { usage: entry.usage, provider: entry.provider, model: entry.model, request: false };
  if (entry?.type === "message") {
    const m = entry.message;
    if (m?.role === "assistant" && m.usage) return { usage: m.usage, provider: m.provider, model: m.model, request: true };
    if (m?.role === "toolResult" && m.usage) return { usage: m.usage, provider: m.provider, model: m.model, request: false };
  }
  if ((entry?.type === "compaction" || entry?.type === "branch_summary") && entry.usage) return { usage: entry.usage, request: false };
  return undefined;
}

export function priceCost(u: Usage, p: Price): number {
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1e6;
}

export type PriceFn = (provider: string, model: string) => Price | undefined;
/** Whether a provider bills a flat plan (OAuth login) rather than per token. */
export type PlanFn = (provider: string, model: string | undefined) => boolean;
const defaultPlan: PlanFn = (provider) => SUBSCRIPTION.has(provider);

/**
 * API-equivalent and real cost of one usage record. A provider that reports cost 0 (the bridge) is
 * priced with the matching `anthropic/<model>` from `price`. Local models cost nothing.
 */
export function usageCost(u: Usage, provider: string | undefined, model: string | undefined, price: PriceFn, plan: PlanFn = defaultPlan) {
  if (provider && LOCAL.has(provider)) return { api: 0, real: 0 };
  const own = u.cost?.total ?? 0;
  let api = own;
  if (!own && provider === "claude-bridge" && model) {
    const p = price("anthropic", model);
    if (p) api = priceCost(u, p);
  }
  const real = provider && (SUBSCRIPTION.has(provider) || plan(provider, model)) ? 0 : own;
  return { api, real };
}

export function addUsage(t: Totals, entry: any, price: PriceFn, plan?: PlanFn): boolean {
  const e = entryUsage(entry);
  if (!e) return false;
  const u = e.usage;
  t.input += u.input || 0;
  t.output += u.output || 0;
  t.cacheRead += u.cacheRead || 0;
  t.cacheWrite += u.cacheWrite || 0;
  const c = usageCost(u, e.provider, e.model, price, plan);
  t.apiCost += c.api;
  t.realCost += c.real;
  if (e.request) t.requests++;
  return true;
}

/** Cache-hit rate of one request: reads / (input + reads + writes), in percent (pi's formula). */
export function cacheHit(u: Usage | undefined): number | undefined {
  if (!u) return undefined;
  const prompt = (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
  return prompt > 0 ? ((u.cacheRead || 0) / prompt) * 100 : undefined;
}

export function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1e6) return `${Math.round(n / 1000)}k`;
  if (n < 1e7) return `${(n / 1e6).toFixed(1)}M`;
  return `${Math.round(n / 1e6)}M`;
}
