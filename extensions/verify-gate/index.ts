import { execFile } from "node:child_process";
import { ownSettings } from "../../lib/settings.ts";
import { basename } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { currentMode, FIX_ROUNDS } from "../../lib/mode.ts";
import { sessionRunDir } from "../../lib/paths.ts";
import { splitCommands } from "../guard/rules.ts";
import { discoverVerify, gitRoot, type VerifyCommand } from "../../lib/verify.ts";
import { ownOrTrusted } from "../../lib/facts.ts";
import { addShared, findShared, type Receipt, receiptsFile, treeId } from "./receipts.ts";

// Verify gate: when a run changed the git tree, the harness runs the project's verify command
// itself before the reply settles. The receipt {tree, command, exit, ms} is bound to the tree id
// (`git write-tree` of a temp index), so any later change makes it stale. A failure continues the
// run with the output tail, at most `maxContinuations` times per user message. No verify command,
// a repo that is neither yours nor trusted in pi's trust.json (ownOrTrusted), or no git repo → a
// one-shot reminder: a foreign repo's check command never runs on the host by itself.
// Once per tree: receipts are shared with the agent children of this session (receipts.ts). A child's
// receipt for the current tree and command satisfies this process; it runs only without one.
// A pass adds one visible line `verify ✓ <cmd> @tree <id>`, so the reply cannot contradict the gate.
// The session mode decides: the `verify` switch (on: run, remind, off) and the fix rounds of its
// rigor. Setting: pitcrew.verifyGate.timeoutSeconds.
// Footer status key `pitcrew.gate`: "" | "verify ●" changed, not verified | "verify ✓" passed after the
// last change | "verify ↻" reminder sent or fixing.

export { discoverVerify } from "../../lib/verify.ts";
export { type Receipt, treeId } from "./receipts.ts";

const run = promisify(execFile);
export const RECEIPT = "verify-receipt";
const STATUS_KEY = "pitcrew.gate";
const TAIL_LINES = 60;
const BY = process.env.PITCREW_RUN ? basename(process.env.PITCREW_RUN) : "session";

// ---------------------------------------------------------------- reminder fallback heuristics

const CHECK = /(test|spec|pytest|check|verify|lint|tsc|typecheck|mypy|ruff|eslint|clippy|build|\bmake\b)/i;
const NOT_A_CHECK = /^(ls|cat|head|tail|grep|rg|find|echo|git|cd|less|wc|tree|true|printf)$/;
const WRITES = /(\bsed\s+-i|\bperl\s+-pi|\btee\b|\bgit\s+(apply|am|checkout|restore|merge|rebase|cherry-pick)\b|\bpatch\b|(^|[^0-9&>])>{1,2}(?!>|\s*(\/dev\/|\/tmp\/|&)))/;

/** A command whose exit code shows a check passed: some segment runs a check, and its status is not
 *  hidden by a later `| filter` (without pipefail) or `|| fallback`. */
export function isCheckCommand(command: string): boolean {
  const segments = splitCommands(command).filter((s) => !s.substituted);
  const pipefail = /pipefail/.test(command);
  return segments.some((s, i) => {
    const comment = s.words.findIndex((w) => w.startsWith("#"));
    const words = comment >= 0 ? s.words.slice(0, comment) : s.words;
    const argv = words.filter((w, j) => !/^-[a-z]*[ce]$/.test(words[j - 1] ?? "")); // drop inline code of -c/-e
    if (!argv.length || NOT_A_CHECK.test(argv[0]) || /^\w+=/.test(argv[0])) return false;
    if (argv[0] === "make" && argv.some((a) => a === "-n" || a === "--dry-run")) return false;
    if (!CHECK.test(argv.slice(0, 3).join(" "))) return false;
    const next = segments[i + 1];
    return !(next && (next.joinedBy === "||" || (next.joinedBy === "|" && !pipefail)));
  });
}
export const writesFiles = (command: string) => WRITES.test(command);

export const REMINDER =
  "Verify gate: files changed in this run, but no passing check ran after the last change. Before you reply, " +
  "run the narrowest check that exercises the change (a test, type-check, build, or a direct reproduction) and " +
  "show its result. If no check applies, say so and why.";

export const failureMessage = (r: Receipt, tail: string) =>
  `Verify gate: \`${r.command}\` failed (exit ${r.exit}) on the current tree. Last ${TAIL_LINES} lines:\n\n` +
  "```\n" + tail + "\n```\n\nFix the cause, or explain why it cannot pass now. Never weaken a check, test or threshold to get green.";

export const resultLine = (r: Receipt) =>
  `verify ${r.exit === 0 ? "✓" : `✗ exit ${r.exit}`} ${r.command} (${Math.round(r.ms / 1000)}s) @tree ${r.tree.slice(0, 7)}`;

interface Settings { mode: "run" | "remind" | "off"; timeoutSeconds: number; maxContinuations: number }

export function settings(pi: Pick<ExtensionAPI, "getSettings">): Settings {
  const { switches, rigor } = currentMode();
  const raw = ownSettings(pi.getSettings())?.verifyGate ?? {};
  return {
    mode: switches.verify === "on" ? "run" : switches.verify,
    timeoutSeconds: typeof raw.timeoutSeconds === "number" && raw.timeoutSeconds > 0 ? raw.timeoutSeconds : 300,
    maxContinuations: FIX_ROUNDS[rigor],
  };
}

export default function verifyGate(pi: ExtensionAPI, runsHere: (cwd: string) => boolean = ownOrTrusted) {
  let root: string | undefined; // git root, or undefined outside git
  let startTree: string | undefined;
  let dirty = false; // heuristic: a tool call wrote files
  let checked = false; // heuristic: a passing check ran after the last write
  let reminded = false;
  let continuations = 0;
  let status = "";
  let receipts: Receipt[] = [];
  let shared: string | undefined; // receipts file of this session tree

  const show = (ctx: ExtensionContext, text: string) => { status = text; ctx.ui.setStatus(STATUS_KEY, text || undefined); };
  const receiptFor = (tree: string | undefined) => (tree ? receipts.findLast((r) => r.tree === tree) : undefined);

  const restore = async (_event: unknown, ctx: ExtensionContext) => {
    receipts = [];
    const session = ctx.sessionManager.getSessionId?.();
    const workDir = ownSettings(pi.getSettings())?.workDir;
    const treeDir = process.env.PITCREW_TREE || (session ? sessionRunDir(ctx.cwd, session, workDir) : undefined);
    shared = treeDir ? receiptsFile(treeDir) : undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === RECEIPT) receipts.push(entry.data as Receipt);
    }
    root = gitRoot(ctx.cwd);
    const tree = root ? await treeId(root) : undefined;
    show(ctx, receiptFor(tree)?.exit === 0 ? "verify ✓" : "");
  };
  pi.on("session_start", restore);
  pi.on("session_tree", restore);

  pi.on("input", async (_event, ctx) => {
    root = gitRoot(ctx.cwd);
    startTree = root ? await treeId(root) : undefined;
    dirty = checked = reminded = false;
    continuations = 0;
    return { action: "continue" };
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.isError && event.toolName !== "bash") return undefined;
    let wrote = false;
    if (event.toolName === "write" || event.toolName === "edit") wrote = !String((event.input as { path?: unknown }).path ?? "").startsWith("/tmp/");
    else if (event.toolName === "bash") {
      const command = String((event.input as { command?: unknown }).command ?? "");
      if (isCheckCommand(command)) checked = !event.isError;
      else if (!event.isError && writesFiles(command)) wrote = true;
    }
    if (wrote) { dirty = true; checked = false; if (settings(pi).mode !== "off" && status !== "verify ↻") show(ctx, "verify ●"); }
    return undefined;
  });

  pi.on("agent_before_settle", async (event, ctx) => {
    const cfg = settings(pi);
    if (cfg.mode === "off" || event.outcome !== "completed") return undefined;
    const tree = root ? await treeId(root) : undefined;
    // After a fix round the tree may be back at the start: it still needs a run to confirm the fix.
    const changed = continuations > 0 || (tree && startTree ? tree !== startTree : dirty);
    if (!changed) { if (status === "verify ↻") show(ctx, ""); return undefined; }

    const found: VerifyCommand | undefined = cfg.mode === "run" && tree ? discoverVerify(ctx.cwd) : undefined;
    const allowed = found && (found.source === "PI_VERIFY" || (ctx.isProjectTrusted() && runsHere(found.root)));
    if (!found || !allowed || !tree) {
      if (checked || reminded) { show(ctx, checked ? "verify ✓" : "verify ●"); return undefined; }
      reminded = true;
      show(ctx, "verify ↻");
      return { entries: [...event.entries, { type: "custom_message", customType: "verify-gate", content: REMINDER, display: true }], continue: true };
    }

    // A receipt for this exact tree already exists: nothing new to learn by running again.
    const known = receiptFor(tree);
    if (known) { show(ctx, known.exit === 0 ? "verify ✓" : "verify ●"); return undefined; }
    // A child (or the parent's gate) already ran it on this tree: take its receipt, do not run again.
    const other = findShared(shared, tree, found.command, found.root);
    if (other) {
      receipts.push(other);
      show(ctx, other.exit === 0 ? "verify ✓" : "verify ●");
      const content = `${resultLine(other)} (receipt from ${other.by ?? "another process"}; not run again)`;
      return { entries: [...event.entries, { type: "custom" as const, customType: RECEIPT, data: other }, { type: "custom_message" as const, customType: "verify-gate", content, display: true, details: other }] };
    }

    show(ctx, "verify ●");
    ctx.ui.notify(`verify: running ${found.command}`, "info");
    const started = Date.now();
    let exit = 0;
    let output = "";
    try {
      const r = await run("bash", ["-c", `{ ${found.command}\n} 2>&1`], { cwd: found.root, timeout: cfg.timeoutSeconds * 1000, maxBuffer: 16 << 20, signal: ctx.signal, killSignal: "SIGKILL" });
      output = r.stdout;
    } catch (error) {
      const e = error as { code?: unknown; stdout?: string; killed?: boolean; signal?: string };
      exit = typeof e.code === "number" ? e.code : 124;
      output = (e.stdout ?? "") + (e.killed || e.signal ? `\n[verify gate: killed after ${cfg.timeoutSeconds}s or aborted]` : "");
    }
    const receipt: Receipt = { tree, command: found.command, exit, ms: Date.now() - started, root: found.root, by: BY };
    receipts.push(receipt);
    addShared(shared, receipt);
    const entries = [...event.entries, { type: "custom" as const, customType: RECEIPT, data: receipt }];
    const line = resultLine(receipt);

    if (exit === 0) {
      show(ctx, "verify ✓");
      return { entries: [...entries, { type: "custom_message" as const, customType: "verify-gate", content: line, display: true, details: receipt }] };
    }
    const tail = output.trimEnd().split("\n").slice(-TAIL_LINES).join("\n");
    const message = { type: "custom_message" as const, customType: "verify-gate", content: failureMessage(receipt, tail), display: true, details: receipt };
    if (continuations < cfg.maxContinuations) {
      continuations++;
      show(ctx, "verify ↻");
      ctx.ui.notify(`${line}; fix round ${continuations}/${cfg.maxContinuations}`, "warning");
      return { entries: [...entries, message], continue: true };
    }
    show(ctx, "verify ●");
    ctx.ui.notify(`${line}; no fix rounds left`, "error");
    return { entries: [...entries, { ...message, content: `${failureMessage(receipt, tail)}\n\n(No automatic fix rounds left; the user sees this failure.)` }] };
  });
}
