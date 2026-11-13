import type { ChildState, Loadout } from "../../lib/ledger.ts";
import type { RpcChild, UiRequest } from "../../lib/rpc-child.ts";

// Live children are kept in a process-wide registry, not in the extension instance. /reload
// replaces the extension runtime (session_shutdown, new modules, session_start) but keeps the
// process, so the child processes and the code that drives them keep running. The new instance
// finds the runs here and takes them over: every call back from a run goes through `host`, which
// the current instance sets on session_start. Idea from pi-herdr-agents (state.ts); pi's loader
// keeps globalThis across reloads.

export interface Run {
  id: string;
  dir: string;
  loadout: Loadout;
  state: ChildState;
  child?: RpcChild;
  /** An open ask_parent question; `toModel` once the parent model was asked to answer it. */
  question?: { reqId: string; text: string; toModel?: boolean };
  /** Blocking tool calls waiting for this run: they return its result, so no message is sent. */
  waiters: number;
  stopRequested?: boolean;
  release?: () => void;
  abortStart?: () => void;
  finalText?: string;
  /** Ends the "blocked" report of its open question. */
  unblock?: () => void;
  /** Its worktree was removed after the parent took its work. */
  treeGone?: boolean;
}

export interface Host {
  /** Something about a run changed (status, usage, last action). */
  changed(run: Run): void;
  /** A run ended; its state is on disk. */
  finished(run: Run): void;
  /** A dialog request from the child (ask_parent, guard confirm). */
  dialog(run: Run, req: UiRequest): void;
}

interface Registry {
  /** Runs this process drives, by run folder (ids repeat across sessions). */
  runs: Map<string, Run>;
  /** Run folders whose result went to the model in this process. */
  sent: Set<string>;
  host?: Host;
  /** The process is quitting: runs that end now are interrupted, not finished. */
  quitting?: boolean;
}

const KEY = Symbol.for("pitcrew.agent");
const g = globalThis as unknown as Record<symbol, Registry | undefined>;
export const registry: Registry = (g[KEY] ??= { runs: new Map(), sent: new Set() });
