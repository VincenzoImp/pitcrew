# Changelog

All notable changes to pitcrew. pi shows the entries newer than your installed version after an
update. Versions follow [semantic versioning](https://semver.org/); before 1.0, a minor version can
change settings or behaviour, and its entry says how to move.

## [0.1.2] - 2026-11-13

### Fixed

- The sandbox starts from an npm install. pi installs packages under `~/.pi`, which is never
  mounted, so `pitcrew box` and `pitcrew run` on a repo that is not yours stopped with "refusing to
  mount". The snapshot of an npm install now carries pitcrew's runtime dependencies, and a snapshot
  is built aside, so a failed build is never reused (#15).
- The test suite passes on macOS (#16).

## [0.1.1] - 2026-11-13

### Changed

- The verify gate and `pitcrew run` now find a repo whose only check is its `test` script: after
  `PI_VERIFY`, a `verify` or `check` script, a `verify` target and `scripts/verify`, they use the
  `package.json` `test` script (not the `npm init` placeholder), then a Makefile or justfile `test`
  target. Both say which command they chose and why.
- The docs install pitcrew with `npx @vincenzoimp/pitcrew init`; a clone is for working on pitcrew
  itself. `docs/sandbox.md` describes the sandbox mount of an npm install.

### Added

- Releases go to npm from a version tag through a GitHub workflow with npm trusted publishing (no
  token); a maintainer approves each staged version. The steps are in `CONTRIBUTING.md`.

## [0.1.0] - 2026-11-13

First public version, tested with pi 1.5.2. Earlier development versions were not released.

### Added

- Roles instead of model names (`lead`, `worker`, `scout`, `reviewer`, `second`), mapped to models
  by a profile per session. Example profiles for `claude-bridge`, `anthropic`, `codex`, `openai`,
  `google` and `local`; with none set, the first one whose models are all available.
- Session mode: the `stop` and `rigor` dials, four switches, and a per-repo `tracking` setting.
- Child agents (`worker`, `scout`, `reviewer`, `researcher`) through the `agent` tool, with the
  `/agents` panel to watch, steer, answer and stop them.
- The guard (blocks catastrophic commands, asks before risky ones, holds the delivery rules), the
  verify gate, compaction with a state block, and `/handoff`.
- `web_search` (Exa, then Codex) and `web_fetch` with private-address blocking.
- 14 skills, the footer with context, cache, cost and subscription windows, and `/stats`.
- The `pitcrew` command: `init`, `run` and `status` (unattended delivery of a milestone or label,
  resumable), `tidy`, `check`, and `box` (the sandbox container of `pitcrew run`).
