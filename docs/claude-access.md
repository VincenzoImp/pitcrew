# Claude access

Claude models on a subscription are reached through `pi-claude-bridge` (pinned in
[UPSTREAM.md](../UPSTREAM.md)). The bridge runs Claude Code under pi, so the request that reaches
Claude is not exactly the one pi built.

## What reaches the model (measured)

`tests/live/fidelity.sh` puts a marker in each instruction channel and asks the model which markers
it sees. Result on 2026-11-12 (pi 1.5.2, bridge 0.12.0), in `tests/live/fidelity.expected.txt`:

| Channel | pi native | Claude bridge |
| --- | --- | --- |
| Global rules (`~/.pi/agent/AGENTS.md`, or the `personal_defaults` section of `pitcrew.rules`) | yes | yes |
| Repo rules (`AGENTS.md`) | yes | yes |
| Skill descriptions | yes | yes |
| Tool descriptions | yes | yes |
| Tool results | yes | yes |
| Messages an extension adds to the conversation | yes | yes |
| Custom prompt sections (`systemPromptOptions.sections`) | yes | yes |
| `--append-system-prompt` | yes | yes |
| Tool `promptGuidelines` | yes | **no** |
| Tool `promptSnippet` | yes | **no** |
| A whole `systemPrompt` returned from `before_agent_start` | yes | **no** (dropped silently) |

Size: the same first request is about 3,000 tokens larger through the bridge (7,683 against 4,683 for
the lead with the rules section, [TESTS.md](TESTS.md)): that is the prompt Claude Code adds.

## Rule for this harness

Instructions go only in channels of the first group. No extension uses `promptGuidelines`,
`promptSnippet`, or returns a `systemPrompt`; a unit test checks this. What a tool needs the model to
know goes in the tool description.

## After an upgrade of pi or the bridge

Run `tests/live/fidelity.sh role/lead claude-bridge/<small model>:low` (one short turn each) and
compare with `tests/live/fidelity.expected.txt`. A difference is a change in behaviour: record it here
and in the expected file, and review the rule above.

## Not done

A byte-for-byte capture of the request on the wire needs a proxy between Claude Code and the API.
That routes subscription traffic through a local proxy; it is left out until the owner decides it
is worth the risk. The marker test shows what the model can see, which is what the harness depends on.
