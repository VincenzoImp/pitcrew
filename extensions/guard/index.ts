import { toplevel } from "../../lib/git.ts";
import { ownSettings } from "../../lib/settings.ts";
import { homedir, tmpdir } from "node:os";
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { currentMode } from "../../lib/mode.ts";
import { type Caps, checkDelivery, DEFAULT_CAPS, type DeliveryFacts, skipsAsk } from "./delivery.ts";
import { deliveryFacts, ranVerify } from "../../lib/facts.ts";
import { discoverVerify } from "../../lib/verify.ts";
import { treeId } from "../verify-gate/receipts.ts";
import { checkBash, checkFileTool, checkWorker, NEVER_PREAPPROVE, type Place, type Verdict } from "./rules.ts";

// Guard: deterministic gate on bash and file tool calls (rules in rules.ts).
// - block: never runs; the turn ends so you regain control. `/guard off` keeps blocks.
// - ask:   interactive sessions show a confirm dialog; `/guard off` skips asks for this session
//          (except guard-bypass).
// - strict (no UI, or PI_GUARD_STRICT=1 for subagent children): asks are blocked unless the rule id
//   is listed in PI_GUARD_ALLOW; the third such block ends the run; `/guard off` is ignored.
// Footer status key `pitcrew.guard`: "guard" or "guard off", plus "N✗ M?" (blocked calls, asks shown).
// Disable the whole guard with `pi config` (extension resource) when you need to.
// Delivery rules (delivery.ts): PR closes an issue, merge inside the stop dial on a verified head,
// foreign repos, worktree and disk caps; each tied to the session mode (docs/delivery.md).
// A foreign repo also gets project trust "no", so its .pi resources never load.

const roots = new Map<string, string>();

function projectRoot(cwd: string): string {
  let root = roots.get(cwd);
  if (!root) {
    try {
      root = toplevel(cwd) ?? cwd;
    } catch {
      root = cwd;
    }
    roots.set(cwd, root);
  }
  return root;
}

/** realpath of the deepest existing prefix, so links inside the project cannot point outside it. */
function realPrefix(p: string): string {
  let head = p;
  const tail: string[] = [];
  for (;;) {
    try { return join(realpathSync(head), ...tail.reverse()); } catch {}
    const up = dirname(head);
    if (up === head) return p;
    tail.push(basename(head));
    head = up;
  }
}

function place(cwd: string): Place {
  const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };
  return {
    cwd,
    root: projectRoot(cwd),
    home: homedir(),
    scratch: [...new Set(["/tmp", "/var/tmp", tmpdir(), real(tmpdir())])],
    real: realPrefix,
  };
}

// The entry name stays as it is: renaming it would orphan older sessions.
export const STATE_ENTRY = "guard-state";
const STATUS_KEY = "pitcrew.guard";

export function statusText(off: boolean, blocks: number, asks: number): string {
  const counts = [blocks ? `${blocks}✗` : "", asks ? `${asks}?` : ""].filter(Boolean).join(" ");
  return [off ? "guard off" : "guard", counts].filter(Boolean).join(" ");
}


export default function guard(pi: ExtensionAPI, facts?: (ctx: ExtensionContext) => DeliveryFacts) {
  const settings = () => (ownSettings(pi.getSettings()) ?? {}) as { caps?: Partial<Caps>; workDir?: string };
  // Trees on which the repo's verify command passed in a bash call of this session: a merge in the
  // same turn needs them, because the verify gate's receipt comes only at the end of the turn.
  const checked = new Set<string>();
  const factsFor = facts ?? ((ctx: ExtensionContext) => deliveryFacts(ctx, () => settings().workDir, checked));
  const allowed = new Set((process.env.PI_GUARD_ALLOW ?? "").split(",").map((s) => s.trim()).filter((s) => s && !NEVER_PREAPPROVE.has(s)));
  const strict = (ctx: ExtensionContext) => !ctx.hasUI || process.env.PI_GUARD_STRICT === "1";
  let off = false;
  let blocks = 0;
  let asks = 0;
  // Strict runs: a model that keeps hitting the guard is trying to work around it; end the run.
  let strictBlocks = 0;
  const show = (ctx: ExtensionContext) => ctx.ui.setStatus(STATUS_KEY, statusText(off, blocks, asks));
  const blocked = (ctx: ExtensionContext) => { blocks++; show(ctx); };

  const restore = (_event: unknown, ctx: ExtensionContext) => {
    off = false;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === STATE_ENTRY) off = Boolean((entry.data as { off?: boolean } | undefined)?.off);
    }
    if (strict(ctx)) off = false;
    show(ctx);
  };
  pi.on("session_start", restore);
  pi.on("session_tree", restore);
  pi.on("input", async () => { strictBlocks = 0; return { action: "continue" }; });

  // Runs before the repo's settings load and before pi's action methods work (getSettings throws).
  pi.on("project_trust", async (event, ctx) => {
    const repo = factsFor(ctx as unknown as ExtensionContext).repo(event.cwd);
    if (!repo || repo.permission === "ADMIN") return { trusted: "undecided" };
    ctx.ui.notify(`pitcrew: ${repo.name} is not your repo (permission ${repo.permission}); its .pi settings, extensions and skills stay off. Start pi with --approve to load them.`, "warning");
    return { trusted: "no" };
  });

  pi.registerCommand("guard", {
    description: "Turn the guard's confirm dialogs off or on for this session (blocks stay): /guard on|off",
    getArgumentCompletions: (prefix) => ["on", "off"].filter((a) => a.startsWith(prefix)).map((a) => ({ value: a, label: a })),
    handler: async (args, ctx) => {
      const arg = args.trim();
      if (strict(ctx)) { ctx.ui.notify("guard: strict run (no user); /guard off is ignored", "warning"); return; }
      if (arg !== "on" && arg !== "off") { ctx.ui.notify(`${off ? "guard off: asks skipped, blocks stay" : "guard on"}${blocks || asks ? ` (${blocks} blocked, ${asks} asked)` : ""}; change it with /guard on|off`, "info"); return; }
      off = arg === "off";
      pi.appendEntry(STATE_ENTRY, { off });
      show(ctx);
      ctx.ui.notify(off ? "guard off: asks skipped, blocks stay" : "guard on", off ? "warning" : "info");
    },
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "bash" || event.isError) return undefined;
    const command = String((event.input as { command?: unknown }).command ?? "").trim();
    const cd = /^cd\s+(\S+)\s*&&/.exec(command)?.[1];
    const found = discoverVerify(cd ? resolve(ctx.cwd, cd.replace(/^~(?=\/|$)/, homedir())) : ctx.cwd);
    if (!found || !ranVerify(command, found.command)) return undefined;
    const tree = await treeId(found.root);
    if (tree) checked.add(tree);
    return undefined;
  });

  pi.on("tool_call", async (event, ctx) => {
    const input = event.input as Record<string, unknown>;
    const here = place(ctx.cwd);
    let verdict: Verdict | undefined;
    if (event.toolName === "bash" && typeof input.command === "string") {
      const caps = { ...DEFAULT_CAPS, ...settings().caps };
      const delivery = checkDelivery(input.command, ctx.cwd, currentMode(), factsFor(ctx), caps);
      const base = checkBash(input.command, here, 0, skipsAsk(delivery));
      const own = delivery.verdicts;
      verdict = base?.level === "block" ? base : own.find((v) => v.level === "block") ?? (base && NEVER_PREAPPROVE.has(base.rule) ? base : own[0] ?? base);
      if (process.env.PITCREW_RUNNER_ROLE === "worker" && verdict?.level !== "block") verdict = checkWorker(input.command, process.env.PITCREW_RUNNER_BASE || "main") ?? verdict;
    }
    else if (["read", "write", "edit", "grep", "find", "ls"].includes(event.toolName) && typeof input.path === "string") {
      verdict = checkFileTool(event.toolName as "read", input.path, here);
    }
    if (!verdict) return undefined;

    const detail = event.toolName === "bash" ? String(input.command) : String(input.path);
    // A terminated turn has no final reply: leave a visible line so the user (and the next turn)
    // knows what stopped and that nothing after it ran. No new turn is started.
    const ended = (what: string) => pi.sendMessage({ customType: "guard-blocked", display: true,
      content: `Guard ${what} (${verdict!.rule}): ${verdict!.reason}.\n\`${detail.slice(0, 300)}\`\nThe turn ended here; nothing after this call ran.` }, { triggerTurn: false });

    if (verdict.level === "block") {
      blocked(ctx);
      ctx.ui.notify(`guard blocked: ${verdict.reason}`, "warning");
      ended("blocked");
      return { block: true, reason: `Blocked by guard (${verdict.rule}): ${verdict.reason}. Do not retry or work around this; tell the user what you wanted to do.`, terminate: true };
    }
    if (allowed.has(verdict.rule)) return undefined;
    if (strict(ctx)) {
      strictBlocks++;
      blocked(ctx);
      if (strictBlocks >= 3) ended("blocked a third ask in this strict run");
      return { block: true, reason: `Blocked by guard (${verdict.rule}): ${verdict.reason}. This run has no user to confirm; skip this step and report it.`, terminate: strictBlocks >= 3 };
    }
    if (off && !NEVER_PREAPPROVE.has(verdict.rule)) return undefined; // off never unlocks guard-bypass
    asks++;
    show(ctx);
    if (await ctx.ui.confirm(`guard: ${verdict.reason}`, `${detail}\n\nAllow this ${event.toolName} call?`)) return undefined;
    blocked(ctx);
    ended("stopped: you declined");
    return { block: true, reason: `The user declined (${verdict.rule}): ${verdict.reason}. Do not retry; ask how to proceed.`, terminate: true };
  });
}
