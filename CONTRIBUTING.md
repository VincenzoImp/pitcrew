# Contributing

Thanks for helping. pitcrew is small on purpose: a change has to earn its place.

## Before you start

- **Bug**: open an issue with the bug template (pi version, profile, the steps, what you saw).
- **Feature**: open an issue first and say which real use it serves. Read
  [docs/decisions.md](docs/decisions.md): it lists ideas that were considered and left out, and why.
- Security problems go through [SECURITY.md](SECURITY.md), not an issue.

## Set up

```sh
git clone https://github.com/VincenzoImp/pitcrew.git
cd pitcrew && npm ci --ignore-scripts
npm run check
```

Node 22.19 or later. `npm run check` runs every unit test (`tests/*.test.mjs`, Node's test runner),
and it must end with `fail 0`.

To try your change in pi without touching your installed copy, use a throwaway agent dir:
`eval "$(tests/live/agent-dir.sh local)"`, then `pi`. It loads your clone, reuses your logins from
`~/.pi/agent`, and prints the folder it made; remove that folder when done. Work in a git worktree of your clone, not in the copy pi loads every day.

## One issue, one branch, one pull request

- One pull request does one thing and closes its issue (`Closes #12` in the body).
- Keep it small. `pitcrew check` reports size, the test-to-code ratio and `shortcut:` markers.
- New logic gets a test; do not weaken a test to get green.
- Docs change with the code: each mechanism has one page in `docs/`, and
  [docs/defaults.md](docs/defaults.md) is generated (`node scripts/defaults.mjs > docs/defaults.md`).
- A change that names a model or vendor in `extensions/`, `lib/`, `bin/` or a skill fails the
  checks: only `profiles/` names models.

## Live tests

Some behaviour needs a real model, terminal or GitHub repo. The scripts are in `tests/live/`
(`eval.mjs` for skills, `fidelity.sh` for prompt channels, `box-escape.sh` for the sandbox), and
[docs/TESTS.md](docs/TESTS.md) records each check with the model that ran it. If your change
affects one of them, run it and add a row. A local model or a small one at low thinking is enough
for most checks.

## Releases

For maintainers. npm gets the package only through
[.github/workflows/publish.yml](.github/workflows/publish.yml), with npm trusted publishing: there is
no npm token.

1. A pull request bumps `version` in `package.json` and `package-lock.json` (`npm version X.Y.Z
   --no-git-tag-version`) and adds a `## [X.Y.Z] - <date>` section to `CHANGELOG.md`. pi shows that
   section to users after an update.
2. Merge it.
3. Tag the merge commit on `main` and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. The workflow runs `npm run check`, fails if the tag is not `v` + the `package.json` version or
   not on `main`, stages the package (`npm stage publish`), and creates the GitHub release with the
   notes of the `CHANGELOG.md` section.
5. A maintainer approves the staged version on npmjs.com (**Staged Packages**, with 2FA), or with
   `npm stage approve <stage-id>`. Only then is it public.

## Style

Simple Technical English in docs, comments and messages: short sentences, one word for one thing
([docs/glossary.md](docs/glossary.md)). Follow the code around your change.

By contributing you agree that your work is released under the [MIT licence](LICENSE), and you
follow the [code of conduct](CODE_OF_CONDUCT.md).
