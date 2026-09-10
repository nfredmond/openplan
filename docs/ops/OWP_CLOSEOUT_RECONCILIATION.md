# OWP closeout reconciliation

This is a private owner/administrator workflow in Programs. It retains review and carryover evidence. Period closure is a separate decision below; neither action posts expenses or establishes funder approval. Apply `20261004000001_work_program_closeout_reconciliation.sql` before using it.

1. Open a program, choose **Administer a reporting period**, then **Saved reconciliation**. Select an issued management report. Its baseline and source cutoff remain fixed; an interim report is labelled as such.
2. Describe the claim register and reconciliation evidence. Match each receipt to an approved **payment** already entered through Actual work. Use the same currency as the report. Combined matches cannot exceed that physical payment. Acceptance alone never means cash was received.
3. Match outgoing refunds to existing approved payment entries after checking the recipient and outgoing bank/accounting reference. Explain that decision in the claim evidence. A payment cannot be both an incoming receipt and an outgoing refund, or be allocated beyond its amount across the latest approved reconciliations of different baselines. Corrections retain the physical entry identity; reopening another baseline keeps its last approved allocation reserved until replacement approval. Assess refunds due and each retained commitment's outstanding amount, with the evidence for its discharge or remaining obligation. Blank means unknown; enter zero only when the responsible reviewer has established zero. Unknown assessments can remain drafts but cannot be approved.
4. For unfinished work, prepare and adopt the successor cycle through Programming Cycles first. Select its exact baseline, work element and a carryover fund, then the source fund, amount and authority evidence. The successor may overlap the old cycle but must start later and use the same currency/workspace. Each work element currently supports one fund/successor mapping. Fund ceilings are checked across source cycles and successor amendments; they do not calculate available cash or interpret funding conditions.
5. Save the draft. Add approval evidence, then choose **Save reconciliation approval**. The server checks current source identity and retains the exact assessment. To correct it, provide reopening evidence and choose **Reopen approved reconciliation**. Earlier approvals remain downloadable. Approved carryover stays reserved during reopening and draft changes until the replacement is approved.
6. If a save's outcome is uncertain, **Retry reconciliation save** uses the retained request, including after reloading the page. A conflict means reload and reconcile current evidence. A failed history read hides exports until recovery. Save any retained version as private JSON to review its source, successor, approval and earlier claim evidence.

The unpaid claim and outstanding obligations remain with the old cycle. Carryover links work and funding; it creates no second expense. The separate period decision below protects closed accounting dates. Split/merged, multiple-fund carryover remains unfinished. The JSON is retained evidence, not a general import/restore command. Agency-form compatibility, actual authority and practicing-finance usefulness require separate acceptance.

[Engineering evidence and limits](../reviews/2026-09-09-m2d4-settlement/VERIFICATION.md) · [Reimbursement operation](OWP_REIMBURSEMENT.md) · [Roadmap](../ROADMAP.md).

## Close or reopen an accounting period

After saving a current reconciliation approval, use **Accounting period closure** in the same workspace. Enter the responsible authority and reason in the approval/reopening evidence field, then choose **Close accounting period**. The retained decision covers the baseline start through the selected report's end, since management reporting is cumulative. Closing an interim report does not close the whole annual cycle.

Closure protects the OWP ledger, linked receipts and claims, mapped time/spend and the selected reporting evidence from subsequent edits. Unpaid claims, outstanding commitments and assessed refunds keep their amounts and meaning. Later-period actuals, reports and reconciliation can proceed. This does not lock every upstream contract or external accounting system.

To correct a closed period, an owner or administrator enters the authority and reason and chooses **Reopen accounting period**. Then reopen the reconciliation, make the source/report corrections, save the reconciled assessment and obtain a fresh reconciliation approval before closing again. An old approval alone cannot reclose a reopened period. Other overlapping closed periods still protect their dates until they are separately reopened.

A lost response retains the exact decision request on this device. Reload and use **Retry reconciliation save** before taking another action. Earlier decisions remain downloadable as private JSON, including the original closure, exact reconciliation and the reopening link/hash. History read failures hide downloads until access and the saved history can be verified again.

Apply `20261005000001_work_program_period_closure.sql` after the reconciliation migration. The workflow remains an internal accounting-period control. Human finance acceptance, bank-verified disbursements, multi-target carryover and independent reconstruction/restore remain open. See the [period closure evidence](../reviews/2026-09-09-m2d4-period-closure/VERIFICATION.md) for current verification status.

## Refund payment matching

Apply `20261006000001_work_program_refund_matches.sql` after period closure. The migration preserves existing reports, approvals, closure decisions and their hashes. Older evidence has no `refundPayments` field and remains unchanged, including pending exact retries.

Under Claim receipts and refunds, enter the assessed refund due and choose **Match refund payment to claim**. Select an existing approved payment in the baseline currency and enter the amount assigned to this refund. Create a missing payment through Actual work with its source reference first. The match classifies that payment as outgoing for this reconciliation. It does not create a disbursement or a second expense. Management payment totals stay gross amounts, not net cash.

The remaining refund is the assessed amount less matched outbound payments, independently of requested reimbursement less receipts. Blank assessment or missing evidence stays unknown; negative remaining refund means excess disbursement. An approval can retain an unresolved balance. Earlier approvals and source baselines remain available in private JSON history after correction. Closed periods protect matched refund entries even when the payment date falls later.

[Refund matching engineering evidence](../reviews/2026-09-09-m2d4-refund-matching/VERIFICATION.md) is separate from bank verification, prescribed agency forms, human finance usefulness and the full two-cycle reconstruction/restore acceptance. Automatic reminders remain unchanged.
