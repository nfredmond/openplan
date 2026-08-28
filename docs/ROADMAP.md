# OpenPlan development roadmap

<!-- openplan-active-roadmap
reviewed_commit: cb445c4b
current_release: v0.39.0
review_by: 2026-09-25
paths:
- AGENTS.md
- CLAUDE.md
- docs/product/V1_PRODUCT_CONTRACT.md
- docs/product/AGENT_OPERATING_RULES.md
- docs/product/PRODUCT_DIRECTION_REVIEW_PROTOCOL.md
- docs/reviews/product-direction/2026-08-25-v1-direction.md
- openplan/scripts/ops/product-direction-review.mjs
- openplan/src/test/product-direction-review-guard.test.ts
- openplan/src/lib/safety/sources/registry.ts
- openplan/src/lib/auth/role-matrix.ts
- openplan/src/lib/runtime/action-metadata.ts
- docs/ops/KNOWN_ISSUES.md
- docs/modeling/WHERE_THE_NUMBER_STANDS_2026-08-20.md
- docs/modeling/VALIDATION_OBSERVATION_UNCERTAINTY_RESEARCH_2026-08-25.md
- docs/modeling/OPEN_SOURCE_MODEL_LANDSCAPE.md
- openplan/docs/ops/BACKUP_AND_RESTORE.md
- docs/ADRs/ADR-004-mcp-server-surface.md
- qa-harness/FIRST-WEEK-HARNESS.md
npm_commands:
- product:direction:check
- product:direction:packet
- ops:restore-drill
- test:workers
- test:rls-live
- qa:gate
-->

This is OpenPlan's only active development queue. The binding destination is
[`docs/product/V1_PRODUCT_CONTRACT.md`](product/V1_PRODUCT_CONTRACT.md). Dated
records, research, ADRs, archived plans, and independent reviews are evidence,
not competing queues. `CHANGELOG.md` records what shipped.

Nathaniel expanded the v1 contract on 2026-08-25 after comparing independent
Claude and Codex reviews. The four-to-six-release proposals in those reviews are
superseded. There is no deadline and no promised number of releases before v1.

## Destination

OpenPlan v1 is the ultimate free and open-source operating system for US
planning practice. It must serve every type of planner's core work, work in all
fifty states and the District of Columbia, make California the gold-standard
implementation, operate coherently as one product, and include a fully working,
scientifically validated nationwide travel demand model.

Worldwide use remains the architectural destination. US data and law stay
behind adapters and registries.

Runtime and calendar time do not reduce scope. A model run may take days. The
program may take the rest of the decade. v1 is cut when the evidence says this
contract is true, not when a version sequence looks long enough.

## How "do what's next" works

Before selecting a major lane, an agent must:

1. Run `npm run product:direction:check` from `openplan/`.
2. Read the v1 contract, this roadmap, the latest direction review, current
   release and CI, live product journeys, known issues, and relevant research.
3. Reassess the product from the full planner and agency coverage map. Past
   agent decisions and these instructions are evidence, not untouchable law.
4. Identify the highest-leverage unproven user outcome, including a simple idea
   outside the current module map that prior agents may have missed.
5. Check whether the capability already exists here, in Nathaniel's other
   projects, or in a suitable free/open-source library.
6. Choose the smallest architectural chunk that materially advances the v1
   contract, start it, and land it with executable evidence.

If the direction review has expired, a materially stronger model is available,
or a milestone just closed, generate a fresh packet with
`npm run product:direction:packet` and obtain independent fresh-context reviews
before committing the next major direction. Preserve their disagreements.

## Current truth at v0.39.0

Strong foundations already exist:

- connected planning, engagement, safety, funding, land-use, aerial, document,
  report, and dual-demand-model capabilities;
- claim tiers, provenance, exact evidence hashes, human approval boundaries,
  agent refusals, sealed-study custody, and honest negative results;
- local/self-hosted workers, live RLS proof, backup and restore rehearsal,
  upgrade CI, interruption recovery, and a large mutation-backed test surface.
- one authenticated rail, project-scoped workflow links, a guided
  baseline-versus-build modeling record, named-road Safety context, and an
  expiring machine-readable v1 coverage registry.

The v1 contract is not yet true:

- the unified shell and project context do not yet make every cross-module
  planning job complete or every specialist workflow approachable to a novice;
- the first-week gate covers only four required outcomes and must expand with
  the planner and organization matrix;
- the proof registry exposes many `partial`, `missing`, and `not-assessed`
  cells; those open cells block v1 even though they do not block this interim
  release;
- project GIS, workbook, immutable v2 evidence handoff, and named exact-hash
  submit/return/approve custody now exist; wider designation/model-link geometry,
  statutory decision proof, and stranger reuse remain incomplete;
- no independent stranger has installed and operated the product;
- the model is screening-grade, not nationwide validated. The often-repeated
  43.3% figure is the selection metric from the roughly 30% holdout drawn from a
  57-station, one-county dataset, not national or independent accuracy evidence.
  Rules-v4 now refuses a claim until observed and modeled quantities are proven
  comparable, but OpenPlan's true nationwide error is still unknown. Rank agreement in measured
  examples is weak, and most minor links are unloaded. Observation uncertainty
  is now represented without invented generic bounds, but has not yet been
  separated from structural model error with untouched use-specific evidence.

## Completed checkpoint: v0.38 trustworthy observed-count validation

- Added exact observation, comparison-basis, and assessment contracts plus one
  shared stdlib-only rules-v4 evaluation core.
- Added complete 2024 FHWA TMAS custody, conservative HPMS enrichment, exact
  polygon/multistate source resolution, Caltrans adjacent-side preservation,
  and explicit coverage failure states.
- Added append-only transactional assessment custody and planner-visible,
  report, assistant, and project-evidence disclosure with downloadable hashes.
- Kept legacy rows diagnostic, build forecasts inconclusive, and AequilibraE
  and ActivitySim separate.
- Stopped the seven-county development study before model-output reveal because
  zero method pairs had identical observation packages and pre-volume match
  audits. The readiness result is in
  `docs/modeling/OBSERVED_COUNT_INSTRUMENT_READINESS_2026-08-28.md`.

## Completed checkpoint: v0.39 frozen development instrument

- Froze one exact network, observation package, and assignment-blind match
  audit for each of the seven registered development counties.
- Required all seven custody gates to pass before opening any assignment
  output, then ran unchanged AequilibraE and ActivitySim baselines against the
  same county inputs.
- Preserved both methods separately and retained every ambiguous, excluded,
  unresolved, and unloaded observation.
- Published all fourteen outcomes as `inconclusive`. No fully comparable
  decisive observation and no use-specific acceptance rule existed, so the
  run made no validation claim and changed no defaults.

The next modeling checkpoint is structural diagnosis using this frozen
instrument: explain the unmatched and unloaded network coverage, missing
model-year/day comparability, and method disagreement before proposing a
candidate. Any later acceptance rule must be frozen from primary evidence
before an untouched holdout is opened.

That last point is a model-science question, not permission to fit observations
exactly. Traffic counts contain sampling, equipment, adjustment, temporal, and
location-matching uncertainty. v1 needs an uncertainty-aware gate that can
distinguish bad observations from bad model structure without letting either
hide the other.

## Completed checkpoint: v0.35 foundation

This release established the machinery the full v1 program depends on. The
open cells below the checkpoint remain v1 work, not claims that v0.35 solved
the full contract.

### One product

- Make Projects and Plans the durable context spine across analysis,
  engagement, safety, funding, documents, aerial evidence, and reports.
- Remove duplicate authenticated navigation and repeated primary actions.
- Present Models, Scenarios, and Validation as stages of one guided model job
  while preserving specialist URLs.
- Separate operator setup/health from the planner's daily overview.
- Close first-week continuity defects: active workspace, reminders and tasks,
  intake handoff, corridor entry, road identity, and printable street context.
- Keep the first-week outcome gate fail-closed: only a completed journey with
  `outcomeReached: "yes"` passes; retry and preserve `partly`, `no`, and
  inconclusive attempts.

### Strategic and validation foundation

- Maintain the v1 planner/organization/state/capability proof matrix and make
  missing or unassessed core cells fail the direction review.
- Complete the primary-source study of traffic-count uncertainty and current
  OpenPlan observation handling.
- Pre-register the nationwide model-validation program before trying candidates:
  claimed uses, station quality classes, observation uncertainty, temporal
  alignment, matching rules, geographic strata, metrics, holdout custody, and
  acceptance logic.
- Treat the current 30% screening threshold as provisional. Replace or retain it
  only from primary-source, use-specific research before the new holdouts are
  opened. Never change a gate after seeing its holdout outcome.
- Fix the public `metadataBase` warning and prove configured public URLs.

**Done when:** the project, engagement, safety, and corridor journeys reach
their actual outcomes without lost context; the strategic review expires and
fails mechanically; and the nationwide validation design can separate model,
observation, and matching uncertainty before any calibration candidate is run.

## Mandatory v1 program A: nationwide validated modeling

This program may span many releases. It is a v1 blocker, not post-v1 research.

### Establish trustworthy observations

- Grade count stations by raw versus factored estimate, duration, season,
  direction, year, equipment, imputation, and location-match confidence.
- Align model and observation periods or carry the mismatch uncertainty.
- Use repeated counts to estimate day-to-day and seasonal variability where the
  source supports it.
- Keep suspect observations visible as excluded or low-confidence evidence;
  never silently discard them after seeing model residuals.
- Report validation with and without low-confidence observations, under a
  preregistered rule.

### Repair model structure, not appearance

- Diagnose trip generation, distribution, destination and mode choice,
  external/through travel, network construction, centroid loading, road-class
  coverage, time-of-day, and transit against independent evidence.
- Replace unlabelled ActivitySim example coefficients with locally estimated,
  hierarchically transferable, or explicitly bounded coefficient sets.
- Route FAF and other defensible external-flow sources over the real network;
  do not substitute straight lines or one scalar per region.
- Load areas rather than a few centroid paths where evidence shows the current
  structure leaves roads unseen.
- Preserve resumability, evidence custody, and hours-to-days worker execution.

### Validate every place and use

- Pre-register development, selection, and untouched holdout geography before
  outcome access.
- Require each state and geographic archetype to pass its applicable use gate.
  A nationwide median cannot hide a failure.
- Give California deeper sub-state proof across its full agency and geographic
  range.
- Validate planning uses separately: corridor comparison, RTP/scenario work,
  grants, transit, and any stronger forecast claim. A lower claim tier cannot be
  relabelled upward.
- Keep AequilibraE and ActivitySim results separate. Agreement remains
  sensitivity evidence, not accuracy, unless untouched evidence proves more.
- Show measured, modeled, unloaded, unavailable, and out-of-network states in
  every live and exported result.

**Done when:** both methods run nationwide and every state plus required
archetype passes preregistered untouched holdout gates for every published use;
California passes its deeper suite; no model value appears without observation,
coverage, provenance, and uncertainty state.

## Mandatory v1 program B: every state in substance

- Maintain a state-by-state registry of crash and serious-injury data, traffic
  counts, transit, freight, demographics, equity, hazards, funding programs,
  statutory planning rules, environmental requirements, and responsible source
  agencies.
- Research and connect stable authoritative sources. Missing sources are gaps to
  solve before v1, while interim releases continue to disclose them honestly.
- Prove every core journey in every state and DC without changing call sites.
- Add an explicit US-territory matrix and preserve a route to worldwide bundles.
- Make California the complete reference bundle and prove every California
  geography from authoritative registry data.

**Done when:** every state/DC cell required by a core journey is proven and no
planner learns a coverage limit only after relying on a result.

## Mandatory v1 program C: every planner's core work

- Maintain coverage across transportation, land use, comprehensive planning,
  transit, active transportation, freight, safety, environmental review,
  climate and resilience, equity, engagement, capital programming, grants,
  delivery, reimbursement, development review, GIS/data, documents, reports,
  implementation, and public records.
- Evaluate cities, counties, regional agencies, state agencies, tribes, transit
  providers, consultancies, non-profits, and independent planners.
- Deepen and connect an existing module when it has a coherent home.
- Add a new module when the direction review proves a core need has no coherent
  owner and existing OpenPlan code or a suitable open-source library cannot
  supply it. Record why before building.
- Expand end-to-end journeys whenever the capability map finds a core planner
  job not represented by the current suite.

**Done when:** every core capability and organization cell is proven by a real
journey and artifact, with no `partial`, `missing`, or `not assessed` result.

## Mandatory v1 program D: interoperability and evidence handoff

- Export GeoPackage for geographic outputs and XLSX for portfolio round-trip.
- Keep the shipped per-project frozen evidence bundles current, and add per-plan
  bundles with the same machine-readable source, retrieval, tier, custody,
  uncertainty, and known-limit manifests.
- Make source documents and frozen artifacts discoverable from every dependent
  result.
- Support public, governing-body, GIS, spreadsheet, document-management, and
  archival handoffs without losing evidence.

**Done when:** an outside planner can inspect and reuse an artifact in standard
agency tools without opening OpenPlan or guessing its provenance.

## Mandatory v1 program E: teams, operations, and human control

- Extend roles to every consequential write and record named approval of exact
  artifacts.
- Make My Work the common assignment, review, approval, exception, and recovery
  inbox.
- Prove analyst, manager, approver, viewer, public participant, and agent
  principals across the full journey suite.
- Make local and self-host deployment, source setup, worker operation, backup,
  restore, upgrade, rollback, and recovery self-service.
- Complete keyboard, screen-reader, responsive, contrast, localization, print,
  and low-bandwidth evidence for every core journey.

**Done when:** a real team and an independent operator can run and recover the
whole system without Nathaniel and without weakening human control.

## Mandatory v1 program F: agentic planning control

The base product must remain fully usable without an agent. Once the underlying
workflows are proven, the MCP/Buzz direction from ADR-004 returns as pre-v1 work
because the ultimate planning operating system should be controllable with the
same discipline as a codebase.

- Build the MCP server as read then propose; do not build a client that bypasses
  the product's approval boundary.
- Derive writes from the action registry, exact executed-payload hashes,
  distinct agent authorship, claim tiers, audit records, and human approval.
- Let agents inspect the whole planning record, explain gaps, draft grounded
  work, and propose safe transitions without silently publishing, adopting,
  spending, or fabricating facts.
- Preserve full non-agent functionality and free/self-hosted operation.

**Done when:** a planner can direct a grounded agent across proven workflows,
review every proposed consequence, and reproduce the result without the agent.

## V1 proof campaign

On one candidate commit:

- every capability, planner type, organization type, state/DC, geographic
  archetype, artifact, accessibility, and operational cell is proven;
- every nationwide and California model holdout gate passes;
- every end-to-end journey reaches its intended outcome from visible UI entry;
- an independent person installs and operates OpenPlan without help;
- independent fresh-context product reviews find no unresolved core omission;
- live RLS, all workers, mutation samples, restore, upgrade, dependency audit,
  build, and CI pass.

Only then tag v1.0.0.

## Permanent refusals

- No paid tier, payment step, or required paid infrastructure.
- No averaged demand-model result or national average that hides local failure.
- No exact-fit objective that overfits noisy observations.
- No invented data, silent coverage limits, unsupported zeros, or promoted claim
  tiers.
- No agent-authored consequential facts or direct-to-public agent action.
- No serverless long-running model execution.
- No hardcoded place, jurisdiction, country assumption, or literal state/county
  roster in core code.
- No scope reduction justified only by time, work size, runtime, or an agent's
  preference for a nearer v1.
