import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { emptyUsage, type Loadout, type Usage } from "./ledger.ts";
import { GRACE_MS } from "./limits.ts";

// Child processes. A child is `pi --mode rpc` (strict JSONL on stdin/stdout, pi docs/rpc.md) that
// loads pitcrew like any session, so roles, guard and verify gate run in it. Its extension dialogs
// arrive here as extension_ui_request records (ask_parent input, guard confirm).
// Process handling (invocation, SIGTERM then SIGKILL) is ported from pi examples/extensions/subagent.

export interface Invocation { command: string; args: string[] }

/**
 * How to start pi: inside pi, the same pi again (its script, or the bun binary); outside pi
 * (`pitcrew run`), `pi` from PATH. PITCREW_AGENT_PI overrides it (tests use a fake child).
 */
export function piInvocation(insidePi = true): Invocation {
  const override = process.env.PITCREW_AGENT_PI;
  if (override) return { command: process.execPath, args: [override] };
  if (!insidePi) return { command: "pi", args: [] };
  const script = process.argv[1];
  const bunVirtual = script !== undefined && (script.startsWith("/$bunfs/root/") || /^[A-Za-z]:[\\/]~BUN[\\/]root[\\/]/.test(script));
  if (script && !bunVirtual && existsSync(script)) return { command: process.execPath, args: [script] };
  if (!/^(node|bun)(\.exe)?$/.test(basename(process.execPath).toLowerCase())) return { command: process.execPath, args: [] };
  return { command: "pi", args: [] };
}

/**
 * CLI args for a child. Never --no-extensions: the guard and roles must load in every child.
 * --no-approve: a repo's own .pi files (extensions, settings, MCP) never load in a child.
 * --offline: no model-catalog refresh or version check at start; the parent already did them
 * (logins and model requests are not affected).
 * The model is a role; the role map comes from the parent through PITCREW_ROLES. pi builds the
 * system prompt as usual; the agent's prompt is only appended (it passes the Claude bridge).
 */
export function childArgs(loadout: Loadout, dir: string, session?: string): string[] {
  const args = ["--mode", "rpc", "--no-approve", "--offline", "--session-dir", join(dir, "session")];
  if (session) args.push("--session", session);
  args.push("--model", loadout.model);
  args.push("--tools", loadout.tools.join(","), "--append-system-prompt", join(dir, "role.md"));
  // Only the agent's own skills: their descriptions are part of every request.
  if (loadout.skills) args.push("--no-skills", ...loadout.skills.flatMap((s) => ["--skill", s]));
  return args;
}

export type UiRequest = { id: string; method: string; title?: string; message?: string; placeholder?: string; options?: string[]; timeout?: number; [k: string]: unknown };
export type Outcome = { kind: "settled"; aborted: boolean } | { kind: "exit"; code: number | null; signal: string | null; error?: string };
export interface ToolCall { name: string; args: Record<string, unknown> }
/** One transcript line for the /agents panel. */
export interface Line { kind: "user" | "assistant" | "tool" | "result" | "error"; text: string }
const TRANSCRIPT_MAX = 500;
export interface ChildHooks { onUi: (req: UiRequest) => void; onUpdate: () => void }

export class RpcChild {
  proc?: ChildProcess;
  usage: Usage = emptyUsage();
  toolCalls: ToolCall[] = [];
  lastTool?: string;
  /** Last lines of the stream (ring buffer), and the assistant text being streamed now. */
  transcript: Line[] = [];
  streaming = "";
  finalText = "";
  stopReason?: string;
  errorMessage?: string;
  stderrTail = "";
  private pending = new Map<string, (response: Record<string, unknown>) => void>();
  private nextId = 0;
  private outcomeWaiters: ((o: Outcome) => void)[] = [];
  /** A settle nobody waited for yet: a fast child can settle in the same read as the prompt response. */
  private unclaimed?: Outcome;
  private exited?: Outcome;
  private exitWaiters: (() => void)[] = [];

  private inv: Invocation;
  private args: string[];
  private cwd: string;
  private env: NodeJS.ProcessEnv;
  private hooks: ChildHooks;

  constructor(inv: Invocation, args: string[], cwd: string, env: NodeJS.ProcessEnv, hooks: ChildHooks) {
    this.inv = inv;
    this.args = args;
    this.cwd = cwd;
    this.env = env;
    this.hooks = hooks;
  }

  get pid() { return this.proc?.pid; }

  start() {
    const proc = spawn(this.inv.command, [...this.inv.args, ...this.args], { cwd: this.cwd, env: this.env, stdio: ["pipe", "pipe", "pipe"] });
    this.proc = proc;
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    proc.stdout!.on("data", (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      for (let i = buffer.indexOf("\n"); i !== -1; i = buffer.indexOf("\n")) {
        const line = buffer.slice(0, i).replace(/\r$/, "");
        buffer = buffer.slice(i + 1);
        if (line.trim()) this.handle(line);
      }
    });
    proc.stderr!.on("data", (chunk: Buffer) => { this.stderrTail = (this.stderrTail + chunk.toString()).slice(-4000); });
    proc.stdin!.on("error", () => { /* exit handler reports it */ });
    proc.on("error", (error) => this.finish({ kind: "exit", code: null, signal: null, error: error.message }));
    proc.on("close", (code, signal) => this.finish({ kind: "exit", code, signal }));
  }

  private finish(outcome: Outcome) {
    if (this.exited) return;
    this.exited = outcome;
    for (const resolve of this.pending.values()) resolve({ success: false, error: "child exited" });
    this.pending.clear();
    this.flush(outcome);
    for (const w of this.exitWaiters.splice(0)) w();
  }

  private flush(outcome: Outcome) {
    const waiters = this.outcomeWaiters;
    this.outcomeWaiters = [];
    if (!waiters.length && outcome.kind === "settled") this.unclaimed = outcome;
    for (const w of waiters) w(outcome);
  }

  private handle(line: string) {
    let rec: Record<string, any>;
    try { rec = JSON.parse(line); } catch { return; }
    if (rec.type === "response" && typeof rec.id === "string" && this.pending.has(rec.id)) {
      this.pending.get(rec.id)!(rec);
      this.pending.delete(rec.id);
      return;
    }
    switch (rec.type) {
      case "extension_ui_request":
        this.hooks.onUi(rec as UiRequest);
        return;
      case "message_update":
        if (rec.assistantMessageEvent?.type !== "text_delta") return;
        this.streaming += rec.assistantMessageEvent.delta ?? "";
        break;
      case "tool_execution_start":
        this.lastTool = `${rec.toolName} ${previewArgs(rec.args)}`.trim();
        this.note("tool", this.lastTool);
        break;
      case "tool_execution_end": {
        const out = (rec.result?.content ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n");
        this.note(rec.isError ? "error" : "result", out.split("\n").slice(0, 3).join("\n").slice(0, 300));
        break;
      }
      case "message_end": {
        const m = rec.message;
        if (m?.role === "user") {
          const parts = typeof m.content === "string" ? [m.content] : (m.content ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text);
          this.note("user", parts.join("\n"));
          break;
        }
        if (m?.role !== "assistant") return;
        this.streaming = "";
        const u = m.usage ?? {};
        this.usage.turns++;
        this.usage.input += u.input ?? 0;
        this.usage.output += u.output ?? 0;
        this.usage.cacheRead += u.cacheRead ?? 0;
        this.usage.cacheWrite += u.cacheWrite ?? 0;
        this.usage.cost += u.cost?.total ?? 0;
        this.stopReason = m.stopReason;
        this.errorMessage = m.errorMessage;
        const parts = Array.isArray(m.content) ? m.content : [];
        const text = parts.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n");
        if (text.trim()) { this.finalText = text; this.note("assistant", text); }
        if (m.errorMessage) this.note("error", m.errorMessage);
        for (const p of parts) if (p.type === "toolCall") this.toolCalls.push({ name: p.name, args: p.arguments ?? {} });
        break;
      }
      case "agent_settled":
        this.flush({ kind: "settled", aborted: rec.aborted === true });
        break;
      default:
        return;
    }
    this.hooks.onUpdate();
  }

  private note(kind: Line["kind"], text: string) {
    this.transcript.push({ kind, text });
    if (this.transcript.length > TRANSCRIPT_MAX) this.transcript.splice(0, this.transcript.length - TRANSCRIPT_MAX);
  }

  /** Send a command; resolves with its response (success:false if the child is gone). */
  send(command: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.exited || !this.proc?.stdin?.writable) return Promise.resolve({ success: false, error: "child not running" });
    const id = `c${++this.nextId}`;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.proc!.stdin!.write(JSON.stringify({ ...command, id }) + "\n");
    });
  }

  respondUi(id: string, fields: Record<string, unknown>) {
    if (!this.exited && this.proc?.stdin?.writable) this.proc.stdin.write(JSON.stringify({ type: "extension_ui_response", id, ...fields }) + "\n");
  }

  /** Next settle or exit. */
  nextOutcome(): Promise<Outcome> {
    const early = this.unclaimed;
    this.unclaimed = undefined;
    if (early) return Promise.resolve(early);
    if (this.exited) return Promise.resolve(this.exited);
    return new Promise((resolve) => this.outcomeWaiters.push(resolve));
  }

  get running() { return !!this.proc && !this.exited; }

  /** Orderly stop: close stdin, then SIGTERM, then SIGKILL. */
  async close(graceMs = 3000) {
    if (!this.proc || this.exited) return;
    const exited = new Promise<void>((resolve) => this.exitWaiters.push(resolve));
    this.proc.stdin?.end();
    const term = setTimeout(() => this.proc?.kill("SIGTERM"), graceMs);
    const kill = setTimeout(() => this.proc?.kill("SIGKILL"), graceMs + 5000);
    await exited;
    clearTimeout(term);
    clearTimeout(kill);
  }

  /** Abort the run, then stop the process. */
  async stop() {
    if (!this.running) return;
    await Promise.race([this.send({ type: "abort" }), new Promise((r) => setTimeout(r, 2000))]);
    await this.close(1000);
  }
}

export function previewArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  const v = a.command ?? a.path ?? a.pattern ?? a.query ?? a.url ?? a.question ?? a.action;
  const s = typeof v === "string" ? v : JSON.stringify(a);
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

export interface ChildRun {
  inv: Invocation; args: string[]; cwd: string; env: NodeJS.ProcessEnv; prompt: string;
  onUi: (req: UiRequest, child: RpcChild) => void;
  onUpdate?: () => void;
  onStart?: (child: RpcChild) => void;
  /** Wall clock: a wrap-up request at the limit, a stop GRACE_MS later. 0: none. */
  timeoutMs?: number;
  /** Model turns: a wrap-up request at 80 %, a stop at the limit. 0: none. */
  maxTurns?: number;
  log?: (line: string) => void;
}

export const WRAP_UP = (why: string) => `${why}. Stop the work now: commit what works if you changed files, then write your report with what you have (Status: partial if it is not finished).`;

/** One prompt to one fresh or resumed child, from start to exit: the one child runner of the agent tool and `pitcrew run`. */
export async function runChild(o: ChildRun): Promise<{ child: RpcChild; outcome: Outcome; limit?: string }> {
  let limit: string | undefined;
  let warned = false;
  const wrapUp = (why: string) => {
    if (warned || !child.running) return;
    warned = true;
    o.log?.(`wrap-up: ${why}`);
    void child.send({ type: "steer", message: WRAP_UP(why) });
  };
  const stopAt = (why: string) => { limit ??= why; void child.stop(); };
  const child: RpcChild = new RpcChild(o.inv, o.args, o.cwd, o.env, {
    onUi: (req) => o.onUi(req, child),
    onUpdate: () => {
      const turns = child.usage.turns;
      if (o.maxTurns && turns >= o.maxTurns * 0.8) wrapUp(`Turn ${turns} of ${o.maxTurns}`);
      if (o.maxTurns && turns >= o.maxTurns) stopAt(`turn limit ${o.maxTurns}`);
      o.onUpdate?.();
    },
  });
  child.start();
  o.onStart?.(child);
  const minutes = Math.round((o.timeoutMs ?? 0) / 60_000);
  const timers = o.timeoutMs ? [
    setTimeout(() => wrapUp(`Time limit: ${minutes} min reached`), o.timeoutMs),
    setTimeout(() => stopAt(`time limit ${minutes} min`), o.timeoutMs + GRACE_MS),
  ] : [];
  const accepted = await child.send({ type: "prompt", message: o.prompt });
  const outcome: Outcome = accepted.success
    ? await child.nextOutcome()
    : { kind: "exit", code: null, signal: null, error: `prompt failed: ${accepted.error ?? "rejected"}. stderr: ${child.stderrTail.slice(-800)}` };
  for (const t of timers) clearTimeout(t);
  await child.close();
  return { child, outcome, limit };
}
