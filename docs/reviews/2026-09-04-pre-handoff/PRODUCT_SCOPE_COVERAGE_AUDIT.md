# Product scope coverage audit — 2026-09-04

## Finding and review boundary

The renewed roadmap originally preserved the broad practice headings but left important jobs inside generic completion criteria. During this audit, the root reviewer added concrete M2a–c, M5a–b, M6a–c, M7 and M8 outcomes. Those additions materially address the omissions identified below. **They restore documentation; they do not establish implementation or accepted planner outcomes.** The remaining risk is that a complete generic planning case, a template count or one organization example closes a much broader practice obligation.

Nine scope families below need durable completion ownership. Eight now have explicit proposed outcomes; organization-specific practice remains broadly specified and needs named cases. A maintained requirement-to-case crosswalk is still needed to make “all core planning work” reviewable without silently choosing only convenient examples.

Read-only source snapshot: OpenPlan HEAD `c64b70b6b474130ab7a88e0ca4d78fcaaf8b9e4a`. The working tree was clean at the initial status check. Scratch drafts changed during review; the final reread includes the additions above and G1’s M1–M15 reference. Line references describe the reviewed text, not immutable identifiers. No browser, models, tests, database, account, service or deployment was used. No claim below establishes current UI reachability or proves source functionality absent. Root separately audits implementation.

## Inventory, authority and sampling

Reviewed the complete current `docs/product/V1_PRODUCT_CONTRACT.md`, current capability tables in `docs/product/US_PLANNING_CAPABILITY_MATRIX.md`, and `docs/product/LAND_USE_PLANS_CONTRACT.md`. Read the scratch `ROADMAP_DRAFT.md`, `CORE_REQUIREMENTS_LEDGER.md`, `doc-proposals/CAPABILITY_MATRIX.md` and the original `independent-product.md`, preserving those files unchanged. Selected historical reads: February 19 platform design; July 17 and July 18 grants/BCA/TDM records; the August 25 v1 review. Sampled plan, aerial, TDM, BCA and work-plan registries/catalogs and inventoried all 24 work-plan template filenames. This is not an exhaustive code audit or a claim to have examined every template’s contents.

Authority distinctions used here:

- **Binding contract:** the current product contract requires core practice across all 50 states/DC, California depth and separate scientifically validated AequilibraE/ActivitySim. Its practice and organization floor cannot disappear because a later roadmap stops naming it (`V1_PRODUCT_CONTRACT.md:36–68`). The land-use contract supplies additional durable guarantees.
- **Direct user requirements:** the current ledger preserves explicit restored RTP, project management, engagement, capital delivery, funding administration, procurement, AI-provider, hosted-trial/service and website requirements. Root independently recovered August 11 requests for comprehensive work-plan coverage and the full aerial/ODM lane; this audit did not reread those raw-history excerpts. The final roadmap attributes them explicitly at M2a/M5b. Root owns the exact historical citation.
- **Historical agent proposals or reports:** earlier architecture and shipped records show prior direction and existing work. They are not new user instructions or present acceptance proof. The February proposal’s city-count, timing and stack choices do not supersede the current nationwide contract.
- **Professional completion recommendations:** the concrete cases and falsification examples below translate broad obligations into reviewable outcomes. Where not already explicit in the contract or user instruction, they are proposed engineering/practitioner acceptance details, not purported quotations from Nathaniel.

## Nine scope families and present coverage

### 1. Full aerial work, including in-house processing

**Authority/evidence:** aerial evidence is part of the binding shared planning spine (`V1_PRODUCT_CONTRACT.md:162–169`). Current Aerial catalog includes mission/package states and project, grant, report and public-response uses (`openplan/src/lib/aerial/catalog.ts:1–4,29–52`). Its operator-assisted planning caveat prevents claims of automatic survey certification or flight compliance. The proposed matrix explicitly requires actual imagery-to-planning use, quality, rights, export and recovery (`doc-proposals/CAPABILITY_MATRIX.md:91`). Root’s direct-user history establishes the fuller ODM requirement; do not shrink it to uploading an orthophoto.

**Present verdict:** initially missing an explicit roadmap owner; **restored in M5b**. Existing Aerial and ODM work are the home. The final draft includes mission/AOI planning, flight-plan export, photo intake, processing, inspected outputs and downstream evidence. This is substantially more precise than generic worker recovery in M3.

**Completion evidence:** an authorized qualified operator carries a permitted real dataset through planning, supported flight export, in-house processing, quality review, map inspection and a real planning artifact. Inspect full-resolution outputs, CRS/vertical units and custody; interrupt/recover work and verify downstream private/public derivatives. A thumbnail or completed worker status cannot satisfy the outcome. Survey/flight authority and use-specific quality remain separate facts. No new aerial implementation is authorized by this review.

### 2. Benefit-cost, demand management and agency prioritization

**Authority/evidence:** capital programming, prioritization and grants are binding practice (`V1_PRODUCT_CONTRACT.md:55–56`). July 17 documents real screening engines; July 18 adds persistence and narrative integration (`docs/ops/2026-07-17-grants-bca-tdm-screening-shipped.md:19–31`; `docs/ops/2026-07-18-grants-bca-persistence-and-facets-shipped.md:14–43`). **Do not repeat the superseded July 17 “not persisted” limitation.** Current BCA explicitly distinguishes screening from analysis of record (`openplan/src/lib/bca/parameters.ts:84–96`). TDM defaults identify general-literature assumptions and unverified CAPCOA correspondence (`openplan/src/lib/tdm/catalog.ts:1–16`). These are strengths in disclosure, not proof the required application analysis is complete.

**Present verdict:** initially absent from ordinary-analysis completion; **restored in M6b/M6c**, using BCA, TDM, RTP priority framework, Programs, Grants, Safety and Reports. M5 supplies source/units reuse. Prioritization is an agency policy decision, distinct from a BCR calculation or procurement scoring. Native support for every external analysis tool is not established as a direct user requirement.

**Completion evidence:** a real decision/application uses the applicable supported calculation or a reviewed external analysis-of-record artifact, preserving source edition, quantities, monetary year, baseline, discounting, sensitivity and limitations. Independently reconstruct both the calculation and agency-selected program, including criteria, weights, eligibility, overrides and deferred projects. Missing inputs, double-counted benefits, overlapping TDM measures and changed criteria must change or invalidate the appropriate conclusion. Separate model validation does not validate monetization, policy weights or TDM effect assumptions. Complete grant handoff remains part of the outcome; a better screening panel alone cannot close it.

### 3. Transit service planning and multimodal implementation

**Authority/evidence:** transit, active transportation, freight and safety are explicit practice; transit agencies are a distinct organization (`V1_PRODUCT_CONTRACT.md:42,52`). The current matrix requires service planning through capital/operations decisions and GTFS round-trip (`US_PLANNING_CAPABILITY_MATRIX.md:87`). The historical platform plan describes feed upload and service-change accessibility questions (`docs/archive/plans/2026-02-19-platform-design.md:8–27`); those examples are historical direction, not current performance proof.

**Present verdict:** M6 originally framed completion only as an investment decision; **M6a now restores service/resources/operations and an appropriate feed/record handoff**, plus separate active-travel and freight cases. Existing GTFS/routing, Safety, Models, Projects and Programs are the home. This does not require fare collection, dispatch or a replacement transit stack.

**Completion evidence:** a transit planner compares actual service-day alternatives, resources/cost assumptions and access/equity effects, obtains an operating or capital decision and hands off the appropriate usable service record/feed. Exercise calendar exceptions, transfers and a rural/no-feed case. Walking/cycling, freight and safety each need their own completed decision and implementation record; success in one mode does not close all four. Missing serious-injury evidence cannot become zero injuries, and disabled mode inputs cannot prove no demand.

### 4. All relevant plan families, including small-town and housing work

**Authority/evidence:** comprehensive/community planning and core land-use practice are binding (`V1_PRODUCT_CONTRACT.md:47–58`). The land-use contract explicitly supports general, comprehensive, specific, area, community, neighborhood, tribal and equivalent plans, with adopted packets, mapped designations and implementation records (`LAND_USE_PLANS_CONTRACT.md:7–32`). Existing work-plan filenames cover additional families: zoning/code, downtown revitalization, parks/open space, historic preservation, annexation, design guidelines, feasibility, climate/hazard, housing, transit development, active transportation, freight and others. Their registry calls them editable standard-practice starting points, **not statements of agency requirements** (`openplan/src/lib/work-plans/template-registry.ts:1–41`).

**Present verdict:** broad scope existed, but M7’s original Done criteria could close on a policy version and housing inventory. **M2a and the final M7 paragraph restore comprehensive work-plan coverage and full plan production** (`ROADMAP_DRAFT.md:69–73,122–131`). Remaining work is a named family-to-outcome crosswalk. Twenty-four template files do not prove twenty-four finished practices, nor establish a permanent exhaustive taxonomy.

**Completion evidence:** for each applicable family, identify the actual plan/project home, required outputs, source/applicability review and a complete practitioner case. Produce reviewed narrative, maps, policies, responses, adoption and implementation monitoring, with plan relationships and exact approved versions intact. A housing inventory alone cannot close a housing plan; a transport-only demonstration cannot close a small town’s general/community planning work. Preserve legitimate unsupported rules rather than fabricate compliance. The existing plan/document/work-plan systems remain the starting point.

### 5. Development review through decision and follow-through

**Authority/evidence:** development review and interdepartmental coordination are explicit binding practice (`V1_PRODUCT_CONTRACT.md:58`); the current matrix leaves the complete statutory-responsibility journey unassessed (`US_PLANNING_CAPABILITY_MATRIX.md:77`). Existing versioned land-use plans and projects provide a coherent home. The neutral plan-type and effective-policy guarantees are essential but are not an application decision.

**Present verdict:** intake, completeness, referrals, findings, appeals and conditions were in M7 scope but missing from its narrower Done clause. **The final M7 paragraph now expressly requires a complete development case** (`ROADMAP_DRAFT.md:126–131`). No code absence is inferred from the old wording.

**Completion evidence:** a real permitted application reaches completeness review, departmental referral, source-bound findings, authorized decision, conditions and monitored follow-through; exercise an applicable appeal/amendment and changed policy/source date. An applicant-facing derivative must preserve privacy and the correct operative record. A condition stored on a project cannot establish that the case reached a lawful decision. This obligation does not automatically expand into a replacement building-permit, inspection, ERP or code-enforcement suite.

### 6. Environmental review, climate and resilience as distinct jobs

**Authority/evidence:** environmental, climate, resilience and equity practice is binding (`V1_PRODUCT_CONTRACT.md:53`). The capability matrix explicitly leaves statutory environmental workflows and use validation unassessed (`US_PLANNING_CAPABILITY_MATRIX.md:73`). Environmental-review and climate/hazard work-plan artifacts show existing product homes; they do not establish current legal sufficiency.

**Present verdict:** M8 originally permitted “each claimed workflow” without naming the required cases. **The final M8 now names environmental review and climate/resilience/equity outcomes** (`ROADMAP_DRAFT.md:133–148`). RTP, Plans, Projects, Scenarios, Engagement and Reports remain the home. The required source/use matrix is explicitly still open.

**Completion evidence:** separately establish actual applicable authorities/process, alternatives, required studies, consultation and responses, exact decision and mitigation/monitoring commitments; then an emissions/hazard/exposure-based action case with adopted responsibility/funding and measured follow-through. A scenario map or VMT screen alone cannot close either job. Test missing studies, absent populations, mismatched units/time horizons and changed commitments. Specialists must define the applicable California/federal/local instruments from current primary sources before acceptance. This audit does not freshly verify environmental law or claim one universal checklist.

### 7. Title VI and service-equity responsibility beyond a translated survey

**Authority/evidence:** Title VI and public decision records are explicit practice (`V1_PRODUCT_CONTRACT.md:54`). The matrix asks for campaign-to-decision response and Title VI evidence (`US_PLANNING_CAPABILITY_MATRIX.md:74`). The historical August review reported reachable Title VI/BCA panels but limited discovery (`docs/ops/2026-08-25-v1-review-and-roadmap.md:357–378`); that is a dated observation, not a current UI defect. Root’s current source audit identifies existing adopted-policy/service-equity safeguards; this audit did not independently execute them.

**Present verdict:** engagement and generic distributional effects initially risked absorbing the obligation. **M8’s final Title VI/service-equity case explicitly restores it**, connected to M6/M9/M12 (`ROADMAP_DRAFT.md:146`). Existing policy/equity and participation records should be extended, not duplicated.

**Completion evidence:** the responsible agency completes an applicable, practitioner-defined review with exact policy, service scenario, population denominator, participation evidence and a human decision. Preserve missing measurements separately from service absence and verify decision implications. A screening disparity is not a legal finding; a translated survey is not a complete agency program. The applicable agency case and required artifacts still need source review; no universal filing deadline or agency exemption is asserted here.

### 8. Small/rural, tribal, state, nonprofit and interagency work in substance

**Authority/evidence:** these organizations are explicit binding users (`V1_PRODUCT_CONTRACT.md:36–45`). The current matrix requires statewide governance/distributed teams, tribal sovereignty/connectivity/data control, and limited-capacity nonprofit/community handoff (`US_PLANNING_CAPABILITY_MATRIX.md:83–89`). Those are organizational jobs, not interchangeable geographic labels.

**Present verdict:** **present but still too generic to close**. G1 properly includes every required interaction and M1–M15; M2 supplies handoff, M4 case access/staff exit, M11 contracted work and M13 interagency funding. However, the human-observation list still says “small/rural or tribal organization” (`ROADMAP_DRAFT.md:299–306,346–350`). One group cannot establish the other’s sovereignty or operating constraints. The exact named organization-practice cases remain unspecified.

**Completion evidence recommendation:** record distinct small-office work, sovereign tribal control, statewide/distributed-agency coordination, consultant multiclient separation, and nonprofit/community-to-agency handoff cases. Reuse staff roles, My Work, Projects, Documents and existing agency/program relationships. Include a departing/delegated staff member, limited connectivity where applicable, confidential consultation and an external partner who lacks broad workspace access. Actual stakeholders, authority, commitments and responses must remain traceable. This is not evidence for adding a standalone CRM, general HR system or every conceivable agency business function.

### 9. Daily planner administration and shared human document work

**Authority/evidence:** GIS/data stewardship, document production, reports and public records are core practice; shared evidence and one coherent case are durable guarantees (`V1_PRODUCT_CONTRACT.md:57,162–169`). The land-use contract requires readable plans/implementation records without re-entering evidence. The draft matrix already identifies Reports, Knowledge Base, My Work and workspace responsibilities (`doc-proposals/CAPABILITY_MATRIX.md:92–99`). Existing document/library/editor capability must not be mistaken for absent code merely because earlier milestones were generic.

**Present verdict:** **restored explicitly in M2b/M2c and M5a**: central discovery of uploaded/generated files, human drafting/review, OCR corrections, daily assigned/blocked/deadline work and failure recovery (`ROADMAP_DRAFT.md:69–73,93–105`). These extend existing Document Library, Knowledge Base, Reports, editors, Dashboard and My Work. They are not new modules.

**Completion evidence:** a staff member finds the exact permitted source/version, drafts and reviews a complete non-RTP document, resolves an edit conflict, exports usable figures/tables and hands off an approved record. A supervisor identifies actual blocked/stale/failed work and delegates it. Distinguish stored bytes, indexing, citation and download status; failed reads cannot become empty queues. A source library panel or scheduled notification alone does not establish a functioning planner workday.

## Required reconciliation and sequencing

Keep these outcomes in the existing queue. Preserve the newly restored M2/M5/M6/M7/M8 cases alongside the explicit early engagement, provider, capital, RTP and PM priorities. Do not launch nine new modules or postpone all ordinary planning work until scientific validation finishes.

The remaining concrete documentation task is to split the ledger’s broad `CORE-PLATFORM-01` row into linked practice/outcome records, or attach a maintained crosswalk under it. Each needs: authority class/source; existing home; named family and organization; milestone; required artifact; responsible human review; falsification case; current evidence state. Link to the same geographic/organization registry without treating sparse flat labels as interaction proof. The current ledger rightly warns that a completed subfeature cannot close its whole requirement (`CORE_REQUIREMENTS_LEDGER.md:22–26`); the missing detailed mapping makes that rule hard to apply.

Finish that inventory early in M2a, before selecting demonstrations. M5’s source/library/aerial work and M6’s distinct modal/BCA/prioritization cases then have concrete recipients. M7/M8 require practitioner/applicability research before domain acceptance; development can begin with source intake and honest missing evidence. G1 and human observation should accompany each family, with a named organization case, rather than use an end-stage generic repetition.

A later reviewer can falsify this audit’s remaining documentation concern by pointing to the maintained named family/organization crosswalk and its complete acceptance mapping. A matching keyword, additional template, old release note, generic successful case or passing test does not falsify it. Implementation completion requires observed identified-checkout journeys, independently reusable artifacts, meaningful failing checks, permission/accessibility/recovery evidence and the applicable scientific use proof. None was collected here.

## What was not lost, and what remains unknown

The latest draft explicitly retains the recently restored RTP prior-plan/full-element workflow, contracted project budgets, complete capital delivery, local-measure administration, both procurement sides, engagement ambition, provider choice, free self-hosting plus optional services, hosted trials, website work, all 50 states/DC, California depth and separate model science. This audit does not reopen those product decisions. Territory interpretation remains an explicit unresolved product question; no scope change is proposed.

Historical sampling was bounded. It cannot establish that every past user instruction has been recovered. Root owns the historical-user citation audit and current implementation review. This report distinguishes revised roadmap promises from working behavior and does not infer that historical functionality vanished. No live legal, provider or cost claim is made without fresh research; domain-specific primary-source research remains a milestone dependency where indicated.

Final working-tree check after scratch report creation found concurrent changes in `openplan/src/app/api/land-use-plans/route.ts`, `openplan/src/components/land-use-plans/land-use-plan-workbench.tsx`, `openplan/src/lib/land-use-plans/registry.ts`, `openplan/src/test/land-use-plan-registry.test.ts`, `openplan/src/test/land-use-plan-route-guards.test.ts`, and new `openplan/src/test/land-use-plan-content-workbench.test.tsx`. This agent changed none of them. The only file written by this task is this report; clean initial status must not be represented as current clean status.
