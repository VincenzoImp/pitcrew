# Security

## Reporting a vulnerability

Report it privately through GitHub: on this repository, open **Security → Report a vulnerability**
(<https://github.com/VincenzoImp/pitcrew/security/advisories/new>). Do not open a public issue for a
vulnerability.

Say what is affected (a guard rule, the sandbox, `web_fetch`, a skill, the CLI), how to reproduce
it, and what an attacker gains. You get an answer within a week. A fix goes into a new release, and
the advisory is published with it; you are credited unless you ask not to be.

## Supported versions

Only the latest release gets fixes.

## What pitcrew protects, and what it does not

pitcrew runs inside pi with your user's rights. Read these limits before you rely on it:

- The **guard** ([docs/guard.md](docs/guard.md)) catches mistakes with pattern rules. It is not a
  sandbox: inline interpreter code and commands built at run time pass it.
- **Interactive sessions are never sandboxed.** Only `pitcrew run` puts workers in the container
  of [docs/sandbox.md](docs/sandbox.md), by default for repos that are not yours.
- `web_fetch` refuses private and local addresses ([docs/web.md](docs/web.md)); `curl` in bash is
  not covered.
- A repo's own `.pi` settings, profiles and verify command are used only in your own repos or ones
  you trusted with pi's `/trust`.

A way around one of these documented limits is not a vulnerability; a way around a protection that
the docs say holds is one.
