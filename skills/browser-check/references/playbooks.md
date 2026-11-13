# Playbooks

Each playbook is a version of the loop in the skill: open, act, read console and network, read
runtime state, change one thing, run the same steps again. Match the report to a playbook and open
the browser before you form a theory. `$B` is the skill's `scripts/browser`, and every command
carries the session flag (`-s=<session>`, left out below).

## Blank or broken page

```text
$B open <url>
$B console warning            # an uncaught exception during render is the usual answer
$B requests --static          # a 404 on a bundle, a script blocked by CORS or CSP, a 5xx
$B eval "() => document.body.innerHTML.length"
$B screenshot                 # confirm what the user sees
```

- Console errors and an empty body: a runtime error while rendering (UI frameworks drop the whole
  tree on an uncaught error). Fix the **first** error; later ones often follow from it.
- No errors and an empty body: routing, build or serving. Compare the HTML the server sends
  (`curl` the URL) with what the app expects.
- A page that stays on "loading": a request that never settles. Look for it in `requests`.

## A request fails

Do the user action, then:

```text
$B requests --filter "/api/"
$B request <n>                # method, URL, status, headers, request body, response
```

| Sign | Usual cause |
| --- | --- |
| 4xx | the client sends wrong data, a wrong URL or no credentials |
| 401 / 403 | missing or expired token, wrong scope, or a server-side permission rule |
| 5xx | a server error: read the server's log for the same request |
| CORS error in the console | the server's allowed origins, methods or headers; check the preflight request |
| Timeout or very slow | server time or payload size; compare timing with a smaller request |
| No request at all | the code never sent it: a handler, a condition or a validation stopped it |

To tell a frontend bug from a backend bug, mock the answer: `route "**/api/orders" --status 200
--body '<a known-good body>'`, run the action again, then `unroute`. If the page now works, the
frontend handles a good answer and the backend answer is the problem.

## A form does nothing

```text
$B snapshot                                   # the form, its fields and the button
$B eval "() => [...document.forms].map(f => ({ action: f.action, method: f.method, valid: f.checkValidity() }))"
$B fill <ref> "<value>"                       # each field
$B click <ref>                                # the submit button
$B console warning
$B requests
```

- `valid: false`: a browser validation rule blocks the submit, often a hidden `required` field.
- No request and no error: no handler is bound (the script did not load or did not hydrate), the
  button is outside the form, or the button is disabled: `eval "el => el.disabled" <ref>`.
- A request with an error status: go to "A request fails".

## Login and session problems

Use a test account only. Read its password from an environment variable, never from a literal in
the command.

```text
$B open <login url>
$B fill <email ref> "$TEST_USER"
$B fill <password ref> "$TEST_PASSWORD" --submit
$B requests --filter "auth|login|token|session"
$B request <n>                # status, Set-Cookie, Location of a redirect
$B cookie-list
$B localstorage-list
```

- The login request succeeds but no session appears in cookies or storage: the client code that
  stores it is wrong (a storage adapter, a race at start-up).
- The session is stored but the next request has no credentials: the client does not read it, or
  the cookie's `Domain`, `Path`, `SameSite` or `Secure` attributes keep it off that request.
- Logged out after `reload`: the session is not persisted, or it is read before it is restored.
- Redirect loops: follow the `Location` headers in `requests` (302, 303, 307).
- To see the claims of a JWT (expiry, audience, role) decode its middle part in an `eval`, and
  show only the claims you need, never the token.

`state-save auth.json` keeps a test login for the next session (`state-load auth.json`). The file
holds live cookies: delete it when the task ends.

## Works locally, fails in production

Run the same steps against both URLs, each in its own session, and compare `requests` and
`console` side by side: the request URL and host, status, headers (credentials, content type),
and the response. Differences in configuration (API base URL, allowed origins, cookie domain,
a missing environment variable in the build) show here. Production is the owner's: open it only
when the owner asked, act read-only, and never with a real user's account.

## Layout at several widths

```text
$B resize 390 844      # phone
$B screenshot
$B resize 1280 800     # laptop
$B screenshot
```

Add a width in between (768 or 1024) when the layout changes there. Look for overflow, cut text,
overlapping elements, controls too small to tap, and a broken order of content. `set-color-scheme
dark` checks a dark theme; `--full-page` captures content below the fold.

## Accessibility

The snapshot is the accessibility tree: what a screen reader gets.

- Every interactive element in the snapshot has a name (`button "Save"`, not `button ""`).
- Headings form one outline: one level 1, no skipped levels.
- Tab order: `press Tab` several times, and see in each `snapshot` which element is `[active]`.
  The order follows the visual order; focus never gets stuck; `Escape` closes a dialog and focus
  returns to what opened it.
- A message that appears after an action (saved, error) is announced: it has `role="status"` or
  `role="alert"`, or sits in an `aria-live` region.
- Contrast and colour-only meaning need a look at the screenshot, or the computed colours from an
  `eval` (`getComputedStyle(el).color` and its background).

The full checklist is in the `frontend-design` skill.

## Performance

Measure before you change anything: `tracing-start`, run the slow action, `tracing-stop` (the
trace lands in the session folder). Read load timing from the page with `eval "() =>
JSON.stringify(performance.getEntriesByType('navigation')[0])"` and the largest paint and layout
shift from `PerformanceObserver` entries. Fix one bottleneck, measure again the same way, and
report both numbers. A guess about speed without a measure is not a finding.

## Evidence for a PR

Before the change: run the flow and take `before.png`. After: the same flow, `after.png`, and no
new console errors. Report the steps, the paths of both screenshots, and the console summary. For
a large interaction change, record it: `video-start flow.webm`, run the flow, `video-stop`.
Attach the files to the PR when the delivery flow allows it, or describe them.
