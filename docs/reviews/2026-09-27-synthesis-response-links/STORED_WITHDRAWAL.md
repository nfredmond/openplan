# Stored withdrawal for synthesis-linked responses

September 27, 2026. Extends the public eligibility checkpoint at `240bc4f2`. The SQL remains a rollback-only candidate outside installed migrations. It does not activate an application workflow or declare a release.

## Behavior

The private reconciliation helper takes the response campaign lock and moves currently published, ineligible synthesis-linked responses to draft. It clears the publication timestamp and retains one finalized response-write receipt with the prior response, actual actor, changed source kind, and before/after cause records. The existing response history records the unpublished version, reason and receipt identity. Reconciliation of an already withdrawn response creates no additional receipt. Original link bytes and old exact-request recovery remain available; replay does not restore publication.

Comment and reply changes, survey-answer changes or deletion, session review/privacy changes, review corrections and approval events invoke reconciliation. Retained comments still refuse deletion through the existing history foreign key. That refusal leaves publication and source data unchanged. Link writes reconcile after inserting the complete dependency index, avoiding a temporary incomplete index during event insertion. Unrelated responses and harmless vote or display-order changes retain their current publication behavior.

Review and approval writes can originate from a service call with an explicit retained actor and no end-user JWT. History accepts that actor only through an unfinished private source-withdrawal receipt for the exact response. The candidate does not change the JWT to impersonate that actor. Caller-supplied request context alone does not create a receipt. The helper restores the prior request context after retaining history.

The helper requires READ COMMITTED. A fixed transaction snapshot could otherwise miss a newly committed publication after lock acquisition. Its campaign lock is nonblocking because source and review callers may already own other row or review locks. A busy lock rejects the source transaction with PT503; retry after release can proceed. Direct execution remains revoked from anonymous, authenticated and service roles.

## Evidence and discovered test limits

The source scenario includes 303 retained records and a 302-member group, with survey answers and a reply whose retained parent is outside that group. Public and staff snapshots, report selection, publication refusal, exact link recovery, immutable original bytes, withdrawal receipts and response history are checked against actual PostgreSQL functions. Each source change runs under a savepoint; rollback restores the original published control and its entire prior history.

The first expanded withdrawal run fails because its comment-deletion setup conflicts with the existing history foreign key. The corrected test requires that custody refusal and separately tests successful answer deletion. No foreign key is removed from the candidate. A deliberate fault removes that foreign key only within the rollback test and is detected by the custody assertion.

A granted helper could still fail with a downstream table permission error, masking the unexpected execution grant. The permission check now inspects execution privilege as well as the actual denied call. Another fault removes the published-status filter; the duplicate-reconciliation assertion detects the resulting extra receipt. Its expected assertion text is corrected to that observed failure without weakening the product condition.

The second-session tests build a published control using temporary, distinct setup lock keys, restore every original function definition, then hold the real campaign lock in another PostgreSQL session. The held-lock case refuses an answer edit and preserves the published response and original answer. Releasing the lock permits the same edit and retains exactly one withdrawal receipt. Unrelated-lock and harmless-comment controls pass. Replacing the helper's real lock key causes the expected refusal assertion to fail. These are lock-barrier tests, not proof of both concurrent commit orders.

The complete run passes all 83 native cases: 17 baseline, isolation and lock controls, and 66 deliberate fault cases. [Check evidence](stored-withdrawal-checks.json) records source and private log hashes. After rollback, the candidate event table, withdrawal helper and publication triggers are absent; the history function is restored and the installed migration count remains 347. Lint and a 6144 MB TypeScript check pass for the expanded test source. Full QA, shuffled tests and the ordinary live RLS command are separate checks; this uninstalled candidate is exercised by the focused native command documented in [NATIVE_CANDIDATE.md](NATIVE_CANDIDATE.md).

## Remaining installation boundaries

Run actual concurrent publication/source and publication/review transactions in both commit orders. Held advisory locks establish refusal and rollback, but do not establish all visibility and commit-order behavior. Finish validation and relational-constraint fault coverage before migration promotion.

Join retained-download authorization to current public eligibility. `publicReviewStillCurrent` still compares raw response rows. The existing `read_engagement_response_snapshot` RPC provides a migration-compatible path for checking current public response eligibility, but its application join and artifact evidence remain unfinished. Test withdrawal, changed approval, later republication, exact retained files and original checksums. Public report selection, export workers and retained downloads are distinct paths.

Application link/history verification, authorization, exact-request recovery, durable client intent, decision provenance and staff controls remain unfinished. Installation requires an additive migration, populated upgrade and isolated installed-schema evidence. UI claims require identified desktop and 390px journeys, keyboard use, console inspection and usable artifacts. Reviewed synthesis exports and optional complete resumable generation remain M9b work. The full V1 contract remains unchanged.

## Subsequent download repair

The [download eligibility repair](DOWNLOAD_ELIGIBILITY.md) replaces the raw response read described above and adds independent survey privacy checks. Its report distinguishes current application protection from the uninstalled native candidate and remaining browser/concurrency acceptance.
