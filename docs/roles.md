# Roles and profiles

A **role** is a job name. Skills, prompts and agents use role names only.

| Role | Job |
| --- | --- |
| `lead` | the agent you talk to |
| `worker` | writes code on a bounded task |
| `scout` | reads, searches, explores; cheap, many at once |
| `reviewer` | checks work with fresh context |
| `second` | optional opinion from another vendor |

A **profile** is a file that gives each role a model and a thinking level:

```json
{
  "lead": { "model": "provider/model-id", "thinking": "high" },
  "worker": { "model": "provider/model-id", "thinking": "medium" },
  "scout": { "model": "provider/model-id", "thinking": "low" },
  "reviewer": { "model": "provider/model-id", "thinking": "high" }
}
```

`lead`, `worker`, `scout` and `reviewer` are required. `second` is optional.

## Where profiles live

Later places replace a profile of the same name.

1. `profiles/` in this package: examples, one per way of reaching a model family, each on one
   provider. `claude-bridge` (Claude on a subscription through `pi-claude-bridge`), `anthropic`
   (Claude through pi's own `anthropic` provider: an API key or `/login`), `codex` (the ChatGPT
   subscription, `openai-codex`), `openai` (an OpenAI API key), `google` (a Gemini API key), `local`
   (a llama.cpp server). The model ids are in pi 1.5.2's catalog; `claude-bridge`, `codex` and
   `local` were run live ([TESTS.md](TESTS.md)). A local profile names the model your server has.
2. `~/.pi/agent/profiles/<name>.json`: yours, for every repo.
3. `<repo>/.pi/profiles/<name>.json`: for one repo; read only in your own repos (admin permission) or
   one you said yes to with pi's `/trust`, because a profile routes every request of the session.

## Choosing

Each role is a pi model named `role/<role>`. Use `role/lead` as the default model.

| When | How |
| --- | --- |
| At start | `pi --profile local`, or `PITCREW_PROFILE=local pi` |
| Default for a repo or for every repo | `"pitcrew": { "profile": "local" }` in `settings.json` |
| In a session | `/profile local` |
| One role, in a session | `/role lead provider/model-id:high`, or `/role lead` and pick from the list |
| Only the level of a role | `/role scout :medium` |
| See the current map | `/profile` or `/role` |

Tab completes the arguments: `/role ` offers the roles, `/role lead ` every model pi can use now
(subscription, API key or local server), `/role lead <model>:` the thinking levels, `/profile ` the
profile names. `/role lead` with no model opens a list of the same models.

Order when several apply: `--profile`, the map inherited from a parent session, `PITCREW_PROFILE`,
the map saved in a resumed session, the setting `pitcrew.profile`.

**Default rule**: when none of these names a profile, the session takes the first of `claude-bridge`,
`codex`, `anthropic`, `openai`, `google`, `local` whose models are all available (subscriptions
first, then API keys, then local). `pitcrew init` writes the one it finds into `pitcrew.profile`, so
a later login does not change it. If none works, the session says so and names the providers it has.

A mix of providers (for example Claude for most roles and another vendor for `second`) is a profile
of your own: copy an example to `~/.pi/agent/profiles/<name>.json`, change the models, and set
`pitcrew.profile` to `<name>`.

## Rules

- A change made with `/profile` or `/role` belongs to that session. Other sessions keep their map.
  The map is saved with the session and comes back on resume. A changed profile shows as `name*`.
- Child sessions get the parent's map through the environment variable `PITCREW_ROLES`.
- There is no fallback. If a model is missing, the request fails with the reason. A local model is
  used only when a profile or `/role` names it.
- `/new` and `/handoff` open the next session with the same map, changes included.
- Thinking level: a session started with `pi` and a switch to another role take the level of the role. After that,
  `/thinking` or `--thinking` changes it for the session as usual.
- Only roles are in the model cycle (Ctrl+P): `enabledModels` is `["role/*"]`. A local model is not a
  role. Like a Claude or Codex model, it answers behind a role: `/role lead llama.cpp/<id>` for one
  session, or a profile that names it (`local`, your own). `/model` still lists every model.
- A local llama.cpp router that holds one model at a time reloads when two different local models
  are in use, in one session or in two.


## Summaries

A request outside the agent loop (pi's own compaction summary, a `/tree` branch summary, an
extension's direct call on a role) is summary work: whichever role is selected, the `scout` role's
model answers it, at the scout's level. The harness's own compaction summary already uses `scout`.
