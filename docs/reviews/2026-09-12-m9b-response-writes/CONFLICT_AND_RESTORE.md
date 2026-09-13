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
