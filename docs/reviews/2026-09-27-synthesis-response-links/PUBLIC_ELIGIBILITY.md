# Current publication eligibility for synthesis-linked responses

September 27, 2026. Rollback-only extension to the native candidate at `46172625`. The SQL remains outside the migration directory. Application activation, automatic status withdrawal and full public artifact acceptance are unfinished.

## Implemented boundary

The private evaluator checks every current active synthesis link for a response. It compares current reviewed content and the exact approval event with the retained context. It compares response wording and source attribution while allowing publication status, timestamps and display order to change. A published response does not invalidate its own evidence link. An unrelated response with no synthesis history retains its existing publication path. Once a response has synthesis history, withdrawing its last active link does not silently restore eligibility.

The evaluator checks the normalized dependency index against the entire selected group. Current comments must retain their recorded meaning and allow public use. A reply also requires a retained, unchanged public parent, even when the parent is outside the selected group. A missing retained parent remains insufficient evidence for publication. Vote counts and review timestamps do not change the retained wording; private metadata still blocks publication.

Survey dependencies include the complete answer record, not a translation into comment IDs. The answer must match its retained text and structured value. Its session must retain the recorded identity, configuration, source and review status and currently permit public use. Reviewed redaction, withdrawal and explicit private metadata make the response ineligible. Empty legacy comment IDs do not bypass these checks.

A scoped wrapper exposes a boolean only for an existing response readable by the caller. Workspace members and the service reader can use it. Anonymous and foreign-workspace callers are denied. The evaluator that accepts arbitrary record text remains private, preventing callers from probing historical wording through that function.

The candidate joins eligibility to the existing native publication trigger, the complete public response snapshot and public report selection. The snapshot preserves invoker RLS and its explicit public field projection. Filtered reports include a linked response only when every active linked comment and answer belongs to the report's selected records. Internal reports preserve their existing selection of published responses and retain evidence that the public report excludes. No private synthesis packet or review reason is added to a public response or report.

## Verification

The public scenario uses a complete 303-record retained source, including two answers. Its selected group contains 302 members, including a reply whose parent remains in the retained snapshot outside that group. The scenario checks public snapshots, private snapshots, publication refusal and actual queued public/internal report bytes for each isolated change. Each change rolls back to the same eligible published control. The original native event/retry/lock cases are rerun alongside the new public cases.

Initial public tests fail before exercising the product condition because the rollback adapter reads every result into JSONB. PostgreSQL boolean output needs explicit `to_jsonb`, and successful direct DML needs a `RETURNING` expression. The corrected adapter returns `NULL::jsonb` for direct DML. This also strengthens the earlier immutability fault checks: a disabled trigger now permits the mutation inside the test transaction instead of encountering an unrelated adapter error. Existing baseline and fault assertions remain.

The positive public scenarios pass after those adapter corrections. The expanded run passes all 58 native and public cases, including nine baseline/lock controls and 49 deliberate fault cases. [Check evidence](public-eligibility-checks.json) records final source and private log hashes. Candidate tables and the new eligibility function are absent after rollback; the installed publication guard is restored and the migration count remains 347. Lint and a 6144 MB TypeScript check pass for the expanded source. Some approval/head checks overlap; the corresponding fault removes the combined comparison rather than claiming independent proof of every clause.

## Still required before installation

Automatic withdrawal must update the stored response to draft, retain a receipt/history event and keep retries exact when comments, reply parents, survey answers/session review, review content, approvals or links change. Test both commit orders and real concurrent writes under the existing response and review locks. Current read-time filtering is not proof of that stored-state workflow.

`publicReviewStillCurrent` currently reads response rows directly when authorizing retained downloads. Join that path to the new dependency rules and verify approval withdrawal, source changes and later republication with original bytes preserved. Public reports, export workers and download authorization are separate checks. The current candidate does not prove every artifact reader safe.

Complete the remaining native validation and relational-constraint fault coverage, application event/history verification, route and client recovery, decision provenance and usable staff controls. Then promote an additive migration with installed-schema, populated-upgrade and identified desktop/390px browser evidence. Reviewed synthesis exports and optional complete resumable generation remain M9b work; the full V1 contract is unchanged.

## Subsequent candidate

The [stored withdrawal extension](STORED_WITHDRAWAL.md) adds receipt-backed draft status after dependency changes. This later rollback candidate preserves the earlier public-read checks. Its report states the remaining concurrency, download and installation boundaries.
