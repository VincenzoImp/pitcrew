# Verify gate

`extensions/verify-gate/` runs the project's verify command when a run changed the git tree.

## Flow (each user message)

1. On the user message: record the tree id (`git add -A` into a temp index copied from the real one,
   then `git write-tree`; the real index is not touched; ignored files do not count).
2. At `agent_before_settle` (run completed, not aborted):
   - tree unchanged and no fix round in progress → nothing;
   - a receipt for this tree exists → no rerun (in this session, or a shared receipt from a process
     of the same session tree for the same command and root, below);
   - verify found, pi trusts the project in this session, and the repo is yours (admin permission)
     or you said yes to it with pi's `/trust`
     (or `PI_VERIFY` set) → run the command with `bash -c` inside a
     `{ … } 2>&1` group in the project root, with a timeout;
   - pass → receipt, status `verify ✓`, one visible line `verify ✓ npm run verify (3s) @tree 3f2a1c0` in
     the conversation (so the reply cannot claim that no check ran);
   - fail → receipt, the run continues with the output tail; after the fix rounds of the rigor
     (below) the failure is shown without a continuation;
   - otherwise → one reminder to run a check, unless a bash command that looks like a passing check ran
     after the last write (per segment; `cmd | tail` and `cmd || true` do not count).
3. Receipts are custom session entries `verify-receipt`; they survive resume and follow `/tree`.

## Once per tree (parent and children)

Every receipt is also appended to `verify-receipts.jsonl` in the run folder of the top session
(`PITCREW_TREE` in a child, else `<work folder>/runs/<session id>/`, [footprint.md](footprint.md)).
Any process of the same session tree takes a receipt for the same tree id, command and root instead
of running again:

- a worker child changes the tree; its own verify gate runs verify once (with fix rounds);
- the parent's verify gate, at the end of its turn, takes the child's receipt.

A child starts with `--no-approve`, so pi reports its project as untrusted and its gate alone would
only remind. The agent tool therefore hands the child the check the parent's gate would run (in
your own or a trusted repo) as `PI_VERIFY`; `pitcrew run` does the same for its workers.

A different command, another root, or a new tree runs. The file is not a security
control: a worker can write to it, as it can edit the verify script.

## Switches (session mode)

| Switch | Effect |
| --- | --- |
| `verify` | `on`: run verify; `remind`: only the reminder; `off`: nothing (`/mode verify off`) |

Automatic fix rounds per user message are fixed per rigor: `fast` 1, `standard` and `strict` 2.

## Setting

`pitcrew.verifyGate.timeoutSeconds` (default 300): verify is killed after this time, which counts as a failure.

`PI_VERIFY="make ci"` overrides discovery and runs in any repo. pi itself trusts every folder without
`.pi/` files, so a cloned foreign repo with a `check` script would pass pi's test: the gate asks for
your own repo or an explicit `/trust` yes, and otherwise only reminds the model.
Keep verify fast (format, lint, types, unit tests); leave slow suites to CI.

## For other extensions

`import { discoverVerify } from "../../lib/verify.ts"` returns `{ command, source, root }` or
`undefined`. It has no pi dependency.
