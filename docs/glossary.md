# Glossary

One word for one thing, in the skills, the global rules, the docs and the code comments. When two
words seem to fit, use the one here.

| Term | Meaning | Not |
| --- | --- | --- |
| owner | the person who runs pitcrew and decides | user (except "the user" of the product being built) |
| session | one pi conversation with its own mode and role map | |
| lead | the role of the model you talk to in a session | main, parent model |
| role | a model slot: `lead`, `worker`, `scout`, `reviewer`, `second`. Skills and agents name roles, never models | model (for a role) |
| profile | a file that gives each role a model and a thinking level (`profiles/*.json`) | |
| agent | a definition in `agents/*.md` (`worker`, `scout`, `reviewer`, `researcher`): prompt, tools, role, skills. Also the `agent` tool that starts one | role (for an agent) |
| child | a running instance of an agent: its own pi process and session file. The session that started it is its parent | subagent (only in user-facing headings and the first lines of the README), worker (for any child) |
| report | a child's final message, also saved as `report.md` in its run folder | result |
| skill | a `skills/<name>/SKILL.md` of method for one kind of work | |
| model-picked skill | its description is always in context and the model loads it when the work matches | auto skill |
| owner-invoked skill | started only with `/skill:<name>` | manual skill |
| session mode | the dials and switches of one session, set by settings, flags and `/mode`. It reaches the model as a message in the conversation | mode (alone, when it could mean another setting) |
| dial | a mode value with several levels: `stop` (how far the agent goes alone), `rigor` (a preset of switches) | |
| switch | one check of the mode: `issueRequired`, `verify`, `review`, `leanCode` | gate (for a switch) |
| tracking | the repo setting for where plans live: `none`, `local`, `github`. On GitHub, the kind of object is chosen per piece of work | tracking dial |
| guard | the extension that blocks or asks before risky commands | |
| verify gate | the extension that runs the repo's verify command at the end of a turn that changed the tree | finish gate |
| receipt | the verify gate's record that a check passed on one tree | |
| runner | `pitcrew run`: the code loop that delivers issues unattended. Nothing else is called runner | driver |
| run folder | `<work folder>/runs/<session id>/`: the children of a session (one folder each: task, report, session file) and the verify receipts its process tree shares. The runner keeps its own under `runs/runner/<run id>/` | tree dir, run ledger (for the folder) |
| ledger | the state of a run: a child's `loadout.json` and `state.json` in its folder, or the runner's `<target key>.json` | |
| work folder | `~/.pi/agent/pitcrew/projects/<repo>-<hash>/` (or `pitcrew.workDir`): the harness's files for one repo, outside the repo | work dir |
| plans folder | `<work folder>/plans/`: local plans | |
| box | the sandbox container of `pitcrew box`; used by the runner for unattended work. Interactive sessions are never in it | pi-box |
| handoff | `/handoff`: a file that carries the state to a new session | |
| frontier | the open items that can start now: issues with no open blocker, or questions whose prerequisites are settled | |
| foreign repo | a repo the owner does not administer | |
