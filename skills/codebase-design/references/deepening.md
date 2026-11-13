# Deepening

How to turn a cluster of shallow modules into one deep module safely, given its dependencies. Uses
the vocabulary of the `codebase-design` skill: module, interface, seam, adapter.

## Dependency categories

Classify each dependency of the candidate. The category decides how the deep module is tested
across its seam.

### 1. In-process

Pure computation, in-memory state, no I/O. Always deepenable: merge the modules and test through
the new interface directly. No adapter needed.

### 2. Local stand-in

Dependencies with a local test stand-in: an embedded or in-memory version of the database, an
in-memory file system, a local emulator. Deepenable if the stand-in exists and is fast. The tests
run with the stand-in. The seam is internal; the module's external interface has no port for it.

### 3. Remote but owned (ports and adapters)

Your own services across a network: internal APIs, other services, queues. Define a **port** (an
interface) at the seam. The deep module owns the logic; the transport is injected as an
**adapter**. Tests use an in-memory adapter; production uses an HTTP, RPC or queue adapter.

The recommendation reads: "Define a port at the seam, with an HTTP adapter for production and an
in-memory adapter for tests, so the logic sits in one deep module even though it runs across a
network."

### 4. True external

Third-party services you do not control (payments, messaging, a hosted model API). The deep module
takes the service as an injected port; tests use a fake adapter. See the `tdd` skill's
`references/mocking.md` for the choice of double.

## Seam discipline

- **One adapter is a hypothetical seam; two make a real one.** Add a port only when at least two
  adapters are justified (usually production and test). A seam with one adapter is indirection.
- **Internal seams stay internal.** A deep module can have private seams used by its own tests.
  Do not expose them through the interface because a test uses them.

## Testing: replace, do not layer

- Once tests at the deep module's interface exist, the old unit tests on the shallow modules are
  waste: **delete them**.
- Write the new tests at the deep module's interface. The interface is the test surface.
- Tests assert on outcomes seen through the interface, never on internal state.
- Tests survive internal refactors because they describe behaviour. A test that must change when
  the implementation changes reaches past the interface.

## Migration

- Keep the build green at each step. When callers are many, add the deep module beside the old
  ones, move callers in batches, then delete the shallow modules.
- `grep` every caller before you delete anything, including tests, fixtures, configuration and
  string or dynamic references.
- Code you move keeps its error handling and validation.
