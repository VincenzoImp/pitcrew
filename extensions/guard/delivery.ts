import { basename, isAbsolute, resolve } from "node:path";
import { type Mode, trackingFor } from "../../lib/mode.ts";
import type { DeliveryFacts, RepoFacts } from "../../lib/facts.ts";
import { type Caps, DEFAULT_CAPS } from "../../lib/settings.ts";

export { type Caps, DEFAULT_CAPS };
export type { DeliveryFacts, RepoFacts };
import { commandWords, splitCommands, type Verdict } from "./rules.ts";

// Delivery rules (docs/delivery.md): small checks on GitHub and git commands, tied to the stop dial,
// a switch, or a repo you do not own (always on). Pure: every fact about the world comes from
// `facts`, asked only for the commands that need it. A result can also *allow* a segment: inside the
// stop dial, the guard's usual ask for a push, a PR, a merge, or closing the milestone and its
// release in your own repo is skipped.

export interface DeliveryResult {
  verdicts: Verdict[];
  /** Segments whose usual push / publish / merge ask is skipped. */
  allowed: Set<number>;
}

/** A closing keyword that links an issue (GitHub docs, "Linking a pull request to an issue"). */
export const CLOSES = /\b(close[sd]?|fix(e[sd])?|resolve[sd]?):?\s+(([\w.-]+\/[\w.-]+)?#\d+|https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+)/i;
const USUAL_ASKS = new Set(["git-push", "publish", "github-write"]);
const AGENT_STOPS = { pr: ["pr", "merge", "milestone"], merge: ["merge", "milestone"], milestone: ["milestone"] };

/** Value of an option: `--name v`, `--name=v`, `-x v`. */
function option(args: string[], ...names: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    for (const name of names) {
      if (args[i] === name) return args[i + 1];
      if (name.startsWith("--") && args[i].startsWith(`${name}=`)) return args[i].slice(name.length + 1);
    }
  }
  return undefined;
}

export function checkDelivery(command: string, cwd: string, mode: Mode, facts: DeliveryFacts, caps: Caps = DEFAULT_CAPS): DeliveryResult {
  const verdicts: Verdict[] = [];
  const allowed = new Set<number>();
  const ask = (rule: string, reason: string) => verdicts.push({ level: "ask", rule, reason });
  const reaches = (stop: keyof typeof AGENT_STOPS) => AGENT_STOPS[stop].includes(mode.stop);
  const foreign = (repo: RepoFacts | undefined) => repo !== undefined && repo.permission !== "ADMIN";
  const notYours = (repo: RepoFacts, what: string) => ask("foreign-repo", `${what} in ${repo.name}, a repo you do not own (permission ${repo.permission}); only the owner decides that`);
  let here = cwd;

  splitCommands(command).forEach((segment, index) => {
    const argv = commandWords(segment.words).argv;
    const cmd = basename(argv[0] ?? "");
    const args = argv.slice(1);
    if (cmd === "cd" && args[0]) { here = isAbsolute(args[0]) ? args[0] : resolve(here, args[0]); return; }

    if (cmd === "gh") {
      const target = option(args, "-R", "--repo");
      const two = args.slice(0, 2).join(" ");
      const repo = () => facts.repo(here, target);

      if (two === "pr create") {
        const r = repo();
        if (foreign(r)) return notYours(r!, "opens a PR");
        if (mode.switches.issueRequired === "on" && (mode.tracking ?? trackingFor(undefined, r?.permission)) === "github") {
          const bodyFile = option(args, "-F", "--body-file");
          const fill = args.some((a) => a.startsWith("--fill"));
          // The whole line counts too: a body is often written by a here-document in the same command.
          const text = [command, option(args, "-t", "--title"), option(args, "-b", "--body"),
            bodyFile && bodyFile !== "-" ? facts.readFile(isAbsolute(bodyFile) ? bodyFile : resolve(here, bodyFile)) : undefined,
            fill ? facts.commits(here, option(args, "-B", "--base")) : undefined].filter(Boolean).join("\n");
          const base = option(args, "-B", "--base");
          if (!CLOSES.test(text)) return ask("issue-required", `the PR closes no issue: put "Closes #N" in its body${bodyFile === "-" ? " (a body from stdin cannot be checked)" : ""}. issueRequired is on; /mode issueRequired off for work without issues`);
          if (base && r && base !== r.defaultBranch) return ask("issue-required", `the PR targets ${base}, not ${r.defaultBranch}: GitHub closes the issue only for PRs into the default branch`);
        }
        if (r && reaches("pr")) allowed.add(index);
        return;
      }

      if (two === "pr merge" || (args[0] === "api" && /\/pulls\/\d+\/merge\b/.test(args.join(" ")))) {
        if (args.includes("--admin")) return verdicts.push({ level: "block", rule: "merge", reason: "--admin merges past the branch rules; never use it" });
        const r = repo();
        if (foreign(r)) return notYours(r!, "merges a PR");
        if (!reaches("merge")) return ask("stop", `the stop dial is "${mode.stop}": the agent does not merge. The owner merges, or sets /mode stop merge`);
        const sha = option(args, "--match-head-commit") ?? args.find((a) => /^sha=/.test(a))?.slice(4);
        if (!sha) return ask("merge-head", "merge without --match-head-commit <sha>: pin the head that was verified and reviewed");
        if (/^\$/.test(sha)) return ask("merge-head", `--match-head-commit ${sha}: give the commit sha itself (from git rev-parse HEAD), so the guard can check that head`);
        if (mode.switches.verify === "on" && facts.verified(here, sha) === false) {
          return ask("merge-head", `no passing verify run on ${sha.slice(0, 7)} in this session: run the repo's verify command on that head as its own command (nothing piped after it, no ";"), then merge; or /mode verify off`);
        }
        if (r && args[0] !== "api") allowed.add(index);
        return;
      }

      if (two === "issue develop" && option(args, "--worktree")) return capCheck(here);

      // Issues, comments, labels, releases, settings: in your own repo the stop dial decides;
      // in a foreign repo creating objects and changing settings is the owner's call.
      const creates = /^(issue create|label (create|edit|delete|clone)|release (create|edit|delete|upload)|repo (edit|rename|archive|delete))$/.test(two)
        || (/^(issue|pr) edit$/.test(two) && args.some((a) => /^--(add-label|remove-label|add-assignee|milestone|add-project)/.test(a)));
      const apiWrite = args[0] === "api" && args.some((a) => /^(-X|--method)$/.test(a) || /^--method=/.test(a) || /^(-f|-F|--field|--raw-field|--input)$/.test(a))
        && !/^GET$/i.test(option(args, "-X", "--method") ?? "POST");
      const apiRepo = apiWrite ? /(?:^|\/)repos\/([\w.-]+\/[\w.-]+)/.exec(args.find((a) => /repos\//.test(a)) ?? "")?.[1] : undefined;
      if (creates || apiRepo) {
        const r = apiRepo ? facts.repo(here, apiRepo) : repo();
        if (foreign(r)) return notYours(r!, creates ? `gh ${two}` : "a GitHub API write");
      }
      if (/^(issue (create|comment|edit)|pr (comment|edit))$/.test(two) && reaches("pr") && repo() && !foreign(repo())) allowed.add(index);
      // The end of a milestone: close it and cut its release.
      const closesMilestone = apiRepo && /\/milestones\/\d+$/.test(args.find((a) => /repos\//.test(a)) ?? "") && args.includes("state=closed");
      const ends = two === "release create" || closesMilestone ? (apiRepo ? facts.repo(here, apiRepo) : repo()) : undefined;
      if (ends && !foreign(ends) && reaches("milestone")) allowed.add(index);
      return;
    }

    if (cmd === "git") {
      let i = 0;
      let dir = here;
      while (i < args.length && args[i].startsWith("-")) {
        if (args[i] === "-C") dir = resolve(here, args[i + 1] ?? ".");
        i += args[i] === "-C" || args[i] === "-c" ? 2 : 1;
      }
      const sub = args[i];
      const rest = args.slice(i + 1);
      if (sub === "worktree" && rest[0] === "add") return capCheck(dir);
      if (sub !== "push") return;
      if (rest.some((a) => /^(-f|--force|--force-with-lease|--mirror|--all|--tags|-d|--delete|--prune)/.test(a) || a.startsWith("+") || a.startsWith(":"))) return;
      const [remoteName = "origin", ...refspecs] = rest.filter((a) => !a.startsWith("-"));
      const name = facts.remote(dir, remoteName);
      const r = name ? facts.repo(dir, name) : undefined;
      if (!r) return;
      if (foreign(r)) return notYours(r, "pushes");
      const targets = refspecs.length ? refspecs.map((s) => s.split(":").pop()!.replace(/^refs\/heads\//, "")) : [facts.branch(dir) ?? ""];
      if (reaches("pr") && targets.every((t) => t && t !== "HEAD" && t !== r.defaultBranch)) allowed.add(index);
      return;
    }
  });

  function capCheck(dir: string) {
    if (!caps.worktrees && !caps.diskGB) return;
    const { count, gb } = facts.worktrees(dir);
    if (caps.worktrees && count >= caps.worktrees) ask("cap", `${count} worktrees exist (cap ${caps.worktrees}): run "pitcrew tidy --all-merged", or raise pitcrew.caps.worktrees`);
    else if (caps.diskGB && gb >= caps.diskGB) ask("cap", `worktrees and the work folder use ${gb.toFixed(1)} GB (cap ${caps.diskGB}): run "pitcrew tidy --all-merged", or raise pitcrew.caps.diskGB`);
  }

  return { verdicts, allowed };
}

/** Skip the usual ask of an allowed segment; any other verdict stays. */
export const skipsAsk = (result: DeliveryResult) => (verdict: Verdict, segment: number) =>
  verdict.level === "ask" && USUAL_ASKS.has(verdict.rule) && result.allowed.has(segment);
