import { toplevel } from "../../lib/git.ts";
import { statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { currentRoles } from "../../lib/profile.ts";
import { type FooterState, quotaSummary, renderFooter } from "./footer.ts";
import { agentDir, parseClaudeHeaders, parseCodexEvent, parseCodexHeaders, type ProviderQuota, type QuotaFile, type QuotaKind, quotaKind, quotaNotices, quotaPath, readQuota, writeQuota } from "./quota.ts";
import { issueCompletion } from "./issues.ts";
import { sessionLabels } from "./labels.ts";
import { aggregate, type GroupBy, parseSince, readSessions, table } from "./stats.ts";
import { addUsage, cacheHit, emptyTotals, SUBSCRIPTION } from "./usage.ts";

// Status: our footer, the shared quota file, /stats, automatic session names, and the session map
// (labels on verify passes, PRs and agent results; labels.ts). Guard and gate
// state come from the "pitcrew.guard" and "pitcrew.gate" statuses that those extensions set. To use
// pi's own footer, turn this extension off in `pi config`.

export { isQuotaError, readQuota } from "./quota.ts";

const OWN_KEYS = new Set(["pitcrew.guard", "pitcrew.gate"]);
const LOCAL = new Set(["llama.cpp", "ollama", "lmstudio"]);
/** Provider behind a role in this session (the roles extension publishes the map in the environment). */
function roleProvider(role: string): string | undefined {
  return currentRoles().map[role]?.model.split("/")[0];
}

/** `<repo>: <first ~6 words of the first prompt>`; deterministic, no model call. */
export function autoName(entries: any[], repo: string): string | undefined {
  for (const e of entries) {
    if (e?.type !== "message" || e.message?.role !== "user") continue;
    const c = e.message.content;
    const text = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join(" ") : "";
    const words = text.replace(/\s+/g, " ").trim().split(" ").slice(0, 6).join(" ");
    if (!words) return undefined;
    const name = `${repo}: ${words}`;
    return name.length > 60 ? name.slice(0, 59) + "…" : name;
  }
  return undefined;
}

function repoName(cwd: string): string {
  try {
    return basename(toplevel(cwd) ?? cwd);
  } catch {
    return basename(cwd) || cwd;
  }
}

const tilde = (p: string) => {
  const home = process.env.HOME;
  return home && (p === home || p.startsWith(home + "/")) ? "~" + p.slice(home.length) : p;
};

export default function status(pi: ExtensionAPI) {
  const seen = new Set<string>();
  let quota: { file: QuotaFile; mtime: number; checked: number } = { file: {}, mtime: -1, checked: 0 };
  let totals: { key: string; value: ReturnType<typeof sessionTotals> } | undefined;
  let initTokens: { key: string; value: number } | undefined;

  const record = (kind: QuotaKind, snapshot: ProviderQuota | undefined, ctx: ExtensionContext) => {
    if (!snapshot) return;
    try { quota.file = writeQuota(kind, snapshot); quota.checked = 0; } catch {}
    // The bridge already warns about Claude limits; we add the others (Codex credits above all).
    if (!ctx.hasUI || snapshot.provider === "claude-bridge") return;
    for (const text of quotaNotices(kind, snapshot, seen)) ctx.ui.notify(text, "warning");
  };

  pi.on("after_provider_response", (event, ctx) => {
    const provider = ctx.model?.provider === "role" ? undefined : ctx.model?.provider;
    const claude = parseClaudeHeaders(event.headers, provider ?? "claude-bridge");
    if (claude) record("claude", claude, ctx);
    else record("codex", parseCodexHeaders(event.headers), ctx);
  });

  pi.on("provider_stream_event", (event, ctx) => {
    if ((event.data as any)?.type === "codex.rate_limits") record("codex", parseCodexEvent(event.data), ctx);
  });
  // A child agent only reports quota: no footer, session name or commands (nobody sees them).
  if (Number(process.env.PITCREW_DEPTH ?? 0) > 0) return;

  function currentQuota(now: number): QuotaFile {
    if (now - quota.checked < 2000) return quota.file;
    quota.checked = now;
    try {
      const mtime = statSync(quotaPath()).mtimeMs;
      if (mtime !== quota.mtime) quota = { file: readQuota(), mtime, checked: now };
    } catch {}
    return quota.file;
  }

  function toolSchemaChars(): number {
    const active = new Set(pi.getActiveTools());
    return pi.getAllTools().filter((t) => active.has(t.name)).reduce((n, t) => n + JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters }).length, 0);
  }

  function sessionTotals(ctx: ExtensionContext) {
    const t = emptyTotals();
    let last: any;
    const price = (p: string, m: string) => ctx.modelRegistry.find(p, m)?.cost;
    for (const e of ctx.sessionManager.getEntries()) {
      addUsage(t, e, price);
      if (e.type === "message" && e.message.role === "assistant") last = e.message;
    }
    return { t, last };
  }

  function state(ctx: ExtensionContext, data: { getGitBranch(): string | null; getExtensionStatuses(): ReadonlyMap<string, string> }): FooterState {
    const now = Date.now();
    const sm = ctx.sessionManager;
    const key = `${sm.getSessionId()}:${sm.getEntries().length}:${sm.getLeafId()}`;
    if (totals?.key !== key) totals = { key, value: sessionTotals(ctx) };
    const { t, last } = totals.value;
    const model = ctx.model;
    const role = model?.provider === "role" ? model.id : undefined;
    const routeProvider = last?.provider ?? (role ? roleProvider(role) : model?.provider);
    if (t.requests === 0 && initTokens?.key !== key) {
      // A lower bound: a proxy (pi-claude-bridge) adds its own prompt on top.
      try { initTokens = { key, value: Math.round((ctx.getSystemPrompt().length + toolSchemaChars()) / 4) }; } catch { initTokens = { key, value: 0 }; }
    }
    const usage = ctx.getContextUsage();
    const branch = data.getGitBranch();
    const name = sm.getSessionName();
    const statuses = data.getExtensionStatuses();
    const kind = quotaKind(routeProvider);
    let subscription = !!routeProvider && SUBSCRIPTION.has(routeProvider);
    try { if (!subscription && model && model.provider !== "role") subscription = ctx.modelRegistry.isUsingOAuth(model); } catch {}
    return {
      location: `${tilde(ctx.cwd)}${branch ? ` (${branch})` : ""}${name ? ` • ${name}` : ""}`,
      selected: role ? `role/${role}` : model?.id ?? "no-model",
      provider: role ? routeProvider : model?.provider,
      routed: role ? last?.model : undefined,
      thinking: model?.reasoning === false ? undefined : pi.getThinkingLevel(),
      local: !!model && LOCAL.has(model.provider),
      context: usage ? { percent: usage.percent, tokens: usage.tokens, window: usage.contextWindow } : undefined,
      initTokens: t.requests === 0 ? initTokens?.value : undefined,
      cacheHit: cacheHit(last?.usage),
      requests: t.requests,
      input: t.input + t.cacheRead + t.cacheWrite,
      output: t.output,
      cost: t.apiCost,
      subscription,
      quotaKind: kind,
      quota: kind ? currentQuota(now)[kind] : undefined,
      guard: statuses.get("pitcrew.guard"),
      gate: statuses.get("pitcrew.gate"),
      statuses: [...statuses.entries()].filter(([k]) => !OWN_KEYS.has(k)).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim()),
      now,
    };
  }

  function install(ctx: ExtensionContext) {
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    ctx.ui.setFooter((tui, theme, data) => {
      const unsubscribe = data.onBranchChange(() => tui.requestRender());
      const timer = setInterval(() => tui.requestRender(), 30_000); // quota age and reset countdowns
      timer.unref?.();
      return {
        render: (width: number) => renderFooter(state(ctx, data), width, theme),
        invalidate() {},
        dispose() { unsubscribe(); clearInterval(timer); },
      };
    });
  }

  pi.on("session_start", (_event, ctx) => {
    totals = undefined;
    install(ctx);
    if (ctx.hasUI && ctx.mode === "tui") issueCompletion(pi, ctx);
  });

  pi.on("agent_settled", (_event, ctx) => {
    for (const { id, label } of sessionLabels(ctx.sessionManager.getBranch() as any[])) if (!ctx.sessionManager.getLabel(id)) pi.setLabel(id, label);
    if (pi.getSessionName()) return;
    const name = autoName(ctx.sessionManager.getEntries(), repoName(ctx.cwd));
    if (name) pi.setSessionName(name);
  });

  pi.registerCommand("stats", {
    description: "Usage and API-equivalent cost: /stats [today|7d|30d] [--by day|project|role|model|session] [--json]",
    handler: async (args, ctx) => {
      const words = args.trim().split(/\s+/).filter(Boolean);
      const json = words.includes("--json");
      const byIndex = words.indexOf("--by");
      const by = byIndex >= 0 ? (words[byIndex + 1] as GroupBy) : undefined;
      if (by && !["day", "project", "role", "model", "session"].includes(by)) return ctx.ui.notify("--by day|project|role|model|session", "error");
      const period = words.find((w) => w === "today" || /^\d+d$/.test(w)) ?? "7d";
      const since = parseSince(period);
      const dir = ctx.sessionManager.getSessionDir();
      const root = dir && basename(dir).startsWith("--") ? dirname(dir) : join(agentDir(), "sessions");
      // Child agents and runner workers keep their sessions in the work folders, not under sessions/.
      const children = readSessions(join(agentDir(), "pitcrew", "projects"), since).filter((f) => /[\\/]session[\\/]/.test(f.path));
      const files = [...readSessions(root, since), ...children];
      const price = (p: string, m: string) => ctx.modelRegistry.find(p, m)?.cost;
      const plan = (p: string, m: string | undefined) => {
        try { const found = m ? ctx.modelRegistry.find(p, m) : undefined; return !!found && ctx.modelRegistry.isUsingOAuth(found); } catch { return false; }
      };
      const groups: GroupBy[] = by ? [by] : ["day", "project", "role"];
      const q = readQuota();
      if (json) {
        const out = Object.fromEntries(groups.map((g) => [g, aggregate(files, g, since, price, plan)]));
        return ctx.ui.notify(JSON.stringify({ period, sessions: files.length, ...out, quota: q }), "info");
      }
      const lines = [`pitcrew stats, ${period} (${files.length} session files; ≈$ = API-equivalent, $ = billed)`];
      for (const g of groups) lines.push("", ...table(g, aggregate(files, g, since, price, plan)));
      lines.push("");
      for (const k of ["claude", "codex"] as const) if (q[k]) lines.push(quotaSummary(k, q[k]!));
      if (ctx.mode !== "tui") return ctx.ui.notify(lines.join("\n"), "info");
      await ctx.ui.custom<void>((_tui, theme, keybindings, done) => ({
        render: (width: number) => [...lines, "", theme.fg("dim", "enter or esc to close")].map((l) => truncateToWidth(l, width)),
        handleInput(data: string) {
          if (keybindings.matches(data, "tui.select.confirm") || keybindings.matches(data, "tui.select.cancel")) done();
        },
        invalidate() {},
      }));
    },
  });
}
