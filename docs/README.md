# pitcrew docs

## Start

| Page | For |
| --- | --- |
| [Getting started](getting-started.md) | install, a first session, a first piece of work |
| [Install and update](install.md) | `pitcrew init`, optional parts, turning parts off, update, remove |
| [How it works](how-it-works.md) | three diagrams: a session, the lead and its agents, delivery |
| [Troubleshooting](troubleshooting.md) | the failure modes seen in use, and what to do |

## Concepts

| Page | For |
| --- | --- |
| [Glossary](glossary.md) | one word for one thing |
| [Roles and profiles](roles.md) | `lead`, `worker`, `scout`, `reviewer`, `second`; which model answers for each |
| [Session mode](mode.md) | the `stop` and `rigor` dials, the switches, tracking |

## Mechanisms

| Page | For |
| --- | --- |
| [Agents](agent.md) | the `agent` tool, children, the `/agents` panel, limits, quota refusals |
| [Guard](guard.md) | what is blocked, what asks, strict mode |
| [Delivery](delivery.md) | issue → branch → PR → review → merge → tidy; the rules in code; `pitcrew tidy` and `pitcrew check` |
| [Verify gate](verify-gate.md) | "done" means the repo's own check passed on this tree |
| [Context](context.md) | `/handoff`, compaction, long runs |
| [Web](web.md) | `web_search` backends, `web_fetch` rules |
| [Skills](skills.md) | the 14 skills, how they are picked, how they are tested |
| [Footer and stats](status.md) | the footer, the quota file, `/stats`, session names and map |
| [Runner](runner.md) | `pitcrew run` and `pitcrew status`: unattended delivery |
| [Sandbox](sandbox.md) | `pitcrew box`: the container of the runner |
| [Claude access](claude-access.md) | the optional Claude bridge and which prompt channels pass it |
| [Files and layers](footprint.md) | where settings and working files live |

## Reference

| Page | For |
| --- | --- |
| [Commands](commands.md) | session commands, flags, keys, the `pitcrew` CLI |
| [Settings](settings.md) | the baseline pi settings, code mode |
| [Defaults](defaults.md) | every `pitcrew` setting and its default, generated from the code |
| [Decisions](decisions.md) | ideas considered and not used, and ideas to measure first |
| [Live tests](TESTS.md) | every live check and measurement, with the model that ran it |
