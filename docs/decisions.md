# Decisions

Features of pi 1.5.2 and its ecosystem that were read and rejected, with the reason. Read this
before proposing one of them again; a new fact (a pi or bridge release, a measurement) can reopen an
item.

| Feature | Why not |
| --- | --- |
| pi's `RpcClient` for children | it starts `node <cliPath>` and cannot answer `extension_ui_request`; children need both (bun binaries, `ask_parent`, guard confirms) |
| In-process SDK children | SDK sessions load no built-in extensions, fail on the Claude bridge, share two code-mode workers per process, and lose the guard's process isolation |
| Code mode on by default, or `codemode.mode: only` | +550 to 760 tokens per request with no measured gain ([settings.md](settings.md)); the bridge drops its rule line |
| Fallback models on retry, phase-based model switches, classifier routing | the owner's rule: no fallback, fail loudly. A phase switch overrides explicit roles and costs a cache miss; classifiers need API keys, not subscriptions |
| `modelThinkingLevels` for roles | static, keyed by exact `provider/modelId`; profiles change per session |
| Tool `promptGuidelines`, `promptSnippet`, a returned `systemPrompt` | the Claude bridge drops them ([claude-access.md](claude-access.md)) |
| `SYSTEM.md` to cut pi's `docs` prompt section | it replaces the preamble, tools and rules too; the bridge drops that section anyway |
| `context` / `context_with_system` pruning | every changed list replays the prompt head: a cache loss each time |
| Router `state` for the role map | per session, not per branch; `direct` requests get no state |
| Parallel attempts in the session tree, `fork` for children | one leaf is active at a time; a fork re-sends the whole context uncached |
| Gondolin, `ssh.ts` or `spawnHook` as the sandbox | they move only the tools; extensions and the bridge stay on the host ([sandbox.md](sandbox.md)) |
| `auto-commit-on-exit`, `git-checkpoint`, `dirty-repo-guard`, `confirm-destructive` examples | they conflict with the delivery rules; `pi-rewind-hook` already checkpoints; the handoff state block lists dirty files |
| A GitHub MCP server instead of `gh` | MCP calls bypass the guard's command-based delivery rules |
| Cache warming | bridge models declare no `promptCache`, so they are not eligible; on Codex it spends quota |
| The native footer as an option | it shows 0 % context for role models |
| A custom header | shown at start-up only; the footer already shows profile and mode |
| Prompt templates as skill aliases | no standing-token gain: owner-invoked skills already cost nothing until used |
| `pi-durable`, `@earendil-works/pi-env`, `chord`, `apps/p3` | an experimental SDK, a remote environment for Durable only, an app framework, design notes |
| A lexical routing test of skill descriptions (TF-IDF) | it passed while small models did not load the skills, and each new skill needed sample prompts; `tests/live/eval.mjs --load-only` measures loading on real models |

## Later, measure first

Ideas that may pay, kept here so they are measured before anyone builds them:

| Idea | Expected gain | Measure first |
| --- | --- | --- |
| Defer the web tools behind pi's `tool_search` | about 450 tokens per request | how often a session needs the web tools, and the cost of the extra search turn when it does |
| Let the guard read MCP tool annotations (read-only, destructive) | asks and blocks for MCP tools, which today pass by name only | only once MCP servers are used with pitcrew |
