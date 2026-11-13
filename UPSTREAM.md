# Upstream

Versions this harness is built and tested against. pi and the Claude bridge are pinned in one
place, `box/package.json` (with its lock file); the dev dependency in `package.json` must match it
(a unit test checks), and the live tests install the bridge from it. An upgrade is a pull request
that changes those pins and this table, and records the tests that were run again.

| Package | Version | Role |
| --- | --- | --- |
| `@earendil-works/pi-coding-agent` | 1.5.2 (`box/package.json`) | the agent |
| `pi-claude-bridge` | 0.12.0 (`box/package.json`) | Claude subscription access (see `docs/claude-access.md`) |
| `pi-rewind-hook` | 1.8.8 | checkpoints and rewind |
| `@mozilla/readability` | 0.6.0 | `web_fetch`: article extraction |
| `linkedom` | 0.18.15 | `web_fetch`: HTML parsing for Readability |
| `turndown` | 7.2.5 | `web_fetch`: HTML to Markdown |
| `undici` | 8.12.4 | `web_fetch`: HTTP with the validated address pinned |
| `unpdf` | 2.1.0 | `web_fetch`: PDF text |
| `@playwright/cli` | 0.1.24 | `browser-check` skill: headless browser (Apache-2.0); needs the browser build this version expects (`browser install-browser`, see `docs/install.md`) |

Text and code copied from other projects, with their licences, and the projects that inspired
the design are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
