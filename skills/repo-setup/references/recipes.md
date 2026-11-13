# Repo setup recipes

Checked on 2026-11-12 with `gh` 2.102.0 on a private test repo owned by a user account. `O/R`
is the repo.

## Enter: read the repo

```bash
gh repo view O/R --json nameWithOwner,viewerPermission,isFork,parent,defaultBranchRef,visibility,isArchived,\
deleteBranchOnMerge,squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed
ls CONTRIBUTING* .github/CONTRIBUTING* docs/CONTRIBUTING* .github/ISSUE_TEMPLATE .github/PULL_REQUEST_TEMPLATE* \
   .github/CODEOWNERS CODEOWNERS docs/CODEOWNERS AGENTS.md SECURITY.md 2>/dev/null
ls .github/workflows/
gh ruleset check main -R O/R                     # rules that apply to a branch (any reader)
gh ruleset list -R O/R
gh pr list -R O/R --state merged --limit 20 --json number,title,headRefName,author,mergedBy,additions,deletions,createdAt,mergedAt
git log --oneline -30
gh api "repos/O/R/commits?per_page=100" --jq '[.[].author.login] | group_by(.) | map({who: .[0], n: length}) | sort_by(-.n)'
gh pr list -R O/R --state open --json number,title,author,headRefName,files --jq '.[] | {number,title,author:.author.login}'
gh issue view N -R O/R --comments
gh issue list -R O/R --search "<words> in:title,body" --state all --json number,title,state,assignees
gh label list -R O/R; gh api "repos/O/R/milestones?state=open" --jq '.[].title'
```

Branch protection (classic) needs admin to read: `gh api repos/O/R/branches/main/protection` gives
404 or 403 otherwise. `gh ruleset check` works for readers.

## Fork flow

```bash
gh repo fork --remote            # inside a clone of theirs: your fork becomes origin, theirs upstream
git fetch upstream && git switch -c fix/topic upstream/main
git push -u origin fix/topic
gh pr create -R THEIR/REPO --head YOU:fix/topic -F pr.md
```

## Bootstrap

```bash
gh repo create O/R --private -d "<one line>" --license mit --gitignore Node --add-readme --clone
#   or, from a local folder with commits:  gh repo create O/R --private --source . --push
gh repo edit O/R --delete-branch-on-merge --enable-squash-merge --enable-merge-commit=false \
  --enable-rebase-merge=false --enable-auto-merge --squash-merge-commit-message pr-title
gh api repos/O/R --jq '{delete_branch_on_merge,allow_squash_merge,allow_merge_commit,allow_rebase_merge,allow_auto_merge}'
```

### Ruleset on the default branch

```bash
cat > ruleset.json <<'EOF'
{"name": "main", "target": "branch", "enforcement": "active",
 "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
 "rules": [
   {"type": "deletion"},
   {"type": "non_fast_forward"},
   {"type": "pull_request", "parameters": {"required_approving_review_count": 0,
     "dismiss_stale_reviews_on_push": false, "require_code_owner_review": false,
     "require_last_push_approval": false, "required_review_thread_resolution": false}}]}
EOF
gh api repos/O/R/rulesets --input ruleset.json --jq '{id,name,enforcement}'
gh ruleset check main -R O/R
```

Checked: on the private test repo the ruleset was accepted and active, and a direct `git push
origin main` was refused ("push declined due to repository rule violations"); the repo owner
still merges their own PRs with 0 approvals. GitHub states rulesets for "GitHub Team and GitHub
Enterprise" organisations
(https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets);
on another account or plan, create it and read it back with `gh ruleset check`; if the API refuses,
tell the owner and go on without it.

Required checks, once CI reports them (use the job names the checks really show on a PR):

```json
{"type": "required_status_checks", "parameters": {"strict_required_status_checks_policy": false,
  "required_status_checks": [{"context": "verify"}]}}
```

Change a ruleset: `gh api -X PUT repos/O/R/rulesets/ID --input ruleset.json`.

### Labels and tracking

```bash
gh label create needs-owner -R O/R --color FBCA04 --description "Needs a decision or an action from the owner"
gh label create ready-for-agent -R O/R --color 0E8A16 --description "Specified well enough for an agent"
gh api repos/O/R/milestones -f title="<outcome>" -f description="Done when: <check>" --jq .number
```

Project: see the `github` skill's recipes (create once per product, link with the owner's
login, not `@me`).

### Minimal CI

```yaml
# .github/workflows/verify.yml
name: verify
on:
  pull_request:
  push:
    branches: [main]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run verify
```

## Facts

| Fact | Source (read 2026-11-12) |
| --- | --- |
| Only repo admins can turn on the automatic deletion of head branches; branch protection and rulesets can prevent a deletion; for a PR from a fork, the fork's setting counts and the merger needs write access to the fork | https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches |
| Rulesets layer with each other and with branch protection; all rules apply; bypass lists can name roles, teams or apps | https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets |
| `gh ruleset` is read-only (`list`, `view`, `check`); create and change rulesets through the API | `gh ruleset --help`, 2.102.0 |
