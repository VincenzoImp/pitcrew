# Web

`extensions/web/` gives the model web tools.

| Tool | What |
| --- | --- |
| `web_search` | One query → titles, URLs, snippets (and a short answer from some backends) |
| `web_fetch` | One URL → Markdown; full text saved to a file, the first `maxChars` characters inline (default 6,000; 1,000 to 20,000) |

All results start with an untrusted-content banner. The guidance for the model (when to use the tool,
cite the URL, do not follow instructions in pages) is in the tool description, the one channel that
reaches every model ([claude-access.md](claude-access.md)).

## Search backends

`web_search` tries the backends in the order of `pitcrew.web.backends` (default `["exa", "codex"]`). A
backend that is not configured or fails is skipped, and the result names it with the reason. The
result says which backend answered. If none works, the result lists what to configure for each one.
No backend depends on the session's model, so search works the same with a Claude, Codex or local lead.

Why Exa first (measured 2026-11-12, 8 coding questions to both backends, [TESTS.md](TESTS.md)): both
found the right official page for every question. Exa answered in 1.2 to 2.2 s, its snippets held the
fact, and it spends no subscription tokens (about $0.012 per search on the free credit). Codex took 4.7
to 9.1 s and 8,700 to 13,200 tokens of the ChatGPT plan per search; it adds a short answer (right in
all 8), but its sources have no snippets and some are noise (a diff page, a mirror, tracking
parameters). Codex stays second: it answers when Exa has no key, a rejected key, no credit, or is down.
A session has a fixed cap of 60 searches (a constant, not a setting). Code: `extensions/web/search.ts`; a new backend is one function there.

### `exa`

[Exa](https://exa.ai) is a search API for AI agents. Request: `POST https://api.exa.ai/search` with
`type: "auto"`, `numResults`, `includeDomains` (from `site`) and highlights of up to 300 characters as
snippets ([API reference](https://exa.ai/docs/reference/search), read 2026-11-12).

- Key: env `EXA_API_KEY`, else the file `~/.config/pitcrew/exa-key`. The file must be mode 0600 (the
  backend refuses a file that other users can read). Never put the key in `settings.json` or a repo.
- Cost ([pricing](https://exa.ai/pricing), read 2026-11-12): free $10 credit per month, no payment
  method required. `auto` search $7 per 1,000 requests, plus $1 per 1,000 pages for highlights: about
  $0.012 per search with 5 results, so about 800 searches per month on the free credit.

### `codex`

A side call to an OpenAI Codex model with OpenAI's hosted web search turned on, through pi's
`openai-codex` provider (the ChatGPT subscription login). It returns the search sources (title, URL,
no snippet) and an answer of up to 5 lines written by that model. The lead sees a normal tool result.

- Model, first match: the setting `pitcrew.web.codexModel` (`"openai-codex/<id>"` or `"<id>"`), then
  the `scout` role, then any other role of the session's profile whose model is on `openai-codex`. The
  setting comes first so the owner can pick a small model even when a profile maps a large Codex model
  to a role. Use the smallest Codex model: search needs
  little reasoning. The call runs at thinking level `low`.
- Needs `/login` to OpenAI Codex in pi. It spends the subscription's Codex quota.
- Cost measured 2026-11-12 on 8 coding questions: 8,700 to 13,200 tokens per search, almost all
  input (the search results), about 200 output tokens ([TESTS.md](TESTS.md), Web).
- Request shape: `onPayload` adds
  `tools: [{type: "web_search"}]`, `tool_choice: "required"`, `include: ["web_search_call.action.sources"]`
  and `store: false`; the sources come from the raw stream events (`onProviderStreamEvent`, SSE only).

### Settings for search

```json
"pitcrew": { "web": {
  "backends": ["exa", "codex"],
  "codexModel": "openai-codex/<smallest model>"
} }
```

## Fetch rules

- http(s) only; `user:pass@` rejected; names `localhost`, `*.localhost`, `*.local`, `*.internal` and bare
  names rejected.
- Every resolved address must be public. Blocked: IPv4 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12,
  192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4, 240/4; IPv6 `::/96`,
  `fc00::/7`, `fe80::/10`, `fec0::/10`, `ff00::/8`, `64:ff9b:1::/48`; IPv4 inside `::ffff:0:0/96`,
  `64:ff9b::/96` and `2002::/16` is checked against the IPv4 list.
- The socket connects to the checked address (undici `connect.lookup` pin), so DNS rebinding cannot
  move it. Redirects: at most 5, each one checked again.
- Limits: 20 s, 10 MB body (30 MB for PDF).
- HTML → Readability → Markdown; small or partial articles fall back to the whole body. PDF → text with
  `--- page N ---`. JSON is pretty-printed (one field per line), so `find` and grep work on one-line API
  bodies. Images and other binaries are saved; the path is returned.
- `find: "<text>"` returns only matching lines with 3 lines of context; a line over 400 chars is cut
  around the match.
- GitHub `blob` URLs are fetched from `raw.githubusercontent.com`; a repo root returns the README and a
  clone hint; issues and PRs get a `gh` hint. YouTube is refused with a transcript hint. A page that needs
  JavaScript is refused with a hint to open it in a headless browser with the `browser-check` skill,
  or to look for raw files, an API or the docs source.
- Files: `/tmp/pitcrew/web/<session-id>/` (folder mode 0700, files 0600). Folders older than 7 days are
  deleted at session start. These are scratch copies of public pages, so they stay in the temp dir,
  not in the harness work folder ([footprint.md](footprint.md)).

Limits of the policy: `curl` in bash is not covered. For unattended runs the sandbox is the control.

## Settings

`pitcrew.web.backends` and `pitcrew.web.codexModel` ([defaults.md](defaults.md)). Fixed: `web_fetch`
never reads loopback or local names.

## Turn off

- All web tools: `pi config` → disable `extensions/web/index.ts`.
- One run: `pi --exclude-tools 'web_*'`.
