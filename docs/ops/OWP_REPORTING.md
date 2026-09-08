# Administer an OWP reporting period

Open **Programming Cycles → your program → Administer a reporting period**.
Pending periods also appear in **My Work**. Preparation and adoption history stay
on the same work-program page.

1. Save the work-program structure. Record its adoption through the existing
   review workflow before issuing a budget-versus-adopted report. Draft actuals
   can be collected against a saved, unadopted structure.
2. An owner/admin opens **Staff and account setup**, adds staff if needed, and
   selects the person's team account. This enables their own draft time entry;
   no client contract is required. Private cost rates are managed in the OWP
   page and remain separate from billing rate tables.
3. Enter time or expenses in **Actual work**. Select the work element, task and
   optional deliverable. Shares must total 100% for approval. Select an existing
   time/expense source to map it once instead of creating another cost.
4. For CSV, select defaults first, upload the file, map columns and preview.
   Stable source keys detect repeated rows across files. Identifier columns use
   saved IDs; manual defaults avoid needing ID columns for a single staff member
   or allocation. Invalid and duplicate rows remain visible and are skipped.
   Each accepted row retains filename, SHA-256, source key and row reference.
5. Owners/admins reconcile and approve actuals. Select recorded payroll/source
   cost or an approved effective cost rate. Exclude duplicate payroll/time costs
   with a reason; explain legitimate separate entries on the same staff date.
   An opening balance needs documented coverage within the fiscal year, ending
   before the report starts. Do not invent daily entries to split an aggregate.
6. Create the reporting period, choose its adopted baseline and source cutoff,
   and describe completed products, outstanding work, issues and dated remaining
   estimates. **Preview current budget position** separates incurred costs,
   commitments, billed amounts and payments. Blank remaining estimates stay
   incomplete. Unknown opening hours are explicitly identified.
7. Save and freeze the period for review. Resolve or explicitly exclude draft,
   unvalued and unallocated sources first. Return it for changes when needed,
   then issue the reviewed snapshot. **Prepare PDF/XLSX**, check worker status,
   and download the retained files. The PDF is the print copy; wider XLSX detail
   sheets support on-screen filtering and reconciliation.
8. Correct an actual with a reason, start a corrected report version, advance its
   cutoff, review and issue again. Prior report files and their adopted baseline
   remain unchanged, including after later program amendments.

A save with an unknown network outcome is retained in browser storage. Use
**Retry pending save** before entering another record; the same request cannot
create the same cost twice. A failed export can be prepared again through the
existing Documents worker. Unsaved form edits are not durable drafts.

This is an internal management report. It does not establish accounting
completeness, accepted work, finish dates, spending authority or funder eligibility.
Reimbursement forms, full fund claims, payroll/accounting replacement, automated
scheduling and closeout remain subsequent work. M11a and M2d.3 remain partial.
