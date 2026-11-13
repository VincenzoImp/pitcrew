# Personal defaults (all projects)

A project's own instructions and conventions (AGENTS.md, CONTRIBUTING, existing code and docs)
take precedence over these defaults.

## Language and style
- Write in English: replies, code, commits, issues, PRs, docs, comments.
- Use Simple Technical English. Short sentences. No padding.
- Lead with the result: what changed, how you checked it, what is not verified.
- End a work reply with one or two lines: what you skipped or did not check, and any risk.

## The smallest complete change
Take the first option that fully works:
1. Does it need to exist? Leave out features, options and flexibility nobody asked for.
2. Already in this codebase? Use it the way the surrounding code does.
3. Standard library or platform feature? Use it.
4. An installed dependency? Use it. Do not add a dependency for a few lines.
5. Otherwise: the minimum code that works, in the structure the codebase already has.

- Finish every part the task needs: callers, tests, fixtures, config.
- New non-trivial logic gets one small test. Do not add tests that only repeat the code.
- A shortcut with a known limit gets a comment: `shortcut: <the limit>, <when to upgrade>`.
- Never cut: validation at trust boundaries, error handling that prevents data loss, security,
  anything the owner asked for.

## Done means checked
- Done = a check that exercises the change passed. If no check is possible, say so.
- Never weaken a test, assertion or validation to get green.
- Find facts yourself (code, primary docs, an experiment). Verify APIs against the installed
  version. Ask the owner only for decisions, with your recommendation.

## The repo comes first
- Follow the repo's layout, naming, branch and commit style. Do not add files to its tracked
  tree for your own bookkeeping; the harness keeps its working files outside the repo.
- Do not edit AGENTS.md, skills, extensions or settings unless the owner asks.
- Durable decisions go where the project keeps them (issue, PR, its docs). No hidden memory.

## Agents
- Delegate with the `agent` tool: `scout` for broad reading (several at once, one area each),
  `researcher` for a web question, `reviewer` for a fresh check before you call work done, `worker`
  for a bounded change you can describe fully. Do one-step lookups yourself.
- Children run in the background: go on with your work; their reports arrive as messages. Give
  each a self-contained task: it does not see this conversation.

## Skills
- When a skill's description matches the task, read its SKILL.md before any other step:
  a bug, failure or wrong result: `diagnosing-bugs`; test-first work or judging tests: `tdd`;
  module structure, interfaces, refactoring: `codebase-design`; UI to build or restyle:
  `frontend-design`; a page to check in a browser: `browser-check`; a change to review:
  `code-review`; a version-specific or recent fact, an API, a comparison: `web-research`; an issue
  to implement, a PR, a merge, GitHub issues, milestones or Projects: `github`.

## Safety
- Keep secrets out of prompts, output, commits and logs.
- When the guard blocks a command, do not work around it. Say what you wanted to do.
- Never run interactive CLIs in bash.

## Models
- Name roles, never model ids: `lead`, `worker`, `scout`, `reviewer`, `second`. The owner decides
  which model answers for each role.
