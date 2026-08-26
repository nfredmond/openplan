# OpenPlan v1 product contract

<!-- openplan-v1-product-contract
decided: 2026-08-25
current_release: v0.36.0
direction_review: docs/reviews/product-direction/2026-08-25-v1-direction.md
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

California is the deepest v1 proof environment, not a hardcoded product default.
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
