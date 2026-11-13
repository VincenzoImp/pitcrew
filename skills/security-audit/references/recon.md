# Recon, the map and the coverage ledger

Phase 1 of a full audit.

## The four recon scouts

Start four `scout` agents in one turn. They read the target and the locally available build and
configuration state only, return facts with `path:line`, and write nothing. They do not contact
deployed endpoints, identity providers, registries, brokers, cloud APIs or other shared services.

**1a: product, stack and local operation**

```
Read the target at <path>. Do not use the network. Return:
1. Product type, users, operators, and the ordinary trust-sensitive actions.
2. Languages, frameworks, build system, runtimes, and the deployment models visible in the repo.
3. Entry points and subsystem boundaries (repository-relative paths).
4. Exact build and test commands that could run offline with the local dependencies, where they
   write, and which target-controlled inputs they process. Do not run them.
5. Comparable software or protocol visible in the local docs and dependencies, if a useful one is
   grounded in the source; else say there is none.
6. Missing toolchains or runtime facts that limit local checks.
Only source facts, each with a repository-relative path:line.
```

**1b: principals, authority and controls**

```
Read all source that establishes identity, authorization, isolation and privilege in <path>. Map:
1. Each lower-trust principal and the actions it has by design.
2. Authentication or peer identity at each entry surface.
3. Per-resource authorization and tenant or owner scope.
4. Process, browser, workload, CI, plugin, model/tool, device or local-IPC authority.
5. Privilege changes, confirmation, revocation, recovery and fallback paths.
6. Which controls the source shows, and which depend on a deployment fact it does not show.
Return trust boundaries and control locations with path:line. Do not infer live reachability.
```

**1c: entry surfaces, copies and sinks**

```
Inventory every place in <path> where external or lower-trust input enters: HTTP/browser,
RPC/message/protocol, files/archives/documents, CLI/env/config, plugins/dependencies/CI, cloud
events/IAM selectors, model context/tool arguments, mobile/deep links/webviews, local IPC.
For each surface, follow the main transformations, stored or derived copies, and security-relevant
sinks. Record limits the source shows and parallel paths to the same effect.
Return path:line. Be complete; do not run anything or send inputs.
```

**1d: local execution and deployment visibility**

```
Read the tests, build definitions, manifests, packaging and environment overlays in <path>. Return:
1. Small offline tests or fixtures that could check trust boundaries with dummy data in a sandbox.
2. Processes that could run on an isolated loopback with no external or shared dependency.
3. Commands that would fetch dependencies, publish, call paid or provider APIs, or change shared
   state; mark them forbidden for this run.
4. Deployed controls the source cannot establish (needs_validation if decisive).
5. The active source path for each deployment mode, where the repo selects it deterministically.
```

Add a focused scout for a deployment mode or subsystem these four do not map, only after the budget
check. If the budget cannot pay it, seed that area as a `deferred` unit and say so in the report.

## The map

You write `map.md`, about 1,000 words at most:

1. Product, principals, their normal authority, and the protected resources.
2. The comparable software from 1a, if grounded: which security trade-offs it accepts. It
   calibrates effort and severity; it never dismisses a demonstrated finding (a shared defect
   pattern that mattered in practice strengthens a finding).
3. Stack, deployment paths visible in source, and what can run offline.
4. Entry surfaces and the important source-to-sink and lifecycle paths.
5. Trust boundaries and the strongest control the source shows on each.
6. Starting paths (repository-relative).
7. Prior coverage gaps, revalidation targets, and unchanged confirmed records excluded from hunting.
8. The class files selected, and the boundary that requires each.

Select a class file because recon found the boundary its "When to use this file" section
describes, never because a language or dependency name appears. Do not exclude a visible boundary
because another hunter covers a related class.

## The ledger

`ledger.json` is a JSON array of units, sorted by `id`. One unit per material combination of entry
surface, trust boundary, subsystem and attack class, at the granularity of the profile (`quick`
uses `"all in scope"` for the subsystem; `deep` adds a lifecycle mode). The ledger is the coverage
claim: a map, an agent count or "auth reviewed" is not evidence of coverage.

```json
{
  "id": "src/router.ts#POST /users/:id::src/authz.ts#requireOwner::packages/api::attack-classes.md#Access control",
  "surface": "src/router.ts#POST /users/:id",
  "boundary": "src/authz.ts#requireOwner",
  "subsystem": "packages/api",
  "attack_class": "attack-classes.md#Access control",
  "starting_paths": ["src/router.ts", "src/authz.ts"],
  "blocks": ["attack-classes.md#Access control", "web-protocol-and-auth.md#Core discipline"],
  "excluded": [{ "block": "client-side.md", "reason": "no browser code in scope" }],
  "prior": "none",
  "wave": 1,
  "status": "planned",
  "agent": null,
  "reviewed_paths": [],
  "checks": [],
  "fingerprints": [],
  "unresolved": [],
  "attempts": []
}
```

- `surface`, `boundary`, `subsystem`, `attack_class` are stable references derived from the source:
  a path plus a route, export or symbol; the control that defines a boundary; a package path; the
  class block as `<file>#<class name as written>`. Use the same reference for the same object in
  every run. `id` is the four joined with `::` (add `::<lifecycle>` when a lifecycle field is set).
  No wave, agent, verdict, severity or line number in an id.
- `blocks`: the class blocks the hunter gets; for a domain file, also its `Core discipline`,
  `Universal moves` and `Validation rules`. `excluded`: every block considered and left out, with
  the source fact that excludes it.
- `prior`: `none` (no earlier ledger), `new`, or the prior state that created this unit
  (`prior_confirmed_same_source`, `prior_confirmed_changed_source`, `prior_needs_validation`,
  `prior_deferred`, `prior_blocked`, `prior_out_of_scope`, `prior_covered_same_source`,
  `prior_covered_changed_source`, `prior_rejected_claim_changed`).
- `checks`: one per invariant checked: `{ "agent", "reviewed_paths", "invariant", "method":
  "source" | "local", "result", "artifact" }`. `artifact` is null for a source check; for a local
  check it names the file in the run folder that holds the command, input and output.
  `reviewed_paths` of the unit is the union of its checks' paths.

State table (the check script enforces it):

| `status` | `agent` | `reviewed_paths` and `checks` | `fingerprints` | `unresolved` |
| --- | --- | --- | --- | --- |
| `planned` | null | empty | empty | empty |
| `not_applicable`, `out_of_scope`, `deferred` | null | empty | empty | the reason |
| `in_progress` | the hunter | empty | empty | empty |
| `blocked` | the hunter | partial evidence | empty | the blocker |
| `covered` | the hunter | evidence | empty | empty |
| `candidate` | the hunter | evidence | the candidates | optional |

`attempts` is an append-only archive: when a critic reopens a unit that has evidence (`blocked`,
`covered`, `candidate`), copy its `wave`, `status`, `agent`, `reviewed_paths`, `checks`,
`fingerprints`, `unresolved`, and the critic's reason as `reassignment_reason` into `attempts`, raise `wave`, and give the
unit a fresh hunter with empty live evidence. Never copy an old attempt's checks into the new one.

Run `node <this skill's folder>/scripts/check-audit.mjs ledger <run>/ledger.json` after seeding, after every update, and
before the report. An invalid ledger cannot drive another assignment.

## Prior runs

Before planning, read every earlier `ledger.json` and `findings.json` of the same repo.

- Compare each prior record and unit with the current source. A prior source ref alone does not
  prove a path unchanged.
- An unchanged prior `confirmed` record: carry it, with the same fingerprint, linked to a current
  `planned` unit with `prior: "prior_confirmed_same_source"`. Exclude only that root cause from
  hunting. The phase 3 verifier that re-checks it owns the unit.
- A prior `confirmed` record whose source or conditions changed: a planned revalidation unit
  (`prior_confirmed_changed_source`). Do not exclude it from hunting.
- Prior `needs_validation`, `deferred`, `blocked`, `out_of_scope` and changed-source units become
  current work. A still-blocked `needs_validation` record is carried only after its trace is checked
  against the current source, and keeps its blocker.
- A prior `rejected` record suppresses only that exact claim while its evidence is unchanged, not
  the coverage of its unit.
- A prior `quick` or scoped ledger contributes its evidence and gaps, never an implied "the rest is
  fine". Record missing or incompatible ledgers instead of treating them as empty coverage.
