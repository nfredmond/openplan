# Reconstructed thematic input custody

October 1–2, 2026. Local continuation from `309e2813`, on base `24022411`.
Code checkpoints `309e2813` and `1fd2450f` are backed up on remote branch
`work/engagement-synthesis-generation`. They remain outside main while the
correction owner retains PR 112's merge path. UI main `8cb534f5` is observed
separately and is not included in the local baseline checks. No CI run for
`1fd2450f` is present on direct inspection after that branch push.

## What the change retains

One worker command replays the original source, parent results and chosen context
through the explicit native preparation reader. It stores a proof containing the
new request, actor, intent, thematic binding, source, contribution, choice,
context binding, history, final capture and result hashes. The original final
provider output is stored separately as exact text with its own digest.
PostgreSQL does not coerce that output to `jsonb`, preserving escaped Unicode that
can appear in historical provider output. The proof actor identifies the new
thematic requester. It does not attribute earlier machine output to that person;
its original provider and attempt authorship remain in the pinned history.

The additive `20261015000006` migration creates one private immutable table.
Only the named service command can insert. Its transaction locks the request,
rechecks current requester membership, campaign, stage and native preparation,
then compares every supplied proof field with retained originals. The server
compares the saved acknowledgement against its reconstructed bytes.

An exact native retry returns the first write and timestamp, including after
cancellation. Recovery reads require the new thematic requester to remain staff.
Fresh preparation and new writes still refuse cancellation. Current staff can
inspect the saved record through a separate authenticated history command after
the earlier requester departs. Neither path changes authorship or grants work.

These records prove byte custody. Native JSON comparisons alone cannot replay a
model's original task or verify semantic quality. A future executor must replay
the originals and compare the complete proof and output before using the input.
It must also verify the complete source set and its seal. There is no new task,
resource grant, provider dispatch, review import, approval, route or UI here.

## Verification record

The preparation fixture is extracted into a shared test helper. Its existing
22 tests and the 11 new application custody tests pass together. Transport is
mocked; actual source and historical continuation reconstruction still run.
Tests distinguish absent records from denied reads, recover an unconfirmed save
without another reconstruction, preserve original output bytes, and reject
altered scopes, hashes, output limits and save acknowledgements.

The first native candidate run passes 39 checks. With the additional isolated
campaign-scope probe, candidate and installed runs each pass 40 checks, including
a harmless comment and 38 deliberate faults. The installed run takes 71.13
seconds. Candidate SQL and inconsistent fixtures roll back. The migration is
installed only on the owned `openplan-restore-target-2026091050` stack. Its catalog
has 274 application tables, all with RLS, and 14 application views. PostGIS's
reference table and two metadata views are extension relations, excluded from
those application counts. The native synthetic proof does not claim valid model
execution.

The four focused suites pass 67 tests, including schema accounting and the
extracted preparation fixture. Changed-file lint passes. Schema guards preserve
a harmless comment and detect an unaccounted column and missing RLS. No native
table is changed for those source-only mutations.

The first application fault run detects 26 faults and preserves the harmless
control. One output-digest fault survives because the fixture also breaks the
proof's output-hash comparison. The corrected fixture supplies the same wrong
hash to both fields, isolating comparison with the actual output bytes. That
fault now fails an assertion, and its harmless control passes. All 27 targeted
application faults are detected after this correction. The original survivor
remains in the [mutation record](thematic-custody-mutations.json); no production
check was weakened.

The native HTTP recovery case passes in 147.07 seconds. It reconstructs actual
retained task history, saves exact original output, reads and retries that input
after cancellation, then refuses custody and staff-history reads after membership
revocation. PostgreSQL, PostgREST and the local worker are real; the provider is
synthetic loopback. This does not establish semantic quality, billing, browser
usability or whole-source readiness. The harmless HTTP control passes in 149.77
seconds total. Deliberately replacing the reconstructed final-result binding with
a zero hash fails at the native save, as expected, in 144.48 seconds. The caller
reports the save as unconfirmed rather than returning a saved input. The source
returns to its recorded digest after both runs.

Full `npm run qa:gate` passes on `309e2813` plus this custody change:
16,831 application tests pass and 1,312 skip; 382 connector tests pass and four
skip; lint, configured deadcode check, dependency audit (zero findings) and the
production build, including TypeScript, pass. The ordinary gate skips live RLS;
the separate installed native and HTTP results above cover the changed boundary.
The later UI commits `bb0dad34` and `8cb534f5` and correction PR 112 are not in
this baseline. No main or release acceptance is claimed for this branch checkpoint.

The initial test-file creation used an extra `openplan/` prefix while already in
the application package. No file was created there. The corrected invocation
created the intended test and ran both suites. Initial TypeScript checking found
an inferred variable-length mutation tuple; explicit tuple types correct it.

## Remaining connected outcome

Retain every selected item and survey answer, verify exact membership and ordered
input hashes, and seal the complete source set. Continue bounded thematic tasks
with a distinct frozen recipe and fresh resource authorization. Preserve complete
original contributions, historical definitions, machine notes and uncertainty.
Retain the original proposal, then require explicit staff import into a reasoned
review revision with its exact expected parent. Existing approvals stay attached
to their original revisions. Complete the desktop and 390px identified-build
Analysis journey and the rest of M9b. The full v1 contract remains unchanged.
