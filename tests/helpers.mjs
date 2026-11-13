// Minimal fake of the pi extension API for unit tests: records handlers, commands, status and notices.
export function fakePi(settings = {}) {
  const handlers = {};
  const commands = {};
  const appended = [];
  const sent = [];
  const pi = {
    sendMessage: (message, options) => sent.push({ message, options }),
    on: (name, fn) => { (handlers[name] ??= []).push(fn); },
    registerCommand: (name, options) => { commands[name] = options; },
    appendEntry: (customType, data) => appended.push({ type: "custom", customType, data }),
    getSettings: () => settings,
    tools: ["read", "bash", "edit", "write"],
    getActiveTools: () => [...pi.tools],
    setActiveTools: (names) => { pi.tools = [...names]; },
  };
  const emit = async (name, event, ctx) => { let r; for (const fn of handlers[name] ?? []) r = await fn(event, ctx); return r; };
  return { pi, handlers, commands, appended, sent, emit };
}

export function fakeCtx({ cwd = process.cwd(), hasUI = true, trusted = true, branch = [], confirm = true } = {}) {
  const status = {};
  const notices = [];
  const dialogs = [];
  return {
    cwd, hasUI, signal: undefined,
    isProjectTrusted: () => trusted,
    sessionManager: { getBranch: () => branch },
    ui: {
      setStatus: (key, text) => { status[key] = text; },
      notify: (text, level) => notices.push({ text, level }),
      confirm: async (title, body) => { dialogs.push({ title, body }); return confirm; },
    },
    status, notices, dialogs,
  };
}
