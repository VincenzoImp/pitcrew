# Sandbox

The whole pi process in a hardened Docker container, on a throwaway clone of one repo, with a
filtered network and no real credential inside. `pitcrew run` uses it by the runner setting
`pitcrew.runner.sandbox`: `foreign` (repos you do not own; the default), `always`, `off`. Interactive
sessions are never sandboxed. Code: `lib/box.ts`, `box/` (image, egress
proxy), `bin/pitcrew`.

## Switch it on or off

| Where | How |
| --- | --- |
| Every run | `pitcrew.runner.sandbox` (default `foreign`: a repo that is not yours runs in the box) |
| One run | `pitcrew run <target> --sandbox always` (or `off`, `foreign`) |
| A repo of yours, every run | `"pitcrew": { "runner": { "sandbox": "always" } }` in `<repo>/.pi/settings.json` |
| By hand | `pitcrew box run <repo> -- -p "…"`, `pitcrew box shell <repo>`, `pitcrew box exec <repo> -- npm test` |

With `off`, or in your own repo at `foreign`, `pitcrew run` keeps its workers on the host.

## What the runner does with it

The worker runs as `pitcrew box run --workdir <worktree> --stdin --run-dir <dir> -- --mode rpc …`:
the same RPC child as on the host, inside the box. Its commits come back by a fast-forward of the
worktree's branch. The verify command (and `pitcrew.runner.setup`) runs with `pitcrew box exec`, so
code the worker wrote never runs on the host. The runner keeps every push, PR and merge on the
host. The reviewer stays on the host with read-only tools. The worker's run folder (session,
report) is in `~/.cache/pitcrew/runs/` (the box may not mount anything under `~/.pi`).

## Commands

```
pitcrew box build                                         image pitcrew-box:<pi version> from box/
pitcrew box run [opts] <repo> -- [pi args]                pi on a clone; new commits come back as branch box/<id>
pitcrew box run [opts] --workdir <worktree> -- [pi args]  pi on a clone of a clean linked worktree; commits fast-forward it
pitcrew box exec [opts] (<repo>|--workdir <dir>) -- CMD   a command, no model, no token; nothing comes back
pitcrew box shell <repo>                                  bash in the same box
Options: --id ID --base REF --branch NAME --net proxy|open --allow HOST --timeout SEC --stdin
         --setup CMD --run-dir DIR --summary FILE
```

Stdout is the command's own; the box writes only to stderr (the clone, the pitcrew commit, the
allowed hosts, the log folder, the start-up time). Exit code: the command's, or 1 when the result
could not be applied. Summary: `~/.local/state/pitcrew/<id>/run.json`, egress log next to it.

## What the box gets

| Item | Value |
| --- | --- |
| Image | `box/Dockerfile`: `node:24-bookworm-slim` by digest; git, ripgrep, jq, build-essential, python3; `box/package-lock.json` (pi 1.5.2, pi-claude-bridge 0.12.0) via `npm ci --ignore-scripts`; user `agent` uid 1000. 1.6 GB, built in 35 s |
| Flags | `--user 1000:1000 --cap-drop ALL --security-opt no-new-privileges --pids-limit 512 --memory 16g --cpus 8 --read-only --init`; tmpfs `/tmp` and `/home/agent` (fresh each run: nothing of an earlier run is there); no docker socket, no `--privileged`, no host network |
| Mounts | the clone at `/work` (never a host repo or `.git`); pitcrew without `.git`, read-only, at `/opt/pitcrew` (a clone: its current commit by `git archive`, in `~/.cache/pitcrew/pitcrew/<sha>`; an npm install: a copy without `node_modules`, in `~/.cache/pitcrew/pitcrew/npm-<version>`), its `node_modules` read-only; with `--run-dir`, that folder at `/home/agent/run` |
| Never mounted | home, `/`, `~/.pi`, `~/.claude`, `~/.claude.json`, `~/.ssh`, `~/.config/gh`, `~/.config/pitcrew`, `~/.local/state/pitcrew` (and the same paths under `pi-env`, the project's working name before the first release), `~/.codex`, `~/.aws`, `~/.gnupg`, `~/.docker`, `~/.kube`, `~/.git-credentials`, `~/.netrc`, `~/.npmrc`, `~/.password-store` (refused in code, on the path and its realpath) |
| Env | `PI_GUARD_STRICT=1`, `PI_GUARD_ALLOW=write-outside,rm-outside,global-install` (the container is the boundary for those), proxy variables, a placeholder `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_BASE_URL=http://egress:8080`; from the caller only `PITCREW_ROLES`, `PITCREW_MODE`, `PITCREW_SPAWNS`, `PITCREW_DEPTH`, `PITCREW_AGENT_LIMITS`, `PITCREW_RUNNER_ROLE`, `PITCREW_RUNNER_BASE`, `PI_VERIFY` |
| Settings | `box/settings.json`: the bridge and pitcrew, roles as models, project trust `never` |

The clone has no remote. Results come back by a host-side `git fetch` from the clone, which runs
`git upload-pack` there and so ignores the clone's hooks and config (git(1), SECURITY); before it,
the clone's `.git` must still be a plain directory. A box that rewrote history is not applied (the
result stays in `refs/pitcrew-box/<id>`).

## Network and the token

Each run gets its own internal Docker network (a free `/28` of `subnetPool`) whose only exit is the
run's egress proxy (`box/egress-proxy.mjs`, same image, hardened flags):

- `egress:3128`: HTTPS `CONNECT` on port 443 to `registry.npmjs.org`, `pypi.org`,
  `files.pythonhosted.org`, `github.com`, `codeload.github.com`, `objects.githubusercontent.com`,
  plus `allow` and `--allow` hosts (`*.domain` for subdomains). Everything else: 403.
- `egress:8080`: plain HTTP to the model API. The box holds a random placeholder token of the real
  token's shape; Claude Code (inside the bridge) sends its requests to this port
  (`ANTHROPIC_BASE_URL`); the proxy replaces the placeholder bearer with the real token and sends
  the request on over TLS to `api.anthropic.com`. The API host is not on the CONNECT list.

The real token is read from `~/.config/pitcrew/claude-token` (mode 600, never printed) and reaches
only the proxy container, through the `docker` process's environment (`-e NAME`, no value on a
command line). One JSON line per connection goes to `egress.log` (host, path, injected, status).

Remaining exposure: code in the box can still *use* the token through port 8080 while the run
lasts (it cannot read it, keep it, or send it anywhere); anyone in the `docker` group on the host
can read it with `docker inspect` of the proxy container (membership of that group is root access on the host anyway).
`--net open` turns the proxy off and puts the real token into the box (stated on stderr).

`exec` runs without any token. `web_search` and `web_fetch` do not work through the proxy; add
hosts with `--allow` for runs that need them.

## Measured (2026-11-12)

| What | Time |
| --- | --- |
| `pitcrew box exec <small repo> -- true` (clone, network, proxy, container) | 1.9 s (3 runs: 1.96, 1.93, 1.90) |
| `pitcrew box exec … -- pi --version` | 2.1 s (host: 0.12 s) |
| A runner worker in the box (Haiku, 4 turns) | 11 s, as on the host |

Clone time grows with the repo. It costs no tokens.

## Escape test

`tests/live/box-escape.sh <repo>` runs checks inside a box and prints one PASS or FAIL each: the
host home, SSH keys, other repos and the host `.git` are not visible; the clone has no remote;
pitcrew and the root file system are read-only; no docker socket; no credentials in home or env;
a host off the list, the model API directly, and a route around the proxy all fail; an allowed host
works. The token check is on the host side: the box's `CLAUDE_CODE_OAUTH_TOKEN` differs from the
real one (compared by hash).

## Docker Sandboxes (`sbx`) instead?

Tried and not adopted: on the test host it does not start without `/dev/kvm` access and a Docker
account, and its pi kit uses pi's own Anthropic login, not the bridge ([TESTS.md](TESTS.md),
Sandbox). This box starts in about 2 s, runs the bridge and the guard, and needs no machine change
or extra account. What must be maintained: `box/` (an image pin, a lock file, a 100-line proxy) and
`lib/box.ts` (about 350 lines).

## Settings

`pitcrew.box` in the global settings:

| Key | Default |
| --- | --- |
| `net` | `proxy` (`open`: no filter, real token in the box) |
| `allow` | `[]` (added to the default list) |
| `tokenFile` | `~/.config/pitcrew/claude-token` |

Fixed in `lib/box.ts`: image `pitcrew-box:<pi version>`, 16 GB memory, 8 CPUs, 512 processes, no
time limit of its own (the runner passes one), `~/.local/state/pitcrew` and `~/.cache/pitcrew`, the
guard rules allowed in the box (`write-outside,rm-outside,global-install`), subnet pool
`10.250.77.0/24`.

Bump: edit `box/package.json`, `npm install --package-lock-only --ignore-scripts` in `box/`,
`pitcrew box build`. Base image: `docker pull node:24-bookworm-slim`, put the new digest in
`box/Dockerfile`, rebuild. Remove: `docker image rm pitcrew-box:<version>`, and the two folders
above.
