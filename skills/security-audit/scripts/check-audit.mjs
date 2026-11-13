#!/usr/bin/env node
// Checks for a security audit run (skill security-audit).
//   check-audit.mjs new-run          create and print the next run folder (outside the repo)
//   check-audit.mjs findings <file>  findings.json against report-schema.json, plus the rules below
//   check-audit.mjs ledger <file>    ledger.json: ids, the state table, checks, attempts
//
// What it checks: every schema branch (required, allowed and forbidden fields, enums, patterns, non-blank text), one record per
// fingerprint and sorted, trace order entrypoint → propagation → sink, repository-relative paths,
// positive lines, overall severity not above impact, a validation plan for needs_validation; for
// the ledger, the id rule, uniqueness and order, the state table, checks and reviewed paths, and
// the attempts archive. Not checked: no-follow and regular-file reads, the pre-parse JSON nesting and
// array limits (a 5 MB size cap remains), Unicode scalar and default-ignorable checks, Windows
// device names in paths, escaping of diagnostics, percent-encoded canonical ids, and per-agent
// artifact ownership (agents in this harness write no files).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentDir, workPath } from "../../../lib/paths.ts";
import { ownSettings } from "../../../lib/settings.ts";

const MAX_BYTES = 5 * 1024 * 1024;
const SEVERITY = ["informational", "low", "medium", "high", "critical"];
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
const visible = (s) => typeof s === "string" && /\S/u.test(s);
const safePath = (p) =>
  typeof p === "string" && p !== "" && p.trim() === p && !/[\\:\0]/.test(p) && !p.startsWith("/") && !p.startsWith("~") &&
  p.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");

/** The JSON Schema keywords report-schema.json uses. Returns error strings. */
export function checkSchema(value, schema, at = "$") {
  const errors = [];
  if (schema.oneOf) {
    const results = schema.oneOf.map((branch) => checkSchema(value, branch, at));
    const passing = results.filter((r) => r.length === 0).length;
    if (passing !== 1) {
      // Report the branch the record names by its const field (verdict), else a summary.
      const named = schema.oneOf.findIndex((b) => Object.entries(b.properties ?? {}).some(([k, p]) => has(p, "const") && isObject(value) && value[k] === p.const));
      errors.push(...(named >= 0 ? results[named] : [`${at}: matches ${passing} of the schema branches, expected 1`]));
    }
    return errors;
  }
  const type = typeOf(value);
  if (schema.type && !(schema.type === type || (schema.type === "number" && type === "integer"))) return [`${at}: expected ${schema.type}, got ${type}`];
  if (has(schema, "const") && value !== schema.const) errors.push(`${at}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: ${JSON.stringify(value)} is not one of ${schema.enum.join(", ")}`);
  if (type === "string") {
    if (schema.minLength && [...value].length < schema.minLength) errors.push(`${at}: too short`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${at}: does not match ${schema.pattern}`);
    if (schema.visibleContent && !visible(value)) errors.push(`${at}: blank text`);
  }
  if (type === "integer" && has(schema, "minimum") && value < schema.minimum) errors.push(`${at}: below ${schema.minimum}`);
  if (type === "array") {
    if (schema.minItems && value.length < schema.minItems) errors.push(`${at}: needs at least ${schema.minItems} item(s)`);
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) errors.push(`${at}: items must be unique`);
    if (schema.items) value.forEach((v, i) => errors.push(...checkSchema(v, schema.items, `${at}[${i}]`)));
  }
  if (type === "object") {
    for (const key of schema.required ?? []) if (!has(value, key)) errors.push(`${at}: missing ${key}`);
    for (const [key, v] of Object.entries(value)) {
      if (schema.properties && has(schema.properties, key)) errors.push(...checkSchema(v, schema.properties[key], `${at}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${at}: unexpected field ${key}`);
    }
  }
  return errors;
}

/** findings.json: the schema, then the rules a schema cannot say. */
export function checkFindings(findings, schema) {
  const errors = checkSchema(findings, schema);
  if (!Array.isArray(findings)) return errors;
  const seen = new Set();
  let previous;
  findings.forEach((f, i) => {
    if (!isObject(f)) return;
    const at = `$[${i}]`;
    if (seen.has(f.fingerprint)) errors.push(`${at}: duplicate fingerprint ${f.fingerprint}`);
    if (previous !== undefined && previous > f.fingerprint) errors.push(`${at}: records must be sorted by fingerprint`);
    seen.add(f.fingerprint);
    previous = f.fingerprint;
    for (const field of ["trace", "evidence"]) {
      for (const [j, step] of (Array.isArray(f[field]) ? f[field] : []).entries()) {
        if (isObject(step) && !safePath(step.file)) errors.push(`${at}.${field}[${j}].file: not a safe repository-relative path`);
      }
    }
    for (const [j, c] of (f.remediation?.code_changes ?? []).entries()) {
      if (!safePath(c?.file_name)) errors.push(`${at}.remediation.code_changes[${j}].file_name: not a safe repository-relative path`);
    }
    const kinds = Array.isArray(f.trace) ? f.trace.map((s) => s?.kind) : [];
    if (kinds.length === 1 && !["entrypoint", "sink"].includes(kinds[0])) errors.push(`${at}.trace: a one-step trace is an entrypoint or a sink`);
    if (kinds.length > 1) {
      const ok = kinds[0] === "entrypoint" && kinds.at(-1) === "sink" && kinds.slice(1, -1).every((k) => k === "propagation");
      if (!ok) errors.push(`${at}.trace: must start with entrypoint, end with sink, propagation in between`);
    }
    if (f.verdict === "confirmed") {
      const overall = SEVERITY.indexOf(f.severity?.overall_severity);
      const impact = SEVERITY.indexOf(f.severity?.impact?.score);
      if (overall > impact && impact >= 0) errors.push(`${at}.severity: overall cannot exceed the demonstrated impact`);
    }
    if (f.verdict === "needs_validation" && !visible(f.validation_plan?.local) && !visible(f.validation_plan?.deployment)) {
      errors.push(`${at}.validation_plan: needs a local or a deployment plan`);
    }
  });
  return errors;
}

const STATUSES = ["planned", "not_applicable", "out_of_scope", "deferred", "in_progress", "blocked", "covered", "candidate"];
const PRIOR = ["none", "new", "prior_confirmed_same_source", "prior_confirmed_changed_source", "prior_needs_validation", "prior_deferred",
  "prior_blocked", "prior_out_of_scope", "prior_covered_same_source", "prior_covered_changed_source", "prior_rejected_claim_changed"];
const REFS = ["surface", "boundary", "subsystem", "attack_class"];

/** The state table of references/recon.md for one unit (live state or an archived attempt). */
function checkState(u, at, errors) {
  const empty = (k) => Array.isArray(u[k]) && u[k].length === 0;
  const full = (k) => Array.isArray(u[k]) && u[k].length > 0;
  const want = (cond, msg) => cond || errors.push(`${at}: ${u.status} ${msg}`);
  const owned = ["in_progress", "blocked", "covered", "candidate"].includes(u.status);
  want(owned ? visible(u.agent) : u.agent === null, owned ? "needs an agent" : "must have agent null");
  if (["planned", "in_progress", "not_applicable", "out_of_scope", "deferred"].includes(u.status)) {
    want(empty("reviewed_paths") && empty("checks"), "must have no reviewed paths or checks");
    want(empty("fingerprints"), "must have no fingerprints");
  }
  if (["planned", "in_progress"].includes(u.status)) want(empty("unresolved"), "must have nothing unresolved");
  if (["not_applicable", "out_of_scope", "deferred"].includes(u.status)) want(full("unresolved"), "needs the reason in unresolved");
  if (["blocked", "covered", "candidate"].includes(u.status)) want(full("reviewed_paths") && full("checks"), "needs reviewed paths and checks");
  if (u.status === "blocked") want(empty("fingerprints") && full("unresolved"), "needs a blocker and no fingerprint");
  if (u.status === "covered") want(empty("fingerprints") && empty("unresolved"), "must have no fingerprint and nothing unresolved");
  if (u.status === "candidate") want(full("fingerprints"), "needs fingerprints");
  const union = new Set();
  for (const [j, c] of (Array.isArray(u.checks) ? u.checks : []).entries()) {
    const cat = `${at}.checks[${j}]`;
    if (!isObject(c)) { errors.push(`${cat}: expected an object`); continue; }
    if (!visible(c.agent)) errors.push(`${cat}: needs an agent`);
    if (!visible(c.invariant) || !visible(c.result)) errors.push(`${cat}: needs invariant and result`);
    if (c.method === "source" && c.artifact !== null) errors.push(`${cat}: a source check has artifact null`);
    if (c.method === "local" && !safePath(c.artifact)) errors.push(`${cat}: a local check names its artifact file in the run folder`);
    if (!["source", "local"].includes(c.method)) errors.push(`${cat}: method is source or local`);
    if (!Array.isArray(c.reviewed_paths) || c.reviewed_paths.length === 0) errors.push(`${cat}: needs reviewed_paths`);
    for (const p of c.reviewed_paths ?? []) union.add(p);
  }
  const paths = new Set(Array.isArray(u.reviewed_paths) ? u.reviewed_paths : []);
  if (paths.size !== union.size || [...paths].some((p) => !union.has(p))) errors.push(`${at}: reviewed_paths must be the union of the checks' paths`);
  for (const p of paths) if (!safePath(p)) errors.push(`${at}: ${JSON.stringify(p)} is not a safe repository-relative path`);
}

/** ledger.json: a sorted array of units with unique ids. */
export function checkLedger(ledger) {
  if (!Array.isArray(ledger)) return ["$: expected an array of units"];
  const errors = [];
  const ids = new Set();
  let previous;
  ledger.forEach((u, i) => {
    const at = `$[${i}]`;
    if (!isObject(u)) return errors.push(`${at}: expected an object`);
    for (const k of REFS) if (!visible(u[k])) errors.push(`${at}.${k}: missing`);
    const expected = [...REFS, ...(has(u, "lifecycle") ? ["lifecycle"] : [])].map((k) => u[k]).join("::");
    if (u.id !== expected) errors.push(`${at}.id: expected ${JSON.stringify(expected)}`);
    if (ids.has(u.id)) errors.push(`${at}.id: duplicate`);
    if (previous !== undefined && previous > u.id) errors.push(`${at}.id: units must be sorted by id`);
    ids.add(u.id);
    previous = u.id;
    if (!STATUSES.includes(u.status)) errors.push(`${at}.status: not one of ${STATUSES.join(", ")}`);
    if (!PRIOR.includes(u.prior)) errors.push(`${at}.prior: not one of ${PRIOR.join(", ")}`);
    if (!Number.isInteger(u.wave) || u.wave < 1) errors.push(`${at}.wave: a positive integer`);
    for (const k of ["starting_paths", "blocks", "excluded", "reviewed_paths", "checks", "fingerprints", "unresolved", "attempts"]) {
      if (!Array.isArray(u[k])) errors.push(`${at}.${k}: expected an array`);
    }
    for (const [j, e] of (Array.isArray(u.excluded) ? u.excluded : []).entries()) {
      if (!visible(e?.block) || !visible(e?.reason)) errors.push(`${at}.excluded[${j}]: needs block and reason`);
      else if (u.blocks?.includes(e.block)) errors.push(`${at}.excluded[${j}]: ${e.block} is also selected`);
    }
    checkState(u, at, errors);
    let lastWave = 0;
    const owners = new Set();
    for (const [j, a] of (Array.isArray(u.attempts) ? u.attempts : []).entries()) {
      const aat = `${at}.attempts[${j}]`;
      if (!["blocked", "covered", "candidate"].includes(a?.status)) { errors.push(`${aat}: only blocked, covered or candidate attempts are archived`); continue; }
      if (!Number.isInteger(a.wave) || a.wave <= lastWave || a.wave >= u.wave) errors.push(`${aat}.wave: must rise and stay below the unit's wave`);
      if (!visible(a.reassignment_reason)) errors.push(`${aat}: needs reassignment_reason`);
      checkState(a, aat, errors);
      lastWave = a.wave;
      owners.add(a.agent);
    }
    if (u.agent !== null && owners.has(u.agent)) errors.push(`${at}.agent: a reopened unit needs a fresh agent`);
  });
  return errors;
}

function readJson(file) {
  if (statSync(file).size > MAX_BYTES) throw new Error(`${file} is larger than 5 MB`);
  return JSON.parse(readFileSync(file, "utf8"));
}

function newRun() {
  const setting = (file) => {
    try {
      return ownSettings(JSON.parse(readFileSync(file, "utf8")))?.workDir;
    } catch {
      return undefined;
    }
  };
  let top = process.cwd();
  try {
    top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {}
  const override = setting(join(top, ".pi", "settings.json")) ?? setting(join(agentDir(), "settings.json"));
  const base = join(workPath(process.cwd(), "reports", override), "security-audit");
  mkdirSync(base, { recursive: true });
  const used = readdirSync(base).map((n) => Number(/^run-(\d+)$/.exec(n)?.[1] ?? 0));
  const dir = join(base, `run-${Math.max(0, ...used) + 1}`);
  mkdirSync(dir);
  return dir;
}

const [command, file] = process.argv.slice(2);
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (command === "new-run") {
      console.log(newRun());
    } else if (command === "findings" || command === "ledger") {
      const data = readJson(file);
      const schema = JSON.parse(readFileSync(new URL("report-schema.json", import.meta.url), "utf8"));
      const errors = command === "findings" ? checkFindings(data, schema) : checkLedger(data);
      for (const e of errors.slice(0, 100)) console.error(`ERROR: ${e}`);
      if (errors.length) {
        console.error(`FAIL: ${errors.length} error(s)${errors.length > 100 ? ", first 100 shown" : ""}`);
        process.exit(1);
      }
      console.log(`PASS: ${data.length} ${command === "findings" ? "records" : "units"}`);
    } else {
      console.error("usage: check-audit.mjs new-run | findings <findings.json> | ledger <ledger.json>");
      process.exit(2);
    }
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exit(1);
  }
}
