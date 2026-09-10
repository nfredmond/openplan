# Approved project-submittal recovery — v0.51.0 verification

Published [v0.51.0](https://github.com/nfredmond/openplan/releases/tag/v0.51.0)
on September 10, 2026 at 12:30:29 UTC from
`38f951ebc9d2db14594c1f01847de686f157cde6`. The final commit passed
[CI](https://github.com/nfredmond/openplan/actions/runs/34475387543),
[live RLS](https://github.com/nfredmond/openplan/actions/runs/34475387610), and
[upgrade](https://github.com/nfredmond/openplan/actions/runs/34475387565)
before tagging. Machine-readable final CI and publication receipts are retained
beside this file. CI full QA and shuffled tests each passed 13,649 tests with
336 skipped; local runs passed 13,656 with 329 skipped. Live RLS passed 358 tests
in 44 files. The populated upgrade from v0.50.0 retained counts
`2:2:1:1:1:1:1`. The historical preparation checkpoints below remain unchanged.

Based on released v0.50.0 at0df7a50a. The current branch is
work/agent-submittal-receipts in the existing isolated agent-hold-receipts checkout;
no app server is running there. v0.50.0's final CI receipts are retained beside its
verification history. The checkpoints below preserve implementation findings. The final engineering evidence is recorded at the end; final main CI and tagging remain pending at release preparation.

Continue roadmap A1a by extending the existing receipt ledger to the registered
create_project_record action, which creates a submittal on an existing project.
It does not create projects or permit the other six manual record variants.
Keep assignment and extra-body fields refused and preserve manual writes.

The route currently consumes consent before its separate record and audit writes.
Use a domain-specific transaction for the submittal, original result receipt and
approval consumption. Shared reading and presentation may support both proven
HOLD and submittal receipts, with action-specific validators. Avoid a new assignment
engine or an abstraction that assumes every later action is a database-only write.

Unlike HOLD, this action carries no workspaceId. Recover original scope from the
exact approval belonging to the signed-in caller, verify its hash and current
membership in that original workspace, then return the original receipt. Current
project metadata must not relabel an older result. For a new write, recheck project
ownership and current write role under locks. Project display names may change;
identity/scope cannot. Preserve original creation results after later edits.

The new screen should identify projects and evidence in readable language while
retaining exact IDs. Existing technical proposal labels remain a related interface
gap. Do not claim external identity, full assignment coverage, provider choice,
prescribed forms, field usefulness or scientific validation from this increment.

Before landing: focused route/helper/UI tests with harmless and targeted mutations;
actual scoped database races, rollback and current/revoked access; desktop/390px
keyboard navigation, interrupted requests and immutable original-result recovery;
full QA/shuffle, isolated RLS, applicable workers and populated upgrade; final main
CI before a release tag. No human sign-off or paid infrastructure is required.

Database separation: browser fixtures use openplan-restore-target-3390964 at22301;
clean RLS uses openplan-restore-target-2026091050 at29821/29822. Always qualify the
chosen stack. Preserve the pending reminder constraint change.

## Implementation checkpoint

The registered submittal path now captures the original project name and scope
with canonical consent, then commits the submittal, original result receipt and
consumption in one transaction. Receipt readback precedes current-project lookup;
new execution checks current role and project ownership under locks. Manual record
variants retain their existing route. Activity adds a submittal section using the
same explicit recovery controls as HOLD, and interrupted chat links to it.

Applied the new migration to the explicitly isolated clean stack
openplan-restore-target-2026091050. Focused tests exercise original result retention
after edits/move/expiry/viewer downgrade, stale and legacy refusal, failed insert,
audit and consumption rollback, service ACL, concurrent duplicate execution,
in-flight project moves and lost database connections. Browser and full gates are
still pending. No browser identity claim is made for the old .next build.

The first route fixture used the wrong execution-source header, reached the manual
path and failed 11 assertions. Corrected the fixture to the real header; the 12
route cases then passed. The existing source seam guard recognized only the old
HOLD transaction; it now requires the submittal proof/read/transaction calls.
Two test typing errors and one missing effect dependency were corrected.

Mutation evidence: harmless source and SQL comments survive. Removing text/default
normalization, project-name projection, receipt identity, original project context,
read access, original approval ID or the route verifier call produces the intended
focused assertion failure. SQL mutations removing the audit effect check, accepting
a wrong receipt type, and omitting the project lock fail at the suppressed audit,
wrong receipt kind and observed lock-wait checks respectively. All restored.
The isolated outer SQL hash-check removal survives because the receipt reader
independently requires the same hash. This suite does not independently prove that
redundant outer guard. An earlier recovery-hash mutation failed only because a
second helper rejected the hash; the stronger context-identity mutation verifies
that a relabeled retained project is refused before RPC.

Blind categories: source scans establish calls rather than runtime ordering;
mocked tests do not prove database atomicity or RLS; live transactions do not prove
browser navigation or useful wording. Browser acceptance will use synthetic model
proposal responses and real approval/write/read routes, not paid model calls. No
external-agent identity, provider choice, assignments, prescribed forms or scientific
validation is established here. Human observation is not a release blocker.


Full QA attempt: lint/deadcode completed, then 13,653 tests passed and three
failed. Two were the Activity-page mock missing its new component export; the
third could not identify dynamically assembled recovery endpoints. Added both
mocked sections and an explicit scoped-render assertion, and wrote both actual
endpoint paths in the shared component. The four affected suites now pass
29 assertions. A harmless render-key change survives; substituting the recovery
workspace fails the page assertion. Typecheck is clean after these corrections.

All 52 worker suites passed. The browser-stack migration preserved all captured
19 approval rows and 19 audit rows exactly; hash and counts are retained here.
The read-only comparison survived a comment change and rejected a corrupted
returned hash without changing the database. Full RLS, corrected full QA,
shuffled order and browser acceptance remain pending at this checkpoint.

## Browser-led display correction

At729fc8e2, corrected full QA/build and shuffled seed510091 passed13,656 tests
in1,245files (329tests in37files skipped). Clean live RLS passed358tests in44files.
The first server start omitted OPENPLAN_COMMIT_SHA; the identity guard refused its
unknown commit. Restarting the same frozen, just-built source with the recorded
729fc8e2c293da8be5b81bbb3166e443b260b1a8 stamp established identity before navigation.
No browser claim is based on the unidentified start.

Desktop1440 and390px journeys reached submittal proposals from real Projects
navigation, approved with keyboard controls, recovered a response interrupted
after201 without another effect, and resumed a request interrupted before reaching
the server with the same approval. Each produced one original record and audit
receipt per consent, replayed with200, and denied anonymous recovery with401.
A keyboard manual status advance changed the current submittal to internal review;
its original receipt stayed draft. Only the deliberate connection-failure console
entries appeared, and document/panel widths stayed within each viewport.

Screenshot inspection found that the card said it retained the original result
without displaying its status or type, and the project-name line broke numbers
across lines on phones. Stopped the identified server before editing. The card now
shows original status/type and separates the readable name from the exact ID.
The affected17 UI tests and scoped lint pass; harmless whitespace survives and
substituting accepted for the original status fails the intended assertion.
A new frozen build and repeated browser journey are still required for this display
correction. Initial screenshots/results remain in the scratch first-journey folder.


## Final browser and release preparation

The final browser build is a1cc1ae5f73a158348c00b2711aa7cdbba476364, served from
the isolated agent-hold-receipts checkout on3282 and identified before navigation.
The package still read0.50.0 during that frozen journey; the0.51.0 version bump
follows acceptance and changes release metadata, not the accepted workflow.

Repeated desktop1440 and390px journeys passed after the display correction. Both
used real sign-in, Projects navigation, Planner Agent approval, Activity recovery
and Delivery status controls. Only model proposal SSE was synthetic; delayed context
responses retained their real contents, and all approval/effect/read/auth routes
were real. Each after-response interruption recovered one committed result without
another POST. Each before-server interruption resumed the original approval after
reload and committed one record/receipt. Repeated POSTs returned200 and the same ID;
anonymous recovery reads returned401. Manual keyboard status advance produced
internal_review while both the retained receipt and visible original-status text
remained draft. Original project names and invoice-backup types were visible.

There were exactly two deliberately induced connection-failure console entries per
viewport, no page errors, and no unexpected HTTP failures. Document width matched
1440/390; recovery content matched panel widths1084/290. Screenshots were inspected
for readable fields, reachable controls and wrapping. Browser servers are stopped.

Full QA/build and shuffled seed510091 at729fc8e2 passed13,656 tests in1,245files;
329tests in37files are intentionally skipped without their live environments.
The subsequent display-only correction passed17 affected UI tests, scoped lint,
its production build and the repeated browser journeys. Live RLS passed358tests in
44files against openplan-restore-target-2026091050. All52 worker suites passed.
Retained pre-upgrade approval/audit rows remain unchanged after the browser work;
the comparison is limited to its original19+19 IDs, not later synthetic fixtures.

v0.51.0 release metadata is now prepared. Final main CI and populated v0.50.0 upgrade
results must be recorded and inspected before the tag. No human sign-off, paid
service, reminder constraint change or demo deployment is required or claimed.

Release ordering passed with313 migrations; a harmless comment survived and a
wrong314 count failed the high-water-mark assertions. Product direction passed
after correcting the registry's currentRelease field to match the package. Review
dates and capability statuses were not promoted. The raw pre-upgrade snapshot
stays in the local evidence directory; this repository retains its checksum,
counts and comparison code rather than publishing the raw approval history.
