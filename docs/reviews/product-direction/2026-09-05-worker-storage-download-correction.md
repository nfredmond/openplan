# Stored model download correction, direction addendum

<!-- openplan-product-direction-review
review_date: 2026-09-05
review_by: 2026-10-05
reviewed_commit: 00917e60
current_release: v0.44.0
independent_contexts: 2
trigger: first-week-model-artifact-delivery-gap
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
- docs/ops/V044_MODEL_ARTIFACT_DOWNLOAD_2026-09-05.md
- docs/reviews/product-direction/2026-09-05-worker-rounding-correction.md
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

This preserves the two independent milestone reviews and their disagreement.
Neither is a new review of this download repair. Reviewer A proposes testing
multi-project engagement-evidence continuity; reviewer B proposes testing
plan-to-assigned-work and completion evidence. The selected sequence remains
A's live hypothesis after release verification, then B's if A is already
supported. No parallel module or smaller v1 target is proposed.

The agreement correction now has rebuilt browser, full QA, and remote CI proof
on 6fe3ab9e. The next diagnostic run completed five more planner jobs, but
land-use timed out and the model-evidence agent overstated its file delivery.
All 42 new study downloads matched their exact published bytes. Several older
and current-run artifacts were not saved. A screenshot shows a stored assessment
opened as inline JSON. The existing signer now requests an attachment without
changing permissions, source paths, short expiry, or stored bytes. Focused tests
and mutations pass; rebuilt native downloads and full QA remain required.

The raw browser narrative remains preserved, including its inaccurate zero-error
claim. The runner's documented favicon exception does not establish complete
artifact delivery. Do not relabel a partial download inventory or timed-out
land-use chain as a passing release gate. Allow the longer test journey to
finish without reducing its outcome requirements. The Safety product-scope
question and earlier partial result also remain open.

This is still release correction, not scientific tuning or a new product lane.
The distributed-loading candidate remains retired and inconclusive. Frozen
studies, holdouts, method separation, defaults, and acceptance rules are unchanged.
New lesser layout, tab-navigation, assumption-display, and export findings are
recorded in the capability registry without promoting any capability cell.
No result establishes calibration, California completeness, nationwide validation,
or v1 readiness. Complete the twelve-job outcome gate before tagging v0.44.
