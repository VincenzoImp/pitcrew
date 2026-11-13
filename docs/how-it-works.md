# How it works

Three pictures of pitcrew: what a session is made of, how the lead works with child agents, and
how a piece of work goes from an issue to a merged change.

## A session: profile, roles, mode

A session starts with a **profile** that gives each **role** a model and a thinking level. You
always talk to `lead`; children and summaries use the other roles. The **session mode** says how far
the agent goes alone (`stop`) and which checks run (`rigor`). Each session has its own; `/profile`,
`/role` and `/mode` change it for that session only.

```mermaid
flowchart LR
  subgraph settings["Where the profile comes from (first match wins)"]
    direction TB
    F["flags: --profile, --stop, --rigor"] --> E["the parent session, PITCREW_PROFILE"]
    E --> S["the saved session"]
    S --> C["pitcrew settings: repo, then global"]
    C --> D["default: first profile that works"]
  end
  settings --> P["Profile"]
  settings --> M["Session mode"]
  P --> R1["lead"]
  P --> R2["worker"]
  P --> R3["scout"]
  P --> R4["reviewer"]
  P --> R5["second (optional)"]
  M --> ST["stop: plan, local, pr, merge, milestone"]
  M --> RG["rigor: fast, standard, strict"]
  RG --> SW["switches: issueRequired, verify, review, leanCode"]
```

The mode comes from the same places in a slightly different order: flags, then the saved session,
then the parent session, then the settings ([mode.md](mode.md)). Details: [roles.md](roles.md).

## The lead and its agents

The lead starts **children** with the `agent` tool: each is its own pi process with the guard, the
roles and the verify gate loaded, and it sees only its task. Children run in the background; their
reports come back as one message. You watch and steer them in `/agents`.

```mermaid
flowchart TB
  you(["You"]) <--> lead["lead session"]
  lead -- "agent start" --> sc1["scout: read an area"]
  lead -- "agent start" --> sc2["scout: read another area"]
  lead -- "agent start" --> rv["reviewer: fresh check"]
  lead -- "agent start" --> wk["worker: a bounded change"]
  wk -- "may start" --> sc3["scout"]
  sc1 & sc2 & rv & wk -- "report.md" --> lead
  you -. "/agents: watch, steer, answer, stop" .-> sc1 & sc2 & rv & wk
  guard{{"guard: blocks or asks"}} -.- lead & wk
```

Details: [agent.md](agent.md), [guard.md](guard.md).

## Delivery: issue to merged change

One procedure for every piece of work. The `stop` dial says where the agent stops and hands over;
`rigor` says which checks run on the way. `pitcrew run` does the same loop unattended, one issue at
a time.

```mermaid
flowchart LR
  I["Issue"] --> B["Branch (worktree)"]
  B --> W["Change + tests"]
  W --> V{"verify gate:<br/>repo's checks pass?"}
  V -- "no: fix rounds" --> W
  V -- "yes" --> PR["Pull request<br/>Closes #issue"]
  PR --> RV{"review<br/>(by the review switch)"}
  RV -- "changes" --> W
  RV -- "ok" --> MG["Merge on the checked commit"]
  MG --> T["pitcrew tidy:<br/>worktree, branches removed"]
  B -. "stop local" .-> X1(["you take over"])
  PR -. "stop pr" .-> X2(["you review and merge"])
  T -. "stop merge, milestone" .-> X3(["done; at milestone: the next issue"])
```

Details: [delivery.md](delivery.md), [runner.md](runner.md), [verify-gate.md](verify-gate.md).
