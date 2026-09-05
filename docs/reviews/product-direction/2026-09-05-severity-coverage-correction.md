# Severity coverage correction, direction addendum

<!-- openplan-product-direction-review
review_date: 2026-09-05
review_by: 2026-10-05
reviewed_commit: b430ee96
current_release: v0.44.0
independent_contexts: 2
trigger: consequential-source-coverage-display-found-during-release-verification
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
- complete-first-week-outcomes-before-release
- test-shared-evidence-continuity-next
paths:
- docs/reviews/product-direction/2026-09-05-distributed-loading-and-first-week.md
- docs/reviews/product-direction/2026-09-05-release-download-correction.md
- docs/reviews/product-direction/independent/2026-09-05-a.md
- docs/reviews/product-direction/independent/2026-09-05-b.md
- docs/reviews/product-direction/independent/2026-09-05-packet.txt
- docs/ops/V044_SEVERITY_RANKING_COVERAGE_2026-09-05.md
- docs/ops/KNOWN_ISSUES.md
- docs/product/V1_PRODUCT_CONTRACT.md
- docs/product/US_PLANNING_CAPABILITY_MATRIX.md
- docs/product/US_PLANNING_CAPABILITY_REGISTRY.json
- docs/ROADMAP.md
-->

The September 5 whole-product decision remains unchanged. The two independent
contexts are the same preserved milestone reports, not two new reviews of this
patch. This addendum reviews the subsequent coverage-display correction and
supersedes the earlier release-readiness status, without rewriting its evidence.

The download correction passed desktop and 390px browser checks, including all
44 files, independent hashes, and clean consoles. An invalid response-event
assumption in the first check was disclosed and corrected. Two separate old-build
controls still failed waiting for actual downloads. The exact distinction and
retained evidence are in the new operations record.

The same browser work exposed unsupported serious-injury zeros in KSI ranking
and community-context panels despite the repaired filters. Generated packets
had equivalent omissions. The existing source-coverage rule now withholds those
combined figures, rankings, and ranked maps when any selected acquisition has
partial or unknown coverage. Supported fatal counts and ordinary crash points
remain available. Seven restored mutations and the focused tests establish the
guard behavior, not live-browser completion. A fresh production check and the
full first-week gate are still required before release.

This correction changes neither the lane nor v1's scope. Complete the release
outcomes, then visibly reproduce reviewer A's multi-project engagement-evidence
handoff hypothesis. If falsified, test reviewer B's plan-to-assigned-work and
completion-evidence hypothesis. Preserve their disagreement and add no module
without the required whole-product case. All planner types, all 50 states and
DC, California's full gold-standard implementation, self-service operation at
no required cost, human-controlled decisions, and nationally validated separate
demand methods remain binding. Runtime and release count do not reduce them.

The failed distributed-loading candidate remains retired. Frozen studies,
source bytes, network custody, acceptance rules, defaults, and holdouts are
unchanged. No replacement is fitted from the failure.
