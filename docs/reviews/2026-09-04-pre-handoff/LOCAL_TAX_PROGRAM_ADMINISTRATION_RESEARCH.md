# Local transportation tax administration and sponsor reporting

September 4, 2026. Research anchor: OpenPlan checkout `/home/nathaniel/code/openplan`, HEAD `d2ce5c0f50d64d84cd57da6048f7b5afae3c2bb6`.

The core outcome is an administrator-operated OpenPlan instance where authorized municipalities and other sponsors submit project outputs, statistics, expenditure reports and funding requests. Administrator staff review the evidence, return deficiencies, approve authorized actions, reconcile disbursements and produce public accountability records. This belongs beside existing program, project and funding administration. Reuse the workflow for grants while retaining each program's actual legal and payment rules.

This report covers primary SHCC and SFCTA sources. Root owns the current OpenPlan code review and canonical requirements; another reviewer covers Napa. I inventoried the public indexes before reading selected agreements, policy sections, portal instructions and financial-report sections. I did not sign in to any portal, contact an agency, inspect private sponsor records, run OpenPlan, or test current portal behavior. No claim of complete legal compliance follows from these documents. Current statutory text retrieval for Government Code §50075.3 failed, so this report does not use it to establish a statewide legal rule.

## What the primary sources establish

### SHCC supplies the member network, not one universal program manual

The [Self-Help Counties Coalition's About page](https://selfhelpcounties.org/about/) identifies 25 local transportation agencies administering voter-approved transportation sales-tax measures. Its [member and annual-update directory](https://selfhelpcounties.org/members-and-annual-updates/) links agencies with different institutional roles and measures. Use it to find responsible administrators and current primary documents. Do not encode its member count, all tax rates, or a common eligibility/reporting policy in application logic. Some directory prose is historical, so the administering agency's current ordinance, adopted plan and agreement remain necessary.

### Identify the exact measure and preserve its successor relationship

This is **San Francisco's November 2022 Proposition L transportation half-cent sales tax**, effective April 1, 2023, succeeding the **November 2003 Proposition K transportation tax**. It is not another election's proposition sharing those letters. SFCTA's current [half-cent sales-tax page](https://www.sfcta.org/funding/half-cent-transportation-sales-tax) describes the 30-year program, 28 programs, five-year project programming and later Board allocation requests. It links the current April 2025 Strategic Plan, sponsor documents and 2023–2028 prioritization programs. Programming identifies intended funding; a sponsor subsequently requests allocation when ready. The same page identifies the grants Portal as the allocation application route.

The [2022 Expenditure Plan](https://www.sfcta.org/sites/default/files/2023-04/2022_Expenditure_Plan_Clean.pdf), §§2.C–D and 5, expressly carries forward outstanding Prop K debt, eligible outstanding grant balances, other liabilities and assets. Legacy projects' unallocated programmed amounts have separate cap treatment. Consequently, do not relabel historical Prop K grants as new Prop L awards or erase their agreements. The plan also requires performance measures and periodic geographic/equity distribution reporting. Retain a distinction between observed outputs and evaluated outcomes. Its remaining-funds procedure includes governing action and public process; an available balance is not permission for software to reallocate it. These are Prop L provisions, not statewide defaults.

The [April 2025 Strategic Plan](https://www.sfcta.org/sites/default/files/2025-07/Final%20Prop%20L%20Strategic%20Plan%20April%202025.pdf), policy attachment and financial narrative, distinguishes phase allocations, proportional expenditure, reimbursement cash-flow schedules, program caps and financing. Smaller or qualifying projects may receive multi-phase exceptions. Program-cap accounting uses constant 2020 dollars while project programming/allocation uses year-of-expenditure dollars. Its carryforward forecasts are dated assumptions, not current open-grant balances. Original estimates, revised forecasts and actual receipts must remain distinguishable.

### The current agreement gives a concrete reporting and payment rule set

The current sponsor page labels its sample “Updated February 2026”; its linked [Prop L Standard Grant Agreement](https://www.sfcta.org/sites/default/files/2026-05/Prop%20L%20Standard%20Grant%20Agreement%20Template%20-%20Updated.pdf) resides in a May 2026 path. An executed project's version and special conditions control. Sections II, IV–VI establish:

- Generally, eligible costs start at execution and stop at expiration; approved exceptions are recorded.
- Reimbursement depends on documented costs, attribution, fiscal cash-flow limits, approved overhead and fund share. Quarterly reimbursement has exceptions; the usual $10,000 minimum excludes fiscal-year-end and closeout billing.
- Reports remain due without progress. Standard quarterly deadlines are April 30, July 31, October 31 and January 31; authorized alternate schedules apply. Annual updates are due December 1 or the next business day.
- Closeout supplies final expenditures by funding source, accounting support and project results. Authorized sponsor staff submit electronically; administrator approval completes closeout. Continuing obligations survive.
- A discretionary holdback may be up to the lesser of $25,000 or 10%; unused funds can be rescinded.
- Records generally remain five years after the later of closeout or termination, with equipment/vehicle retention conditions. Financial/performance audits and refunds remain possible.

This is a sample-based rule inventory, not proof of any sponsor's actual entitlement or compliance.

### The portal is more than an upload folder

SFCTA still links the [Portal Guide for Sponsors, updated October 1, 2020](https://www.sfcta.org/sites/default/files/2024-02/Portal%20Guide%20for%20Sponsors%202020_10_01.pdf). It documents sponsor-agency access, grant assignments, administrator roles and project/grant hierarchy. Reports move through draft, submitted, revise-and-resubmit and approved states; submission locks the report for review. Custom report fields correspond to recurring grant deliverables. It separately supports amendments, partial de-obligation and closeout, including signed requests. It distinguishes grant expiration, outside deadlines and forecast milestone dates. Its cash-flow tab describes daily imports of posted Microsoft Dynamics transactions.

Those are documented 2020 mechanics, not a fresh test of today's portal or evidence of a public integration API. I could not establish the current electronic intake channel or attachment schema for every reimbursement invoice. The sources prove Portal-based allocation, reporting and closeout, but do not justify claiming that every payment request is submitted there. Do not copy the guide's permission or signature behavior without independent security design.

The [2026 allocation calendar](https://www.sfcta.org/sites/default/files/2026-01/SFCTA%20Allocation%20Request%20Calendar%202026.pdf) provides a separate annual review calendar. A request submission deadline, Board action date, agreement execution date, eligible expenditure period and report due date must be different fields.

### Public accountability and narrower program exceptions

[SFCTA's attribution requirements](https://www.sfcta.org/attribution) make funding acknowledgment part of reimbursement compliance. For construction, they call for prior signage review and a photograph with the first quarterly report following fieldwork. The same resource addresses reports, capital purchases and communications. Retain evidence and its review outcome, not a self-certified “has logo” flag.

[MyStreetSF](https://mystreetsf.sfcta.org/) is the public project-map destination linked by SFCTA. Its public search description says underway projects update quarterly; no authenticated or interactive map journey was performed here. [Annual reports](https://www.sfcta.org/annual-reports) and the [FY2025 ACFR presented February 24, 2026](https://www.sfcta.org/sites/default/files/2026-02/SFCTA_Board_Item11_AuditReportfortheFiscalYearEndedJune30%2C2025ENCLOSURE_2026-02-24.pdf) provide distinct public narratives and audited financial statements. The ACFR separates program financial schedules and allocations versus actual reimbursements. An approved sponsor report is not an independent audit opinion.

Two controls demonstrate why reuse must preserve policy differences. [Prop AA](https://www.sfcta.org/funding/prop-aa-vehicle-registration-fee) uses the same grant-administration website but is a vehicle-registration fee; its listed eligible phases exclude planning/environmental studies. [TFCA](https://www.sfcta.org/funding/transportation-fund-clean-air) uses Portal progress reporting with January/April/July/October **15th** deadlines and additional final-report/cost-effectiveness materials. Do not assign Prop L's quarter-end-plus-one-month schedule or eligible phases to every program.

## Separate program taxonomy from payment mechanics

This is the proposed reusable model, not a claim that SFCTA uses each method below.

| Dimension | Keep separate |
|---|---|
| Revenue authority | Election jurisdiction/date/measure, ordinance, tax or fee, effective/expiration dates, administering entity, restricted funds, predecessor/successor obligations. |
| Selection/distribution | Competitive award, named project allocation, formula/local-return distribution, entitlement or other documented method. |
| Authorization | Programming commitment, governing allocation, executed agreement, amendment, reservation, release and de-obligation. |
| Payment | Reimbursement, authorized advance, formula distribution, milestone payment, direct administrator expenditure or other explicit basis. |
| Accountability | Periodic expenditure/output reports, conditions, certifications, audits, corrective actions and publication. |

A tax allocation can be called a grant, as SFCTA's agreement does. A formula distribution need not await a reimbursable invoice. A municipality reporting prior expenditure is not necessarily requesting new payment. Federal requirements attach only where the actual funding/award conditions make them applicable; this research does not establish federal pass-through status for local tax recipients.

## General model and workflow to extend in OpenPlan

These are recommendations for root's existing Programs/local-measure implementation, not a parallel replacement. Root's source review reports existing measures, recipients, allocations, claims, maintenance-of-effort and oversight records. It also identifies missing sponsor-user authorization and structured project/output reporting. This report has not independently repeated that code inspection.

**Program and agreement versions.** Bind each reporting/payment obligation to a stable program, recipient, award/allocation and approved rule version. Store sources, effective conditions, phase applicability, fiscal/calendar basis, authority and signed exceptions. A new rule changes future applicable obligations while preserving historical submissions and decisions. Distinguish an amendment proposal from an approved change. Prop K carryforward should reference the original obligation and successor paying fund without duplicating available authority.

**Sponsor organizations and scoped membership.** The administrator manages its instance; each sponsor has an organization record and authorized submitters, reviewers, finance contacts and signatories. An invitation must name the sponsor and allowed programs/projects. Agency A cannot read Agency B's private financial documents by changing a URL or subscribing to a record. Administrator reviewers and payment authorizers have separate permissions. Consultant access is delegated and time-bounded. Staff departure changes future authority without changing historical authorship.

**Projects, phases and outputs.** Reuse canonical project identity and locations. Allow one project to have several allocations and one programmatic allocation to cover several approved sites or subprojects. Attach sponsor source IDs to imported records and reconcile them before merging. Separate a physical project, a funded phase and an agreement; all three need status. Sponsors should enter project facts once and reuse approved evidence across reports while selecting what to disclose.

**Reporting-period instances.** Generate required reports from the applicable rule, including a no-activity response and approved exemptions. A submission freezes a revision with author, authorized certifier, reporting interval and evidence manifest. Return-for-revision preserves the submitted version and comments. Review acceptance, payment eligibility and publication approval remain separate decisions. A deadline outage must preserve the actual arrival time, queued receipt and later processing time. Alerts help staff but do not grant an extension automatically.

**Metric definitions and observations.** Each definition needs ID/version, output or outcome type, unit, coverage, period-versus-cumulative basis, collection method, denominator where relevant, allowed aggregation and reviewer. Example configurable outputs include repaired lane-miles, installed ramps or completed study products; these are design examples, not claimed universal SFCTA fields. Observations preserve reported value, evidence, revisions and validation state. Zero, no activity, missing, not applicable and not yet measured differ. Never sum cumulative reports or combine lane-miles with centerline miles. Deduplicate shared physical outputs across multiple funding awards. Attribution to a funding source must not imply that it independently caused a measured safety outcome.

**Expenditure and payment reconciliation.** Maintain source cost identity, accounting period, eligible share, prior claimed amount, cumulative authority, payment/credit/refund events and remaining balance. Separate sponsor expenditure from administrator cash payment. Repeated uploads or retries cannot pay the same cost twice. A formula recipient reports use and balances under its rule; it must not fabricate invoices to fit reimbursement logic. Reconcile opening balance, receipts/distributions, interest where applicable, expenditure, adjustments and closing balance with a finance-approved basis. Contract budgets by task/staff/deliverable remain linked but distinct from funding allocation balances.

**Administrator review and public release.** Provide an intake queue, missing-report register, deficiency correspondence, condition checks, approval record, payment-export/reconciliation queue and audit trail. A public report/map is a reviewed derivative with provenance and as-of date. It must exclude private attachments and identify sponsor-reported versus independently verified figures. Publication does not automatically follow submission or payment. Oversight members can receive appropriate records without becoming payment administrators.

## Acceptance and adversarial proof

The first coherent acceptance journey uses two sponsor agencies and an administrator on one self-hosted instance. A sponsor submits a funded project's period expenditures, output statistics and supporting files; the administrator returns an issue; the sponsor revises; authorized staff accept the report and separately authorize a supported disbursement; an approved public summary shows the correct totals. Include an imported legacy obligation and a formula distribution control case.

Required falsification cases:

- Sponsor A attempts Sponsor B's record, export, attachment and API; all private paths refuse. Membership revocation also prevents queued unauthorized writes.
- An administrator member without decision authority directly changes a claim approval or decider field; database enforcement refuses it, not only the UI.
- A submitted report is amended after review; the approved version stays fixed and later changes require a new visible decision.
- Report says no activity, or misses one required metric. No activity can be valid; missing evidence does not become zero or a clean completeness verdict.
- A cumulative ten-unit observation is repeated next quarter, or one project has two funding sources. Program totals do not become twenty units without new work.
- Payment retry, duplicate source invoice, partial receipt, credit or refund. Reconciliation conserves amounts and operation identity.
- Fiscal cash-flow authority is exhausted although lifetime award remains. A request does not become payable merely because the lifetime ceiling has room.
- Rule changes, authorized exceptions, old Prop K obligations and a different program deadline coexist without rewriting history or applying the newest rule universally.
- Formula distribution reporting succeeds without an invented reimbursement invoice. A reimbursement grant still requires its own eligible-cost evidence.
- Required report read fails, attachment is unavailable, totals exceed pagination or a worker stops. Review becomes incomplete and resumable; it never passes on empty data.
- Public export contains payroll, banking details, unpublished notes or sponsor-private attachment links. Publication tests must detect and refuse that disclosure.
- Underspent closeout de-obligates or returns funds under approved authority while preserving debt, asset, audit and retention obligations as applicable.

Future proof must include identified-checkout desktop and 390px journeys, keyboard use, console review, complete browser records, direct database policy checks and real file round-trip/restore. Every changed guard needs a surviving no-op and a targeted failure. None of these checks were performed in this research task.

## Boundaries, operating costs and unresolved evidence

Keep a fully local/free software path. The sponsor workflow should work without an LLM, commercial grants portal, paid map tiles or per-user charge. Agency hosting still needs a computer/server, reliable remote access, electricity, storage, backups, security maintenance and staff time. Existing agency infrastructure may cover these; this report has no agency inventory or cost quote. Do not promise a reliable public municipal service from an untested personal-computer setup.

Primary storage drivers are period attachments, photographs and retained revisions. Measure bytes per representative report and annual volume, then budget backup/restore copies and retention before setting limits. Keep uploads resumable; expose oversize/failed evidence clearly. Local in-app reminders and exported task lists provide a base path. Email delivery is optional infrastructure with operational ownership, retry logs and delivery failure disclosure. External AI, mail, maps or hosted storage must have explicit egress configuration; documents must not leave the agency instance by default.

OpenPlan should prepare and reconcile payment instructions with the agency's authoritative accounting system before attempting any deeper integration. No public SFCTA integration API or current invoice-portal schema was established. Payment execution, statutory certification and legal approval remain human-controlled. This research does not authorize connections, account creation, agency contact, payments or deployment.

Before claiming production adequacy, an administrator program manager, municipal sponsor PM, sponsor finance reviewer, administrator finance/payment authorizer and records/security officer should walk a sanitized real allocation through a complete reporting cycle. Verify the executed agreement, current invoice intake and evidence format, exception authority, metric definitions, actual accounting export, successor obligations and retention schedule. Reconcile SFCTA's historical portal guide against current practice rather than presenting its 2020 screens as current. Validate a formula/local-return program separately using that administrator's documents and the parallel Napa research.

The scope decision is clear: sponsor-side submission on the administrator's instance is core. The implementation should deepen existing program and project administration, preserve financial distinctions and provide a reusable reporting/review system without turning every local tax allocation into a federal reimbursement grant.
