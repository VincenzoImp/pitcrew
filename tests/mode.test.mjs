import assert from "node:assert/strict";
import { test } from "node:test";
import { asInput, currentMode, describeMode, ENV_MODE, modeMessage, PRESETS, resolveMode, reviews, shortMode, SWITCHES, trackingFor, withChange } from "../lib/mode.ts";
import { ownSettings, settingsNotice } from "../lib/settings.ts";

test("defaults: stop pr, rigor standard; every preset sets every switch to an allowed value", () => {
  const mode = resolveMode();
  assert.deepEqual([mode.stop, mode.rigor], ["pr", "standard"]);
  assert.deepEqual(mode.switches, PRESETS.standard);
  for (const preset of Object.values(PRESETS)) {
    assert.deepEqual(Object.keys(preset).sort(), Object.keys(SWITCHES).sort());
    for (const [name, value] of Object.entries(preset)) assert.ok(SWITCHES[name].includes(value), `${name}=${value}`);
  }
});

test("later sources win; removed keys in settings are skipped, not errors; bad values are errors", () => {
  const settings = { tracking: "issue", rigor: "strict", switches: { sandbox: "foreign", planReview: "on", leanCode: "off" } };
  const mode = resolveMode(settings, undefined, { rigor: "fast", stop: "merge" });
  assert.deepEqual([mode.stop, mode.rigor, mode.tracking], ["merge", "fast", undefined]);
  assert.deepEqual(mode.switches, { ...PRESETS.fast, leanCode: "off" });
  assert.throws(() => resolveMode({ stop: "deploy" }), /stop: "deploy" is not one of plan, local, pr, merge, milestone/);
  assert.throws(() => resolveMode({ switches: { review: "pr" } }), /review: "pr" is not one of off, auto, on/);
});

test("settingsNotice names keys nothing reads, and where a moved one went", () => {
  assert.equal(settingsNotice({ pitcrew: { profile: "x", mode: { stop: "pr", switches: { review: "on" } }, web: { codexModel: "m" } } }), undefined);
  const text = settingsNotice({ pitcrew: { mode: { tracking: "issue", switches: { sandbox: "off" } }, verifyGate: { mode: "remind" }, runner: { onFailure: "stop" }, nope: 1 } });
  assert.match(text, /pitcrew\.mode\.tracking \(now: pitcrew\.tracking/);
  assert.match(text, /pitcrew\.mode\.switches\.sandbox \(now: pitcrew\.runner\.sandbox\)/);
  assert.match(text, /pitcrew\.verifyGate\.mode \(now: the verify switch/);
  assert.match(text, /pitcrew\.runner\.onFailure, pitcrew\.nope$/);
});

test("the old key piEnv is read when pitcrew is missing, with a notice; pitcrew wins when both exist", () => {
  assert.deepEqual(ownSettings({ piEnv: { profile: "old" } }), { profile: "old" });
  assert.deepEqual(ownSettings({ piEnv: { profile: "old" }, pitcrew: { profile: "new" } }), { profile: "new" });
  assert.match(settingsNotice({ piEnv: { profile: "old" } }), /^pitcrew: rename the key "piEnv" to "pitcrew" in settings\.json \(read this time\)$/);
  assert.match(settingsNotice({ piEnv: {}, pitcrew: { nope: 1 } }), /\(not read: pitcrew is set\); settings not read, remove them from settings\.json: pitcrew\.nope$/);
  assert.equal(settingsNotice({ pitcrew: { profile: "x" } }), undefined);
});

test("review auto runs only when the agent merges by itself; on and off force it", () => {
  const at = (stop, review = "auto") => reviews(resolveMode({ stop, switches: { review } }));
  assert.deepEqual(["plan", "local", "pr", "merge", "milestone"].map((s) => at(s)), [false, false, false, true, true]);
  assert.equal(at("pr", "on"), true);
  assert.equal(at("merge", "off"), false);
  assert.equal(reviews(resolveMode({ rigor: "fast", stop: "merge" })), false);
  assert.match(describeMode(resolveMode()), /review +auto {2}→ off: you review the PR/);
});

test("tracking: the setting, else github with push rights, else local", () => {
  assert.equal(trackingFor("none", "ADMIN"), "none");
  assert.equal(trackingFor(undefined, "WRITE"), "github");
  assert.equal(trackingFor(undefined, "READ"), "local");
  assert.equal(trackingFor("issue", undefined), "local", "an old value is not read");
});

test("withChange: dials, switches, rigor drops switch changes; tracking is a repo setting", () => {
  let session = withChange(withChange({}, "stop merge"), "review off");
  assert.deepEqual(session, { stop: "merge", switches: { review: "off" } });
  session = withChange(session, " rigor  strict ");
  assert.deepEqual(resolveMode(session).switches, PRESETS.strict);
  assert.throws(() => withChange({}, "stop"), /usage/);
  assert.throws(() => withChange({}, "tracking github"), /repo setting: "pitcrew": \{ "tracking": "github" \}/);
});

test("currentMode and asInput carry tracking to children; a bad value gives the defaults", () => {
  const published = { ...resolveMode({ rigor: "fast", switches: { verify: "remind" } }), tracking: "none" };
  assert.deepEqual(currentMode({ [ENV_MODE]: JSON.stringify(published) }), published);
  assert.deepEqual(asInput(published), { stop: "pr", rigor: "fast", switches: { verify: "remind" }, tracking: "none" });
  assert.deepEqual(currentMode({ [ENV_MODE]: "{broken" }), resolveMode());
  assert.equal(shortMode(published), "pr · fast*");
});

test("the mode message says what the agent may do, with review resolved", () => {
  const text = modeMessage({ ...resolveMode(), tracking: "github" });
  assert.match(text, /Stop pr: go as far as a ready PR; the owner reviews and merges it/);
  assert.match(text, /no automatic review/);
  assert.match(text, /a PR must close an issue/);
  assert.match(modeMessage({ ...resolveMode({ stop: "merge" }), tracking: "local" }), /a fresh reviewer agent checks the change/);
  assert.doesNotMatch(modeMessage({ ...resolveMode(), tracking: "local" }), /close an issue/);
  assert.ok(text.length < 600, `${text.length} characters`);
});
