# Translation history browser and upgrade evidence

Unreleased implementation at b81d932cc306e3527818f1f39d4b58d359cce604, September13.
The isolated next dev process on3260 was identified by which-openplan.sh as the
engagement-response-writes-2026-09-12 checkout. No production source changed during
these journeys. See browser-acceptance.json for source, migration, original record
checksums, viewport widths, console entries and capture hashes. Private scripts,
raw synthetic captures and logs remain under
/home/nathaniel/.local/state/openplan/response-write-probe-20260913.

Desktop1440 and narrow390 journeys enter from the root, sign in, navigate to
Engagement, create and activate a synthetic campaign and enter Setup. Keyboard
navigation opens Spanish editing and translation history. A real save commits
before its acknowledgement is deliberately interrupted; the browser retains the
exact draft and retries the same body. This is current duplicate-save behavior,
not proof of a durable receipt or concurrent-write protection.

A controlled history-read outage persists until the user explicitly retries.
The complete private read returns the original revision. Correction refreshes the
public Spanish title and retains the exact original entry. Withdrawal restores
the public source title while retaining all three history revisions and the
original configuration snapshot. Both widths have zero horizontal overflow.
Images were inspected: retained revisions and their origin/unknown-source labels
are readable, and the public corrected title appears in Spanish. History exceeds
a phone viewport and requires vertical scrolling. Public map access is unavailable
in this local configuration; that disclosed limitation was not fixed or tested
as part of translation custody. Machine translation was unavailable without an
API key; these journeys prove manual wording and history, not language quality.

Both final browser consoles contain only the two deliberately induced ERR_FAILED
resource errors, with no page exceptions. Network captures also contain cancelled
map requests while navigating away and the first history effect cancellation.
The earlier ERR_NETWORK_CHANGED attempts and stopped restore companions remain
recorded in RESUME.md and retired-restore-loops.json.

Two browser-runner corrections were necessary. The initial first-request-only
outage was consumed by a cancelled request and the next read succeeded, leaving
no error alert to assert. Holding the outage until explicit recovery tested the
intended behavior. A later response wait rejected before its await and ended the
Node process without failure captures. Pending waits now have rejection handlers;
the correction step brings the staff page to the foreground and checks enabled
keyboard focus after visiting the public page. Subsequent journeys completed.
These were runner changes; no app fix is claimed for these failures. A harmless
comment control survived the full desktop journey. Replacing the successful
history response with an empty array failed immediately at the original revision
count, expected1 and received0. See browser-controls.json.

The retained restored disposable database2731143 upgraded327 to328 through normal
Supabase migration up. A fresh full backup was retained first. Exact row-count/
JSON hashes of all277 pre-existing public/auth/storage tables were unchanged.
It had zero current translations, so legacy baseline preservation relies on the
separate app-stack install and earlier positive legacy fixture. See
restored-upgrade-328.json and installed-328.json. Neither new backup has itself
been independently restored again. The retained stack's full live suite passed52 files and482 tests in424.79seconds,
including the strengthened source-removal fixture. All52 worker suites completed
successfully. The first shuffled run failed two inventory assertions because the
new relation and policy were missing from expected totals;14343 other tests
passed. The totals were corrected after inspecting the installed catalog.
The ordinary QA run was stopped during lint before this test-only correction.
Final QA and shuffled results must be recorded before merge/release claims.

The read/history proof does not close atomic translation writes, correction
reasons, retained original source text, durable generation/spend accounting or
cache completion provenance. RESUME.md lists these remaining software gaps.


## Local release gates

Full QA passed lint, dead-code checking,14345 tests with453 intentional skips,
382 provider connector tests with4 skips, zero dependency audit vulnerabilities,
and the webpack production build. Shuffled seed913328 passed the same14345 tests
after the inventory correction. Live restored RLS passed482 tests and all52
worker suites passed. See local-checks.json for terminal outcomes and log hashes.
The inventory's baseline and harmless comment survive; removing its staff policy,
RLS declaration or entire migration produces the corresponding failure.

The v0.58.0 release records are being prepared. Final release metadata checks and
exact-commit GitHub CI precede tagging; this document does not claim publication.

Release accounting baseline and harmless comment pass; a wrong328-to327 migration
count fails the release-ordering guard. The product-direction check caught one
stale roadmap release header during preparation; it was corrected without
changing review dates or capability grades. The check and focused changed-test
lint then passed. Local QA was run before version-only release metadata edits;
final release commit CI verifies the release package before tagging.
