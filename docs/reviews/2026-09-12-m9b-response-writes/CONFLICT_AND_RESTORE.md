# Conflict recovery and restored-database evidence, September 13, 2026

This continues RESET_HANDOFF.md. It is an unreleased engineering checkpoint,
not a release declaration. The original v1 scope and M9b scope remain unchanged.

## Observed correction

A browser stale save reached the unconfirmed timeout while direct SQL returned
40001 immediately. PostgREST v14.15 retries that code. The repository had already
fixed this problem for OWP; the engagement increment reintroduced it. SQL-only
checks missed the HTTP boundary. Migration 20261014000007 changes engagement
stale conflicts to PT409 and incomplete receipts to PT503, preserving the RPC,
private history and request identities. The two unused legacy access-request
functions still have manual 40001; no current src callers were found.

Sources: [Supabase retry-loop explanation](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b),
[PostgREST custom error responses](https://docs.postgrest.org/en/v14/references/errors.html).

A second real browser defect retained the old review-read failure warning after
a successful retry. The current and proposed copies were intact. The editor now
states that the current responses loaded and asks the user to compare them.
The new regression first failed against the old code. Baseline and harmless
comment survived; removing the message update failed that regression. See
review-warning-mutations.json. These component checks cannot prove rendering.

The receipt isolation census also needed its expected sorted list updated,
in addition to the probe and 91-table count. The removed-list-entry mutation
fails that census. Conflict mapping faults prove PT409 remains a reviewable
conflict and PT503 remains unconfirmed/unavailable, including the item route.
See conflict-mapping-mutations.json. Mocked route tests cannot prove installed
PostgREST behavior, and the direct-table census does not cover join-scoped tables.

## Browser evidence

The served Next dev checkout was identified at port 3260 as
/home/nathaniel/.local/state/openplan/engagement-response-writes-2026-09-12.
Reports identify parent 3d04f200 plus exact application file hashes. The later
message fix is captured by those hashes. Images and reports are retained under
browser-conflict-evidence; earlier browser-evidence remains historical.

Both 1440px and 390px journeys entered through sign-in and keyboard navigation,
created a campaign, configured public availability, saved a response with a lost
acknowledgement, reloaded and retried the identical request, published it, ran
the actual local worker with zero eligible recipients, and refreshed Activity.
They then corrected the response while history was open, preserved focus,
checked the original record/checksum, and refreshed the publication result.

Each journey made a separate concurrent API correction, attempted the stale
editor save, reviewed its prompt conflict, deliberately interrupted the first
current-copy read, retried review, and saved the retained proposed wording with
a new request identity and the current saved version. Five revisions remain;
the original checksum and record match. The current review warning clears on
successful retry. Narrow text wraps without horizontal overflow. The inspected
screens show the current copy, retained proposal and final correction history.

The first desktop attempt failed before campaign creation with ERR_NETWORK_CHANGED.
Later diagnostic assertions were wrong: ResponseCopy includes a We did label,
and the reviewed textarea was reliably located by its textbox accessible name
rather than an exact label-text query. Those diagnostic failures are retained
privately and are not application failures. The final desktop journey completed
but still logged network-change failures on background map/GIS requests. Host
NetworkManager and Docker events show repeated interface changes from the older
openplan-restore-target-3112923 stack, whose auth/storage containers are restarting.
That is a plausible cause, not a demonstrated browser-network causal test. No
unrelated container was stopped. The 390px console contains only two deliberate
ERR_FAILED requests and the expected 409. Neither final journey had page exceptions.
Do not describe the desktop console as clean.

## Restore and isolation

The earlier full archive drill restored 296 tables and one file, signed in with
the restored account, reconstructed OWP relationships and compared their hashes.
It then failed the missing receipt census. It copied 325 migrations through 06;
that failed whole-run outcome is preserved in full-restore-final.log.

The retained target supabase_db_openplan-restore-target-2731143 was backed up and
upgraded from 325 to 326 through 20261014000007. Exact row-hash snapshots across
all 277 public/auth/storage tables were unchanged. The 296-table restore archive
also includes other schemas; the table comparison here does not claim to cover
those. See restored-conflict-upgrade.json and its executable script. The private
latest backup itself has not been separately restored.

The full isolated RLS suite then passed 50 files and 480 tests on that upgraded
restored target, exit 0, in 346.75 seconds. No final-source full restore rerun is
claimed: this is a verified full data restore followed by a data-preserving
function upgrade and final isolation suite. The app source stack independently
passed all 22 rls-isolation cases, including actual prompt HTTP conflicts and
unchanged original response/contribution text with no failed request receipt.

Private logs and databases remain under the explicit paths in RESET_HANDOFF.md.
Installed HTTP baseline and harmless-comment control also passed on the restored
target. Reintroducing manual 40001 separately into each engagement function
failed the preflight before HTTP, avoiding a new retry loop. Both original
function definitions were restored and hash-checked. See conflict-http-mutations.json
and conflict-http-restoration.json. TypeScript checking exited 0. Full QA, shuffled tests,
remaining changed-workflow acceptance and final release CI remain outstanding.

## Full QA follow-up

The full gate on f95e477e completed lint and Knip, then failed two assertions in
viewer-write-denial-guard.test.ts. It passed 14304 tests, with 451 skipped.
The gate had not accounted for the deliberately retained restrictive response
writer policies after migration 06 removed their permissive partners.

The revised inventory recognizes exactly that one RPC-only table, proves that
all direct write policies are absent, checks table and column privileges for
anon, authenticated and PUBLIC, and retains all three restrictive writer gates.
Its baseline and harmless comment passed; restoring an authenticated UPDATE,
a PUBLIC column UPDATE, or a permissive INSERT policy failed the new boundary.
See retained-gate-mutations.json. No database policy or privilege changed.

The full shuffled suite subsequently passed 1265 files and 14306 tests, with
43 files and 451 tests skipped, seed 370816, exit 0, in 130.98 seconds. This run
includes the corrected gate. Full QA still needs a new run through the remaining
provider, dependency and build stages. These outcomes do not establish release CI.

## Public source withdrawal

Both desktop and 390px journeys now pass public input through the real submission
form, staff approval, a public reply, approval of that reply, and a response linked
to it through the editor's Contributions addressed selector. A notes-only parent
edit keeps publication. Changing the approved parent's wording withdraws the
reply-linked response. Republishing after review and then flagging the parent
withdraws the response again and hides the reply from the public feed. Both
journeys assert stored draft status as well as public absence, preserve all five
response revisions and the original checksum, and deny anonymous history reads.
No rows were hand-seeded. The native worker was not started for these journeys.

The script initially used the wrong moderation-list name and assumed the public
entry page was the full feedback portal. Actual receipt navigation leads to the
about page; its link label depends on whether approved comments were loaded.
Those script mistakes are preserved privately. Another run stopped on an aborted
reload. The final script allows one recorded navigation retry after ERR_ABORTED
or ERR_NETWORK_CHANGED, preserving all content assertions. Neither final run
needed that retry. Their consoles contain only font-preload warnings; no page
exceptions or network-change errors were recorded.

Artifacts are under browser-source-evidence. Immediate published screenshots
caught the prior tab color during its CSS transition. A separate read-only check
on an earlier synthetic published response waited for the actual animations to
finish, verified the selected tab's computed colors and no horizontal overflow,
and captured settled desktop/390px images. This was an animation timing issue,
not a product correction or a new withdrawal journey. Those images and the
separate tab-transition-check.json preserve that distinction.

## Final checkpoint before the usage reset

Full QA on pushed candidate 0c1e7d70081ccbf6b63d256903463efbb210067d completed with exit 0, recovered from tool session 56986. Private log: /home/nathaniel/.local/state/openplan/response-write-probe-20260913/full-qa-0c1e7d70.log. Lint, Knip, 14306 tests with 451 skipped, provider checks, zero dependency vulnerabilities and the optimized production build completed, including all 135 static pages. Separate shuffled, restored-target live RLS and worker evidence is recorded in CONFLICT_AND_RESTORE.md. No owned QA/build process remains.

Remote main remains 3f70af98e6fb06b4c0f932769e10f880711d46ec. Candidate code is pushed on work/engagement-response-writes, not yet main or tagged. Next: refresh ownership and remote state, land directly on main without a PR, inspect CI for that exact main commit, then tag/publish v0.57.0 after applicable gates pass. Continue the full v1 goal afterward. Translation correction custody is a possible remaining M9b gap, not yet implemented; recheck the current roadmap before choosing the next lane.

Older failed-test and runtime statements below are historical wherever they conflict with this checkpoint and the linked current evidence. Saved files and commits are the recovery authority; do not assume old tool sessions or processes survive a usage reset. The owned dev server is stopped. Preserve named database stacks and the separate demo.
