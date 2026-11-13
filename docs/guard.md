# Guard

`extensions/guard/` checks every `bash`, `read`, `write`, `edit`, `grep`, `find` and `ls` call against
deterministic rules (`rules.ts`, tested in `tests/guard*.test.mjs`). It catches mistakes; it is not a
sandbox.

## Verdicts

- **block**: the call never runs and the turn ends.
- **ask**: a confirm dialog. Without a UI (strict mode) an ask is a block.

## Rules

- **block**: recursive delete of `/`, `~`, system dirs, the project itself (also through
  `find -exec rm`, `mv ~ …`, `sudo -u`, `env`, `timeout`, `sh -lc`, here-documents fed to a shell);
  remote or decoded code run by a shell (`curl … | sh`, `bash <(curl …)`, `base64 -d | sh`); disk tools;
  reboot, `kill -1`; `git push --force`; sleepless busy-wait loops (`while :; do :; done`).
- **ask**: `sudo`; deletes and writes outside the project and temp dirs, also by bash (`>>`, `tee`, `cp`,
  `mv`, `sed -i`, `git config --global`); `.git` internals; credential files and dirs; `git push`,
  `reset --hard`, `clean -f`, `checkout -f`, `pitcrew tidy --force`; publishing; GitHub writes (`gh api` non-GET, except a GraphQL `query`, `pr merge`,
  `workflow run`); global installs; Docker runs that reach the host (`--privileged`, host mounts,
  `docker.sock`); persistence (`crontab`, `systemctl enable`); database and infra destroy;
  `guard-bypass` (`PI_GUARD_*=…`, `env -u PI_GUARD_*`, `unset PI_GUARD_*`, `git -c core.hooksPath=…` or
  `core.fsmonitor=…`, `pi --no-extensions`, `claude --dangerously-skip-permissions`).
- **ask `secret`** (token prints; a printed token lands in the model context and the session file):
  `gh auth token`, `gh auth status -t`, `printenv` with no name or a secret name, bare `env`,
  `export -p`, `set`, `/proc/*/environ`, and any `$NAME` expansion where the name matches
  `TOKEN|SECRET|PASSWORD|API_KEY|_KEY|CREDENTIAL|AUTH…` (`echo $GH_TOKEN`).
- **ask `publish`**: `pitcrew run` and `pitcrew box` anywhere in a command (also behind `nohup`,
  `node …`); `gh issue|pr create|comment|edit`.
- **Delivery rules** (`delivery.ts`, tied to the session mode): a PR must close an issue; merge only
  inside the stop dial, with `--match-head-commit` on a verified head, never `--admin`; foreign
  repos; caps on worktrees and disk use. Inside the stop dial they also skip the usual asks for a
  push, a PR and a merge in your own repo. Details: [delivery.md](delivery.md).
- Not covered (the sandbox covers these): inline interpreter code (`python -c …`), network exfiltration
  of non-file data, symlinked `rm` targets.

**Runner workers** (`PITCREW_RUNNER_ROLE=worker`, set by `pitcrew run`) also get blocks for runner-only
actions: `gh pr merge`, `gh api -X DELETE`, `--admin`, releases, any push to the base branch
(`PITCREW_RUNNER_BASE`), every token print listed above, and a nested `pitcrew run` or `pitcrew box`. These hold
even when `PI_GUARD_ALLOW` lists `git-push` or `publish`. Details: [runner.md](runner.md).

When a block or a declined ask ends the turn, the guard adds a visible `guard-blocked` message: what
was stopped, and that nothing after that call ran. It starts no new turn.

## Modes

- `/guard off`: skip the confirm dialogs for this session. Blocks and `guard-bypass` asks stay. The
  footer badge turns red (`guard off`).
- `/guard on` turns the dialogs back on; `/guard` shows the state. The state is saved in the session.
- **Strict**: runs without a UI (`pi -p`, `--mode json`) and processes started with
  `PI_GUARD_STRICT=1` (children of a session with no human, runner workers, the sandbox) never ask:
  an ask is blocked, the third such block ends the run, and `/guard off` is ignored. Children of a
  session with a human pass their asks up to it ([agent.md](agent.md)). Pre-approve rule ids with
  `PI_GUARD_ALLOW=git-push,publish pi -p …`; `guard-bypass` cannot be pre-approved.

Footer status `pitcrew.guard`: `guard` or `guard off`, plus counts of blocked calls and asks
(`guard 1✗ 2?`).

## Outside corpus

`tests/guard-corpus.test.mjs` runs the guard against 70 example commands from the blocked-commands
catalogue listed in `THIRD_PARTY_NOTICES.md` (examples only, no code), plus 6 everyday commands of our own next to the
newer rules. 48 dangerous ones must be flagged, 19 everyday ones must pass, and 9 are
listed as not flagged:

- **By design** (work inside a subfolder of the project is not catastrophic): `rm -rf .`, `rm -rf *`,
  `find . -delete`, `find . -exec rm -rf {} +` in a subfolder; `shred` of a project file.
- **Not covered by pattern rules** (the sandbox covers these): inline interpreter code, and
  commands assembled at run time (`$(printf r)m`, `c=rm; "$c"`).

Covered since the corpus was first run (now in the flagged list): `find .git -delete` and `rm -r .*` (ask: `.git`, and
`..` in some shells); `parallel rm -rf ::: /` (each `:::` argument is checked as its own command:
block); a shell function or brace group that deletes its argument (`f() { rm -rf "$1"; }`: ask, an
unresolved path); a git alias that runs a shell (`git -c alias.x='!cmd'`: `cmd` is checked); a file
downloaded and run in the same command line (`curl -o i.sh … && bash i.sh`, `wget …; sh i.sh`,
`./i.sh`: block, like `curl | sh`); a cloud metadata address (`169.254.169.254`,
`metadata.google.internal`, and the ECS, Alibaba and IPv6 forms: ask `secret`). Downloading alone,
`parallel gzip ::: …`, `git -c alias.st=status st` and `{ npm test; }` still pass.

## Turn off

Completely: `pi config` (disable `extensions/guard/index.ts`). There is no setting that removes the
block floor.
