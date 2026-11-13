import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkFindings, checkLedger } from "../skills/security-audit/scripts/check-audit.mjs";

// These cases pin the rules of the audit check that the skill relies on.
const schema = JSON.parse(readFileSync(new URL("../skills/security-audit/scripts/report-schema.json", import.meta.url), "utf8"));
const trace = [
  { kind: "entrypoint", file: "app.js", line: 3, scope: "GET /users", description: "q from the query string" },
  { kind: "sink", file: "db.js", line: 9, scope: "find", description: "q concatenated into SQL" },
];
const evidence = [{ file: "db.js", line: 9, description: "string concatenation" }];
const confirmed = {
  verdict: "confirmed", fingerprint: "db:find-sql-concat", title: "SQL injection", description: "d", root_cause: "r",
  intended_behavior: "i", trace, evidence, conditions: [],
  execution: { attacker_perspective: "anonymous", payloads: ["' OR 1=1 --"], instructions: ["call find"], observed_result: "all rows" },
  remediation: { strategy: "parameterise" },
  severity: { likelihood: { score: "high", reason: "r" }, impact: { score: "high", reason: "r" }, overall_severity: "high" },
  confidence: { score: "high", reason: "r" },
};
const pending = {
  verdict: "needs_validation", fingerprint: "proxy:host-header", title: "t", description: "d", claimed_root_cause: "c",
  trace, evidence, blockers: ["proxy config not in repo"], validation_plan: { deployment: "owner checks the proxy strips Host" },
};

test("findings: valid records pass; the schema and the extra rules catch what they must", () => {
  assert.deepEqual(checkFindings([confirmed, pending], schema), []);
  const higher = { ...confirmed, severity: { ...confirmed.severity, overall_severity: "critical" } };
  assert.match(checkFindings([higher], schema).join(), /cannot exceed/);
  assert.match(checkFindings([{ ...pending, severity: confirmed.severity }], schema).join(), /unexpected field severity/);
  assert.match(checkFindings([{ ...pending, validation_plan: {} }], schema).join(), /local or a deployment plan/);
  assert.match(checkFindings([pending, confirmed], schema).join(), /sorted/);
  assert.match(checkFindings([confirmed, confirmed], schema).join(), /duplicate fingerprint/);
  assert.match(checkFindings([{ ...confirmed, trace: [...trace].reverse() }], schema).join(), /start with entrypoint/);
  assert.match(checkFindings([{ ...confirmed, evidence: [{ ...evidence[0], file: "../etc/passwd" }] }], schema).join(), /safe repository-relative/);
  assert.match(checkFindings([{ ...confirmed, title: "   " }], schema).join(), /blank text/);
});

const refs = { surface: "app.js#GET /users", boundary: "db.js#find", subsystem: "api", attack_class: "attack-classes.md#Injection" };
const unit = (extra) => ({
  ...refs, id: Object.values(refs).join("::"), starting_paths: ["app.js"], blocks: [], excluded: [], prior: "none", wave: 1,
  status: "planned", agent: null, reviewed_paths: [], checks: [], fingerprints: [], unresolved: [], attempts: [], ...extra,
});
const check = { agent: "h1", reviewed_paths: ["db.js"], invariant: "parameterised query", method: "source", result: "concatenated", artifact: null };

test("ledger: the id rule, the state table, checks and attempts", () => {
  assert.deepEqual(checkLedger([unit()]), []);
  const candidate = unit({ status: "candidate", agent: "h1", reviewed_paths: ["db.js"], checks: [check], fingerprints: ["db:find-sql-concat"] });
  assert.deepEqual(checkLedger([candidate]), []);
  assert.match(checkLedger([unit({ status: "covered", agent: "h1" })]).join(), /needs reviewed paths and checks/);
  assert.match(checkLedger([unit({ status: "deferred" })]).join(), /reason in unresolved/);
  assert.match(checkLedger([unit({ id: "x" })]).join(), /id: expected/);
  assert.match(checkLedger([{ ...candidate, reviewed_paths: ["db.js", "app.js"] }]).join(), /union/);
  assert.match(checkLedger([unit({ checks: [check] })]).join(), /no reviewed paths or checks/);
  const archived = { wave: 1, status: "covered", agent: "h1", reviewed_paths: ["db.js"], checks: [check], fingerprints: [], unresolved: [], reassignment_reason: "missed batch path" };
  assert.deepEqual(checkLedger([unit({ wave: 2, attempts: [archived] })]), []);
  assert.match(checkLedger([unit({ wave: 2, status: "in_progress", agent: "h1", attempts: [archived] })]).join(), /fresh agent/);
  assert.match(checkLedger([unit({ wave: 1, attempts: [archived] })]).join(), /below the unit's wave/);
});
