# v0.33.0 reviewed portfolio import proof

Date: 2026-08-25

## Boundary proved

The Projects page stores a workspace-level CSV before review, previews every
row through the same pure reviewer used at commit, and creates only rows a
planner explicitly confirms. The commit reloads the stored bytes, rechecks the
current project names and prior source rows, verifies the approved preview
hash, and calls one service-role-only database transaction. Source-location
text is retained only in the immutable import-row record; the project insert
has no geography, place, bounding-box, coordinate, or geometry column.

## Mutation proof

A comment-only mutation survived the focused parser suite, establishing that
the workflow could report a survivor. Each behavior mutation below then failed
for its intended reason before the original text was restored:

| Guard | Mutation | Failure observed |
|---|---|---|
| Approved preview | Reversed the preview-hash comparison | Stale-preview API test received 201 instead of 409 |
| Current role | Changed the database viewer-role check | Live viewer test no longer received SQLSTATE 42501 |
| Source scope | Removed the workspace-level `project_id IS NULL` constraint | Live project-scoped source test no longer received SQLSTATE 22023 |
| Duplicate source IDs | Required three matches instead of two | Parser marked both repeated-ID rows clean instead of blocked |
| Created-row identity | Moved the partial unique index from `created` to `skipped` | Migration guard could not find the created-outcome idempotency key |
| Atomic project write | Redirected the transaction's project insert | Migration guard could not find the project insert inside the RPC |
| Location isolation | Added source-location text to the project insert columns | Migration guard found forbidden location data on the project write path |
| Deletion dependency | Reversed the portfolio dependency count condition | Delete-route test omitted the named durable-import dependency |
| Assistant refusal | Temporarily registered `import_project_list` as an action | Refusal guard named the newly actionable bulk import |
| Knowledge Base scope | Replaced the workspace-null dedup filter | Upload-route test found no workspace-level scope constraint |
| Planner disclosure | Changed “does not set” to “may set” | Real importer render lost the explicit geography-isolation statement |
| Page reachability | Pointed the header action at a missing anchor | Real Projects-page test found the wrong importer link |

After restoration, the focused static and component suite passed 107 tests
with the six environment-gated live checks skipped. The restored local database
then passed all six portfolio-import live checks and the 20-test RLS isolation
census.

The first complete application run found six integration seams outside the
focused suite: a Knowledge Base mock missing the new scope method, two primary
header actions, a SQLSTATE mistaken for a county FIPS literal, two copy-ratchet
terms, unexplained write-only audit columns, and an unlisted project-delete
dependency. After those were fixed, the next run found that the dependency link
targeted a nonexistent project-detail anchor. Both deep-link guards rejected it;
the final full run passed 12,494 tests with only the repository's 76
environment-gated cases skipped.

The complete `qa:gate` then passed lint, the dead-code audit, the full Vitest
suite, 106 live RLS and migration tests, the production dependency audit with
zero vulnerabilities, TypeScript, and the webpack production build. All 47
Python worker suites also passed.

## Browser proof

The edited checkout was served separately on port 3200 and identified by
`scripts/ops/which-openplan.sh`; the persistent walkthrough on port 3000 was not
used. Installed Chrome entered through the visible sign-in page, followed the
Projects navigation, uploaded and mapped a CSV, selected one clean row, reviewed
the server preview, committed it, and opened the created project from the
completion link. Reloading Projects showed the durable one-row import summary.

That journey found two visual defects before acceptance. Explicit accessible
names were added after Chrome could not distinguish the five mapping selects.
At 390px the importer initially measured 786px inside a 292px content grid; its
right side was clipped. Constraining the Projects grid and its form controls
reduced the importer to 292px, kept the document at 390px with no horizontal
overflow, and allowed the source summary to wrap. The final desktop and 390px
runs produced no browser-console errors and no failed network responses.

## Known limit

This evidence proves the reviewed CSV workflow on the local OpenPlan stack. It
does not establish demand or usability at an outside agency. XLS, XLSX, and ODS
files can be retained as the original source, but parsing those formats remains
future work; the imported sheet must currently be supplied as CSV.
