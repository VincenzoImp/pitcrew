import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ask_user: ask the human one decision question with options, through pi's own select dialog (and
// an input for a free answer). No UI: the model is told to decide on stated assumptions. Top session
// only; children use ask_parent.

const OTHER = "Other (type an answer)";
const CANCELLED = "The user cancelled. Do not ask again; continue with your recommendation or stop.";

// One dialog at a time: tool calls of one turn run in parallel.
let lock: Promise<unknown> = Promise.resolve();
function withDialogLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => undefined);
  return run;
}

export function registerAskUser(pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_user",
    label: "Ask user",
    description:
      "Ask the user one decision question with 2-5 options; put your recommended option first. A free-text answer is always " +
      "offered. Ask only for decisions you cannot make from the code, the docs or the request; never for permission to continue.",
    parameters: Type.Object({
      question: Type.String({ description: "The question, with the context the user needs to decide" }),
      options: Type.Array(Type.String(), { description: "2-5 options, the recommended one first" }),
    }),
    executionMode: "sequential",

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });
      if (!ctx.hasUI) return text("No user is present. Decide on stated assumptions, or stop and report the open decision.");
      const options = params.options.map((o, i) => (i === 0 ? `${o} (recommended)` : o));
      return withDialogLock(async () => {
        const choice = await ctx.ui.select(params.question, [...options, OTHER], { signal });
        if (choice === undefined) return text(CANCELLED);
        if (choice !== OTHER) return text(`The user selected: ${params.options[options.indexOf(choice)]}`);
        const typed = (await ctx.ui.input(params.question, "your answer", { signal }))?.trim();
        return text(typed ? `The user wrote: ${typed}` : CANCELLED);
      });
    },

    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("ask_user ")) + theme.fg("muted", String(args.question ?? "").slice(0, 100)), 0, 0);
    },
  });
}
