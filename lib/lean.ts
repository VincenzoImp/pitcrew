import { gitOut } from "./git.ts";
import { ownSettings } from "./settings.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// `pitcrew check`: lean-code checks on the changes of a branch (docs/delivery.md, "Lean code").
// Size of the change and test-to-code ratio, counted in lines; `shortcut:` markers in added lines
// must name their upgrade trigger. The `leanCode` switch says off, warn or block.

export interface Bounds {
  /** Most lines changed (added + deleted) in code and tests together. */
  maxLines: number;
  /** Most test lines added per code line added. */
  maxTestRatio: number;
  /** The ratio is judged only when at least this many code lines were added. */
  minCodeLines: number;
}
export const DEFAULT_BOUNDS: Bounds = { maxLines: 400, maxTestRatio: 1.5, minCodeLines: 30 };

export type Kind = "code" | "test" | "other";

const TEST_PATH = /(^|\/)(tests?|__tests__|__mocks__|specs?|testdata|fixtures|e2e)\/|[._-](test|spec)s?\.[^/]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py|rb|exs?)$|(^|\/)conftest\.py$/i;
const OTHER_PATH = /\.(md|mdx|markdown|rst|txt|adoc|json|ya?ml|toml|ini|cfg|lock|svg|png|jpe?g|gif|webp|ico|pdf|snap|min\.js|map|csv)$|(^|\/)(docs?|dist|build|vendor|node_modules|third_party|__snapshots__)\/|(^|\/)(LICEN[CS]E|COPYING|CHANGELOG|AUTHORS|CODEOWNERS)[^/]*$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock)$|(^|\/)\.[^/]+$/i;

/** Test code: files under a test folder, or named as tests. Other: docs, data, config, lock files, generated and vendored files. */
export function kindOf(path: string): Kind {
  if (TEST_PATH.test(path)) return "test";
  if (OTHER_PATH.test(path)) return "other";
  return "code";
}

export interface Change { path: string; added: number; deleted: number; addedLines: { line: number; text: string }[] }

/** Parse `git diff -U0` output into changes per file (a rename counts as its new path, a deleted file as its old one). */
export function parseDiff(diff: string): Change[] {
  const changes: Change[] = [];
  let current: Change | undefined;
  let header = false; // between "diff --git" and the first hunk
  let oldPath = "";
  let next = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) { current = undefined; header = true; continue; }
    if (header) {
      if (line.startsWith("--- ")) oldPath = line.slice(4).replace(/^a\//, "");
      if (line.startsWith("+++ ")) {
        const path = line.slice(4) === "/dev/null" ? oldPath : line.slice(4).replace(/^b\//, "");
        current = { path, added: 0, deleted: 0, addedLines: [] };
        changes.push(current);
      }
      if (!line.startsWith("@@")) continue; // binary files have no "+++" line and stay uncounted
      header = false;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { next = Number(hunk[1]); continue; }
    if (!current) continue;
    if (line.startsWith("+")) { current.added++; current.addedLines.push({ line: next++, text: line.slice(1) }); }
    else if (line.startsWith("-")) current.deleted++;
  }
  return changes;
}

const MARKER = /(?:#|\/\/|\/\*|<!--|--|;)\s*shortcut:\s*(.*?)\s*(?:\*\/|-->)?\s*$/i;

export interface Report {
  code: { added: number; deleted: number };
  test: { added: number; deleted: number };
  other: { added: number; deleted: number };
  findings: string[];
}

export function leanReport(changes: Change[], bounds: Bounds = DEFAULT_BOUNDS): Report {
  const sum = { code: { added: 0, deleted: 0 }, test: { added: 0, deleted: 0 }, other: { added: 0, deleted: 0 } };
  const findings: string[] = [];
  for (const change of changes) {
    const kind = kindOf(change.path);
    sum[kind].added += change.added;
    sum[kind].deleted += change.deleted;
    for (const { line, text } of change.addedLines) {
      const marker = MARKER.exec(text);
      // A marker inside a string literal (a test fixture, a message) is not a comment.
      if (marker && [`"`, "'", "`"].some((q) => (text.slice(0, marker.index).split(q).length - 1) % 2 === 1)) continue;
      // `shortcut: <the limit>, <when to upgrade>`: a trigger after the comma.
      if (marker && !/^[^,]+,\s*\S.{2,}/.test(marker[1])) {
        findings.push(`${change.path}:${line} shortcut marker names no upgrade trigger; write "shortcut: <the limit>, <when to upgrade>"`);
      }
    }
  }
  const size = sum.code.added + sum.code.deleted + sum.test.added + sum.test.deleted;
  if (bounds.maxLines && size > bounds.maxLines) {
    findings.unshift(`change size ${size} lines of code and tests (bound ${bounds.maxLines}): split it, or say in the PR why it cannot be split`);
  }
  if (bounds.maxTestRatio && sum.code.added >= bounds.minCodeLines && sum.test.added > bounds.maxTestRatio * sum.code.added) {
    findings.unshift(`tests are ${(sum.test.added / sum.code.added).toFixed(1)}× the code added (${sum.test.added} / ${sum.code.added}, bound ${bounds.maxTestRatio}×): keep one test per risky behaviour`);
  }
  return { ...sum, findings };
}

// ---------------------------------------------------------------- git and settings

const git = (cwd: string, args: string[]) => gitOut(cwd, ...args);

/** Changes of the branch against `base` (default origin's default branch): commits, uncommitted edits and new untracked files. */
export function branchChanges(cwd: string, base?: string): { base: string; root: string; changes: Change[] } | undefined {
  const ref = base ?? git(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])?.trim()
    ?? ["origin/main", "origin/master", "main", "master"].find((r) => git(cwd, ["rev-parse", "-q", "--verify", r]) !== undefined) ?? "main";
  const fork = git(cwd, ["merge-base", ref, "HEAD"])?.trim();
  if (!fork) return undefined;
  const changes = parseDiff(git(cwd, ["diff", "-U0", "--no-color", "--no-ext-diff", fork]) ?? "");
  const root = git(cwd, ["rev-parse", "--show-toplevel"])?.trim() ?? cwd;
  for (const path of (git(cwd, ["ls-files", "--others", "--exclude-standard", "--full-name", ":/"]) ?? "").split("\n").filter(Boolean)) {
    let text = "";
    try { text = readFileSync(join(root, path), "utf8"); } catch { continue; }
    if (text.includes("\0")) continue;
    const lines = text.split("\n");
    if (lines.at(-1) === "") lines.pop();
    changes.push({ path, added: lines.length, deleted: 0, addedLines: lines.map((t, i) => ({ line: i + 1, text: t })) });
  }
  return { base: ref, root, changes };
}

/** `pitcrew.leanCode` bounds from the global and the repo settings (the repo wins). */
export function settingsBounds(paths: string[]): Partial<Bounds> {
  let bounds: Partial<Bounds> = {};
  for (const path of paths) {
    try { bounds = { ...bounds, ...ownSettings(JSON.parse(readFileSync(path, "utf8")))?.leanCode }; } catch { /* missing or unreadable */ }
  }
  return bounds;
}

/** What `pitcrew check` prints and its exit code, for a level of the `leanCode` switch. */
export function render(report: Report, level: "off" | "warn" | "block", base: string): { lines: string[]; exit: number } {
  if (level === "off") return { lines: ["pitcrew check: lean-code checks are off (leanCode off)"], exit: 0 };
  const n = (k: keyof Omit<Report, "findings">) => `+${report[k].added} -${report[k].deleted}`;
  const lines = [`pitcrew check against ${base}: code ${n("code")}, tests ${n("test")}, other ${n("other")} (not counted)`];
  if (!report.findings.length) return { lines: [...lines, "ok"], exit: 0 };
  const tag = level === "block" ? "block" : "warn";
  return { lines: [...lines, ...report.findings.map((f) => `${tag}: ${f}`)], exit: level === "block" ? 1 : 0 };
}
