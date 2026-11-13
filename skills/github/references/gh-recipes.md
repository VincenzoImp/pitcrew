# gh recipes

Checked live on 2026-11-12 with `gh` 2.102.0 on a private test repo owned by a user account
(not an organisation), token scopes `repo`, `project`. `O/R` is the repo, `OWNER` its owner login.
Run `gh --version` first: these flags need `gh` 2.94 or later.

## Read the state

```bash
gh repo view O/R --json nameWithOwner,viewerPermission,defaultBranchRef,hasIssuesEnabled
gh api "repos/O/R/milestones?state=open" --jq '.[]|{number,title,open_issues,closed_issues,due_on,description}'
gh label list -R O/R
gh api graphql -f query='query{repository(owner:"OWNER",name:"R"){issueTypes(first:25){nodes{name}}}}' \
  --jq '.data.repository.issueTypes.nodes[].name'          # Task Bug Feature by default
gh repo view O/R --json projectsV2                         # note: gh prints the list under "Nodes"
gh project list --owner OWNER
gh issue list -R O/R --search "<words> in:title,body" --state all --json number,title,state
gh issue view N -R O/R --json title,body,milestone,issueType,parent,subIssues,subIssuesSummary,blockedBy,blocking
```

`subIssues` and `blockedBy` come as `{nodes: [...], totalCount}`: use `.subIssues.nodes[]`.
Open blockers only: `gh api repos/O/R/issues/N --jq .issue_dependencies_summary.blocked_by`.

## Frontier (what can start now)

```bash
gh issue list -R O/R --milestone "<title>" --state open --limit 200 \
  --json number,title,blockedBy,subIssuesSummary \
  --jq '[.[] | select([.blockedBy.nodes[]? | select(.state=="OPEN")] | length == 0)
             | select((.subIssuesSummary.total // 0) == (.subIssuesSummary.completed // 0)) | .number]'
```

Never use the search term `is:blocked`: it matches a label, not a dependency.

## Issues with structure, in one call

```bash
gh issue create -R O/R -t "<outcome>" -F body.md --type Feature --milestone "<title>" \
  --parent 12 --blocked-by 14,15 --project "<project title>" -l ready-for-agent
gh issue edit 20 -R O/R --add-blocked-by 19 --parent 12 --type Bug --milestone "<title>"
gh issue edit 12 -R O/R --add-sub-issue 21,22
gh issue edit 20 -R O/R --remove-milestone
gh issue close 20 -R O/R --reason "not planned" --comment "<why>"
```

`--blocked-by`, `--parent` and `--add-sub-issue` take numbers or URLs (other repos by URL).
GraphQL equivalents: `addSubIssue`, `removeSubIssue`, `reprioritizeSubIssue`, `addBlockedBy`,
`removeBlockedBy`, `updateIssueIssueType`.

## Milestones (REST only: no `gh milestone` command and no GraphQL mutation)

```bash
gh api repos/O/R/milestones -f title="Session resume" \
  -f description="Done when: a resumed session keeps its mode." -f due_on=2026-12-01T12:00:00Z --jq .number
gh api -X PATCH repos/O/R/milestones/3 -f description="…"
gh api -X PATCH repos/O/R/milestones/3 -f state=closed
```

- `--milestone` of `gh issue|pr create|edit` takes the **title**; the REST API takes the **number**.
- **Due date**: `due_on=2026-12-01T00:00:00Z` was stored as 2026-11-30. Give the time as `12:00:00Z`
  to keep the date you meant.

## Projects (needs the `project` token scope)

```bash
gh project create --owner OWNER --title "<product>" --format json --jq .number
gh project link N --owner OWNER --repo O/R        # use the login: "--owner @me" fails here
gh project view N --owner OWNER --format json --jq .id                       # project node id
gh project field-list N --owner OWNER --format json
gh project field-create N --owner OWNER --name Target --data-type DATE
gh project field-create N --owner OWNER --name Priority --data-type SINGLE_SELECT --single-select-options P0,P1,P2
gh project item-add N --owner OWNER --url https://github.com/O/R/issues/20 --format json --jq .id
gh project item-edit --id ITEM --project-id PID --field-id FID --single-select-option-id OPT
gh project item-edit --id ITEM --project-id PID --field-id FID --date 2026-12-01
gh project item-list N --owner OWNER --format json --jq '.items[]|{n:.content.number,status,milestone:.milestone.title}'
gh project copy N --source-owner OWNER --target-owner OWNER --title "<new product>"   # from a template Project
```

A new item showed `Status = Todo` at once (the project's "item added" workflow).

### Add `In review` to Status, keeping the existing options

Send the full list; give each existing option its `id`, so items keep their values. Checked: the
three ids stayed the same and the new option got a new id.

```bash
gh api graphql -f f=FIELD_ID -f query='mutation($f:ID!){updateProjectV2Field(input:{fieldId:$f,
  singleSelectOptions:[{id:"<todo id>",name:"Todo",color:GRAY,description:""},
    {id:"<in progress id>",name:"In Progress",color:YELLOW,description:""},
    {name:"In review",color:BLUE,description:"PR open"},
    {id:"<done id>",name:"Done",color:GREEN,description:""}]})
  {projectV2Field{... on ProjectV2SingleSelectField{options{id name}}}}}'
```

### Views, iterations, status updates (GraphQL only)

```bash
gh api graphql -f p=PID -f query='mutation($p:ID!){createProjectV2View(input:{projectId:$p,
  name:"Board",layout:BOARD_LAYOUT}){projectV2View{name}}}'        # TABLE_LAYOUT, ROADMAP_LAYOUT
gh api graphql -f p=PID -f query='mutation($p:ID!){createProjectV2StatusUpdate(input:{projectId:$p,
  status:ON_TRACK,startDate:"2026-11-12",targetDate:"2026-12-01",body:"<run report>"}){statusUpdate{id}}}'
gh api graphql -f p=PID -f query='query($p:ID!){node(id:$p){... on ProjectV2{
  statusUpdates(last:3){nodes{status body targetDate createdAt}}}}}'
```

- Status values: `ON_TRACK`, `AT_RISK`, `OFF_TRACK`, `COMPLETE`, `INACTIVE`.
- Field types for `createProjectV2Field`: `TEXT`, `SINGLE_SELECT`, `MULTI_SELECT`, `NUMBER`, `DATE`,
  `ITERATION` (with `iterationConfiguration`).
- Views can be created but their grouping and filters are set in the UI.
- **Workflows** (auto-add, auto-archive, item added, item closed) have no create or enable API
  (only `deleteProjectV2Workflow` exists). Set them in the web UI.

## Releases

```bash
gh release create v0.3.0 -R O/R --target main --title "v0.3.0" --generate-notes
gh release view v0.3.0 -R O/R
```

## Facts and where they come from

| Fact | Source (read 2026-11-12) |
| --- | --- |
| Milestones hold issues and PRs; show due date, completion %, open/closed counts; no priority order above 500 open issues | https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/about-milestones |
| Up to 100 sub-issues per parent, 8 levels; children may come from other repos; parent progress shows in Projects | https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues |
| Blocked issues show a "Blocked" icon; `gh` takes numbers or URLs | https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies |
| Issue types work in organisations and user-owned repos; defaults task, bug, feature; up to 25 | https://docs.github.com/en/issues/tracking-your-work-with-issues/configuring-issues/managing-issue-types-in-an-organization |
| Status updates: status, start and target date, Markdown body; anyone with write access; not on template Projects | https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/sharing-project-updates |
| Default workflows: closed → Done, PR merged → Done; others (item added, auto-add, auto-archive) are set in the UI | https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-built-in-automations |
| Closing keywords close/fix/resolve (+s, +d); `KEYWORD OWNER/REPO#N` for other repos; only PRs merged into the default branch close issues | https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue |
| Mutations present: see the GraphQL lists above; no milestone mutation; no workflow create | schema introspection, 2026-11-12 |
