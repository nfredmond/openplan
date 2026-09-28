# Committed synthesis response concurrency

September 27, 2026. Continues main commit `9ea82cde`. Candidate SQL remains outside installed migrations. This work addresses publication and withdrawal under concurrent transactions; it does not establish a browser workflow or release.

## Defect and repair

A committed two-session probe reproduces stale publication under `REPEATABLE READ`. The publisher first reads the old answer. A second actor changes that answer while holding the shared campaign lock. The publisher waits for the lock, resumes after the source change commits, and publishes using its old transaction snapshot. The old candidate permits the publication transaction to commit. A new connection then sees a stored `published` response that should remain `draft`.

The publication trigger now requires `READ COMMITTED` whenever the resulting response is published. A fixed snapshot receives SQLSTATE `25001`; draft writes remain allowed under `READ COMMITTED`, `REPEATABLE READ` and `SERIALIZABLE`. The rule also applies when the snapshot contains no synthesis links, since that snapshot cannot establish the absence of a newly committed dependency. Existing native source reconciliation already requires `READ COMMITTED`.

The targeted fault removes this publication guard and reproduces the committed stale response. Another fault restricts the guard to visible links, which the no-link isolation control detects. Ordinary publication and draft controls check that the repair permits valid work.

## Owned database and transaction evidence

Each committed probe creates a uniquely named database inside the explicitly selected isolated Supabase stack. It copies schema, grants and owners without source rows, then installs candidate definitions and synthetic fixtures in that owned copy. The second connection confirms the committed link and exactly three fixture users. The original `postgres` database receives no committed candidate DDL or fixtures.

Cleanup requires the original random ownership marker and exact disposable name. It uses no force option. An unexpected connection therefore prevents cleanup instead of being terminated. Unit controls cover refused names and stacks, changed ownership, schema-only copy, explicit connection targets, restore and callback failures, and a failed ownership-marker write. The mutation runner restores helper source after every case and on exit.

Publication-first and source-first probes exercise comments, a reply parent outside the selected group, answers, survey review, survey privacy, approval withdrawal, review correction, link withdrawal and a harmless vote-count change. Separate publisher and source actors exercise retained attribution. The tests inspect `pg_blocking_pids` to prove blocking requests wait on the intended transaction. Nonblocking source changes must return `PT503`, roll back, and succeed after publication commits.

After commit, the tests inspect stored publication status, withdrawal receipt count and actor, original link bytes, public snapshot eligibility and exact request recovery. An old publication retry returns its retained result without publishing the response again. The vote-count control stays published. Targeted faults remove either campaign lock, answer reconciliation, stored withdrawal, current publication checks or fixed-snapshot protection. A harmless SQL comment preserves behavior.

## Verification record

The original fixed-snapshot probe fails after committing the stale publication. The first commit-order run passes 16 of 18 cases. The two survey-review fixtures incorrectly read a private session timestamp as an authenticated user; passing the already saved timestamp to the real review RPC corrects the fixtures without changing access rules.

The first repair run passes 12 of 13 selected cases. Its remaining positive publication control changes response wording and receives the expected existing approval conflict. Correcting that control to change publication status alone yields 31 passing focused concurrency and isolation cases. Subsequent controls add the publication-writer lock fault and no-visible-link scope checks.

The disposable-helper proof has a passing baseline and harmless control, with 14 targeted defects detected. An initial mutation of the connection default is rejected by the name guard before reaching the expected argument assertion. The final run substitutes a different valid disposable name and detects the incorrect default at that assertion. No guard is weakened to accommodate the test.

The final native suite passes all 122 cases: 48 positive or harmless controls and 74 targeted fault cases. Lint and TypeScript checks pass. After cleanup, no disposable probe databases or candidate objects remain; the installed publication guard is unchanged and the migration count remains 347. [Check evidence](concurrency-checks.json) records final source and log hashes. The parent main commit has passing full CI, shuffled tests and RLS isolation. This candidate-only checkpoint does not repeat the full local QA, worker or upgrade suites; exact-head GitHub checks follow the push.

## Limits and next work

These tests use native PostgreSQL sessions and synthetic records. They do not exercise HTTP retries, browser navigation, storage delivery, production contention, or a transaction spanning an eligibility check and streamed artifact bytes. The copy/cleanup unit tests mock process calls; the native two-session control separately exercises the actual schema copy and cross-session visibility.

Continue with remaining native constraints, verified application link/history records, authenticated routes, durable client recovery and decision provenance. Promote an additive migration only with populated-upgrade evidence. Verify the integrated workflow at desktop and 390px with keyboard navigation, console inspection and saved artifacts before a release claim. Reviewed synthesis exports and optional complete resumable generation remain M9b work. The full V1 contract is unchanged.

The next [record-reader increment](RECORD_VERIFICATION.md) verifies application event/history/receipt parsing against the native candidate while retaining the remaining authorization and activation boundaries.
