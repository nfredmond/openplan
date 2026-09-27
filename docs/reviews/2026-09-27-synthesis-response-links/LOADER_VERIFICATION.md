# Authenticated synthesis response evidence

September 27, 2026. Internal checkpoint after `85b94b83`. This advances M9b source-to-response provenance. No new route, browser control, native link writer or public derivative is enabled.

## Behavior

`loadSynthesisResponseContext` uses the staff-authenticated native readers and the existing complete review/approval verifiers. It requires an approval for the observed current revision and a saved selected group. It verifies the whole response history before selecting the latest version of the named response. Missing, removed, corrupt or incomplete records and failed reads return no context, including database errors that also carry an earlier valid payload.

The extracted `readResponseHistorySnapshot` retains all existing envelope, count, identity, sequence, digest, scope and baseline checks. It returns exact stored text for private evidence construction. The existing staff history loader continues returning only parsed rows and its generic private error. The approval loader exposes its already verified review internally, avoiding a duplicate source/review load; the existing HTTP response still explicitly selects its original fields.

The resulting packet preserves the complete source snapshot, preparation, exact reviewed content, exact approval event and PostgreSQL response text. Correcting or removing the current response does not rewrite an earlier context. The new loader cannot establish an atomic current-head observation across multiple RPC reads. The native writer must recheck those heads under its locks before saving a link.

## Application fault controls

[Mutation evidence](loader-mutations.json) records 30 expected outcomes: baseline and harmless comment controls pass; 28 targeted faults fail at named checks. The final baseline has 35 tests across the loader and history files. Faults include accepting stale or withdrawn approval, selecting an earlier or unrelated response, accepting removed responses, skipping whole-history verification, ignoring a read error, losing exact stored text and adding raw records to the old staff response contract. All five recorded source hashes match the restored checkout.

The six-suite regression run passes 109 tests before two additional error-with-data checks. Final full QA includes those checks. Some scope checks overlap. Mocked RPC tests verify application behavior and exact arguments; they do not prove installed permissions, concurrent transactions, HTTP authorization or browser operation.

## Native join

The installed native join passes four cases: baseline, harmless SQL comment, corrupt rehashed approval revision reference and corrupt response history text. It calls the actual source/review/approval/response RPCs through production application functions, inside rollback SQL transactions. The retained packet contains 303 comments and answers, and response text matches `record_json::text` exactly.

The checks cover correction requiring its own approval, approval withdrawal, the latest corrected response, anonymous/viewer/foreign-workspace denials, later staff revocation and a still-readable original after response removal. A restored owner control returns the same packet. Appending a space to native response text without changing its digest is refused. Rehashing a false approval revision reference also fails. These controls prove native read joins, not an HTTP or PostgREST transport, a new native link write, lock ordering or concurrent link publication.

Two earlier fixture runs failed. The shared source fixture promotes its second member from viewer to owner, so that account correctly retained staff access. Demoting it broke the later original test's owner-floor constraint. The corrected fixture creates and checks a dedicated synthetic viewer inside the rollback transaction and preserves the existing second owner. No product permission was loosened. Failed and corrected logs remain in the private evidence directory.

## Verification status

Full QA passes: 15,669 tests pass and 629 are explicitly skipped, across 1,332 passing and 59 skipped files. Lint, configured dead-code analysis, provider connector checks, dependency audit and production build pass. The final build completes TypeScript checking. Existing unused export/type warnings remain visible; the internal loader is not yet connected to a route.

The full isolated RLS suite passes all 658 tests in 66 files against the installed 347-migration test stack, with candidate installation disabled. The named database is `supabase_db_openplan-restore-target-2026091050`, port 29822, container `a4181e334bb0`. The shuffled suite passes the same 15,669 tests with 629 explicit skips using seed 865719. [Check evidence](loader-checks.json) retains final source and private log hashes. GitHub CI is inspected separately after the push. No migration or worker implementation changes in this checkpoint. No worker rerun, upgrade claim, browser acceptance, release tag or capability-rating promotion is claimed.

The product-direction check passes with reminders that the September 7 review covers v0.44.0 while the current package is v0.63.0. Its review deadline is October 5; the review metadata remains unchanged.

## Remaining implementation

Add immutable link events and complete comment/reply/answer dependencies, exact retry recovery and transactional current-head checks. Join source changes, survey redaction, review/approval changes, response changes and public withdrawal in both commit orders. Then extend decision provenance and connect the staff controls with desktop/390px keyboard, console, recovery and artifact checks. Reviewed synthesis exports and optional complete resumable generation remain in M9b. The full V1 contract remains unchanged.
