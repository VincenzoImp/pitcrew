# Install and update

pitcrew is one pi package. You need Node 22.19 or later and pi (the version pitcrew is tested with is
in [UPSTREAM.md](../UPSTREAM.md)), logged in to at least one model provider (`/login` in pi, an API
key, or a local server).

## Install

From npm, once the package is published:

```sh
npx @vincenzoimp/pitcrew init
```

From a clone (works today):

```sh
git clone https://github.com/VincenzoImp/pitcrew.git
cd pitcrew && npm ci --ignore-scripts
./bin/pitcrew init
```

In a terminal, `pitcrew init` asks at most two questions and prints one line per part (`ok`, `add`, `note`,
`option`, `skip`, `missing`). Run it again at any time: it changes only what is missing.
`--dry-run` shows what it would do; `--yes` takes the proposals without asking (the rules section
stays off unless you add `--rules on`). Without a terminal and without `--yes`, it sets no profile
and says so.

| Step | What it does |
| --- | --- |
| Node and pi | checks the versions; stops if one is missing |
| Package | `pi install <source>` when pi does not load pitcrew yet: the npm package when run with `npx`, else the folder it runs from |
| Settings | adds the keys of `config/settings.base.json` that `~/.pi/agent/settings.json` lacks ([settings.md](settings.md)); never changes a key you have. The previous file is kept as `settings.json.bak-pitcrew-init` |
| Profile | when `pitcrew.profile` is not set: the first example profile whose models are all available ([roles.md](roles.md)); you confirm it |
| Rules | asks whether to add pitcrew's global rules (`AGENTS.global.md`) to every session as a prompt section (`pitcrew.rules: on`). Default no. Your own `~/.pi/agent/AGENTS.md` stays yours and loads as well |
| Command | links `~/.local/bin/pitcrew` to the package's `bin/pitcrew`, and says if that folder is not on `PATH` |
| Optional parts | reports what is missing and how to add it: `gh` and its login, the Exa key, the Claude bridge, Docker and the sandbox image, the sandbox's Claude token, the browser for `browser-check` |

Other ways to install the package itself (then run `pitcrew init` for the rest):
`pi install npm:@vincenzoimp/pitcrew`, `pi install git:github.com/VincenzoImp/pitcrew`.

## Optional parts

| Part | Needed for | Add it |
| --- | --- | --- |
| `gh`, logged in | GitHub tracking, PRs, `pitcrew run`, `pitcrew tidy` | install the GitHub CLI, `gh auth login` |
| Exa key | `web_search` through Exa (free credit; [web.md](web.md)) | key in `~/.config/pitcrew/exa-key` (mode 600) or `EXA_API_KEY` |
| Claude bridge | Claude on a Claude subscription ([claude-access.md](claude-access.md)) | `pi install npm:pi-claude-bridge@<version in UPSTREAM.md>`, then `/profile claude-bridge` |
| Docker and the image | the sandbox of `pitcrew run` ([sandbox.md](sandbox.md)) | `pitcrew box build` |
| Claude token for the sandbox | Claude models inside the sandbox | `claude setup-token`, saved in `~/.config/pitcrew/claude-token` (mode 600) |
| Browser | the `browser-check` skill | `skills/browser-check/scripts/browser install-browser chromium` in the package (about 700 MB in `~/.cache/ms-playwright/`; `--with-deps` also installs system libraries on Linux, with sudo). Run it again after an upgrade of `@playwright/cli` |

Everything works without the Claude bridge: it is one way to reach Claude models. Without it, use
another profile (`anthropic` with an API key, `codex`, `openai`, `google`, `local`, or your own).

## Turn parts off

pitcrew is one package, but pi loads each part on its own, so you can turn parts off without
removing it: `pi config` lists its extensions and skills as toggles (`Tab` switches to the project
scope). In `settings.json` the same is a filter on the package entry, for example no web tools and
no `browser-check` skill:

```json
{ "packages": [ { "source": "npm:@vincenzoimp/pitcrew",
    "extensions": ["!extensions/web/index.ts"], "skills": ["!skills/browser-check"] } ] }
```

The guard and the verify gate are parts like the others: turning them off removes their protection
([guard.md](guard.md)).

## Update

- npm: `pi update npm:@vincenzoimp/pitcrew` (or `pi update --extensions`). pi shows the new
  [CHANGELOG](../CHANGELOG.md) entries at the next start.
- A clone: `git pull --ff-only && npm ci --ignore-scripts` in it.

Open sessions keep the old code until `/reload`. Then run `pitcrew init` once more: a new version
may add a baseline key.

## Remove

`pi remove <the source in pi list>`, then `rm ~/.local/bin/pitcrew`. The keys under `pitcrew` in
`settings.json` and the work folders in `~/.pi/agent/pitcrew/` stay until you delete them
([footprint.md](footprint.md)).
