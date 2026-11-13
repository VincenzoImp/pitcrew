#!/usr/bin/env bash
# Human-in-the-loop reproduction loop (diagnosing-bugs skill).
# The agent copies this file outside the repo and edits the steps between the markers.
# The owner runs it in their own terminal (the agent's bash tool cannot answer prompts)
# and pastes the block after "--- Captured ---" back to the agent.
#
# Two helpers:
#   step "<instruction>"          show the instruction, wait for Enter
#   capture VAR "<question>"      show the question, read the answer into VAR
#
# capture prints its value at the end, so use it for observations only.
# Sign-in and anything secret is a step the person does, never a capture.

set -euo pipefail

step() {
  printf '\n>>> %s\n' "$1"
  read -r -p "    [Enter when done] " _
}

capture() {
  local var="$1" question="$2" answer
  printf '\n>>> %s\n' "$question"
  read -r -p "    > " answer
  printf -v "$var" '%s' "$answer"
}

# --- edit below ---------------------------------------------------------

step "Open the app at http://localhost:3000 and sign in."

capture ERRORED "Click the 'Export' button. Did it show an error? (y/n)"

capture ERROR_MSG "Paste the error message (or 'none'):"

# --- edit above ---------------------------------------------------------

printf '\n--- Captured ---\n'
printf 'ERRORED=%s\n' "$ERRORED"
printf 'ERROR_MSG=%s\n' "$ERROR_MSG"
