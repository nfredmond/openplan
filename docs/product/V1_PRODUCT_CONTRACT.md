# OpenPlan v1 product contract

<!-- openplan-v1-product-contract
decided: 2026-08-25
current_release: v0.44.0
direction_review: docs/reviews/product-direction/2026-09-06-workspace-control-and-owp-review.md
review_protocol: docs/product/PRODUCT_DIRECTION_REVIEW_PROTOCOL.md
capability_matrix: docs/product/US_PLANNING_CAPABILITY_MATRIX.md
validation_research: docs/modeling/VALIDATION_OBSERVATION_UNCERTAINTY_RESEARCH_2026-08-25.md
validation_preregistration: docs/modeling/NATIONWIDE_VALIDATION_PREREGISTRATION_V1.json
roadmap: docs/ROADMAP.md
-->

This is the durable definition of the product OpenPlan must become before the
v1.0.0 tag. Nathaniel set this direction after comparing independent Claude and
Codex full-repository reviews on 2026-08-25. A later product-direction review may
strengthen or amend it, but a release plan may not quietly narrow it.

## Mission

**OpenPlan v1 is the ultimate free and open-source operating system for planning
practice in the United States: powerful enough for any type of planner to use
for their core work, coherent enough to operate as one product, self-service
without Nathaniel, and defensible enough that its evidence can survive public,
technical, legal, and funding review.**

Worldwide use remains the architectural destination. US-specific law and data
must stay behind adapters and registries so national completeness does not bake
one country into the core.

This is deliberately ambitious. There is no calendar deadline for v1 and no
maximum number of pre-v1 releases. Work may take the rest of the decade. Runtime
may be measured in days when accuracy benefits. Time, effort, and the desire for
a smaller version number are never evidence that the contract is satisfied.

## Who v1 must serve

The product must support the core work of planners in, at minimum:

- cities, towns, counties, regional and metropolitan planning organizations;
- state transportation and other planning agencies;
- tribal governments and rural or capacity-constrained agencies;
- transit providers and multimodal transportation organizations;
- planning, engineering, and environmental consultancies;
- non-profits, community organizations, and independent planners.

The capability review must cover, at minimum:

- long-range transportation and regional planning;
- land-use, comprehensive, and community planning;
- travel demand, corridor, scenario, and performance analysis;
- transit, active transportation, freight, and safety planning;
- environmental review, climate, resilience, and equity work;
- community engagement, Title VI, and public decision records;
- capital programming, project prioritization, grants, delivery, and funder
  reimbursement;
- GIS, data stewardship, documents, reports, and public records;
- development review, implementation tracking, and interdepartmental handoff.

This list is a floor, not a ceiling. A periodic product-direction review must add
a newly identified core planning need. It may conclude that an existing module
should own it or that a new module is necessary. "Do not add modules" is no
longer an absolute rule; opportunistic module growth is still refused.

The maintained inventory and proof vocabulary live in the
[US planning capability matrix](US_PLANNING_CAPABILITY_MATRIX.md). A planning
practice, organization, geography, or cross-cutting proof dimension cannot
disappear from v1 merely because a later roadmap stops mentioning it.

## Explicit core outcomes reaffirmed September 4, 2026

These clarify the practice floor and preserve Nathaniel's current and recovered prior requirements. They do not announce implemented capabilities or reduce any other v1 obligation. Their evidence mapping is maintained in [core requirements](CORE_REQUIREMENTS_LEDGER.md); sequencing remains in the single roadmap.

- **Work-plan coverage and everyday practice:** maintain comprehensive adaptable transportation and land-use work-plan families, selectable plain-language daily work views, blocked-work and deadline follow-through, and complete human document authoring/review. A generic project or template count cannot close the named practice outcomes in the requirement ledger.
- **Shared files and agency intake:** project and all-project library access to permitted uploaded/generated artifacts, general scanned-document OCR, and reviewed GIS/spreadsheet intake including shapefile, KML/KMZ, explicit geodatabase variants and CSV/XLS/XLSX. Preserve existing supported formats, source identity, field/geometry/unit meaning, complete exports and independently usable plan archives. Resident submissions retain their separate privacy controls.
- **Full aerial work:** project-linked mission planning and supported flight export, photo intake, in-house ODM processing, quality-reviewed orthophoto/point-cloud/elevation outputs and reuse as planning evidence. Processing completion, aircraft compatibility, flight authority and use-specific measurement quality are separate facts to establish.
- **Grant pursuit:** official-source discovery, supported applications with optional AI, amendments and actionable calendars/alerts, retained submission/outcome evidence and award-condition handoff into administration. This is a required pre-award job alongside the post-award requirements below.
- **Overall Work Program administration:** a high-priority agency workflow from importing the prior adopted OWP/UPWP and amendments through preparing work elements, staffing/funding and products, review/adoption and external approvals, daily delivery, quarterly reporting/reimbursement, amendments, expenditure certification and reconciled carryover/closeout. Connect the same records across Projects, Programs, staff effort, contracts, funding, Documents, Reports and My Work. Preserve California MPO/RTPA distinctions, actual one- or two-year cycles, planning-fund eligibility, approved baselines and public/internal records; a generic work-plan template is insufficient.
- **Planning project management:** original/current contracted budgets and approved changes, task/work-package and employee allocations, deliverable commitments, actual hours/costs, remaining work, forecast cost and completion dates, dependencies and review/acceptance deadlines. Distinguish internal cost, client fee/billing, cash and funder reimbursement. Support small practices as well as agency contracts, with proportional effort and preserved financial history.
- **Complete RTP updates:** create, adjust and track every applicable policy/action/financial and narrative element, mapped short/long-term projects and funding, performance, public review/comment responses, adoption and implementation. Begin with the previous adopted RTP, retaining reviewed source figures, tables, chapter text, provenance, conflicts and differences between cycles. No element is complete merely because a template or record type exists.
- **Public engagement:** mapping participation and agency administration demonstrably better than Social Pinpoint for observed planning work, with accessible participation, useful receipt/response, accountable decisions and portable complete records.
- **Planner Agent provider choice:** supported user-selected APIs/models and locally installed Codex, Claude Code and OpenCode using appropriate native authentication/account modes. Reuse the relevant T3 Code implementation where justified. Preserve installation disclosures, user/device/workspace boundaries, exact human approvals and provider-specific conditions; no silent API-billing fallback.
- **Platform-wide agentic work:** a planner can assign substantial work across the product, see progress and sources, review exact proposed consequences, recover after interruption and use the resulting artifacts. Extend the existing Planner Agent and shared capability/approval system, with optional Buzz or other compatible clients. Provider choice alone does not satisfy this outcome; agent work must join the complete planning workflows while the product remains fully usable without any agent.
- **Local tax measures and grant administration:** administering organizations configure actual program rules and reporting requirements; recipient cities/agencies use the hosted instance to report projects, expenditures, delivery quantities and evidence under scoped access. Staff review/correct/certify, administer distributions or reimbursement as applicable, reconcile balances, publish oversight records and preserve successor-measure history. Post-award administration is distinct from funding discovery and application writing.
- **Procurement from both sides:** consultants discover opportunities, assess fit, prepare truthful source-linked proposals, manage questions/addenda, submit through the authorized channel and retain receipt/outcome evidence. Agencies/MPOs/RTPAs create and issue RFPs/RFQs, securely receive and retain responses, apply the correct reviewed selection method, evaluate, negotiate, resolve required notices/protests, award and transfer executed work into contract administration. Preserve bidder privacy, evaluation independence, exact versions and funding/authority-specific requirements.
- **Hosted evaluation and independent ownership:** a mid-term remotely accessible installation supports real browser-based demonstrations and saved trial work, with the services needed for every advertised capability. Customers can transfer their work into a self-hosted or independently funded deployment. Optional paid implementation, annual administration and customization support adoption without restricting software features, source access, customer records or the right to operate independently. Shared-host resource controls are operator configuration, not paid product tiers.
- **Capital delivery:** planning through environmental review, ROW/utilities, PS&E, procurement, construction administration, payment/reimbursement, acceptance, closeout and asset handover, including intake of already-active projects. California depth includes actual applicable Caltrans workflows, exact required documents and invoicing, with dated funding/authority rules and responsible review. Full local-assistance depth includes nonconstruction/FTA branches, agency civil-rights and hearing records, independent field/quantity/payment evidence, post-construction maintenance and county mileage certification, and agency-wide audits/corrective actions. Applicability and actual external authority govern; a chapter label or template is not completion.

Budget consumption is not accepted work progress; a plan's regional financial element is not the consultant's fee ledger; an adopted project is not an authorized construction expenditure. Keep each fact linked to its actual owner and meaning. These outcomes deepen existing product homes unless evidence establishes a missing home. They must remain explicit in capability reviews and the route to v1 after any change of agent or release focus.

## Nationwide completeness

Before v1:

1. Every core journey works in all fifty states and the District of Columbia.
2. Every state has an explicit, maintained matrix for data sources, statutory
   rules, responsible agencies, geographic identifiers, and known limitations.
3. A missing state source or legal rule is a v1 gap, not a permanent excuse.
   Interim releases continue to degrade honestly while the gap is open.
4. US territories receive an explicit support matrix and never silently inherit
   state assumptions. The architecture must permit full territory and later
   international support without changing core types.
5. No national aggregate may hide a failing state, rural region, tribal area,
   border region, island, mountain region, or major metropolitan area.

## California gold standard

California is the deepest v1 proof environment, not a hardcoded product default. National procedural coverage must distinguish current source discovery, reviewed applicability and completed practitioner workflows. Agency certification, delegated authority, sponsorship, funding/payment conditions and retention cannot be inherited from California or a workspace home state. Preserve the actual federal/program/award relationship and incorporated source versions, with explicit draft, superseded, missing and unresolved states. Alaska and Hawaii remain full state obligations; island, Tribal and award-specific authority cannot be reduced to a county or state label.
"Flawless" means:

- every California county and incorporated place resolves from authoritative
  registry data rather than a literal list in application code;
- every v1 journey completes with the configured California legal and source
  depth, including state-specific planning, funding, safety, environmental, and
  reimbursement requirements that OpenPlan claims to support;
- statewide, metropolitan, suburban, rural, mountain, coastal, border, and
  tribal contexts are represented in the evidence;
- no known Blocker or High defect is open or hidden behind documentation;
- public artifacts are usable, sourced, accessible, printable, and approved by
  the responsible human;
- backup, restore, upgrade, and long worker recovery preserve the work.

It does not mean that every estimate equals an unknowable true value. It means
every published claim has passed its declared gate and every limitation is
visible where the claim is used.

## The nationwide validated travel model

A screening-only model is not the v1 destination. Both AequilibraE and
ActivitySim must be fully operational and scientifically defensible nationwide.

The v1 modeling program must:

1. Run both demand methods on the same selected geography, population, network,
   assignment settings, and evidence boundary in every state.
2. Replace unlabelled borrowed behavioral coefficients with locally estimated,
   hierarchically transferable, or explicitly source-bounded parameters whose
   provenance and applicability are testable.
3. Address demand distribution, external and through travel, network loading,
   unloaded links, road-class coverage, transit, and calibration as measured
   scientific problems rather than scalar-fitting exercises.
4. Pre-register validation uses, datasets, metrics, geographic strata, and
   acceptance gates before opening untouched holdouts. Current gates remain in
   force until evidence justifies a change.
5. Pass the applicable untouched holdout gate in every state and required
   geographic archetype. A national median cannot rescue a failing state.
6. Give California additional sub-state proof across its full geographic and
   agency diversity.
7. Preserve both model outputs and their disagreement. Never average them.
8. Distinguish measured, modeled, unloaded, unavailable, and out-of-network
   values on every live and exported surface.
9. Publish only the use tier the evidence supports. Environmental forecasting,
   if claimed, requires its own stronger validation; planning-grade validation
   cannot be relabelled to reach it.
10. Run in resumable workers with durable custody and no accuracy-driven timeout.

At the decision date, OpenPlan has no independent nationwide accuracy result.
The often-repeated 43.3% median APE was the model-selection metric from the
roughly 30% holdout drawn from a 57-station, one-county dataset; a later trial
worsened the metric and was rejected. It cannot describe the United States or
independent validation. The absence of valid nationwide evidence is the v1
blocker. Fitting one scalar per region and reporting a prettier national number
is explicitly refused.

The observation and acceptance design is grounded in the
[traffic-count uncertainty research](../modeling/VALIDATION_OBSERVATION_UNCERTAINTY_RESEARCH_2026-08-25.md).
It requires two separate bands: a source-supported observation interval and a
preregistered, use-specific model acceptance tolerance. A modeled value inside
an observation interval is indistinguishable at that observation's precision;
it is not thereby proven correct.

The first frozen protocol artifact and its detached SHA-256 digest are
[`NATIONWIDE_VALIDATION_PREREGISTRATION_V1.json`](../modeling/NATIONWIDE_VALIDATION_PREREGISTRATION_V1.json)
and
[`NATIONWIDE_VALIDATION_PREREGISTRATION_V1.sha256`](../modeling/NATIONWIDE_VALIDATION_PREREGISTRATION_V1.sha256).
It blocks new nationwide calibration candidates until decisive datasets,
dataset hashes, independent geographic partitions, observation intervals, and
use-specific thresholds are frozen in a successor. The existing 30 percent
selection holdout remains diagnostic only.

## One coherent operating system

Projects and statutory plans are the durable spine. Data, documents, models,
safety, engagement, land use, programming, funding, aerial evidence, reports,
review, and approval reuse that context. Specialist entry points may remain,
but a planner does not reconstruct the job at every module boundary.

Every top-level surface must participate in at least one proven core journey or
leave the top level. Every core planning need must have one clear home. Shared
evidence must have one implementation used by all consumers.

## V1 acceptance evidence

The v1 tag requires all of the following on one candidate commit:

- every required planner-role, organization, geography, and capability cell is
  `proven`; `partial`, `missing`, and `not assessed` do not pass;
- every state and required geographic archetype passes the applicable model and
  workflow gates, with the additional California proof above;
- all end-to-end planning journeys reach the intended outcome from visible UI
  entry points and produce usable artifacts;
- an independent person installs, operates, backs up, restores, and upgrades the
  product without Nathaniel;
- accessibility, responsive, keyboard, screen-reader, print, and public-artifact
  checks pass for every core journey;
- live RLS, worker suites, mutation samples, restore and upgrade rehearsals,
  dependency audit, build, and CI pass;
- the latest product-direction review is current and no unresolved independent
  review identifies a simple, high-leverage omission from the core product.

"Ultimate" is a direction, not a claim of metaphysical completeness. The v1
claim is justified when the maintained coverage system finds no unproven core US
planning need and independent adversarial reviews cannot produce an unresolved
one. New evidence after v1 may reopen the matrix; v1 does not end development.

## Permanent boundaries

- Free and open source; no paid tier or required paid infrastructure.
- Self-service; no founder or manual operator dependency.
- Human control over consequential facts, publication, adoption, and money.
- No invented data, hidden coverage limit, unsupported zero, or promoted claim
  tier.
- No averaged demand-model result.
- No accuracy sacrifice justified only by runtime.
- No US-specific concept in core architecture.

## Explicit aerial completion requirement, September 4 clarification

The full aerial lane retains the substantial processing, control/accuracy, 2D/3D, measurement, spectral, repeat-survey, export, sharing and operational capabilities of current OpenDroneMap and WebODM. A maintained dated benchmark must also cover video-source and external visualization/processing handoffs where substantial. Better planning usefulness requires independent comparative evidence, not a product claim. Complete project/mission/capture operations and reviewed downstream reuse remain part of the same lane.

KML export and computer-to-DJI-controller USB transfer are explicit requirements. Preserve survey-boundary KML, review KML and supported complete mission formats as distinct artifacts; validate the actual aircraft/controller/app combination. Generated, copied, imported, preview-reviewed and flight-validated are different evidence states. Intermediate unsupported states do not reduce the full destination. M5b.1–6 and CORE-AERIAL-01/02, CORE-DJI-01 own completion; no automatic flight or unmeasured survey-grade claim is implied.


## Project-specific engagement setup, September 4 clarification

A planner can easily create a public input map for a project and tailor its questions, comment categories, instructions, geographic context and participation settings. Editable templates or blank setup support different planning problems, including complete streets and countywide wayfinding. Preview, deliberate publication, accessible participation and staff/export consistency form one workflow. Reuse and later edits preserve other campaigns and the meaning of earlier contributions. CORE-ENG-02 and M9a make this explicit within the existing engagement ambition.

Planners also need a coherent response dashboard and review queue. Human moderation before public release is the default; approvals, redacted public copies and withholding decisions retain reasons and history. Pending/private records remain protected across public maps, feeds, exports, summaries and attachments. Moderation and agency follow-through are distinct states. CORE-ENG-03/M9a–b preserve this explicit requirement.

Engagement reports export as polished PDF and usable XLSX with portable supporting data, declared scope/snapshot, complete included responses, interpretable maps/tables and reviewed staff responses. Public and internal packages enforce their actual disclosure rules. CORE-ENG-04/M9a–b require recipient-ready files and independent reconciliation, not merely a download button.

## OWP, appearance and forecasting decisions retained at handoff

Complete OWP/UPWP administration is an explicit high priority. It includes prior-program intake, work elements and products, staff/contracts, authorization and amendments, delivery, progress and claims, expenditure certification, closeout and next-cycle carryover. CORE-OWP-01 and roadmap M2d define its connected outcome; a work-plan template is insufficient.

Retain the requested Signal palette with yellow, two grays and black alongside existing palettes, and an independent default-rounded or square-corner preference. These are queued UI changes, not implemented by documentation.

TimesFM evaluation targets 3.0 only; Nathaniel rejected 2.5. Roadmap S2a preserves the actual license, scientific and deployment conditions. Optional forecasting does not replace either demand model or the full geographic validation obligation.
