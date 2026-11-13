import assert from "node:assert/strict";
import test from "node:test";
import { AgentPanel } from "../extensions/agent/panel.ts";

const theme = { fg: (_c, s) => s, bold: (s) => s };
const tui = { requestRender() {}, terminal: { rows: 40 } };

test("panel: list, open, type to steer, Ctrl+X twice stops, Esc goes back then closes", async () => {
  const calls = [];
  let closed = false;
  const src = {
    rows: () => [
      { id: "scout-2", agent: "scout", model: "m", status: "running", tokens: "1t", last: "read a.ts" },
      { id: "scout-1", agent: "scout", model: "m", status: "done", tokens: "2t", last: "" },
    ],
    transcript: () => [{ kind: "tool", text: "read a.ts" }, { kind: "assistant", text: "Working on it" }],
    send: async (id, text) => { calls.push(["send", id, text]); return "sent"; },
    stop: (id) => { calls.push(["stop", id]); return "stopping"; },
    toModel: (id) => { calls.push(["toModel", id]); return "model"; },
    subscribe: () => () => {},
  };
  const panel = new AgentPanel(tui, theme, src, () => { closed = true; });
  assert.match(panel.render(120).join("\n"), /agents \(2\)[\s\S]*› scout-2[\s\S]*scout-1/);
  panel.handleInput("\x1b[B"); // down
  panel.handleInput("\x1b[A"); // up
  panel.handleInput("\r");
  const view = panel.render(120).join("\n");
  assert.match(view, /scout-2 · scout · m · running/);
  assert.match(view, /→ read a\.ts[\s\S]*Working on it[\s\S]*steer:/);
  // Same height in both views (85 % of 40 rows), so the centred overlay never moves (#77).
  assert.equal(view.split("\n").length, 34);
  assert.equal(new AgentPanel(tui, theme, src, () => {}).render(120).length, 34);
  for (const ch of "go on") panel.handleInput(ch);
  panel.handleInput("\r");
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls[0], ["send", "scout-2", "go on"]);
  panel.handleInput("\x18");
  assert.equal(calls.length, 1, "one Ctrl+X only arms the stop");
  panel.handleInput("\x18");
  assert.deepEqual(calls[1], ["stop", "scout-2"]);
  panel.handleInput("\x1b");
  assert.match(panel.render(120).join("\n"), /agents \(2\)/);
  assert.equal(closed, false);
  panel.handleInput("\x1b");
  assert.equal(closed, true);
});
