# M2d.4 accounting period closure

Status: engineering acceptance complete locally, unreleased. GitHub results must be checked separately on the final pushed main commit.

Started from main `5dffba4b` after full QA, shuffled tests, RLS isolation and upgrade CI were green. Worktree: `/home/nathaniel/.local/state/openplan/m2d4-period-closure-2026-09-09`. Owned closeout API/UI/domain, additive migration, related tests and evidence. No other coding session was active. No draft PR, paid service or reminder change.

## Scope

Programs → Administer a reporting period → Saved reconciliation. An owner/admin closes a current issued management report against the exact latest approved reconciliation. The closure records its cumulative accounting dates, complete reconciliation, original baseline and human authority/reason. Outstanding claims, commitments and refunds remain visible. A separate reopening decision retains the original and requires a fresh reconciliation approval before reclosure. Later-period actuals, reports and reconciliation remain available without reopening the old period.

Database triggers protect the attributed OWP ledger, mapped time/spend, period/report records, claim changes, reconciliation changes and withdrawal of the closing baseline adoption. Both old/new identities and dates are considered. Program locks serialize writes with closure. These controls do not freeze every upstream M11 contract or external accounting system.

## Verification

The named disposable database is `supabase_db_m2d3-reimbursement-verification`, API 58821 and DB 58822. Workdir `/home/nathaniel/.local/state/openplan/m2d4-period-closure-verification` points at this checkout. Migration `20261005000001` applied successfully. Tests use rolled-back synthetic fixtures. No demo migration or reset.

Focused SQL and UI/API mutation controls retain harmless survivors and targeted failing behavior. Detailed results are linked below. Scratch evidence: `/home/nathaniel/.local/state/openplan/m2d4-period-closure-evidence-2026-09-09`.

Initial test mistakes reused a saved request ID, used an ambiguous SQL projection, and introduced an expense without corresponding reimbursement eligibility. These failed for fixture reasons and were corrected before mutation results were accepted. Review found and fixed reuse of an old approval after reopening and the prior global approval blocking later-period reconciliation.

## Remaining boundaries

This is an OpenPlan accounting-period control, not funder acceptance, cash settlement or full M2d.4 completion. Multi-target carryover, matching outbound refunds, independent two-cycle reconstruction/restore and practicing-finance usefulness remain open. Prescribed agency forms and automatic reminders remain unproved. Exact hashes prove custody, not the truth or sufficiency of authority evidence.

## Final local evidence

Application code: `d9e7ea2851b92d1db80f4aedc56b441664baa11e`. Final full QA used that application tree plus the subsequently committed late-receipt and stronger permission tests. Its [explicit exit receipt](final-qa-exit.json) is 0: lint, dead-code check, 13,445 unit/UI checks, 291 live RLS checks in 40 files, zero production audit vulnerabilities and production webpack build. There were 269 skipped tests in the ordinary suite; the separately opted-in RLS run executed its live tests. The shuffled suite passed 13,445 checks before the final live-only test additions, with 268 skipped. Final main CI must rerun both suites on the pushed commit. No worker code changed; worker CI remains a separately checked final-head gate.

[SQL mutations](sql-mutations.json), [UI/API mutations](ui-mutations.json), [inventory/census mutations](guard-mutations.json), [late-receipt tests](late-receipt-results.json) and the [concurrency proof](concurrency-results.json) cover 39 targeted failures and five harmless controls. Removing the program lock lets a mapped source update through while closure is uncommitted; with the lock, it waits about 2.9 seconds, then receives the closed-period refusal. Tests cover valid forbidden writes, including direct service insertion and unauthorized reopening. Initial probes that encountered malformed requests or duplicate keys were strengthened before accepting the final mutation results.

The [populated upgrade](upgrade-results.json) applies released reimbursement and merged reconciliation migrations inside a transaction on `supabase_db_m11-contract-verification-upgrade`, retained at 306 migrations. It prepares an approved synthetic reconciliation, applies the new closure migration, and compares counts/hashes across eleven existing source/history tables. Baseline and harmless comment preserve all contents; a changed saved program title is detected. Every exercise rolls back. This verifies forward data preservation, not a complete independent disaster restore.

## Browser acceptance

The [identified build](build-identity.txt) is served from this isolated checkout on 3261. Installed Chrome used fresh contexts and real navigation: sign in → dashboard → Programming Cycles → program → Administer a reporting period → Saved reconciliation. Both 1440px and 390px used keyboard activation; mobile used the module picker, and Tab from the source selector reached Reload reconciliation. An all-zero expected SHA failed before financial actions.

[Browser results](browser-results.json) retain final closure/reopening versions and console output. A server-success/lost-response injection survived reload and recovered the same request once. Both widths closed the August period over cumulative dates July 1 through August 31. Source corrections and claim submissions received 409 while closed. Reopening retained the original; an attempt to reclose under the old approval received 409. A fresh reconciliation review/approval then permitted continued closure work. The 3.00 unpaid claim and 15.00 obligation stayed visible, with no second expense.

The original period decision downloaded at both widths with identical SHA256 `bf22d76edb43920e2c26001b167d433a537ca3ef30535791d5464175f98b747f`. Final captured decisions were 13→14 at desktop and 15→16 at 390px. Earlier concurrency/capture decisions remain retained.

[Access checks](access-results.json) confirm owner access, private no-store caching, anonymous 401, ordinary member 403 and foreign-workspace owner 404 for reads and writes. The earlier reconciliation approval and original period decision remain identical. Physical ledger entries remain three. Private downloaded JSON and logins stay outside the repo.

[Desktop closed](closed-period-1440.png) · [390px closed](closed-period-390.png) · [Desktop reopened](reopened-period-1440.png) · [390px reopened](reopened-period-390.png). All four screenshots were inspected. Controls and text fit the viewport without document-width overflow. Closed/reopened status, scope and the decision button are visible; the button requires newly entered evidence. Console output contains only the deliberately injected failed request, with no unexpected warnings/errors. These agent-operated cases do not establish practicing-finance usefulness or comprehensive screen-reader acceptance.

## Execution errors and limits of the checks

The first QA run failed because I omitted the new table/policy inventory counts and introduced copy caught by the wording guard. Both were corrected without weakening guards. A later aggregate QA process returned SIGTERM despite complete component output, so it was not counted as a clean pass. A supervised repeat retained exit 0. The acceptance server also received SIGTERM between runs, with sender undetermined. I then allowed a repeat capture to overlap QA replacing the build files, causing missing-manifest errors. Final browser/access acceptance ran after the completed production build, with the server restarted and identified again. The first abbreviated commit stamp failed identity checking; the full commit stamp passed.

SQL cannot prove browser reachability or genuine external authority. Mock HTTP tests cannot prove RLS. The census depends on declared table coverage; its targeted omission failed. The guard freezes attributed OWP sources and linked claims/receipts, not every upstream contract system. Exact retries and hashes protect custody, not completeness of financial records. Independent two-cycle reconstruction/restore, outbound-refund matching, richer carryover and human finance acceptance remain subsequent M2d.4 work. No full administration, funder approval or release claim is made.
