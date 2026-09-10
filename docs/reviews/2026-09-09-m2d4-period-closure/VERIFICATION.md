# M2d.4 accounting period closure

Status: implementation checkpoint, unreleased. Final QA, browser acceptance and pushed-head CI are pending.

Started from main `5dffba4b` after full QA, shuffled tests, RLS isolation and upgrade CI were green. Worktree: `/home/nathaniel/.local/state/openplan/m2d4-period-closure-2026-09-09`. Owned closeout API/UI/domain, additive migration, related tests and evidence. No other coding session was active. No draft PR, paid service or reminder change.

## Scope

Programs → Administer a reporting period → Saved reconciliation. An owner/admin closes a current issued management report against the exact latest approved reconciliation. The closure records its cumulative accounting dates, complete reconciliation, original baseline and human authority/reason. Outstanding claims, commitments and refunds remain visible. A separate reopening decision retains the original and requires a fresh reconciliation approval before reclosure. Later-period actuals, reports and reconciliation remain available without reopening the old period.

Database triggers protect the attributed OWP ledger, mapped time/spend, period/report records, claim changes, reconciliation changes and withdrawal of the closing baseline adoption. Both old/new identities and dates are considered. Program locks serialize writes with closure. These controls do not freeze every upstream M11 contract or external accounting system.

## Verification in progress

The named disposable database is `supabase_db_m2d3-reimbursement-verification`, API 58821 and DB 58822. Workdir `/home/nathaniel/.local/state/openplan/m2d4-period-closure-verification` points at this checkout. Migration `20261005000001` applied successfully. Tests use rolled-back synthetic fixtures. No demo migration or reset.

Focused SQL and UI/API mutation controls retain a harmless survivor and targeted failing behavior. Detailed results will be retained after final acceptance. Scratch evidence: `/home/nathaniel/.local/state/openplan/m2d4-period-closure-evidence-2026-09-09`.

Initial test mistakes reused a saved request ID, used an ambiguous SQL projection, and introduced an expense without corresponding reimbursement eligibility. These failed for fixture reasons and were corrected before mutation results were accepted. Review found and fixed reuse of an old approval after reopening and the prior global approval blocking later-period reconciliation.

## Remaining boundaries

This is an OpenPlan accounting-period control, not funder acceptance, cash settlement or full M2d.4 completion. Multi-target carryover, matching outbound refunds, independent two-cycle reconstruction/restore and practicing-finance usefulness remain open. Prescribed agency forms and automatic reminders remain unproved. Exact hashes prove custody, not the truth or sufficiency of authority evidence.
