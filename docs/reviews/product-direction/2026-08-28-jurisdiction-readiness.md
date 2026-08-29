# OpenPlan direction after the v0.41 scientific instrument

<!-- openplan-product-direction-review
review_date: 2026-08-28
review_by: 2026-09-28
reviewed_commit: 1536da3f81588b4d75130dab3f97fca866961507
current_release: v0.42.0
independent_contexts: 2
trigger: v0.41-milestone-and-whats-next
perspectives:
- transportation-and-travel-model-science
- land-use-statutory-and-development-planning
- environmental-climate-resilience-and-equity
- community-engagement-title-vi-and-public-decisions
- capital-programming-grants-delivery-and-reimbursement
- rural-tribal-small-and-capacity-constrained-agencies
- gis-data-evidence-and-public-records
- agency-operations-accessibility-and-recovery
- adversarial-product-strategy
decisions:
- ultimate-us-planning-operating-system
- all-planner-types
- all-fifty-states-and-dc
- california-gold-standard
- nationwide-validated-dual-demand-model
- no-calendar-or-runtime-scope-reduction
- preserve-independent-disagreement
- recheck-old-agent-decisions
- self-service-free-open-source
- human-control-and-evidence
- jurisdiction-readiness-before-reliance
- deepen-existing-product-spine
paths:
- docs/product/V1_PRODUCT_CONTRACT.md
- docs/product/AGENT_OPERATING_RULES.md
- docs/product/PRODUCT_DIRECTION_REVIEW_PROTOCOL.md
- docs/product/US_PLANNING_CAPABILITY_MATRIX.md
- docs/product/US_PLANNING_CAPABILITY_REGISTRY.json
- docs/ROADMAP.md
- docs/ops/KNOWN_ISSUES.md
- docs/ops/V041_COMPARABLE_OBSERVATION_PROOF_2026-08-28.md
- docs/modeling/NATIONWIDE_VALIDATION_PREREGISTRATION_V1.json
- qa-harness/FIRST-WEEK-HARNESS.md
- openplan/src/lib/jurisdiction-readiness/registry.v1.json
-->

Two fresh-context reviews independently reconstructed the repository after
v0.41. Both refused a new module and selected a visible, place-aware readiness
answer as the highest-leverage next completed outcome. They agreed that v0.41
repaired the observation instrument without validating either travel model and
that the nationwide modeling program remains a binding v1 blocker.

## Preserved independent findings

The first review selected one California and one non-California
start-to-handoff journey. Its simplest overlooked idea was a visible answer to
“Can OpenPlan do this here?” generated from the same registry the release gate
reads. It recommended joining workspace geography, stage gates, source
registries, projects, reports, and evidence bundles. It would reject this lane
if a fresh first-week run still learned a coverage limit only after relying on
a result, or if the registry existed only in documentation.

The second review independently selected a sparse jurisdiction-aware registry
with California, Oregon, and Puerto Rico exemplars. It emphasized that a
territory must not inherit state behavior, that unknown places must remain
unassessed, and that the evidence must travel through the assistant, reports,
and exact project bundles. It also identified a stale-review defect: the prior
guard accepted any historical Git commit, even after substantive code changed.

The independent reports differed in breadth. The first framed the release as
two visible exemplar journeys; the second named three jurisdictions and treated
Puerto Rico as the necessary explicit-limits case. The synthesis accepts the
larger three-jurisdiction set. It does not interpret three exemplars as national
coverage.

## Coverage judgment

- Transportation and modeling remain partial. The readiness surface may expose
  v0.41’s inconclusive scientific evidence but may not call it accuracy.
- California land-use, safety, grants, and modeling support remain partial even
  where configured. The product does not determine legal sufficiency.
- Oregon demonstrates that national and state adapters can be composed without
  California leakage. Missing Oregon statutory-plan depth stays unavailable.
- Puerto Rico demonstrates explicit territory handling and fatal-only national
  safety coverage. It does not inherit a state statute or grant bundle.
- Environmental, climate, resilience, equity, tribal, state-agency, transit,
  and development-review coverage remain open v1 work.
- Exact paths and hashes, human review, RLS isolation, accessibility, responsive
  layout, recovery, and free self-hosting remain cross-cutting requirements.

## Decision and falsification

v0.42 deepens the existing workspace/project spine. It adds one sparse,
versioned registry that answers readiness for five existing planning jobs,
requires exact jurisdiction selection, and carries the same cells into the UI,
downloads, reports, assistant grounding, and immutable project evidence
bundles. Unknown, multistate, unsupported, and unreadable states remain
distinct. No new module or paid service is added.

The release is falsified if a failed geography read becomes “not assessed,” if
California behavior leaks into Oregon or Puerto Rico, if an adapter can change
without its evidence hash changing, if the five consumers disagree, or if the
surface cannot be reached and used at desktop and 390px. The implementation
review caught the first, third, and an assistant-payload inconsistency before
release; all were repaired and covered by focused failures.

The next scientific lane remains demand distribution, external and through
travel, and network loading diagnosis on the frozen v0.41 evidence boundary.
It may not calibrate, rank methods, invent an acceptance rule, or open an
untouched holdout merely to improve a metric.
