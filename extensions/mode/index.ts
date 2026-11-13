import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { asInput, describeMode, ENV_MODE, type Mode, type ModeInput, modeMessage, resolveMode, shortMode, trackingFor, withChange } from "../../lib/mode.ts";
import { ownSettings, settingsNotice } from "../../lib/settings.ts";
import { repoFacts } from "../../lib/facts.ts";

// Session mode: stop, rigor and the switches. Sources, weakest first: settings.json (`pitcrew.mode`,
// global then repo), the mode of a parent session, the session itself (flags at start, then /mode;
// saved with the session). Tracking: `pitcrew.tracking`, else the parent's, else from the repo
// (trackingFor). The resolved mode is published in PITCREW_MODE so other extensions and child
// sessions read it with currentMode(), and it reaches the model as one short message at the start
// of a session and after each change. Docs: docs/mode.md.

// Session entry and message names stay as they are: renaming them would orphan older sessions.
const ENTRY = "pitcrew-mode";
const MESSAGE = "pitcrew-mode-message";
// Names before the rename to pitcrew: still read in sessions saved before it.
const OLD_ENTRY = "pi-env-mode";
const OLD_MESSAGE = "pi-env-mode-message";
const FLAGS = ["stop", "rigor"] as const;
const PARENT = Symbol.for("pitcrew.mode.parent");
// pi loads the extensions again for a new session; this slot carries the last session's own mode.
const CURRENT = Symbol.for("pitcrew.mode.current");
const NOTICED = Symbol.for("pitcrew.settings.noticed");

type Slots = { [PARENT]?: ModeInput; [CURRENT]?: ModeInput; [NOTICED]?: boolean };
const slots = globalThis as Slots;

export default function mode(pi: ExtensionAPI) {
  let session: ModeInput = {};
  let inherited: ModeInput | undefined;
  let unsaved = false;
  let resolved: Mode | undefined;
  // `stop: plan` takes the file tools away, so "plan only" is not left to the model. Restored on a
  // later stop. A change of the tool list costs one prompt-cache miss.
  let withheld: string[] = [];
  function planTools(stop: string) {
    if (stop === "plan" && !withheld.length) {
      const active = pi.getActiveTools();
      withheld = active.filter((t) => t === "edit" || t === "write");
      if (withheld.length) pi.setActiveTools(active.filter((t) => !withheld.includes(t)));
    } else if (stop !== "plan" && withheld.length) {
      pi.setActiveTools([...new Set([...pi.getActiveTools(), ...withheld])]);
      withheld = [];
    }
  }

  for (const flag of FLAGS) pi.registerFlag(flag, { description: `Session ${flag} (see /mode)`, type: "string" });

  const flags = (): ModeInput =>
    Object.fromEntries(FLAGS.map((flag) => [flag, pi.getFlag(flag)]).filter(([, value]) => typeof value === "string" && value));
  const own = () => ownSettings(pi.getSettings()) as { mode?: ModeInput; tracking?: string } | undefined;

  /** Resolve from all sources, publish, show. Throws when a source holds a bad value. */
  function publish(ctx: ExtensionContext): Mode {
    const next = resolveMode(own()?.mode, inherited, session);
    const setting = own()?.tracking ?? inherited?.tracking;
    next.tracking = trackingFor(setting, setting ? undefined : repoFacts(ctx.cwd)?.permission);
    resolved = next;
    planTools(next.stop);
    slots[CURRENT] = session;
    process.env[ENV_MODE] = JSON.stringify(next);
    if (ctx.hasUI) ctx.ui.setStatus("pitcrew.mode", shortMode(next));
    return next;
  }

  pi.on("session_start", async (event, ctx) => {
    const saved = ctx.sessionManager
      .getBranch()
      .filter((entry) => entry.type === "custom" && (entry.customType === ENTRY || entry.customType === OLD_ENTRY))
      .pop() as { data?: ModeInput } | undefined;
    // Flags set the session's starting values; /mode changes them later.
    const fromFlags = event.reason === "startup" ? flags() : {};
    // A new session (/new, /handoff) keeps this process's mode, as pi keeps the model; resume and
    // fork restore the mode saved in their session.
    session = event.reason === "new" ? { ...slots[CURRENT] } : { ...saved?.data, ...fromFlags };
    unsaved = Object.keys(event.reason === "new" ? session : fromFlags).length > 0;
    if (!slots[NOTICED] && ctx.hasUI) {
      slots[NOTICED] = true;
      const notice = settingsNotice(pi.getSettings());
      if (notice) ctx.ui.notify(notice, "warning");
    }
    try {
      // At startup the environment holds the mode of a parent session, if any: a child starts from
      // the parent's dials, switch changes and tracking. The slot keeps them across /reload.
      if (event.reason === "startup") slots[PARENT] = process.env[ENV_MODE] ? asInput(JSON.parse(process.env[ENV_MODE])) : undefined;
      inherited = slots[PARENT];
      publish(ctx);
    } catch (error) {
      delete process.env[ENV_MODE];
      inherited = undefined;
      resolved = undefined;
      const message = `pitcrew mode: ${(error as Error).message}; using defaults`;
      if (ctx.hasUI) ctx.ui.notify(message, "error");
      else console.error(message);
    }
  });

  pi.on("turn_start", async () => {
    if (!unsaved) return;
    pi.appendEntry(ENTRY, session);
    unsaved = false;
  });

  // The model learns the mode from a message in the conversation: a channel that reaches every
  // model (docs/claude-access.md). Sent again only when the text changed since the last one.
  pi.on("before_agent_start", async (_event, ctx) => {
    const content = modeMessage(resolved ?? { ...resolveMode(), tracking: "local" });
    const last = ctx.sessionManager.getBranch().filter((e) => e.type === "custom_message" && [MESSAGE, OLD_MESSAGE].includes((e as { customType?: string }).customType ?? "")).pop() as { content?: unknown } | undefined;
    if (last?.content === content) return undefined;
    return { message: { customType: MESSAGE, content, display: false } };
  });

  pi.registerCommand("mode", {
    description: "Show the session mode, or change it: /mode <stop|rigor|switch> <value>",
    handler: async (args, ctx) => {
      try {
        if (args?.trim()) {
          const next = withChange(session, args);
          const previous = session;
          session = next;
          try {
            publish(ctx);
          } catch (error) {
            session = previous;
            throw error;
          }
          unsaved = true;
        }
        ctx.ui.notify(describeMode(publish(ctx)), "info");
      } catch (error) {
        ctx.ui.notify((error as Error).message, "error");
      }
    },
  });
}
