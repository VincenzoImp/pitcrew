import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addUsage, type ChildState, emptyUsage, writeJson } from "../../lib/ledger.ts";
import { failureText, isQuotaError, type Limit, type AgentSettings, TreeBudget } from "../../lib/limits.ts";
import { childArgs, piInvocation, runChild } from "../../lib/rpc-child.ts";
import { registry, type Run } from "./registry.ts";

// One child episode: a prompt to a fresh or resumed child, from its running slot to its end state.
// Module scope on purpose: an episode started before /reload keeps running in this code and reports
// to whichever instance is current (registry.host).

export const now = () => new Date().toISOString();
export const saveState = (run: Run) => writeJson(join(run.dir, "state.json"), run.state);
export const log = (run: Run, line: string) => appendFileSync(join(run.dir, "events.log"), `${now()} ${line}\n`);
export const reportPath = (run: Run) => join(run.dir, "report.md");

interface EpisodeOptions {
  budget: TreeBudget;
  maxRunning: Limit;
  spawns: string[];
  human: boolean;
  /** Session limit changes, passed on to the child's own children. */
  limits: Partial<AgentSettings>;
}

export async function runEpisode(run: Run, prompt: string, session: string | undefined, opts: EpisodeOptions) {
  const lo = run.loadout;
  run.stopRequested = false;
  run.state = { ...run.state, status: "queued", startedAt: now(), endedAt: undefined, error: undefined, quota: undefined };
  saveState(run);
  registry.host?.changed(run);
  const ac = new AbortController();
  run.abortStart = () => ac.abort();
  run.release = await opts.budget.acquire(opts.maxRunning, lo.depth, run.id, ac.signal);
  run.abortStart = undefined;
  if (!run.release || run.stopRequested) return finish(run, "stopped", "stopped before start");
  const env: NodeJS.ProcessEnv = {
    ...process.env, PITCREW_DEPTH: String(lo.depth), PITCREW_RUN: run.dir, PITCREW_TREE: opts.budget.dir,
    PITCREW_SPAWNS: opts.spawns.join(","), PITCREW_AGENT_LIMITS: JSON.stringify(opts.limits), ...(lo.verify ? { PI_VERIFY: lo.verify } : {}),
  };
  delete env.PI_GUARD_ALLOW;
  delete env.PI_GUARD_STRICT;
  delete env.PITCREW_HUMAN;
  // With a human at the top, the child's guard asks and the question travels up to them; without
  // one, the guard blocks what it would ask (strict mode).
  if (opts.human) env.PITCREW_HUMAN = "1";
  else env.PI_GUARD_STRICT = "1";
  const { child, outcome, limit } = await runChild({
    inv: piInvocation(), args: childArgs(lo, run.dir, session), cwd: lo.cwd, env, prompt, timeoutMs: lo.timeoutMs,
    onUi: (req) => registry.host?.dialog(run, req),
    onUpdate: () => registry.host?.changed(run),
    onStart: (c) => {
      run.child = c;
      run.state = { ...run.state, status: "running", pid: c.pid, parentPid: process.pid };
      saveState(run);
      registry.host?.changed(run);
    },
    log: (line) => log(run, line),
  });
  run.finalText = child.finalText;
  run.state.usage = addUsage(run.state.usage ?? emptyUsage(), child.usage);
  if (child.finalText.trim()) writeFileSync(reportPath(run), child.finalText.trimEnd() + "\n", { mode: 0o600 });
  if (limit) return finish(run, "timeout", `${limit} (pitcrew.agent.maxMinutes)`);
  if (run.stopRequested) return finish(run, "stopped", "stopped");
  const failed = (error: string) => {
    run.state.quota = isQuotaError(error) || isQuotaError(child.errorMessage);
    return finish(run, "failed", failureText(run.id, error, run.state.quota));
  };
  if (outcome.kind === "exit") return failed(outcome.error ?? `child exited (code ${outcome.code}, signal ${outcome.signal}): ${child.stderrTail.slice(-800)}`);
  if (outcome.aborted) return finish(run, "stopped", "run aborted");
  if (child.stopReason === "error") return failed(child.errorMessage ?? "model error");
  return finish(run, "done");
}

function finish(run: Run, status: ChildState["status"], error?: string) {
  run.unblock?.();
  run.release?.();
  run.release = undefined;
  run.question = undefined;
  if (registry.quitting) { status = "interrupted"; error = "parent session ended"; }
  run.state = { ...run.state, status, error, endedAt: now() };
  saveState(run);
  log(run, `${status}${error ? ` error=${error}` : ""}`);
  registry.host?.finished(run);
}

