import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { ownSettings } from "../../lib/settings.ts";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum } from "@earendil-works/pi-ai";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { repoRoot, sessionRunDir } from "../../lib/paths.ts";
import { DEFAULT_CAPS } from "../guard/delivery.ts";
import { currentRoles, ROLES } from "../../lib/profile.ts";
import { registerAskUser } from "./ask-user.ts";
import { ASK_PREFIX, registerChild } from "./child.ts";
import { addUsage, createRunDir, emptyUsage, findSessionFile, LIVE, type Loadout, listEntries, reconcile, writeJson } from "../../lib/ledger.ts";
import { type AgentSettings, childLimit, type Limit, MAX_DEPTH, parseLimits, readSettings, TreeBudget } from "../../lib/limits.ts";
import { registry, type Run } from "./registry.ts";
import { type AgentDetails, type ChildView, childLine, formatUsage, renderAgentCall, renderAgentResult, renderResultMessage } from "./render.ts";
import { extractJson, reportHead, reportStatus } from "../../lib/report.ts";
import { type AgentDef, childTools, loadAgents, skillPaths, spawnRefusal } from "../../lib/agents.ts";
import { AgentPanel, type PanelSource } from "./panel.ts";
import { type Line, type UiRequest } from "../../lib/rpc-child.ts";
import { dropTaken, type WorkerTree, workerTree } from "../../lib/worktree.ts";
import { ownOrTrusted } from "../../lib/facts.ts";
import { discoverVerify } from "../../lib/verify.ts";
import { log, now, reportPath, runEpisode, saveState } from "./episode.ts";

// Subagents: one `agent` tool. Each child is a `pi --mode rpc` process that loads every pitcrew
// extension (guard, roles, verify gate), runs on a role of the session's profile, and keeps its
// own session file in the run ledger. Children run in the background by default; a finished
// child's report comes back as one message. Live children survive /reload (registry.ts).
// Docs: docs/agent.md. Settings: pitcrew.agent in settings.json (lib/limits.ts).

const PKG = fileURLToPath(new URL("../../", import.meta.url));
const depth = Number(process.env.PITCREW_DEPTH ?? 0);
const callerSpawns = (process.env.PITCREW_SPAWNS ?? "").split(",").filter(Boolean);
const RESUME_PROMPT = "Continue the task from where you stopped. End with your report.";

/** An agent that edits files: two of them must not share a checkout. */
const writes = (def: AgentDef | undefined) => Boolean(def?.tools.some((t) => t === "edit" || t === "write"));

// ---------------------------------------------------------------- extension

export default function agent(pi: ExtensionAPI) {
  /** Limit changes for this session (/agents limits); a child starts with its parent's. */
  let sessionLimits: Partial<AgentSettings> = {};
  try { sessionLimits = JSON.parse(process.env.PITCREW_AGENT_LIMITS ?? "{}"); } catch { /* none */ }
  const loadSettings = () => readSettings(pi.getSettings(), sessionLimits);
  let settings: AgentSettings = readSettings(undefined, sessionLimits);
  let sessionId = "";
  let sessionDir = "";
  let budget: TreeBudget | undefined;
  let uiCtx: ExtensionContext | undefined;
  /** Run ids whose result is in this session's file (a result message or a tool result). */
  let acked = new Set<string>();

  // Blocking waits wake on any change.
  let pulse!: () => void;
  let changed = new Promise<void>((r) => { pulse = r; });
  const listeners = new Set<() => void>();
  const bump = () => {
    const p = pulse;
    changed = new Promise<void>((r) => { pulse = r; });
    p();
    for (const fn of listeners) fn();
    showCount();
  };

  // Footer: the number of running children of this session, and how many wait for an answer.
  let shownCount = "";
  function showCount() {
    if (depth > 0 || !uiCtx?.hasUI) return;
    const live = mine().filter((r) => LIVE.has(r.state.status));
    const asking = live.filter((r) => r.question).length;
    const text = live.length ? `agents ${live.length}▶${asking ? ` ${asking}?` : ""}` : "";
    if (text === shownCount) return;
    shownCount = text;
    try { uiCtx.ui.setStatus("pitcrew.agents", text || undefined); } catch { /* stale ctx */ }
  }

  const agents = () => loadAgents([join(PKG, "agents"), join(getAgentDir(), "agents")]);
  const text = (t: string, details?: AgentDetails, isError = false) =>
    ({ content: [{ type: "text" as const, text: t }], details: details ?? { action: "", views: [] }, isError });
  const mine = () => [...registry.runs.values()].filter((r) => r.loadout.session === sessionId);

  function view(run: Run): ChildView {
    const end = run.state.endedAt ? Date.parse(run.state.endedAt) : Date.now();
    return {
      id: run.id, agent: run.loadout.agent, status: run.state.status, elapsedMs: end - Date.parse(run.state.startedAt),
      lastTool: run.child?.lastTool, usage: run.child?.running ? addUsage(run.state.usage ?? emptyUsage(), run.child.usage) : run.state.usage,
      toolCalls: run.child?.toolCalls.slice(-40), finalText: run.finalText, question: run.question?.text,
    };
  }

  /** A run of this session by id: live in the registry, or loaded from the ledger. */
  function findRun(id: string): Run | undefined {
    const live = mine().find((r) => r.id === id);
    if (live) return live;
    const entry = listEntries(sessionDir).find((e) => e.id === id);
    if (!entry) return undefined;
    const run: Run = { id, dir: entry.dir, loadout: entry.loadout, state: entry.state, waiters: 0 };
    try { run.finalText = readFileSync(reportPath(run), "utf8"); } catch { /* no report */ }
    registry.runs.set(run.dir, run);
    return run;
  }

  // ---------------------------------------------------------------- delivery
  // Exactly once: a result counts as delivered when this session's file holds it (a result message
  // or a tool result with `details.delivered`), or when this process sent it (registry.sent; a
  // queued message is not in the file yet). An interrupted run is reported to the owner, not the model.

  const delivered = (run: Run) => registry.sent.has(run.dir) || acked.has(run.id);
  const deliverable = (run: Run) => !LIVE.has(run.state.status) && run.state.status !== "interrupted" && !delivered(run);
  const markDelivered = (run: Run) => { registry.sent.add(run.dir); acked.add(run.id); };

  function resultText(run: Run): string {
    const status = reportStatus(run.finalText ?? "");
    const usage = formatUsage(run.state.usage);
    const head = `agent ${run.id} (${run.loadout.agent}) ${run.state.status}${status ? `, report: ${status}` : ""}` +
      `${run.state.error ? ` — ${run.state.error}` : ""}${usage ? ` · ${usage}` : ""}`;
    const t = run.loadout.tree;
    const tree = t && !run.treeGone ? `\nIts work is on branch ${t.branch} (worktree ${t.path}): merge or cherry-pick it into ${t.into}; the worktree goes once ${t.into} holds its commits.` : "";
    if (!run.finalText?.trim()) return `${head}${tree}\nNo final message. The child's session: ${findSessionFile(run.dir) ?? run.dir}`;
    return `${head}${tree}\nReport: ${reportPath(run)}\n\n${reportHead(run.finalText, reportPath(run))}`;
  }

  /**
   * Send a finished run's result to the model as one message. A run that ends while others of this
   * session still run is added without a new turn; the last one to end starts the turn, so a
   * fan-out costs one turn. A stopped run, or a quiet delivery, never starts a turn.
   */
  function deliver(run: Run, quiet = false) {
    if (run.waiters > 0 || !deliverable(run) || run.loadout.session !== sessionId) return;
    markDelivered(run);
    let idle = true;
    try { idle = uiCtx?.isIdle() ?? true; } catch { /* stale ctx */ }
    const othersLive = mine().some((r) => r !== run && LIVE.has(r.state.status) && r.waiters === 0);
    const trigger = !quiet && !run.stopRequested;
    const message = { customType: "agent-result", content: resultText(run), display: true, details: { action: "result", views: [view(run)], delivered: [run.id] } };
    if (!idle) pi.sendMessage(message, { deliverAs: "followUp", triggerTurn: trigger });
    else pi.sendMessage(message, { triggerTurn: trigger && !othersLive });
  }

  /** Ids of the results already in the session file. */
  function readAcks(ctx: ExtensionContext): Set<string> {
    const ids = new Set<string>();
    for (const e of ctx.sessionManager.getEntries() as any[]) {
      const details = e.type === "custom_message" && e.customType === "agent-result" ? e.details
        : e.type === "message" && e.message?.role === "toolResult" && e.message.toolName === "agent" ? e.message.details : undefined;
      for (const id of details?.delivered ?? []) ids.add(id);
    }
    return ids;
  }

  // ---------------------------------------------------------------- child dialogs
  // A child's question (ask_parent) and its guard's confirm go to the human when the top session
  // runs in a terminal: the top opens the panel on the child, a deeper parent passes them up.
  // Without a human, a question goes to the parent model (agent reply) and the guard does not ask.

  /** A human answers dialogs: the top session runs in a terminal. */
  const human = () => (depth === 0 ? uiCtx?.mode === "tui" : process.env.PITCREW_HUMAN === "1");

  async function onDialog(run: Run, req: UiRequest) {
    const child = run.child!;
    const timeout = settings.askTimeoutSeconds * 1000;
    if (req.method === "input" && req.title?.startsWith(ASK_PREFIX)) {
      const question = req.title.slice(ASK_PREFIX.length);
      log(run, `ask_parent: ${question}`);
      if (depth > 0 && human()) {
        const value = await uiCtx!.ui.input(`${ASK_PREFIX}[${run.id}] ${question}`, undefined, { timeout });
        child.respondUi(req.id, value === undefined ? { cancelled: true } : { value });
        return;
      }
      run.question = { reqId: req.id, text: question };
      run.state.status = "asking";
      saveState(run);
      setTimeout(() => {
        if (run.question?.reqId !== req.id) return;
        run.unblock?.();
        run.question = undefined;
        run.state.status = "running";
        bump();
      }, timeout).unref();
      if (depth === 0 && human()) {
        // The panel is not opened by itself: it would take the keys the owner is typing.
        const wait = Math.round(timeout / 120_000);
        uiCtx!.ui.notify(`${run.id} asks: ${question}\n/agents to answer; the parent model answers in ${wait} min otherwise.`, "info");
        reportBlocked(run, `${run.id} asks: ${question}`);
        setTimeout(() => toModel(run, req.id), timeout / 2).unref();
      } else toModel(run, req.id);
      bump();
      return;
    }
    if (req.method === "confirm" && human()) {
      const ok = await uiCtx!.ui.confirm(`[${run.id}] ${req.title ?? ""}`, String(req.message ?? ""), { timeout });
      log(run, `confirm ${ok ? "allowed" : "denied"}: ${req.title} ${String(req.message ?? "").split("\n")[0]}`);
      child.respondUi(req.id, { confirmed: ok });
      return;
    }
    if (["select", "input", "editor", "confirm"].includes(req.method)) {
      log(run, `dialog ${req.method} cancelled: ${req.title}`);
      child.respondUi(req.id, { cancelled: true });
      return;
    }
    if (req.method === "notify") log(run, `notify: ${req.message}`);
  }

  /** Hand an open question to the parent model. */
  function toModel(run: Run, reqId = run.question?.reqId) {
    if (!run.question || run.question.reqId !== reqId || run.question.toModel) return;
    run.question.toModel = true;
    run.unblock?.();
    log(run, "question goes to the parent model");
    if (run.waiters === 0) {
      pi.sendMessage({ customType: "agent-question", display: true, content: questionText(run) }, { triggerTurn: true, deliverAs: "steer" });
    }
    bump();
  }

  /**
   * pi reports "blocked" (OSC 7501, read by terminals and agent dashboards) while a child's question
   * waits for the owner: a hidden overlay that takes no keys, closed when the question is answered,
   * handed to the model, or dropped. `pitcrew.notify: false` turns it off.
   */
  function reportBlocked(run: Run, message: string) {
    if (ownSettings(safeSettings(pi))?.notify === false) return;
    void uiCtx!.ui.custom<void>((_tui, _theme, _kb, done) => {
      run.unblock = () => { run.unblock = undefined; done(); };
      return { render: () => [], invalidate() {} };
    }, { overlay: true, overlayOptions: { nonCapturing: true }, onHandle: (h) => h.setHidden(true), blocked: { kind: "question", message } });
  }

  function answer(run: Run, value: string, by: string) {
    run.unblock?.();
    run.child?.respondUi(run.question!.reqId, { value });
    log(run, `${by} answered: ${value.slice(0, 200)}`);
    run.question = undefined;
    run.state.status = "running";
    saveState(run);
    bump();
  }

  const questionText = (run: Run) =>
    `${run.id} (${run.loadout.agent}) asks: ${run.question?.text}\nAnswer with agent({action:"reply", id:"${run.id}", text:"..."}). If only the user can decide, ask them first.`;

  // ---------------------------------------------------------------- waiting
  async function collect(ids: string[], timeoutMs: number | undefined, signal: AbortSignal | undefined, onUpdate: any, action: string) {
    const targets = ids.map((id) => findRun(id)).filter((r): r is Run => !!r);
    for (const r of targets) r.waiters++;
    const deadline = timeoutMs ? Date.now() + timeoutMs : undefined;
    const shown = new Set<string>();
    try {
      while (true) {
        const asking = targets.filter((r) => r.question?.toModel && !shown.has(r.question.reqId));
        const live = targets.filter((r) => LIVE.has(r.state.status));
        const done = asking.length > 0 || live.length === 0;
        if (done || signal?.aborted || (deadline && Date.now() >= deadline)) {
          const parts: string[] = [];
          const sent: string[] = [];
          for (const r of targets) {
            if (deliverable(r)) {
              markDelivered(r);
              sent.push(r.id);
              parts.push(resultText(r));
            } else if (r.question?.toModel && !shown.has(r.question.reqId)) {
              shown.add(r.question.reqId);
              parts.push(questionText(r));
            } else if (LIVE.has(r.state.status)) parts.push(`${r.id} ${r.state.status}`);
            else parts.push(`${r.id} ${r.state.status}${delivered(r) ? `: result already delivered (agent status ${r.id} shows it again)` : r.state.error ? ` — ${r.state.error}` : ""}`);
          }
          if (signal?.aborted) parts.push("(wait detached: the children keep running; each result comes as a message when it ends)");
          else if (!done) parts.push("(wait timed out: the children keep running; each result comes as a message when it ends)");
          return text(parts.join("\n\n---\n\n"), { action, views: targets.map(view), delivered: sent }, targets.some((r) => r.state.status === "failed"));
        }
        onUpdate?.(text(`waiting for ${live.map((r) => r.id).join(", ")}`, { action, views: targets.map(view) }));
        await Promise.race([changed, new Promise((r) => setTimeout(r, 1000))]);
      }
    } finally {
      for (const r of targets) r.waiters--;
      // Runs that ended after the wait returned are delivered as messages.
      for (const r of targets) deliver(r);
    }
  }

  // ---------------------------------------------------------------- actions
  function episode(run: Run, prompt: string, session?: string) {
    const spawns = agents().agents.get(run.loadout.agent)?.spawns ?? [];
    void runEpisode(run, prompt, session, {
      budget: budget!, maxRunning: settings.maxRunning, spawns, human: human(), limits: sessionLimits,
    });
  }

  /** Start a child; returns the run, or the reason it cannot start. */
  function launch(params: Record<string, any>, ctx: ExtensionContext, extra = ""): Run | string {
    const { agents: all, errors } = agents();
    const def: AgentDef | undefined = all.get(String(params.agent ?? ""));
    if (!def) return `Unknown agent "${params.agent ?? ""}": name one in agent (${[...all.keys()].join(", ")}); role is the model slot.${errors.length ? `\nAgent file errors: ${errors.join("; ")}` : ""}`;
    if (!params.task?.trim()) return `${params.action} needs a task.`;
    const refusal = spawnRefusal(depth, callerSpawns, def.name, MAX_DEPTH);
    if (refusal) return refusal;
    const role = String(params.role ?? def.role).replace(/^role\//, "");
    if (!(ROLES as readonly string[]).includes(role)) return `Unknown role "${role}". Roles: ${ROLES.join(", ")}`;
    const { id, dir } = createRunDir(sessionDir, def.name);
    // Two workers in one checkout would edit the same files: the second one gets its own worktree.
    let cwd = ctx.cwd;
    let tree: WorkerTree | undefined;
    const root = writes(def) ? repoRoot(cwd) : undefined;
    if (root && [...registry.runs.values()].some((r) => LIVE.has(r.state.status) && writes(all.get(r.loadout.agent)) && repoRoot(r.loadout.cwd) === root)) {
      try {
        ({ tree, cwd } = workerTree(cwd, `${sessionId.slice(-6)}-${id}`, { ...DEFAULT_CAPS, ...ownSettings(safeSettings(pi))?.caps }.worktrees));
      } catch (error) {
        rmSync(dir, { recursive: true, force: true });
        return `${def.name} not started: another worker runs in this repo and its own worktree failed: ${(error as Error).message}`;
      }
    }
    // pi reports a child (--no-approve) as an untrusted project, so its verify gate would only remind.
    // The parent passes the check it would run itself: in your own or a trusted repo only.
    const found = discoverVerify(cwd);
    const verify = found && (found.source === "PI_VERIFY" || (ctx.isProjectTrusted() && ownOrTrusted(found.root))) ? found.command : undefined;
    const loadout: Loadout = {
      id, agent: def.name, model: `role/${role}`, tools: childTools(def, depth + 1, MAX_DEPTH), tree, verify,
      skills: skillPaths(def, [join(PKG, "skills"), join(getAgentDir(), "skills")]), cwd, depth: depth + 1, timeoutMs: childLimit(settings), session: sessionId, createdAt: now(),
    };
    writeFileSync(join(dir, "role.md"), def.prompt);
    writeFileSync(join(dir, "task.md"), params.task);
    writeJson(join(dir, "loadout.json"), loadout);
    const run: Run = { id, dir, loadout, state: { status: "queued", startedAt: loadout.createdAt }, waiters: 0 };
    registry.runs.set(dir, run);
    const prompt = [
      `You are agent ${id} (${def.name}, depth ${depth + 1}), started by a parent agent that sees only your final message.`,
      `Working directory: ${cwd}`,
      tree ? `It is your own git worktree on branch \`${tree.branch}\`, made from the parent's commit on \`${tree.into}\` (without its uncommitted changes); another worker edits the main checkout. Commit your work on this branch before your report.` : "",
      "", "Task:", params.task, extra,
    ].filter(Boolean).join("\n");
    episode(run, prompt);
    return run;
  }

  function start(params: Record<string, any>, ctx: ExtensionContext) {
    const run = launch(params, ctx);
    if (typeof run === "string") return text(run, undefined, true);
    const where = run.loadout.tree ? ` in its own worktree ${run.loadout.tree.path} (branch ${run.loadout.tree.branch})` : "";
    return text(`Started ${run.id} (${run.loadout.agent})${where} in the background. Its report comes as a message when it ends; do not poll.`, { action: "start", views: [view(run)] });
  }

  /**
   * One-shot: start, wait, and return the JSON the child ends with, checked against `schema`.
   * One repair turn when it does not parse or match.
   */
  async function runOnce(params: Record<string, any>, signal: AbortSignal | undefined, onUpdate: any, ctx: ExtensionContext) {
    const schema = params.schema;
    if (schema !== undefined && (typeof schema !== "object" || schema === null || Array.isArray(schema))) return text("run: schema must be a JSON Schema object.", undefined, true);
    const ask = schema
      ? `End your final message with one \`\`\`json block whose value matches this JSON Schema:\n${JSON.stringify(schema)}`
      : "End your final message with one ```json block that holds your answer.";
    const run = launch(params, ctx, `\n${ask}`);
    if (typeof run === "string") return text(run, undefined, true);
    const fail = (error: string) => ({ ...text(`${resultText(run)}\n\nrun failed: ${error}`, { action: "run", views: [view(run)], delivered: [run.id] }, true), structuredContent: { id: run.id, status: run.state.status, error, report: reportPath(run) } });
    for (let attempt = 0; ; attempt++) {
      await collect([run.id], undefined, signal, onUpdate, "run");
      if (signal?.aborted) return fail("detached (Esc); the child keeps running and reports as a message");
      if (run.state.status !== "done") return fail(`child ${run.state.status}${run.state.error ? `: ${run.state.error}` : ""}`);
      const parsed = extractJson(run.finalText ?? "", schema);
      if ("data" in parsed) {
        const data = parsed.data;
        return { ...text(JSON.stringify(data, null, 1), { action: "run", views: [view(run)], delivered: [run.id] }), structuredContent: { id: run.id, status: "done", data, report: reportPath(run) } };
      }
      if (attempt > 0) return fail(parsed.error);
      const fix = `Your JSON is not usable: ${parsed.error}. Reply with the Status line and one corrected \`\`\`json block only.`;
      if (!findSessionFile(run.dir)) return fail(parsed.error);
      registry.sent.delete(run.dir);
      acked.delete(run.id);
      episode(run, fix, findSessionFile(run.dir));
    }
  }

  function resume(run: Run, prompt: string) {
    if (LIVE.has(run.state.status)) return text(`${run.id} is still ${run.state.status}.`);
    const sessionFile = findSessionFile(run.dir);
    if (!sessionFile) return text(`${run.id}: no session file to resume in ${run.dir}/session.`, undefined, true);
    registry.sent.delete(run.dir);
    acked.delete(run.id);
    log(run, `resume: ${prompt.slice(0, 200)}`);
    episode(run, prompt, sessionFile);
    return text(`Resumed ${run.id} in the background.`, { action: "resume", views: [view(run)] });
  }

  /** Children of this session stopped by a provider's quota refusal: resume them all. */
  function resumeQuota(): string {
    for (const e of listEntries(sessionDir)) findRun(e.id);
    const stopped = mine().filter((r) => r.state.status === "failed" && r.state.quota);
    for (const r of stopped) resume(r, RESUME_PROMPT);
    return stopped.length ? `resumed ${stopped.map((r) => r.id).join(", ")}` : "no child of this session stopped on a quota refusal";
  }

  /** Remove the worktree of a finished worker once the parent's branch holds its commits. */
  function tidyTrees(ctx: ExtensionContext) {
    for (const r of mine()) {
      const t = r.loadout.tree;
      if (!t || LIVE.has(r.state.status) || r.treeGone) continue;
      if (!dropTaken(t)) continue;
      r.treeGone = true;
      log(r, `worktree ${t.path} removed: ${t.into} holds its commits`);
      if (ctx.hasUI) ctx.ui.notify(`agent ${r.id}: worktree ${t.path} and branch ${t.branch} removed (${t.into} holds its commits)`, "info");
    }
  }

  function stopRun(run: Run) {
    if (!LIVE.has(run.state.status)) return false;
    run.stopRequested = true;
    if (run.child?.running) void run.child.stop();
    else run.abortStart?.();
    return true;
  }

  function status(id?: string) {
    if (!id) return text(statusText(), { action: "status", views: [] });
    const run = findRun(id);
    if (!run) return text(`No agent ${id} in this session.`, undefined, true);
    if (LIVE.has(run.state.status)) return text(`${childLine(view(run))}\nledger: ${run.dir}`, { action: "status", views: [view(run)] });
    markDelivered(run);
    return text(resultText(run), { action: "status", views: [view(run)], delivered: [run.id] });
  }

  function statusText(): string {
    for (const e of listEntries(sessionDir)) findRun(e.id);
    const runs = mine();
    if (!runs.length) return "No agents in this session.";
    return runs.map((r) => childLine(view(r))).join("\n") + `\nledger: ${sessionDir}`;
  }

  // ---------------------------------------------------------------- tool
  const { agents: loaded } = agents();
  pi.registerTool({
    name: "agent",
    label: "Agent",
    executionMode: "parallel",
    description: toolDescription(loaded, readSettings(safeSettings(pi), sessionLimits)),
    // Code mode scripts get this instead of the text: `data` is the checked JSON of `run`.
    outputSchema: Type.Object({
      id: Type.Optional(Type.String()), status: Type.Optional(Type.String()), data: Type.Optional(Type.Unknown()),
      error: Type.Optional(Type.String()), report: Type.Optional(Type.String()),
    }),
    parameters: Type.Object({
      action: StringEnum(["start", "run", "status", "wait", "reply", "steer", "stop", "resume"] as const),
      agent: Type.Optional(Type.String({ description: `start/run: which agent (${[...loaded.keys()].join(", ")})` })),
      role: Type.Optional(Type.String({ description: `start/run: run it on another role's model (${ROLES.join(", ")}); default: the agent's role` })),
      task: Type.Optional(Type.String({ description: "start/run: self-contained task" })),
      schema: Type.Optional(Type.Object({}, { additionalProperties: true, description: "run: JSON Schema the child's JSON answer must match" })),
      id: Type.Optional(Type.String({ description: "status/reply/steer/stop/resume: child id" })),
      ids: Type.Optional(Type.Array(Type.String(), { description: "wait: ids (default: all of this session that are running or not yet delivered)" })),
      timeout: Type.Optional(Type.Number({ description: "wait: seconds (default 1800)" })),
      text: Type.Optional(Type.String({ description: "reply/steer/resume: message" })),
    }),

    async execute(_id, params, signal, onUpdate, ctx) {
      uiCtx = ctx;
      settings = loadSettings();
      const p = params as Record<string, any>;
      switch (p.action) {
        case "start": return start(p, ctx);
        case "run": return runOnce(p, signal, onUpdate, ctx);
        case "status": return status(p.id);
        case "wait": {
          const ids: string[] = p.ids?.length ? p.ids : p.id ? [p.id] : mine().filter((r) => LIVE.has(r.state.status) || deliverable(r)).map((r) => r.id);
          if (!ids.length) return text("Nothing to wait for.");
          const unknown = ids.filter((i) => !findRun(i));
          if (unknown.length) return text(`Unknown ids: ${unknown.join(", ")}`, undefined, true);
          return collect(ids, (p.timeout ?? 1800) * 1000, signal, onUpdate, "wait");
        }
        case "reply": {
          const run = findRun(p.id ?? "");
          if (!run?.question || !run.child) return text(`${p.id} has no open question.`, undefined, true);
          answer(run, String(p.text ?? ""), "parent");
          return text(`Replied to ${run.id}.`);
        }
        case "steer": {
          const run = findRun(p.id ?? "");
          if (!run) return text(`No agent ${p.id}.`, undefined, true);
          if (!p.text) return text("steer needs text.", undefined, true);
          if (run.child?.running) { await run.child.send({ type: "steer", message: p.text }); log(run, `steer: ${p.text}`); return text(`Steered ${run.id}.`); }
          return resume(run, p.text);
        }
        case "stop": {
          const run = findRun(p.id ?? "");
          return text(run && stopRun(run) ? `Stopping ${run.id}.` : `${p.id} is not running.`);
        }
        case "resume": {
          const run = findRun(p.id ?? "");
          if (!run) return text(`No agent ${p.id} in this session's ledger.`, undefined, true);
          return resume(run, p.text ?? RESUME_PROMPT);
        }
        default: return text(`Unknown action ${p.action}.`, undefined, true);
      }
    },
    renderCall: (args, theme) => renderAgentCall(args as Record<string, any>, theme),
    renderResult: (result, { expanded }, theme) => renderAgentResult(result as any, expanded, theme),
  });

  if (depth > 0) registerChild(pi, () => settings.askTimeoutSeconds);
  else registerAskUser(pi);
  pi.registerMessageRenderer("agent-result", renderResultMessage);

  // ---------------------------------------------------------------- /agents panel
  /** The physical model behind a role, without the provider. */
  function modelOf(run: Run): string {
    try {
      const map = currentRoles().map;
      return String(map[run.loadout.model.replace(/^role\//, "")]?.model ?? run.loadout.model).split("/").pop()!;
    } catch {
      return run.loadout.model;
    }
  }

  const panelSource: PanelSource = {
    rows: () => {
      for (const e of listEntries(sessionDir)) findRun(e.id);
      return mine().reverse().map((r) => {
        const v = view(r);
        return { id: r.id, agent: r.loadout.agent, model: modelOf(r), status: r.state.status, tokens: formatUsage(v.usage),
          last: r.state.error ?? v.lastTool ?? "", question: r.question?.text };
      });
    },
    transcript: (id) => {
      const run = findRun(id);
      if (!run) return [];
      if (!run.child) return [{ kind: "assistant", text: run.finalText ?? `(no transcript in memory; the child's session: ${findSessionFile(run.dir) ?? run.dir})` }];
      const lines: Line[] = [...run.child.transcript];
      if (run.child.streaming) lines.push({ kind: "assistant", text: run.child.streaming });
      return lines;
    },
    send: async (id, message) => {
      const run = findRun(id);
      if (!run) return `no agent ${id}`;
      if (run.question && run.child) {
        answer(run, message, "owner");
        return "answer sent";
      }
      if (run.child?.running) {
        await run.child.send({ type: "steer", message });
        log(run, `owner steer: ${message}`);
        return "steer sent; the child sees it after its current step";
      }
      return resume(run, message).content[0].text;
    },
    toModel: (id) => {
      const run = findRun(id);
      if (!run?.question) return `${id} has no open question`;
      toModel(run);
      return "the parent model will answer";
    },
    stop: (id) => {
      const run = findRun(id);
      return run && stopRun(run) ? `stopping ${id}` : `${id} is not running`;
    },
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };

  function openPanel(ctx: ExtensionContext, focus?: string) {
    return ctx.ui.custom<void>((tui, theme, _kb, done) => new AgentPanel(tui, theme, panelSource, done, focus), {
      overlay: true,
      overlayOptions: { width: "90%", maxHeight: "85%", anchor: "center" },
    });
  }

  // One key for the panel (alt+a is free in pi's default keys).
  pi.registerShortcut("alt+a", {
    description: "Open the agents panel",
    handler: async (ctx) => { uiCtx = ctx; if (ctx.mode === "tui") await openPanel(ctx, mine().find((r) => r.question && !r.question.toModel)?.id); },
  });

  pi.registerCommand("agents", {
    description: "Open the agents panel, resume the children a quota refusal stopped, or set the running limit: /agents [resume | limits running <n>]",
    handler: async (args, ctx) => {
      uiCtx = ctx;
      const [sub, ...rest] = args.trim().split(/\s+/);
      if (sub === "resume") return ctx.ui.notify(`agents: ${resumeQuota()}`, "info");
      if (sub === "limits") {
        try {
          if (rest.length) sessionLimits = { ...sessionLimits, ...parseLimits(rest.join(" ")) };
          settings = loadSettings();
          return ctx.ui.notify(`agent limits: running ${settings.maxRunning || "no limit"} at each depth, depth ${MAX_DEPTH}, child time ${settings.maxMinutes ? `${settings.maxMinutes} min` : "no limit"} (pitcrew.agent.maxMinutes; 0: no limit)`, "info");
        } catch (error) {
          return ctx.ui.notify((error as Error).message, "error");
        }
      }
      if (ctx.mode !== "tui") return ctx.ui.notify(statusText(), "info");
      // Open on the first child that asks, if any.
      await openPanel(ctx, mine().find((r) => r.question && !r.question.toModel)?.id);
    },
  });

  // ---------------------------------------------------------------- lifecycle
  pi.on("session_start", async (event, ctx) => {
    settings = loadSettings();
    uiCtx = ctx;
    sessionId = ctx.sessionManager.getSessionId();
    const workDir = ownSettings(pi.getSettings())?.workDir;
    sessionDir = sessionRunDir(ctx.cwd, sessionId, workDir);
    budget = new TreeBudget(process.env.PITCREW_TREE || sessionDir);
    registry.quitting = false;
    registry.host = { changed: () => bump(), finished: (run) => { bump(); deliver(run); }, dialog: (run, req) => void onDialog(run, req) };
    const interrupted = reconcile(sessionDir, (dir) => registry.runs.has(dir));
    if (interrupted.length && ctx.hasUI && depth === 0) {
      ctx.ui.notify(`agent: ${interrupted.join(", ")} interrupted (process gone). Nothing reran. Resume with agent resume <id>.`, "warning");
    }
    // Results not yet in this session: runs that ended during /reload, while another session was
    // current, or just before a crash. After /reload they deliver as usual; otherwise quietly, for
    // the next turn, so opening a session never starts a turn by itself.
    acked = readAcks(ctx);
    const quiet = (event as { reason?: string }).reason !== "reload";
    const pending = listEntries(sessionDir).map((e) => findRun(e.id)!).filter((r) => deliverable(r));
    for (const run of pending) deliver(run, quiet);
    tidyTrees(ctx);
    if (quiet && pending.length && ctx.hasUI && depth === 0) {
      ctx.ui.notify(`agent: ${pending.map((r) => r.id).join(", ")} ended while this session was not active; the reports are in the conversation.`, "info");
    }
  });

  pi.on("agent_settled", async (_event, ctx) => tidyTrees(ctx));

  pi.on("session_shutdown", async (event) => {
    registry.host = undefined;
    // /reload, /new, /resume, /fork keep the process: children keep running and report to the
    // session that started them when it is current again. Only quitting ends them.
    if ((event as { reason?: string }).reason !== "quit") return;
    registry.quitting = true;
    const live = [...registry.runs.values()].filter((r) => LIVE.has(r.state.status));
    for (const r of live) r.abortStart?.();
    await Promise.all(live.map((r) => r.child?.close(500)));
    for (const r of live) {
      r.release?.();
      r.state = { ...r.state, status: "interrupted", error: "parent session ended", endedAt: now() };
      saveState(r);
    }
  });
}

function safeSettings(pi: ExtensionAPI): unknown {
  try { return pi.getSettings(); } catch { return undefined; }
}

/** The tool description: positive guidance, the loaded agents, the limits in force. A child gets a short one for the agents it may start. */
function toolDescription(agents: Map<string, AgentDef>, s: AgentSettings): string {
  if (depth > 0) {
    return [
      `Start a child agent for a part of your task: ${callerSpawns.map((n) => `${n} (${agents.get(n)?.description ?? ""})`).join("; ")}. ` +
        "It does not see your conversation: give it a self-contained task. Its report comes back as a message when it ends; " +
        "or use run {agent, task} to block for it.",
      "Actions: start {agent, task}; run {agent, task, schema?}; status {id?}; wait {ids?}; stop {id}.",
    ].join("\n");
  }
  const running = !s.maxRunning ? "no limit on children running at once" : `up to ${s.maxRunning} children run at once at each depth (more wait for a slot)`;
  return [
    "Delegate work to subagents: separate pi processes with their own context, the same guard, and the session's role models. " +
      "Delegating keeps your context small and lets work run in parallel:",
    "- use scout agents for broad reading and search (a whole area, many files, docs): start several at once, one area or question each;",
    "- use a reviewer for a fresh-context check of a change or a claim before you call it done;",
    "- use a worker for a bounded change you can describe fully (goal, files, the check that shows it works); a second worker in the same repo gets its own worktree and branch;",
    "- do one-step lookups yourself.",
    `Agents: ${[...agents.values()].map((a) => `${a.name} (${a.description})`).join("; ")}.`,
    "Children run in the background: start them (several start calls in one turn run in parallel), go on with your own work, " +
      "and each report arrives as a message when the child ends; you get one turn when the last running child ends. Do not poll. " +
      `Use wait only when you cannot continue without the result. Limits: ${running}; depth ${MAX_DEPTH}.`,
    "A child does not see this conversation: give it a self-contained task (the goal in the user's words, constraints, files to read, what is ruled out, what to report). " +
      "Its final message is its report, saved as report.md; you get it whole up to 30,000 characters, then its head and the file path.",
    "Actions: start {agent, task, role?}; run {agent, task, schema?, role?} (blocks; returns the child's JSON checked against the schema); status {id?}; " +
      "wait {ids?, timeout?} (Esc detaches); steer {id, text}; reply {id, text} (answer a child's question); stop {id}; resume {id, text?}.",
  ].join("\n");
}
