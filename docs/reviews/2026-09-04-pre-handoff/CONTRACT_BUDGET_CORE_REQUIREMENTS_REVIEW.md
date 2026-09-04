# Contract budgets are core project management

Research date: September 4, 2026. Source checkout: `/home/nathaniel/code/openplan`. HEAD observed at inspection start: `d2ce5c0f50d64d84cd57da6048f7b5afae3c2bb6`.

Nathaniel's requirement restores core scope: track project drawdown against contract budgets by task, employee and deliverable, connected to deliverable and overall project deadlines. The purpose is to let a planning PM see an approaching overrun or missed commitment early enough to act. It belongs in Projects and the existing contract/time/invoicing systems, and applies to small consulting assignments as well as agency capital delivery. It must not disappear behind funder reimbursement or become an optional future enhancement.

The current source has useful foundations, but it does not yet satisfy that outcome. A contract ceiling, a time register and a deliverable budget are separate records today. Their existence does not establish a reconciled work plan, historical contract position or reliable forecast.

## Review boundary and historical evidence

This is a bounded source review. I inventoried relevant migrations, libraries, UI components, APIs and tests before reading definitions and callers. Small financial helpers and schema definitions were read in depth; larger routes, page components and tests were sampled around relevant behavior. No code, database, browser, model, test or service changes were made, and no tests or browser journeys were run. Database observations below describe tracked migrations, not the deployed schema. Source-level defects are distinguished from potential consequences that need reproduction.

The dated [July 28 verification walk](/home/nathaniel/code/openplan/docs/ops/2026-07-28-browser-verification-walk.md) records a client, $50,000 contract ceiling, staff/category rate, ten hours, draft/send/void invoice and restored unbilled time. That is historical evidence for a simple billing journey, not current proof of task budgets, employee allocation, amendments or schedule forecasting. The [v1 contract](/home/nathaniel/code/openplan/docs/product/V1_PRODUCT_CONTRACT.md) says its practice inventory is a floor and missing capabilities cannot disappear from later queues.

A limited README-path inventory of other local code repositories found no obvious existing contract-budget system worth deeper review. This was not an exhaustive search of all abandoned repositories; no personal records were inspected. The working implementation in OpenPlan is the appropriate reuse starting point. Parent review owns current primary project-management guidance research. This report's financial distinctions and proposed workflows are engineering/product requirements, not an accounting standard, legal opinion or universal earned-value mandate.

## Capability matrix

Paths below refer to the repository above. `src/` means its nested `openplan/src/`; migrations are under `openplan/supabase/migrations/`.

| Required capability | Current source evidence | Gap or necessary correction |
|---|---|---|
| Contract and task-order identity | `20260727000010_receivable_invoicing.sql`: engagements have client, optional project, parent engagement, contract/task-order/on-call kind, billing basis, NTE, start/end dates and status. `api/invoicing/engagements` creates/updates them. | A task order is a commercial vehicle, not the task-level work breakdown. No reviewed versioned fee baseline, amendment ledger, task allocation or parent ceiling roll-up exists. Do not rebuild contract identity. |
| Project and deliverable budgets | `20260727000012_deliverable_budgets_and_spend.sql`, `lib/projects/budget.ts`: nullable project and deliverable amounts, recorded progress, remaining amount, incomplete budget coverage and over-budget warnings. | Scalar editable amounts have no contract/version binding, currency/basis reconciliation, staff or task breakdown, original/current distinction, committed cost or forecast. |
| Named people and actual hours | `20260727000011_invoicing_time_and_rates.sql`: staff may link to a user; time has staff, engagement, optional deliverable, date, hours, billable flag, category and billed-line stamp. | No task ID, planned hours, employee budget, approval period, capacity/calendar or actual labor-cost basis in the inspected ledger. A single assignee is not a staffing allocation. |
| Rate lookup | `lib/invoicing/time-billing.ts`: engagement category rates take precedence over defaults; missing category/rate stays unpriced. | No selection by service date or preserved effective rate version. No separate internal cost versus contractual billing rates, authorized escalation or employee-specific override precedence. |
| Deliverable attribution | Time and invoice lines accept deliverable IDs; invoice lines also permit milestone IDs. Project budget filters by deliverable. | Pulling time groups across deliverables by staff/category, then initializes each new invoice line's deliverable blank. Source time IDs survive, but financial dimension attribution is not carried automatically. |
| Contract billed balance | `lib/invoicing/receivables.ts`, `components/invoicing/engagement-nte-bar.tsx`: sent/paid totals reduce NTE, drafts separate, void excluded, overrun visible. | It uses net-after-retention invoice amounts, so it is not a complete gross contract drawdown. No staff/task/child-contract roll-up or approved unbilled exposure. |
| Receivable cash and funder draw | Client invoices and `billing_invoice_records` are separate; `receivables.ts` and `drawdown-ledger.ts` provide status/retention calculations. | Scalar paid states do not supply settlement events, partial receipts, credits and allocation reconciliation. Funder cash must not become consultant earned revenue or erase contract labor cost. |
| Remaining work and forecast | `budget.ts` explicitly refuses unsupported progress judgments and deliberately has no estimate-at-complete. | PM-entered remaining effort/cost, time-phased resource demand and forecast finish are absent in the inspected financial path. The ten-point burn/progress tolerance is a heuristic, not a deadline forecast. |
| Planning schedule and acceptance | `project_deliverables`, `project_milestones`, `project_submittals` carry dates/status; later assignment supports delivery board and My Work. Templates create dated records. | No inspected dependency graph, working calendar, contractual baseline versus forecast, acceptance event or relationship between staffing effort and overall deadline. Submittal acceptance exists and should be connected. |
| Risk and change control | Existing project risks, issues and decisions; work-plan templates and stage-gate decisions provide reusable records. | Risk mitigation, scope changes, review delays and extra work do not recalculate remaining contract/staff/task exposure or preserve an approved amendment baseline. |
| Security and recoverable history | Route workspace/role checks, conditional time stamping, compensating invoice/rate replacement, and later viewer-denial RLS migrations exist. | API and database authority differ; historical time/rates are still mutable in relevant paths. Stronger financial permissions, immutable approved revisions and recoverable atomic operations need proof. |

## Specific seams that prevent a trustworthy answer

### “Actual” currently combines different financial meanings

In [budget.ts](/home/nathaniel/code/openplan/openplan/src/lib/projects/budget.ts), `actualToDate = billedToDate + spendToDate`. The loader supplies sent/paid **client invoice** line amounts and direct project spend. For a consultancy, client billing is an amount charged outward; it is not its labor cost. An expense included in a client invoice and also entered in direct spend can be counted twice. That last case is a source-supported failure scenario, not a finding about existing records. The current calculation is explicitly tested, so simply making its tests green would preserve the wrong meaning for the restored requirement.

Keep distinct, labeled bases:

- Actual effort: worked hours, including nonbillable rework, with approved/unapproved distinctions.
- Internal actual cost: labor valued under the organization's explicit cost basis plus attributable direct/subconsultant costs. Unknown cost rates remain unknown.
- Contract-authorized budget: original approved fee/hour allocations plus approved amendments, including explicit unallocated reserve. Internal labor-cost budgets may differ from client fee allocations.
- Earned/billable value: supported by the contract's billing basis and accepted progress or eligible time. This is a management measure; do not silently claim formal accounting revenue recognition.
- Drafted, submitted/billed, disputed, credited, retained and received amounts: distinct states/events, with gross and net shown separately.
- Remaining allowance: approved budget minus consumption measured on the same basis. Forecast remaining work is a separate estimate, not merely unspent budget.
- Funder reimbursement: eligible costs, submitted claims, approvals and remittances against a funding award, separately linked to underlying costs.

Each card/export needs an as-of date, scope, basis and completeness state. A sum across budgets, billings and receipts does not become a useful “total actual.”

### Retention currently understates contract billing against NTE

[buildEngagementBilledSummary](/home/nathaniel/code/openplan/openplan/src/lib/invoicing/receivables.ts:333) calls `receivableInvoiceAmount`, which returns subtotal less retention when subtotal exists. A synthetic $10,000 gross invoice with $1,000 retention therefore consumes $9,000 of the displayed contract ceiling. For a fee ceiling on gross billed work, it should consume $10,000 while separately reporting $1,000 withheld and $9,000 currently payable. This is a code deduction, not an executed test. Add explicit contract treatment where an agreement uses a different basis rather than making one universal assumption.

NTE warnings should remain truthful even when real overrun work must be recorded. Block an unauthorized commitment or approval where policy requires it; do not prevent recording an already-incurred cost and thereby hide the loss. Draft proposed amendments must never increase the approved allowance.

### Time attribution and historical rates need repair

[Time-entry POST](/home/nathaniel/code/openplan/openplan/src/app/api/invoicing/time-entries/route.ts:172) verifies staff and engagement workspace, then checks a deliverable's workspace. It does not compare that deliverable's project with the engagement's project. The PATCH performs the same workspace-only deliverable check. A different project in the same workspace is therefore not rejected by the inspected relationship check. Invoice create has stronger project checks on its own line links, but does not reconstruct task/deliverable allocation from every source time row.

[Client invoice composer](/home/nathaniel/code/openplan/openplan/src/components/invoicing/client-invoice-composer.tsx:222) flattens matching rate tables, groups by staff/category and initializes `deliverableId: ""`. Ten hours split across two deliverables can become one staff line with no deliverable allocation. A manual single-deliverable choice cannot represent that split accurately. Preserve the underlying allocation independently of how a client wants invoice lines grouped.

The [receivables loader](/home/nathaniel/code/openplan/openplan/src/app/(app)/invoicing/_components/receivables-lane.tsx:152) orders tables by `updated_at` and does not select `effective_date`. The lookup accepts category and rate entries, not the work date. Editing an older table can change which current category entry wins; unbilled historical work can price differently. Approved invoices retain numeric line amounts, which is useful, but no durable rate-version chain explains the valuation. Rate editing replaces entries with compensating restoration on failure; that protects against one failed write, not against losing historical rate versions.

### Schedule is a register, not yet an early-warning plan

[Record schemas](/home/nathaniel/code/openplan/openplan/supabase/migrations/20260313000012_project_subrecords.sql) and [milestones/submittals](/home/nathaniel/code/openplan/openplan/supabase/migrations/20260321000033_lane_c_lapm_pm_invoicing.sql) support due/target dates, phases and accepted/revise-and-resubmit states. The [delivery board](/home/nathaniel/code/openplan/openplan/src/app/(app)/projects/[projectId]/_components/project-delivery-board.tsx) connects status and assignment controls. These are worth extending.

The inspected [record PATCH](/home/nathaniel/code/openplan/openplan/src/app/api/projects/[projectId]/records/[recordId]/route.ts:41) accepts status, assignment and selected budget/progress fields, but not deliverable due-date or milestone target-date amendments. A board instruction to rebaseline is not proof of an editable, versioned baseline. Templates in `lib/work-plans/apply.ts` add calendar-day offsets from an anchor; they do not establish statutory dates, business calendars or dependency scheduling.

A planning task must account for work and waiting: data acquisition, field season, analysis, internal QA, client review, agency consultation, public notice, meeting packet cutoff, hearing/adoption and revision. Staff working hours differ from elapsed review periods. Completion of drafting differs from client acceptance and statutory adoption. A delayed public meeting may move the final date without consuming labor every day; additional alternatives or repeated comment rounds may consume fee without changing an invoice yet.

### Completeness and permission limits cannot be hidden

[Budget loaders](/home/nathaniel/code/openplan/openplan/src/lib/projects/budget-queries.ts) cap deliverables at 200, spend at 500 and client invoices at 200. They expose read failures and missing migrations, which must be preserved, but do not expose truncation as part of budget completeness. Removing a deliverable from the capped list can also make its invoice lines appear unrecognized. Never present a capped financial subtotal as the full contract/project position.

The receivables lane caps invoices at 500 and time at 100. Its time view discloses the latest-100 scope; the time API returns `hasMore`, and the composer discloses the 500-entry pull limit. Preserve these useful distinctions. Full contract summaries need complete server aggregation or verified pagination, not merely higher limits. Even uncapped client selects need review against the actual database API row limit.

Time routes require owner/admin invoice-write authority, making ordinary staff self-entry unavailable through that route today. Conversely, [later RLS role gating](/home/nathaniel/code/openplan/openplan/supabase/migrations/20260728000006_workspace_write_role_gate.sql:86) permits member-or-stronger workspace writes at the database layer. The original time migration expressly places billed-entry edit/delete refusal in the API. Source inspection therefore does not establish database-enforced approved-time immutability or matching least-privilege roles. Viewer denial is present; claiming “all members can write everything” from the original migrations alone would be wrong. Verify the composed deployed policies, parent relationships and direct database behavior before exposing employee costs or relying on approved records.

## Extend the existing system

Use engagements for the contract hierarchy and project records for delivery. Add task/work-package identity beneath the relevant contract/project, with stable task codes, optional phase and deliverable associations. A task can have several staff allocations; one deliverable can require several tasks. A public hearing is a milestone, not a substitute for the preparatory work. Allow a small project to start with a few tasks rather than forcing an elaborate hierarchy.

Create approved baseline versions with source agreement/amendment, authority, effective date, original/current fee and hours, task/staff allocations, direct expenses, subconsultants, reserve and deadlines. Keep proposed changes separate. Parent on-call ceilings and child task-order authorizations need explicit roll-up rules to avoid counting both as additive budget. A project may have several contracts and funding awards, so its overall budget must declare what it includes.

Record time once with staff, contract/task, work date, hours, activity and attributable deliverable allocation. Split allocations must conserve the source hours and value; no copying one entry into every view. Use stable staff identity even after departure. Distinguish labor role from person, client billing rate from internal cost rate, and original valuation from a later correction. Approved effective-dated rates, amendment authority and manual overrides must be traceable. Import historical/opening balances with source, cutoff and reconciliation; do not force teams joining mid-project to invent daily time they never recorded.

Add explicit remaining-hours/cost estimates by task and staff/role, an owner and as-of date. Calculate forecast total using compatible actual and remaining bases, with commitments represented once. Future rates and availability are assumptions that must be visible. Missing estimates, stale timesheets or an incomplete imported period make forecasts incomplete. Do not infer remaining work solely from elapsed time, invoiced percentage or a manually entered completion percentage.

Connect task dependencies, available working time, external review durations and committed deadlines. Preserve original approved, current approved, forecast and actual dates. Make the reason for a threatened deadline legible, including predecessor delay, staff overload or missing agency response. Changes should show fee and schedule effects before human approval. Resource capacity should work across a person's active projects with consented availability, without revealing their private compensation to every PM.

Use existing risks/issues/decisions to own actions. A PM should be able to record additional review rounds, assess their remaining work, propose reassignment or amendment, and see the unresolved exposure. AI may draft the explanation from these records. It must not approve extra fees, edit a baseline or manufacture estimates to turn a warning green.

## Concrete definition of done

The first coherent outcome is a planning PM's weekly contract review from the actual project entry point. It must include baseline setup or reconciled mid-project intake, work/time entry, a reviewed forecast and a decision on an emerging overrun. Invoice-only success is insufficient.

1. A small planning consultancy enters an executed agreement, phased tasks, assigned staff/roles, hours/rates, deliverables and deadlines. Original and approved current budgets reconcile; missing allocations stay visible.
2. Staff record work against the correct task without invoice administrator powers. PM/finance review it under explicit roles. Approved corrections preserve history. Nonbillable rework remains a cost/effort exposure.
3. The PM drills project → contract/task order → task → deliverable or employee and obtains reconciling hours, budget, actual cost, fee consumption, billed, received, remaining estimate and forecast. Different dimensions partition the same source entries; their totals are not added together.
4. An upcoming client review and public meeting reveal a forecast deadline conflict and remaining fee shortfall before an overrun is billed. The system names the cause, estimates and uncertainty. A revision changes the forecast but only an approved amendment changes the baseline.
5. Invoice grouping preserves staff/task/deliverable lineage; partial receipts, retention, credits and disputed amounts reconcile. Linking a funder claim leaves the contract cost and fee ledgers unchanged.
6. Opening balances, historical rates, amended scopes and departed staff remain understandable in an exported as-of record. An independent reviewer can reconstruct a sampled figure without the original agent.
7. Desktop, 390px and keyboard journeys work from Projects and the staff work queue with identified checkout, console capture and meaningful outcome evidence. Appropriate unit, route, integration and live RLS tests pass, with no-op and targeted mutations proving relevant checks can fail. None of this live acceptance was performed for this report.

## Adversarial cases required

| Case | Required result |
|---|---|
| Same employee works two tasks/deliverables at one rate | Invoice may group the display, but both allocations and reconciled totals survive. |
| Time names another project in the same workspace, or a child task of another contract | Refuse invalid attribution in API and database; do not silently reroute it. |
| Old work predates an approved rate increase; a user edits an older rate table | Historical approved valuation remains stable; any restatement has a new revision and explanation. |
| $10,000 gross billing with $1,000 retention | Gross fee drawdown remains $10,000; current payable, retained and actual receipts stay separate. |
| $1,000 vendor expense is paid, billed onward and claimed from a funder | Cost is counted once; each later financial event links to that source without adding another cost. |
| 200/201 deliverables, 500/501 spend rows or invoice rows beyond a page | Full totals remain complete or explicitly unavailable; row limits never silently improve the budget position. |
| Invoice draft is replaced, voided, retried or concurrently claims the same time | No duplicated time, lost stamp or false success; recoverable operation identity survives interruption. |
| Approved time is changed through direct database access | Financial history protections match the intended role policy, including member/viewer and cross-workspace cases. |
| A proposed amendment raises fees, or staff is replaced mid-project | Approved allowance stays unchanged until authorized; original staff/rate/work history survives. |
| A task is 90% billed but its draft is rejected | No automatic 90% accepted work or safe schedule verdict. Remaining rework is estimated independently. |
| Hours remain affordable but the only qualified reviewer is unavailable | Date forecast shows the constraint; spare fee does not imply available capacity. |
| Dependency cycle, missing review duration, holiday/meeting cutoff or overdue prerequisite | Reject impossible relationships or disclose uncertainty; do not fabricate a finish date. |
| Partial receipt, credit, disputed fee, retainage release or unused authorized budget at closure | Reconcile actual events and remaining obligations; neither full spending nor full billing is required to represent legitimate completion. |
| Failed query, missing rate, incomplete historical import or stale estimate | Preserve unknown/incomplete state in UI and exports; a zero or green warning is not an acceptable substitute. |

Existing tests worth retaining include `invoicing-time-billing.test.ts`, `invoicing-time-and-rates-routes.test.ts`, `project-budget.test.ts`, `project-budget-queries.test.ts`, `invoicing-drawdown-ledger.test.ts` and field-caller/assignment guards. They cover useful local behavior, including missing-rate refusal and compensating recovery. Their existence is not proof of this complete journey. Revise the specific tests that currently enforce mixed financial semantics when the intended basis is corrected, and prove the revised behavior with targeted mutations rather than removing assertions.

## Human validation and scope decision

Nathaniel should validate the planning PM outcome and vocabulary using a sanitized real agreement and work plan. A consulting PM and finance/bookkeeping reviewer should independently reconcile the hours, client fees, internal costs and receipts. An agency PM should validate task-order/contract hierarchy, external review and accepted deliverables. Staff should confirm that routine time entry and remaining-work updates fit a small practice. Where Caltrans/federal reimbursement applies, the responsible finance/Local Assistance reviewer validates that separate funding claim path; it must not dictate the meaning of every private or local planning contract.

Use a modest corridor or land-use study with analysis, public engagement and agency review, plus an amended capital-project planning/design contract and a mid-project intake case. These are future validation scenarios, not invented operating records. Human approval of scope and money remains necessary; human judgment must not substitute for reconciliation, attribution constraints or preserved history.

This is restored core scope. Integrate it into the early capital-delivery and project-management work without narrowing the all-states/DC, California-deep, whole-planning v1 target. Start with the connected weekly review outcome and deepen its records, permissions and forecasts. A new standalone PM module or mandatory enterprise earned-value bureaucracy is not justified by the inspected gaps.
