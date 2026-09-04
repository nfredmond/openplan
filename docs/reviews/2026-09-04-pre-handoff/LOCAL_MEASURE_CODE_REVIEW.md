# Local measure administration: existing code and missing municipal workflow

September 4, 2026. Source inspected at `d2ce5c0f50d64d84cd57da6048f7b5afae3c2bb6` in the read-only development checkout. This review did not modify that checkout, open an application/browser, run a database/test, or interfere with acceptance. It establishes source behavior and proposed verification, not a completed city-to-agency journey.

## Product outcome and existing home

Nathaniel requires local transportation sales-tax program administration, including municipalities using an administrator-hosted OpenPlan instance to report projects, expenditures and required delivery statistics. Responsible staff review submissions, return corrections, administer the applicable funding/disbursement process and produce auditable program reports. The same submission and review machinery should support appropriate grant administration. The historical recovery independently found his earlier request; this is restored core scope.

The existing home is **Programs → Local measure**, with a child fund page at `/programs/[programId]/measure`. This is a real implementation worth extending. It does not require a new disconnected module. The administering agency and each municipality remain distinct organizations; a funding relationship does not make the agency the city's general legal superior. One hosted instance can provide separate organizational access without requiring a separate installation for every recipient.

### Foundations inspected

| Existing capability | Source | Evidence boundary |
|---|---|---|
| Program entry and fund setup | `components/nav/nav-registry.ts:135`; `app/(app)/programs/[programId]/measure/page.tsx:79–166`; `the-measure-fund-is-reachable.test.tsx` | Actual navigation/components and caller tests exist; no new browser proof. |
| Ordinance dates, tax-rate label, explicit sunset state, currency and fiscal-period cadence | `20260812000011_local_measure_fund.sql:167–237`; `lib/measures/fund.ts` | Rate is a display label. Receipts are recorded, not invented from a tax base. No successor-measure transfer record in the inspected schema. |
| Receipts and agency-adopted forecasts | `lib/measures/receipts.ts`; `measure_fund_periods` | Unknown receipts and recorded zero differ. The software does not invent an economic forecast. |
| Effective allocation rules and sourced recipient bases | `lib/measures/allocation.ts`; allocation-rule/basis-value tables | Exact integer-cent apportionment, configured categories, weighted factors, floors, deductions and reserve logic are useful. Unsupported rules have a disclosed manual path. |
| Atomic period allocation replacement | `20260812000014_measure_off_the_top_and_atomic_allocation.sql:224`; `measure-allocate-route.test.ts` | A database function replaces related rows together. This is not evidence that every concurrent annual-cap or later restatement case is safe. |
| Recipient and claim register | `20260812000011_local_measure_fund.sql:346`; `20260812000012_measure_claims.sql:141`; `lib/measures/claims.ts` | Recipients include municipalities, transit operators, tribes and other bodies. Claims have period/category/amount/status and supporting document links. |
| Maintenance of effort | `measure_moe_records`; `lib/measures/claims.ts:985` | Required versus reported amounts with basis note and explicit undetermined states. A two-number comparison does not implement every ordinance's accounting, averaging or audit requirement. |
| Public fiscal oversight and annual statement | `app/(public)/measure/[shareToken]/page.tsx`; `lib/measures/oversight.ts`; `oversight-statement.ts` | Useful financial reconciliation and failure disclosures. No project-output register was found in this path. |

Paths beginning `app/`, `components/`, `lib/` and test filenames are under `openplan/src/`; migration filenames are under `openplan/supabase/migrations/`. Source references describe the pinned checkout.

## Consequential gaps

### Municipal access is not the current workspace role model

`measure_recipients` stores name, type, external reference and active status. It has no recipient-user membership or delegated organization authority. `authorizeMeasureWrite` selects the caller's current workspace membership and applies `programs.write` for clerical work or `invoices.write` for decisions. A member may draft/submit against any recipient in that workspace; there is no inspected check that the user represents the selected city. The composer lists all active recipients.

The migration SELECT policies expose fund/claim/MOE records to workspace members, and write policies rely on `workspace_member_can_write`. Giving city staff broad member access would therefore grant powers and visibility beyond their city's submission job. Separate recipient workspaces alone would not solve it either: the current routes require the fund in the caller's selected workspace. Add explicit program-to-organization participation and scoped reporting roles, enforced in both routes and database/storage access, with delegated administrators and public approved derivatives.

### Decision authority and financial history rely too heavily on the API

Claim creation permits draft/submitted; the update route reserves approval/payment for owner/admin, stamps the session user and refuses submitted financial edits. Those are useful protections. But the tracked `measure_claims` INSERT/UPDATE policies permit writable workspace members, while CHECK constraints require only a decider/date for decided states. They do not establish the decider's authority, match that identity to the acting user, constrain state transitions or prevent a submitted amount being changed through another writer. Grants allow authenticated INSERT/UPDATE.

The database's draft-only DELETE rule also needs testing through a preceding UPDATE to draft, not merely a direct delete of a submitted row. The current UPDATE policy does not establish immutable submitted state. This is a source-supported bypass scenario, not a deployed exploit demonstration. The same-workspace composite foreign keys protect tenant consistency but do not by themselves establish that a claim's recipient and period belong to the same fund. The API checks those relationships; a direct database probe is still needed.

The claim PATCH reads the status, then updates by ID without an expected-status/version condition. A concurrent edit and submission may invalidate the earlier check. Durable submitted versions, authenticated approval events, controlled return/correction, optimistic concurrency or transactional transitions and an auditable payment record belong before external recipient access. Recording payment is distinct from initiating a bank transfer; this assignment proposes administration and reconciliation, not an unrequested banking integration.

### Required project statistics have no structured home in the measure path

The claim schema and composer accept recipient, period, category, reference, description, amount and retention. They do not bind a project, output quantity/unit, construction segment, metric definition, evidence or a sponsor reporting period. Document attachments can preserve a form but cannot support dependable countywide totals by themselves. No first-class municipal progress/report submission, named reporting obligation, reviewed output register or project-to-measure agreement link was found in the scoped inventory.

Keep project delivery evidence in Projects and Documents, then link it to a versioned program report. A report must be able to exist without a reimbursement request, including a required no-activity report. Grants administration is more than the existing application-writing/grant-search workflow.

### Historical categories are available at the server but wrong in the form

The fund page resolves categories using the latest period start (`page.tsx:254–271`) and passes that one set to `ClaimComposer` (`:609–629`). The form says categories come from the period selected but does not update them when the period changes. The POST route correctly resolves the rule using the selected period. If an older period has a retired category, the ordinary form cannot select it; a newer category may be offered and correctly rejected for the old period. Fix the form's period/rule binding without weakening the server check. This is especially relevant to amended ordinances and successor programs.

### Financial totals lack proof of complete retrieval

The staff fund page reads periods, recipients, rules, allocations, claims and MOE using one select per table, with no pagination or complete server aggregate. The public oversight page does likewise. Local Supabase config declares `max_rows = 1000`. Thus successful reads do not establish complete lifetime totals above the API limit; the existing failed-read and unreported-period disclosures cannot detect rows never returned. Reproduce on an isolated database and repair complete retrieval before relying on multi-year countywide reporting. Higher hard limits alone are insufficient. This review did not query deployed row counts.

### Money movement and physical delivery need different records

Existing claims distinguish gross requested, net paid and retention. They represent payment as a status/date rather than a settlement-event ledger; partial disbursement, corrections, refunds, recoveries, interest, recipient-held balance and final reconciliation are not established. Formula apportionments, advances, reimbursement grants and performance-conditioned distributions must use the actual agreement's workflow. Do not invent a reimbursement invoice for every tax distribution. Successor measures need linked effective versions and authorized opening/transfer balances, preserving old grants, debts and reporting obligations.

## How to record outputs without misleading totals

These are proposed requirements, not measured OpenPlan behavior or an assertion that every source ordinance mandates these fields:

- A metric definition has a stable ID/version, reporting purpose, unit/dimension, measurement method, eligible activity, aggregation rule, applicable period/rule and required evidence. The administrator defines required fields from the actual adopted program and forms.
- Distinguish new sidewalk, repaired/reconstructed sidewalk, curb ramps, road centerline miles, lane miles, bike facilities and service/noncapital outputs. Linear feet, square feet, counts and costs are different dimensions. Sidewalks on both sides of a street may be two assets; a GIS centerline is not automatically constructed sidewalk length.
- Record project/segment, activity, planned/constructed/accepted state, observation date, period-only or cumulative basis, source and reporting organization. Keep a missing quantity, recorded zero and not-applicable reason distinct.
- Preserve raw quantity/unit and any explicit conversion. GIS may support a measurement; it must not silently overwrite certified field quantities. Geometry carries CRS/method and exact segment identity.
- A physical asset funded by multiple sources is built once. Keep total output and the method for attributing program-supported output separate. A 40% funding share does not prove 40% of a sidewalk unless the adopted reporting method explicitly calls for that attribution.
- Revised cumulative reports supersede earlier totals rather than adding them again. Separate recipient-reported, agency-reviewed and publicly certified aggregates. Late/missing reports and disputed figures remain visible with coverage, reviewer and as-of date.
- Link each expenditure/claim and output to source records without adding the same cost or physical improvement again when it appears in a later grant report, construction record or public map.

## Meaningful verification and reuse

Existing arithmetic, missing-value, fiscal reconciliation, route transition and foreign-key tests are useful. `measure-fund-rls.test.ts` has focused live probes for direct submitted-claim deletion and selected cross-tenant parenting; `rls-isolation.test.ts:1812–1854` explicitly retains broader proof gaps. These tests do not prove recipient isolation, database decision authority, update-then-delete resistance, complete retrieval, physical output semantics or the full municipal journey. No existing suite was run or changed in this review.

Register those missing cases before implementation. Include two independent cities and an agency reviewer, delegated staff departure, malicious same-workspace recipient/fund IDs, API/direct-database/storage paths, period-rule amendments, concurrent submit/correct/approve, duplicate imported records, 1,001-row totals, cumulative reports and mixed units. Include a no-activity report and a missing report with different outcomes, one formula disbursement and one reimbursement grant, and an old obligation paid after a successor measure begins. Every changed consequential guard needs targeted failures and a surviving harmless mutation.

Observe a municipal public-works/planning preparer, its authorized certifier, an administering-agency program/finance reviewer and an oversight/public reader. They should complete one real permitted reporting cycle from visible entry, resolve a returned correction, reconcile payment or distribution independently and understand the published quantities. Check desktop, 390px, keyboard, accessible tables, upload recovery and independent exports. Human study remains necessary for vocabulary, reporting burden and professional usefulness.

Use the current fund, Projects, Documents and financial calculations. Add reusable organization participation, versioned reporting definitions, submissions, evidence, review and settlement links to the Programs/funding architecture. Tax measures retain ordinance/receipt/apportionment rules; grants retain their actual award terms. A federal subaward's obligations do not attach automatically to a locally funded grant. Parent-agency hosting should require local/free infrastructure only; measure file growth, upload/import time and reporting-peak load, and preserve audit bytes in backup/restore tests.

## Coverage and uncertainty

Inventoried measure routes, components, libraries, migrations and tests by filename and targeted content searches. Read the shared operating manual and geography guidance; read the authorization helper, claim schema/policies, recipient schema, claim payload and relevant transition/update code. Inspected staff/public loaders, current category binding, allocation function boundaries, local API cap and focused test definitions. Sampled larger arithmetic/oversight libraries and adjacent grants/auth/nav paths, rather than reading every line or asserting complete grant coverage. Dated Napa, SFCTA/SHCC and history reports provide complementary primary-source and requirement evidence. No runtime incident, complete legal conformance or release acceptance is claimed.


Primary-source spot checks by root: opened SHCC and SFCTA's current public indexes, NVTA's July 1, 2025 transition announcement and signed Ordinance 2024-01, and the current NVTA reporting page. The reporting page currently describes U's 20% MOE basis, annual increase limit and separate 7% equivalent-funds requirement. An earlier reviewer retrieval reportedly showed T-era text; that preliminary claim was sent back for correction before publication. This reinforces the need to record exact source/version and retrieve current controlling documents. The report does not claim the website is currently stale.


The root also independently read page 3 of [NVTA's 2022 Measure T report](https://nvta.ca.gov/wp-content/uploads/2023/03/001_Measure-T-Biennial-Report-2022-FINAL.pdf): 7,280 linear feet of sidewalks repaired/replaced, 10.26 miles of roads repaired/replaced and 28 curb ramps installed/replaced. These are published historical outputs supporting the requested data model, not proof of the mandatory fields in today's U forms. The source extract was inspected; a web screenshot request did not provide an inspectable image in this session, so no visual-layout review is claimed.
