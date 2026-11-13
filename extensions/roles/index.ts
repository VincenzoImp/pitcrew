import { existsSync } from "node:fs";
import { ownSettings } from "../../lib/settings.ts";
import { join } from "node:path";
import { ownOrTrusted } from "../../lib/facts.ts";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  type Active,
  chooseActive,
  describe,
  ENV_PROFILE,
  ENV_ROLES,
  loadProfiles,
  parseRoleArgs,
  profileCompletions,
  type Role,
  roleCompletions,
  ROLES,
  snapshot,
  splitModel,
  THINKING_LEVELS,
  withRole,
} from "../../lib/profile.ts";

// Roles and profiles. Each role is a virtual model `role/<name>`; the session's profile decides
// which physical model and thinking level answer for it. The map is state of this process only:
// two sessions can hold different maps. Children inherit it through PITCREW_ROLES.
// Docs: docs/roles.md.

// The session entry name stays as it is: renaming it would orphan older sessions.
const ENTRY = "pitcrew-roles";
const OLD_ENTRY = "pi-env-roles"; // the name before the rename to pitcrew: still read on resume
const PACKAGE_PROFILES = fileURLToPath(new URL("../../profiles", import.meta.url));

export default function roles(pi: ExtensionAPI) {
  let active: Active | undefined;
  let unsaved = false;
  // Kept from the last session start, for argument completion (which gets no context).
  let registry: ExtensionContext["modelRegistry"] | undefined;
  let lastCwd = process.cwd();

  /** Every model pi can use now, as `provider/model-id`, without the roles themselves. */
  const availableModels = (): string[] =>
    (registry?.getAvailable() ?? [])
      .filter((model) => model.provider !== "role")
      .map((model) => `${model.provider}/${model.id}`)
      .sort();

  pi.registerFlag("profile", { description: "Role profile for this session (see /profile)", type: "string" });

  for (const role of ROLES) {
    pi.registerVirtualModel({
      provider: "role",
      id: role,
      name: `role: ${role}`,
      thinkingLevels: THINKING_LEVELS,
      route(request, ctx) {
        if (!active) throw new Error(`role/${role}: no role profile is active; see the error at session start, or use /profile <name>`);
        // A request outside the agent loop (pi's own compaction summary, a /tree branch summary) is
        // summary work: the scout's model answers it, at the scout's level.
        const direct = request.reason === "direct" && active.map.scout ? active.map.scout : undefined;
        const spec = direct ?? active.map[role];
        if (!spec) throw new Error(`role/${role}: no model in profile "${active.profile}"; use /role ${role} <model>`);
        const model = ctx.modelRegistry.find(...splitModel(spec.model));
        if (!model) throw new Error(`role/${role}: ${spec.model} is not in the model catalog`);
        // The selected level is the role's level unless the owner changed it; pi clamps it to the model.
        return { model, thinkingLevel: direct ? direct.thinking : request.thinkingLevel };
      },
    });
  }

  // A repo's own profiles only in your own or trusted repos: a profile routes every role's requests.
  const profileDirs = (cwd: string) => {
    const repo = join(cwd, CONFIG_DIR_NAME, "profiles");
    return [PACKAGE_PROFILES, join(getAgentDir(), "profiles"), ...(existsSync(repo) && ownOrTrusted(cwd) ? [repo] : [])];
  };

  const selectedRole = (ctx: ExtensionContext): Role | undefined =>
    ctx.model?.provider === "role" ? (ctx.model.id as Role) : undefined;

  /** Make `next` the session's map: export it to children, show it, and align the thinking level. */
  function activate(next: Active, ctx: ExtensionContext, seedThinking: boolean) {
    active = next;
    process.env[ENV_ROLES] = JSON.stringify(snapshot(next));
    const role = selectedRole(ctx);
    const spec = role && next.map[role];
    if (seedThinking && spec) pi.setThinkingLevel(spec.thinking);
    if (ctx.hasUI) ctx.ui.setStatus("pitcrew.profile", `profile:${next.profile}`);
  }

  pi.on("session_start", async (event, ctx) => {
    registry = ctx.modelRegistry;
    lastCwd = ctx.cwd;
    const saved = ctx.sessionManager
      .getBranch()
      .filter((entry) => entry.type === "custom" && (entry.customType === ENTRY || entry.customType === OLD_ENTRY))
      .pop() as { data?: unknown } | undefined;
    // A new session (/new, /handoff) keeps this process's role map, as pi keeps the model. pi loads
    // the extensions again for it; PITCREW_ROLES holds the last session's map.
    const carried = event.reason === "new" ? process.env[ENV_ROLES] : undefined;
    if (carried) {
      try {
        activate({ ...chooseActive({ profiles: {}, envRoles: carried }), source: "previous session" }, ctx, false);
        unsaved = true;
        return;
      } catch { /* not a valid map: choose as usual */ }
    }
    const flag = pi.getFlag("profile");
    const settings = ownSettings(pi.getSettings());
    try {
      const next = chooseActive({
        profiles: loadProfiles(profileDirs(ctx.cwd)),
        // At startup the snapshot in the environment comes from a parent session. After /reload it is
        // this session's own latest map and wins. /new, /resume and /fork ignore it.
        flag: event.reason !== "reload" && typeof flag === "string" && flag ? flag : undefined,
        envRoles: event.reason === "startup" || event.reason === "reload" ? process.env[ENV_ROLES] : undefined,
        envProfile: process.env[ENV_PROFILE],
        session: saved?.data,
        setting: settings?.profile,
        available: availableModels(),
      });
      // A resumed session keeps the level pi restored. An explicit --thinking or model:level wins.
      const explicit = process.argv.some((arg) => arg === "--thinking" || /^role\/\w+:\w+$/.test(arg));
      activate(next, ctx, !saved && !explicit);
      unsaved = !saved;
    } catch (error) {
      active = undefined;
      const message = `pitcrew roles: ${(error as Error).message}`;
      if (ctx.hasUI) ctx.ui.notify(message, "error");
      else console.error(message);
    }
  });

  // Selecting another role with /model or Ctrl+P takes that role's thinking level.
  pi.on("model_select", async (event) => {
    const spec = event.model.provider === "role" ? active?.map[event.model.id as Role] : undefined;
    if (spec) pi.setThinkingLevel(spec.thinking);
  });

  // Save the map with the session so a resume restores it. Only when it changed.
  pi.on("turn_start", async () => {
    if (!active || !unsaved) return;
    pi.appendEntry(ENTRY, snapshot(active));
    unsaved = false;
  });

  pi.registerCommand("profile", {
    description: "Show the role map, or switch profile: /profile [name]",
    getArgumentCompletions: (text) => {
      try {
        return profileCompletions(text, Object.keys(loadProfiles(profileDirs(lastCwd))));
      } catch {
        return null;
      }
    },
    handler: async (args, ctx) => {
      const name = args?.trim();
      const profiles = loadProfiles(profileDirs(ctx.cwd));
      if (!name) {
        const current = active ? describe(active) : "no active profile";
        ctx.ui.notify(`${current}\navailable: ${Object.keys(profiles).join(", ")}`, "info");
        return;
      }
      try {
        const next = { ...chooseActive({ profiles, flag: name }), source: "/profile" };
        activate(next, ctx, true);
        unsaved = true;
        ctx.ui.notify(describe(next), "info");
      } catch (error) {
        ctx.ui.notify((error as Error).message.replace("--profile: ", ""), "error");
      }
    },
  });

  pi.registerCommand("role", {
    description: "Change one role for this session: /role <role> [provider/model][:thinking]",
    getArgumentCompletions: (text) => roleCompletions(text, availableModels(), active?.map),
    handler: async (args, ctx) => {
      if (!active) return ctx.ui.notify("no active profile", "error");
      if (!args?.trim()) return ctx.ui.notify(describe(active), "info");
      try {
        let text = args.trim();
        // A role with no model: pick one of the available models.
        if ((ROLES as readonly string[]).includes(text) && ctx.hasUI) {
          const picked = await ctx.ui.select(`Model for ${text}`, availableModels());
          if (!picked) return;
          text = `${text} ${picked}`;
        }
        const change = parseRoleArgs(text);
        if (change.model && !ctx.modelRegistry.find(...splitModel(change.model))) {
          throw new Error(`${change.model} is not in the model catalog`);
        }
        const next = withRole(active, change);
        activate(next, ctx, change.role === selectedRole(ctx));
        unsaved = true;
        ctx.ui.notify(describe(next), "info");
      } catch (error) {
        ctx.ui.notify((error as Error).message, "error");
      }
    },
  });
}
