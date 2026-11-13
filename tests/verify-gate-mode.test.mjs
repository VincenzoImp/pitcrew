import assert from "node:assert/strict";
import test from "node:test";
import { settings } from "../extensions/verify-gate/index.ts";
import { ENV_MODE, resolveMode } from "../lib/mode.ts";

const withMode = (input, fn) => {
  const before = process.env[ENV_MODE];
  process.env[ENV_MODE] = JSON.stringify(resolveMode(input));
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env[ENV_MODE];
    else process.env[ENV_MODE] = before;
  }
};
const pi = (verifyGate) => ({ getSettings: () => ({ pitcrew: { verifyGate } }) });

test("the verify switch sets the gate (on, remind, off); fix rounds follow the rigor; only the timeout is a setting", () => {
  assert.deepEqual(withMode({}, () => settings(pi())), { mode: "run", timeoutSeconds: 300, maxContinuations: 2 });
  assert.equal(withMode({ rigor: "fast" }, () => settings(pi())).maxContinuations, 1);
  assert.equal(withMode({ switches: { verify: "off" } }, () => settings(pi())).mode, "off");
  assert.equal(withMode({ switches: { verify: "remind" } }, () => settings(pi())).mode, "remind");
  assert.deepEqual(withMode({}, () => settings(pi({ mode: "off", timeoutSeconds: 60, maxContinuations: 5 }))), { mode: "run", timeoutSeconds: 60, maxContinuations: 2 });
});
