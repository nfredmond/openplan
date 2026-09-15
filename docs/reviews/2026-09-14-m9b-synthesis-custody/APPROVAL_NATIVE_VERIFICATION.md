# Exact saved review approval database checkpoint

September 14, 2026. This extends the pure protocol in commit `061cd24fb8813ce9152f7d045bc1d6201ca58754`. It is an unreleased database increment, not a connected staff approval workflow. The complete M9b and V1 requirements remain open.

## Implemented

Migration `20261014000028_engagement_synthesis_approvals.sql` adds immutable approval events with exact intent, original event bytes and a generated digest. Its composite foreign key binds each predecessor to the same review and exact earlier event hash. Table access stays private with RLS and no client policies. Only the service role may call the writer; authenticated staff can use checked event/history readers. The future web route must bind the actor to the authenticated user before calling the service writer.

The writer checks current membership before recovering a request. Exact retries return the original event, actor and clock before stale-head checks. Changed retries fail. New approval compares the selected source/preparation, actual revision ID/hash/number, current revision and current approval-history predecessor. Withdrawal names the exact preceding approval and remains possible after a later correction. Corrections preserve their existing immutable `staff_draft` content and never receive an approval event automatically. This is internal staff synthesis review, not publication, adoption, funding or scientific authority.

Approval uses the same `engagement-synthesis-review:<review>` advisory transaction lock as migration 27's correction writer, plus its own request lock. Busy calls return `PT503` for exact retry. Membership and consultation share locks are held through the transaction. Complete private history returns count, order, head and exact event packets from one statement snapshot.

## Native evidence

The explicitly named isolated stack is `supabase_db_openplan-restore-target-2026091050`, API 29821 / database 29822. It remains installed through migration 27 with 346 migrations. Every candidate-schema and data-fixture run here used `BEGIN`/`ROLLBACK`; no reset or drop occurred. The candidate catalog reports 270 application relations, 256 tables, 14 views and 256 RLS-enabled tables, excluding extension-owned relations. The approval table has zero policies.

`engagement-synthesis-approvals-rls.test.ts` passed 39 cases without skips. `approval-native-results.json` records names and source hashes. Three ordinary/harmless/administrator controls, deliberate permission and custody faults, and six separate-session lock cases protect different boundaries. The native fixture constructs explicitly synthetic persistence records using existing source/review RPCs. The actual approval packet/history passes the production TypeScript protocol, including current approved versus original withdrawn state, exact actor and rejection of a different source digest. This is not the full production review-preparation/server join.

The separate-session cases place a real lock in a second PostgreSQL transaction and exercise the actual approval writer. Explicit synthetic review rows avoid acquiring the correction lock during fixture setup. Same-review and same-request locks refuse a write until released; an unrelated review lock permits it. A harmless control survives. Changing either production lock key permits a bad write and makes the same held-lock assertion fail. These are mutex and retry proofs, not two committed application writers racing against each other. Both complete approval/correction write interleavings and identical/competing request races remain required before release.

The regular database role cannot disable internal foreign-key triggers. That one fault and a matching harmless control run as the isolated local `supabase_admin`; application-facing operations still explicitly switch to service, authenticated or anonymous roles. The internal triggers are disabled only inside the fault transaction. Normal cases run as the existing `postgres` test role.

Integration checks passed 71 tests across five files. The final broader migration/permission/script guard run passed 65 tests across nine files and explicitly skipped nine live-only tests. It does not replace the 39-case native run. Focused ESLint and TypeScript with an 8 GB Node heap passed. `prove-approval-native-integration.py` ran 13 cases: baseline, harmless comment, six removed SQL classifications, three stale schema counts, disabled RLS and missing migration disclosure. Each produced its expected outcome, and every mutated file was restored to the recorded hash. Static checks cannot establish runtime access or a browser consumer. The final post-run catalog still reports 346 installed migrations through 27 and no installed approval-event table.

## Errors and repairs retained

- Initial hash-failure probes could have been refused by the separate duplicate-approval guard. They now use an otherwise valid withdrawal so a missing hash check reaches a bad write.
- Granting anonymous writer access initially survived because the test helper could not read its temporary input table. The fixture now lets anonymous probes read that synthetic input, so they reach the actual writer. The repaired permission fault fails for the intended assertion. No application table grant was broadened.
- The first database reason check accepted a string made only of BOM/nonbreaking-space characters. Native baseline tests reproduced the bad write. The SQL check now rejects that invisible blank reason; restoring the former expression triggers the retained targeted failure.
- The first internal-constraint fault failed during setup because `postgres` lacked permission to disable an internal trigger. That was not counted as a killed behavior fault. The isolated administrator control/fault pair now reaches and tests the constraint.
- Static column inventory initially reported six new unread columns. Each now identifies its actual SQL reader or foreign-key use; the descriptions explicitly preserve the unfinished browser connection. No fake application caller was added.

## Remaining work

Migration 28 is not yet installed on the local acceptance stack. Inspect this checkpoint's CI, then apply the additive migration to that named stack, implement the production application server/API with route-local actor binding and executable assistant-write refusal, and run installed native isolation plus the full TypeScript writer/recovery join. Complete real simultaneous writers and both approval/correction orders. The current native protocol join does not replace those checks.

Connect account/source-scoped pending commands and private history to the saved review inspector. Exercise real Engagement navigation, exact approval and withdrawal, corrections, unchanged originals, revoked/cross-workspace access and interrupted acknowledgement recovery at desktop and 390px with keyboard and console inspection. Reviewed response/decision connections, reviewed exports and optional complete resumable generation remain following M9b work. No new release or capability-rating promotion is justified by this database checkpoint alone.

CI `34910274557` and RLS Isolation `34910274599` completed successfully for the preceding pure-protocol commit `061cd24f`. Their results do not cover this new migration.
