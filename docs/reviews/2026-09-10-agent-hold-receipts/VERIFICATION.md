# Approved HOLD recovery, backend checkpoint

Worktree `~/.local/state/openplan/agent-hold-receipts-2026-09-10`, branch
`work/agent-hold-receipts`, based on released v0.49.4 at 4d02130b. This is not a
release candidate or a completed browser workflow. It continues roadmap A1a.

The existing approval table gains a context snapshot; the existing action ledger
gains a versioned result receipt and a unique approval index for those receipts.
Historical audit rows remain unchanged. Approval preparation captures the current
workspace binding, registered gate and prior decision. The transaction hashes the
canonical action text itself, parses that same text for the decision, and saves
the decision, verified audit receipt and consumed approval together. The route
checks a retained receipt before checking whether current context permits new
work. A current viewer may recover their earlier result but cannot execute a new
HOLD. A revoked member cannot recover it. Manual PASS/HOLD remains a separate
human-authored decision route.

PostgreSQL row locks are the proposed serialization mechanism. The [PostgreSQL
locking documentation](https://www.postgresql.org/docs/17/explicit-locking.html)
explains the conflict between FOR UPDATE and key/shared row locks. Actual races
with concurrent manual writes, binding changes and process loss remain to test;
documentation is not concurrency acceptance.

The additive migration applied through Supabase to the explicitly owned disposable
stack `openplan-restore-target-3390964`, API22301/database22302. No reset or demo
migration was used. Fourteen live database tests pass. They cover exact receipts,
replay after expiry/context change, stale context, original-user/workspace binding,
viewer/revoked access, unused expired/legacy approvals, ledger RLS and complete
rollback when decision/audit/approval writes are suppressed. The first fixture
attempt demoted its only owner, correctly hitting the owner floor before the
intended probe. A separate fixture custodian now preserves that invariant.

A harmless SQL comment survives. Removing payload matching, workspace/prior-decision
checks, audit confirmation, original-caller checking, expiry, function privilege
restrictions or receipt-read access fails the intended assertions. Disabling ledger
RLS exposes the synthetic receipt and fails the cross-workspace probe. A no-effect
success mutation fails the exact-decision assertion. Each mutation was restored;
logs were inspected, including the specific SQL failure messages.

135 focused tests across seven files pass, including migration inventory and the
existing manual/agent scope checks. TypeScript and scoped ESLint pass. Browser-side
route fixtures now model a transaction response, not the former separate database
writes; the live tests carry the atomicity claim. Helper tests assert query fields,
scope, canonical dispatch, exact receipt data and refusal statuses. Harmless source
comments survive. Missing projections/filters, ignored failures or scope, changed
receipt content, dropped approval context, absent route verification/transaction
calls and skipped recovery each fail their intended assertions. Source-call guards
only establish calls; they cannot establish runtime ordering or SQL correctness.

Two commands were initially invoked from the repository root rather than the app
package and failed before their checks ran. Corrected app-root invocations provide
the evidence above. Do not count those startup failures as product failures or
successful checks.

Remaining before a release: simultaneous requests/manual changes, process-loss
recovery, durable browser recovery after navigation/reload, native desktop/390px
journeys and console inspection, full QA/shuffle/workers/isolated RLS, upgrade and
final-main CI. Other actions still use separate effect/audit operations. No external
agent identity, assignment system, provider adapter or scientific claim is added.

Next implementation choice: expose recovery through the existing Planner Agent
Activity page. Prefer server-retained exact approved action data over an unscoped
browser-storage queue. A result lookup must never mint new approval or silently
re-execute work. An explicit resume may reuse valid unchanged consent; expired or
stale consent must return to review. Keep historical uncertain executions visible.
