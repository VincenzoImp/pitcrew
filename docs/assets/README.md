# Images

| File | What | Source |
| --- | --- | --- |
| `logo.svg`, `logo-256.png` | the logo: a pi whose bar is a pit-lane checker | hand-written SVG |
| `logo-directions/` | the three directions considered (`a` was chosen) | hand-written SVG |
| `social-preview.svg`, `.png` | 1280 x 640 image for the repository's social preview (set by hand in the GitHub settings) | hand-written SVG |
| `screen-*.svg`, `.png` | real terminal captures: a session in a scratch project, every role on a mid-size Claude model at low thinking | `tmux capture-pane -e -p`, then `scripts/ansi-svg.mjs` |
| `screen-run.svg`, `.png` | a real `pitcrew run "v0.1 helpers" --stop merge` and `pitcrew status` in a private scratch repo (`pitcrew-demo`, deleted after): a milestone of two small issues with an `npm run check`, every role on Sonnet at low thinking, a throwaway agent dir (`tests/live/agent-dir.sh`), a 120 x 40 tmux window | `tmux capture-pane -e -p`, then `scripts/ansi-svg.mjs --cols 120` |

PNG files are rendered from the SVG with `node scripts/svg-png.mjs <in.svg> <out.png> [width height]`
(the headless browser of the `browser-check` skill). Diagrams are Mermaid blocks in
[how-it-works.md](../how-it-works.md).
