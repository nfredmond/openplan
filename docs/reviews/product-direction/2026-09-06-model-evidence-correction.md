# Model evidence correction, direction addendum

<!-- openplan-product-direction-review
review_date: 2026-09-05
review_by: 2026-10-05
reviewed_commit: 9fa7b9bb
current_release: v0.44.0
independent_contexts: 2
trigger: first-week-model-evidence-false-output
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
- docs/ops/V044_MODEL_EVIDENCE_STATE_2026-09-05.md
- docs/reviews/product-direction/2026-09-05-workspace-crash-publication-correction.md
- docs/reviews/product-direction/2026-09-05-distributed-loading-and-first-week.md
- docs/reviews/product-direction/independent/2026-09-05-a.md
- docs/reviews/product-direction/independent/2026-09-05-b.md
- docs/reviews/product-direction/independent/2026-09-05-packet.txt
- docs/ops/KNOWN_ISSUES.md
- docs/product/V1_PRODUCT_CONTRACT.md
- docs/product/US_PLANNING_CAPABILITY_MATRIX.md
- docs/product/US_PLANNING_CAPABILITY_REGISTRY.json
- docs/ROADMAP.md
-->

The September 5 whole-product decision remains unchanged. The two independent
contexts are the preserved milestone reviews, not new reviews of this patch.
This addendum records the bounded model-evidence correction and supersedes
earlier release-readiness status without rewriting the underlying results.

The complete run on `bcd6bbde` reached four yes outcomes and a partly Safety
outcome before job 05 exposed false independent-validation and transit claims.
The run was interrupted and remains failed. `e973a346` distinguishes missing
evaluation evidence from measured failure and stops inferring transit execution
from download inventory. Eighteen targeted mutations fail and both harmless
controls survive. Frozen bytes and existing scientific rules are unchanged.
Corrected browser proof, broader local checks, remote CI and a new complete
twelve-job run remain required. Lesser findings are in the capability registry.

The failed distributed-loading candidate remains retired and inconclusive.
The subsequent `9fa7b9bb` repair quotes the worker test's CLI paths and exercises
spaces in its temporary directory. Its no-op passes and the unquoted form fails
before CLI execution. This is test portability, not a runtime or modeling change.
No model is averaged, promoted, tuned from the failure, or assigned a new default.
No frozen study or holdout is reopened. Nationwide accuracy remains unknown.

Complete release verification, then test reviewer A's multi-project engagement
evidence handoff hypothesis. If falsified, test reviewer B's plan-to-assigned-work
and completion-evidence hypothesis. Preserve their disagreement. The nationwide
jurisdiction and modeling depth requirements remain binding alongside the full
planner and agency scope; no calendar or runtime convenience reduces them.
