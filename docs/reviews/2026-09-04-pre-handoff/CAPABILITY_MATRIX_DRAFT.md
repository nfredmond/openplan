# OpenPlan capability matrix

<!-- openplan-planning-capability-matrix
review_date: 2026-09-04
review_by: 2026-10-05
current_release: v0.44.0
capabilities:
- long-range-transportation-and-regional-planning
- land-use-comprehensive-and-community-planning
- travel-demand-corridor-scenario-and-performance-analysis
- transit-active-transportation-freight-and-safety-planning
- environmental-review-climate-resilience-and-equity
- community-engagement-title-vi-and-public-decisions
- capital-programming-prioritization-grants-delivery-and-reimbursement
- gis-data-stewardship-documents-reports-and-public-records
- development-review-implementation-and-interdepartmental-handoff
organizations:
- local-and-county-government
- regional-and-metropolitan-organizations
- state-agencies
- tribal-governments
- transit-and-multimodal-providers
- consultancies
- nonprofits-community-groups-and-independent-planners
geographies:
- all-fifty-states-and-dc
- us-territories-explicitly-assessed
- california-gold-standard
- metropolitan-suburban-rural-and-remote
- tribal-border-island-mountain-and-coastal
statuses:
- proven
- partial
- missing
- not-assessed
-->

Proposed current ledger, reviewed 2026-09-04. This scratch proposal has not been adopted into repository authority. The independent source reviews began at `ad640ce7164cbea55bddd30341748e5f48639410`; the checkout was subsequently observed clean at `6f353b0e`. The active session owns the crash-cap correction and its acceptance. This review did not observe a browser, execute models, or certify the latest candidate. Package version `0.44.0` is not release or acceptance evidence.

The proposed review authority is `docs/reviews/product-direction/2026-09-04-whole-product-review.md`; the integration owner will bind its final reviewed commit after the active session's handoff. The metadata preserves the current candidate version for compatibility and does not assert that v0.44.0 has been released.

The destination remains every core planning job across all 50 states and DC, California as the deepest implementation, scientifically validated **separate AequilibraE and ActivitySim** results for every published use, accessible human-controlled workflows, and durable free operation. No deadline, runtime target, or release count reduces that destination. Territory support is explicitly unassessed; the precise v1 depth is awaiting Nathaniel's scope decision. No existing territory cell is removed or promoted by this proposal.

## Status and evidence rules

The current machine-readable inventory is `docs/product/US_PLANNING_CAPABILITY_REGISTRY.json`. Its 99 dimension entries contain **37 partial, 62 not-assessed, and zero proven**. These are independent planner, organization, state/territory, practice, artifact, accessibility, and operations entries; they are not 99 completed jobs or a complete set of their interactions. This proposal does not change those statuses.

| Status | Meaning |
|---|---|
| Proven | A current identified candidate has evidence that the named planner completed the actual job, a recipient reused the required artifact, and the applicable permission, geography, source, accessibility, recovery, and export checks could reject failure. Professional usefulness requires observed humans as well as regression checks. |
| Partial | An implemented foundation exists, with bounded historical evidence where cited, but some required behavior, context, or proof remains open. This review's source inventory alone does not establish current reachability. |
| Missing | The specific required behavior or handoff has been established absent. It does not mean an entire module must be rebuilt. |
| Not assessed | Evidence is insufficient to distinguish partial from missing for the required complete job or context. A national source or generic template cannot fill the gap by inference. |

Only proven passes the v1 gate. Promotion requires dated evidence bound to the actual candidate and job. The current direction guard was found capable of accepting unsupported promotion; stronger proof checks are proposed separately. Do not describe that maintenance as already landed. A guard can check evidence completeness and identity; it cannot determine professional usefulness from a document's existence.

## Core planning practice

| Required practice | Current status | Existing home and foundation | What remains before the complete practice is proven |
|---|---|---|---|
| Long-range transportation and regional planning | Partial | RTP cycles and documents; Projects, Scenarios, Programs, Engagement, Reports | Complete regional/state/local statutory journeys, fiscal and scenario consistency, public comment-response, responsible adoption, partner transfer, and implementation across jurisdictions. An unanswered-comment warning remains distinct from an adoption prohibition. [P6] |
| Land-use, comprehensive, and community planning | Partial | Land Use Plans, generic Plans, GIS designations, versioned review/adoption, Projects | Plan-owned governing authority; correct general/specific/amendment rules; housing and parcel inventories; local/coastal/tribal applicability; adopted-policy implementation. California is not complete. [P1–P3] |
| Travel demand, corridor, scenario, and performance analysis | Partial | Models, County Runs, Scenarios, Explore; separate demand methods; published frozen development studies | Comparable quantities/year/observations, corrected structure and behavior, complete coverage and custody, then untouched use-specific California/nationwide acceptance. v0.44 retired overall and is scientifically inconclusive. [S1–S4] |
| Transit, active transportation, freight, and safety planning | Partial | GTFS/accessibility/freight analysis, Safety, Projects, Models, Programs | Actual modal alternatives through investment decisions; service-calendar and network validity; injury-source coverage for claimed KSI uses; defensible exposure; separate mode/period/forecast validation. National FARS coverage is fatal-crash coverage. [P7, S4] |
| Environmental review, climate, resilience, and equity | Not assessed | Existing plan/project tasks, reports, alternatives and equity-adjacent evidence | Coherent applicable review, consultation, cumulative/time-horizon assumptions, mitigation/monitoring, climate/hazard analysis and accessible decision records. A template or AI narrative is not a valid impact analysis. [P2, P7] |
| Community engagement, Title VI, and public decisions | Partial | Engagement, public maps/surveys/comments, service-equity calculations, exact-version review | Accessible/language-appropriate participation, representative interpretation, accountable responses and decision linkage; Title VI methods appropriate to each decision; public/private derivative controls. Tract service analysis for one day is not a legal determination. [P6–P7] |
| Capital programming, prioritization, grants, delivery, and reimbursement | Partial | Programs, measures, Projects, Grants, Invoicing, Documents, Reports | One traceable authorization/obligation/delivery/amendment/reimbursement/closeout record; eligibility, price year, match and human money controls; nationwide source depth. Grant bundles sampled cover federal programs and six states, not 51 jurisdictions. [P8] |
| GIS, data stewardship, documents, reports, and public records | Partial | Data Hub/workspace GIS, imports, project GeoPackage, reviewed workbook creation, documents, reports, frozen evidence bundles | Selected model/designation geometry actually exported; honest import/update semantics; shared source reuse; sensitive originals, public derivatives, retention/holds and recipient reuse. [P4–P5, P9] |
| Development review, implementation, and interdepartmental handoff | Not assessed | Projects, Land Use Plans, tasks and exact-version review primitives | Intake, applicable adopted rules, findings/conditions, departmental review, implementation tracking and amendments in real cases. Establish the best existing home before considering a new module. [P1–P3, P9] |

## Existing modules and the jobs they must join

This is a source inventory of all authenticated application module families, with related public surfaces. Every row is an implemented foundation with incomplete outcome proof; no row is a new proven capability. Route presence proves an entry implementation exists, not that a person can reach or use it on the current deployment. Inventory: `openplan/src/app/(app)/*/page.tsx` and related detail routes, sampled 2026-09-04.

| Module or surface | Planner job it supports | Principal missing behavior or evidence |
|---|---|---|
| Dashboard | Orient to current work and next action | Useful prioritization across actual roles/cases; current source and stale/failed evidence clear at desktop, mobile, and keyboard entry. |
| Projects | Maintain the shared case, geography, sources, funding, analysis, review and delivery context | Authoritative fact ownership across plan types; correct authority independent of workspace home; second-person handoff without re-entry. [P1, P3] |
| Plans | Assemble linked planning outputs and a work plan | Its six presence checks must remain distinguishable from legal completeness or adopted readiness. Meaning relative to Land Use Plans and RTP needs an observed case. [P2] |
| Land Use Plans and public plan/review routes | Draft, map, review, adopt and implement a land-use decision | Workspace/plan authority defect and California plan-kind mismatch; housing/development depth; accurate public and internal derivatives. [P1–P3] |
| RTP, extraction and document workspaces | Build a regional transportation plan from sources through review and publication | Source extraction accuracy; complete cycle and fiscal consistency; statutory applicability; comments and partner acceptance. [P6] |
| Programs and measure pages/public measures | Prioritize and maintain an investment program and related measure | Defensible scoring, fiscal basis, amendments, authorization, project delivery and public accountability in one case. |
| Models and model detail | Configure/run and inspect modeling evidence | Actual supported use, exact custody, clear failed/missing evidence, separate methods, scientifically valid acceptance. [S1–S5] |
| County Runs and run detail | Prepare geography and execute longer county workflows | Source completeness, attempt ownership, long-stage liveness, cancellation/recovery, honest unknown coverage. [S1–S4, O1] |
| Scenarios and comparison detail | Compare a baseline and alternative | All four exact method/scenario outputs and current assumptions; valid causal/forecast meaning; comparable source/year/units. Historical guided-comparison repair is narrower than scientific validation. [S4, P9] |
| Explore / corridor analysis | Retrieve and interpret place-specific evidence | Truncated or partial crash retrieval cannot become a complete total or score; selected export scope must be explicit. The active `6f353b0e` correction still needs current acceptance disposition. |
| Safety | Establish a safety problem and carry evidence into a project/report | Injury/fatality and geography scope, supported exposure denominator, project/report attachment and actual intervention decision. [P7] |
| Engagement and public participation | Receive contributions and show their disposition and effect | Accessibility, language quality, non-map/assisted participation, privacy, honest receipt and accountable decision response. Historical false-receipt correction does not prove the full job. [P6, P9] |
| Grants | Identify a program and prepare a supported application | Nationwide eligibility/source maintenance and project/award/delivery linkage; external submission stays human-controlled. [P8] |
| Invoicing | Document payable/reimbursable work and closeout | Authorized amount/scope, rejected and partial claims, funding restrictions, traceability to delivery, independent recipient acceptance. |
| Aerial, mission detail and mission editing | Plan and retain aerial/orthophoto work and its evidence | Current end-to-end planning use, imagery/source/position accuracy, licensing, export and mission recovery were not independently assessed here. Source presence does not establish a compliant flight operation. |
| Reports and report detail | Produce a source-grounded decision or technical artifact | Exact selected evidence, current claim boundaries, usable print/public artifact, accessible output and recipient verification. [P5, S5] |
| Knowledge Base / documents | Find, retain and reuse source documents | Extraction fidelity, versions, permissions, source grounding, records policy and cross-case reuse with provenance. |
| Data Hub / workspace GIS | Import, place, inspect and reuse agency data | Governed layer updates, exact CRS/geometry, source completeness, public/private derivatives, complete selected-layer export. [P4–P5] |
| My Work | Receive assigned reviews/actions and return or approve work | Delegation, stale approval, revocation, later amendments and cross-workspace responsibility in the full case. Historical queue repair is bounded. [P9] |
| Workspace | Set up membership and deployment capabilities | Free agency installation, honest worker state, finer case confidentiality and authority distinct from home location. [P1, O1–O2] |
| Command Center compatibility redirect | Preserve older links into Overview | Do not treat the redirect as a separate operating module. Recovery and identity remain cross-cutting requirements. [O1] |
| Assistant and Assistant Activity | Inspect grounded evidence and propose reviewable actions | Exact executed-payload approval, authorship, scopes/revocation, malicious-document resistance, scientific claim fidelity and non-agent equivalent workflow. Required agent-control integration must reuse existing controls. [S5] |
| Help, authentication/invitation, onboarding and compatibility redirects | Enter, learn and recover access to the product | Stranger commissioning and recovery, current free setup instructions and clear handoffs. A `/billing` compatibility page is not evidence of a required paid product tier. [O2] |

## Organization and geography coverage

| Organization context | Registry status | Required evidence still open |
|---|---|---|
| Local and county government | Partial | Small/rural through major-city cases, departmental responsibility, local rule variation and independent operation. |
| Regional and metropolitan organizations | Partial | Multi-jurisdiction authority, full RTP/MTP, modeling/programming and member-agency reuse. |
| State agencies | Not assessed | Statewide scale, governance, distributed teams, multimodal programs and public records. |
| Tribal governments | Not assessed | Sovereign authority, appropriate sources, consent/data control, local connectivity and actual tribal planner jobs. A state code does not resolve these. |
| Transit and multimodal providers | Partial | Service-calendar/network analysis through capital or service decisions and interoperable feed/artifact reuse. |
| Consultancies | Partial | Multi-client authority, confidentiality, records transfer, client review and acceptance. Workspace-home authority is a known counterexample. |
| Nonprofits, community groups and independent planners | Not assessed | Accessible limited-capacity self-service, permitted data access, durable operation and public/agency handoff. |

All 50 states and DC remain required. California is partial; every other state and DC is not-assessed against the complete contract. The five territory entries remain not-assessed. The three California/Oregon/Puerto Rico readiness exemplars disclose source/adapter/authority limits; they do not prove complete support in those jurisdictions. Source: `openplan/src/lib/jurisdiction-readiness/registry.v1.json` and the capability registry.

California needs statewide, metropolitan, suburban, rural, mountain, coastal, border and tribal proof. Nationwide coverage must add island, remote and other contexts California cannot represent. Legal authority may overlap or span boundaries; study geometry, place identity, responsible agency, and applicable legal regime need independent evidence. No neighboring-state result, federal source, national median or geocoder match fills a required jurisdiction cell.

## Evidence needed to close a cell

For each real job, record the planner and organization, governing authorities, exact geography, input/source/rule versions, candidate and deployment identity, intended artifact and recipient, permitted claim/use, and unresolved limits. Join that record to the dimension ledger; do not infer the interactions from green independent dimensions.

Required proof includes visible entry through completion, human usefulness, artifact reuse, exact approvals and role/public boundaries, source uncertainty, keyboard/screen-reader/mobile/print/public accessibility, imports/exports, interruption/restore/upgrade, and a government-eligible free operating route. Missing, skipped, expired, failed or wrong-candidate evidence leaves the relevant cell open. Current browser acceptance and isolated guard maintenance must receive their own final dispositions before this proposal is integrated.

The active roadmap alone owns sequencing. This ledger supplies gaps and evidence requirements; it does not authorize new product implementation.

## Source register

Repository paths are relative to the checkout root; line numbers identify the sampled revision and may move after concurrent changes. Primary external sources were refreshed in the independent reviews on 2026-09-04. No legal sufficiency or browser behavior is certified by these references.

- **P1:** `openplan/src/app/api/land-use-plans/route.ts:22-29,74-107`; `openplan/src/lib/land-use-plans/registry.ts:203-264`; `openplan/src/lib/geographies/place-of-record.ts:1-40` — workspace authorization versus separately stored plan geography and an existing owner-neutral place type.
- **P2:** `openplan/src/lib/land-use-plans/registry.ts:70-123`; create route `117-147`; `openplan/src/lib/land-use-plans/workflow.ts:59-82`; `openplan/src/lib/plans/catalog.ts:111-177` — shared plan-kind rules and presence gates. [California specific-plan requirements, Government Code 65451 and 65453](https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?article=8.&chapter=3.&division=1.&lawCode=GOV&part=&title=7.)
- **P3:** `openplan/src/lib/projects/planning-context.ts`; [HCD sites-inventory requirements](https://www.hcd.ca.gov/housing-element/sites-inventory) — existing project context and the concrete parcel-inventory outcome required beyond generic housing sections.
- **P4:** `openplan/src/lib/projects/portfolio-round-trip-contract.ts:6-39`; `portfolio-import.ts:881-892`; `openplan/src/app/api/projects/import/route.ts:267-288` — selected-value, create-only import; exported place identity is not automatically restored.
- **P5:** `openplan/src/lib/projects/project-geopackage.ts:604-644`; `openplan/src/app/api/projects/[projectId]/export/geopackage/route.ts:101-107`; `openplan/src/lib/project-evidence-bundles/generated-records.ts:391-397` — builder supports model/designation layers but the two production call sites do not supply them.
- **P6:** `openplan/src/lib/rtp/comment-response.ts:14-51` — approved campaign comments and cycle linkage; draft responses excluded, missing/unanswered evidence remains explicit.
- **P7:** `openplan/src/lib/safety/sources/registry.ts:21-35`; `openplan/src/lib/title-vi/service-equity.ts:29-90` — CCRS/FARS scope and tract/service-day equity calculation boundaries.
- **P8:** `openplan/src/lib/grants/programs/registry.ts:14-32` — federal plus CA, WA, OR, CO, TX and OH program bundles.
- **P9:** `docs/ops/KNOWN_ISSUES.md`; `openplan/src/lib/auth/role-matrix.ts:7-28` — historical narrowly scoped corrections and workspace roles. These do not certify case confidentiality or current whole-product acceptance.
- **S1:** Published `data/modeling/*/study-report.md` for development validation, structural diagnosis, comparable observations, structural demand diagnosis and distributed work loading, dated 2026-08-28/31 — exact chain detailed in `independent-product-science.md`, retained with the review packet.
- **S2:** `docs/modeling/NATIONWIDE_VALIDATION_PREREGISTRATION_V1.json:79-91`; `workers/aequilibrae_worker/model_validation_core_v5.py:61-87,150-170,225-253` — blocked nationwide acceptance, quantity limits and diagnostic-only evaluator.
- **S3:** `scripts/modeling/development/california_distributed_work_loading_study.v1.json:5-41`; published v0.44 `study-result.json`; [Census LODES 8.4 technical documentation](https://lehd.ces.census.gov/data/lodes/LODES8/LODESTechDoc8.4.pdf) — consumed development lineage, work-only evidence and source coverage limits.
- **S4:** `scripts/modeling/synthetic_population.py:140-222`; `scripts/modeling/activitysim_mtc_inputs.py:703-705,900-915`; `docs/modeling/ACTIVITYSIM_RUNTIME_GAP.md:64-88` — existing population synthesis, borrowed behavior and limited skims.
- **S5:** `openplan/src/lib/models/published-distributed-work-loading.ts:88-156`; `openplan/src/app/(app)/models/page.tsx:161-164`; `openplan/src/lib/reports/html.ts:543-559`; `openplan/src/lib/assistant/chat-tools.ts:966-985` — current disclosure and display/custody limitations. No frontend observation was performed.
- **O1:** Engineering review findings R5/R8 in `REVIEW_DRAFT.md` — source-based lifecycle, checked-write, CI-family and recovery gaps; root owns their integration and runtime verification.
- **O2:** `README.md:71-139`; `openplan/src/lib/integrations/anthropic-access.ts:19-49`; [Docker Desktop licensing](https://docs.docker.com/subscription/desktop-license/); [Supabase self-hosting guidance](https://supabase.com/docs/guides/self-hosting) — free-operation and outbound-service claims need corrected instructions and an observed agency operating route.

## September 4 early product priorities

Nathaniel explicitly prioritizes engagement mapping superior to Social Pinpoint, installed CLI/API provider choice for the Planner Agent using T3 Code as a reuse reference, and capital administration through construction/closeout with Caltrans depth. Roadmap M9, A0 and M10 schedule these early. No capability status is promoted by that instruction or by the source review.

| Priority | Current foundation and limit | Required evidence |
|---|---|---|
| Better public mapping input | Existing geometry/survey/moderation/public-response code; superiority unproved. | Real campaign setup and participation through decision response; comparable current-platform human tasks; accessible geometry/non-map parity and portable exports. |
| User-selected agent backend | Current Planner Agent chat is Anthropic API-specific; existing grounding/proposal/approval system should be reused. T3 has actual native Codex/Claude/OpenCode adapters. | Same planning task across supported API and all three installed CLIs; correct account mode, installation discovery, scoped data/actions, interrupt/recovery and no silent billed fallback. |
| Full capital delivery | Project delivery, documents, stage gates, funding and reimbursement foundations; exact Caltrans forms/lifecycle not established. | Actual case from planning or mid-project intake through environmental, ROW/utilities, PS&E, procurement, construction, payments/reimbursement, acceptance and closeout; dated applicable rules and practitioner/finance review. |

Detailed primary-source findings live in the dated pre-handoff priority reports. California office bulletins and inactive exhibits must be checked alongside manuals. Native CLI authentication and optional provider charges are distinct from OpenPlan's free software license. Personal CLI access must not become an unattended public-engagement account pool.

## Restored planning-contract and complete RTP outcomes

Current user instructions and the recovered August decisions require these as core practice, not optional additions. The core requirements ledger preserves scope and maps evidence; roadmap M11/M12 own sequencing. This assessment does not promote any capability to proven.

| Outcome | Present foundation and gap | Completion evidence |
|---|---|---|
| Contract drawdown and proactive PM | Engagements, staff/time, rates, delivery/budget records and invoices exist. Task/staff allocations, approved historical baselines and remaining-work forecasts are incomplete; financial bases and attribution need repair. | Weekly PM review by project/contract/task/person/deliverable, reconciled hours/cost/fee/cash, explainable fee/date warning and authorized change; staff and finance permissions tested. |
| Complete RTP update | Regional cycles, fiscal/project/measure records, chapters, extraction and public/adoption machinery exist. Complete applicability, narrative/financial consistency and a full real update remain unproved. | Entire applicable policy/action/financial/narrative and review/adoption/implementation workflow with practitioner-checked tables and artifacts. |
| Begin from adopted predecessor | Source bytes/pages, extraction proposals, conflict review and verbatim chapter staging exist. Normal launcher omits chapter extraction. | Previous PDF/scan through complete coverage disclosure, reviewed chapter/table/figure/project reuse and source-preserving revisions; no silent overwrite, invented values or inaccessible step. |

## Local measure and grant program administration

Restored core scope includes the administering agency and its reporting municipalities on one instance. Programs → Local measure is the existing home; grants require post-award work as well as application help. Roadmap M13 expands those joins without promoting current capability.

| Required outcome | Current foundation and gap | Required evidence |
|---|---|---|
| Municipal self-service reporting | Named recipient, claim and document records exist; current access is workspace-wide without recipient-user participation. | Two cities submit/correct their own reports with proper certification, recipient isolation and separate agency authority, including database and document access. |
| Project/output statistics | Projects/GIS/Documents are reusable; local claim records contain money and description, not structured project quantities. | Actual agency reporting form mapped to source-backed project/segment/quantity/unit/period, no-activity/missing distinction, revision/cumulative deduplication and reproducible totals. |
| Program financial administration | Recorded receipts, versioned allocation rules, MOE, claims and oversight exist; complete lifetime retrieval and durable decision/settlement history remain unproved. | Source-specific formula/advance/reimbursement cases, complete reconciling balances, approvals and corrected/partial payments with independent finance review. |
| Successor measures and public accountability | Effective rule versions and public financial pages exist; successor-obligation transfer and full project/output publication are unestablished. | Old/new rule and fund identity survive transition, with continuing obligations, accepted outputs, fiscal audit and accessible public reports. |

## Consultant pursuits and agency procurement

M14 and CORE-PROCURE-01 make both sides mandatory. Source review at 27c22b68 establishes preparation foundations, not complete procurement acceptance.

| Required outcome | Existing foundation and gap | Required evidence |
|---|---|---|
| Discover and prepare a response | Proposal pursuit, grounded sections and exports exist under Grants. Procurement feeds, issuer timezone, complete requirements and source-specific package structure are incomplete. | Find/import a real permitted notice, detect an addendum, prepare exact technical/fee files and required attachments from verified firm material; preserve missing/unknown requirements. |
| Agency creates and issues a solicitation | Projects/Documents/stage gates are reusable; no complete agency-owned competition was established in the inspected paths. | Approved method/scope/criteria, immutable issued notice and amendments, publication evidence, separate consultant users and accurate public/private views. |
| Submit and securely receive | Export artifacts are preserved; they are not buyer receipt or protected agency intake. | Exact-byte receipt, authoritative closing time, interruption/retry/replacement/withdrawal, separate bidder access and appropriately concealed costs, including assistant/search/storage paths. |
| Evaluate, award and start delivery | Project/contract/budget records are reusable; panel/conflict/protest and procurement handoff remain unestablished. | Separate QBS and price-inclusive cases, recorded independent judgments and approvals, applicable notices/holds, executed scope/rates/deadlines and NTP linked to M11/M10. |

## Hosted trials, customer deployment and optional services

M15 and CORE-HOST-01/CORE-SERVICES-01 connect a fully functioning hosted evaluation to long-term independent use. Hosting a shell does not close the whole-product capability cells.

| Required outcome | Current foundation and gap | Required evidence |
|---|---|---|
| Open a browser anywhere and do real work | Node production commands and worker deployment ingredients exist; public commissioning and full external-network acceptance are unproved. | Correct release identity, real auth/mail, maps/data/jobs/exports, sign-out/return and accessible desktop/390px tasks on a separate network. |
| Shared trials remain private and affordable | Workspace roles, usage counters and optional operator cap exist; AI metering fails open and whole-host budgets/queue behavior remain unproved. | Cross-trial denial, retention/cleanup consent, cost reservation/limits, fair concurrency, metering failure and uninterrupted non-AI access. |
| Adopt a customer-owned installation | Self-host/restore/export foundations exist; complete selective workspace transfer is unestablished. | Migrate one trial without another tenant's records, preserve evidence and bytes, reauthorize users/providers safely, continue work and restore on the new host. |
| Offer optional implementation and administration | License notice permits services; independent operations and a bounded service runbook need proof. | Customer-owned accounts and records, accepted installation, clear update/backup/support scope, scoped customization and independent administrator exit rehearsal; no software paywall. |

## Named outcome coverage restored in the September 4 review

The [core requirements ledger](CORE_REQUIREMENTS_LEDGER.md) now maps the practice families and organizational cases that broad module headings could conceal. M2a–c explicitly owns comprehensive work plans, shared files/human documents and daily work; M5a–b owns named-format intake and the full aerial/ODM lane; M6a–c separates modal service planning, BCA/TDM and agency prioritization; M7/M8 require named complete land-use/development/environmental/climate/Title VI cases; M13e preserves grant pursuit and alerts before administration. Shared acceptance retains localization, contrast, print and constrained-network use.

These are restored or clarified documentation obligations, not new implementation proof or a claim that existing modules are absent. Every complete case remains open pending current acceptance and appropriate practitioner observation. The initial family list must expand through source/practitioner review and cannot become a convenient ceiling. Distinct small/rural and sovereign tribal cases remain required alongside the other organization contexts.

CORE-AGENTIC-01 / A1a–d now explicitly tracks substantial delegated planning assignments, separate from A0 backend choice. Current read/proposal tools and twelve registered actions are partial foundations. Require authenticated agent scope, truthful effect/audit records, persistent review/job recovery, all-core-operation coverage, optional external-client parity and usable artifacts. Existing human-only authority and scientific evidence boundaries remain. The detailed agentic research records a source-established false-success audit path and unproved orchestration/interoperability; it establishes no live agent completion.

## Aerial benchmark clarification at e6900750

The earlier aerial row records an unexamined live outcome; the subsequent [current aerial code review](AERIAL_CURRENT_CAPABILITY_REVIEW.md) now traces mission/export and photo-to-frozen-report paths. It establishes real foundations and source defects, not current browser/physical acceptance. [The 21-family benchmark](ODM_WEBODM_FEATURE_BENCHMARK.md) is the maintained minimum comparison inventory for M5b.1–6: capture/input/control, full reconstruction, 2D/3D/measurements/contours/change, spectral/video/splats handoffs, export, sharing and local/large-job operations. CORE-AERIAL-02 and CORE-DJI-01 separately retain superiority evidence and actual controller USB/import. Every family needs visible entry, input/output identity, supported engine/device profile, meaningful test and recipient proof. All full outcomes remain open; upstream feature lists and generated files are not closure evidence.


## Full LAPM chapter assessment, September 4

The entire manual review adds detail without promoting any capability to complete. Source/coverage: `LAPM_SOURCE_AND_REVIEW_COVERAGE.md`; gaps: `LAPM_FEATURE_GAP_ANALYSIS.md`.

| Practice | Assessment and required proof |
|---|---|
| Local-assistance authority, agreements, funding and forms | Partial foundations; M10a.1 and M11 require source/phase/trigger specificity, NI/FTA branches, exact packets and outside authorization. |
| Environmental/design/ROW/utility readiness | Templates/records exist; M8a/M10b.1–2 require actual specialist cases, signed versions and commitments carried to field evidence. |
| Agency civil rights and hearings | Transit-equity/campaign foundations are narrower; M8b/M9d require full agency cycle, confidential complaints and authoritative hearing record. |
| Consultant competition and construction administration | Pursuits/time/invoice/control descriptions are partial; M14/M11/M10c.1 need sealed methods/on-call caps, approved rates and independently checked field-to-payment lineage. |
| Closure, maintenance and entity oversight | Not established end to end; M10d.1–2/M13f require valid underspend, final-voucher evidence, continuing obligations, county certification and audit/CAP final disposition. |

Current DBE and future Buy America/bidder-list transitions differ; retain dated application, suspended/unknown states and historical evidence. Full source reading is not proof of runtime compliance or professional usefulness.


## State and federal manual reconnaissance

Oregon, Washington, Nevada, Alaska, Hawaii, New York, Minnesota, Florida and Texas now have source inventories and selected procedural comparisons in `NATIONAL_LOCAL_ASSISTANCE_COMPARISON.md`. Nathaniel's neighboring-state, Alaska, Hawaii and federal priorities are explicit in G1a. This does not promote any capability/geography cell: full manuals, current forms/overlays and real workflow acceptance remain separate work. Nevada's discovered 2017 manual and inaccessible live hub require currentness resolution. Agency delegation, sponsorship, approved payment paths, identifier hierarchy and record retention are named cross-state cases. DC, tribes, direct grants and territories retain distinct coverage requirements.

Alaska and Hawaii add award-specific administration/maintenance, seasonal custody, island/county/MPO distinctions and incomplete-agreement detection. Federal highway, FTA, direct-award and Federal Lands guidance form distinct source families with incorporated award versions. G1a now names falsifying cases; KL061 preserves draft/source/date/access limits. No state, federal or modal capability was promoted by reading these sources.


## Project-specific public mapping setup

CORE-ENG-02/M9a explicitly covers creating a map from a project and tailoring its categories, questions, instructions, study area and layers. Editable templates or blank setup must support contrasting complete-streets and countywide-wayfinding activities. Current template/project/category code is a foundation; ease of setup and participant comprehension remain unproved. Acceptance includes preview/publish, campaign isolation, preserved historical response meaning and complete export. This clarification promotes no capability status.

CORE-ENG-03 adds a linked response dashboard and human review before public release, including accurate queues, scoped map/list filters, response detail, approve/redact/withhold history and distinct follow-up status. Existing moderation components do not prove usable staff administration or leak-free public paths. M9a must include the basic review/publication loop; M9b completes interpretation and responses.

CORE-ENG-04 requires polished PDF and typed/filterable XLSX engagement exports, with public/internal disclosure controls, declared snapshot/scope, consistent totals, historical response meaning and open data companions. Existing CSV/report foundations do not close this requirement. M9a–b requires actual file inspection and independent recipient use; no export capability is promoted by documenting the request.
