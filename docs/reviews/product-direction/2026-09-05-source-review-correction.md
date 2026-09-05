# Plan source-review correction, direction addendum

<!-- openplan-product-direction-review
review_date: 2026-09-05
review_by: 2026-10-05
reviewed_commit: 0f521c14
current_release: v0.44.0
independent_contexts: 2
trigger: unsupported-legal-source-review-date-found-by-first-week-journey
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
- docs/reviews/product-direction/2026-09-05-source-caveat-correction.md
- docs/reviews/product-direction/independent/2026-09-05-a.md
- docs/reviews/product-direction/independent/2026-09-05-b.md
- docs/reviews/product-direction/independent/2026-09-05-packet.txt
- docs/ops/V044_PLAN_SOURCE_REVIEW_2026-09-05.md
- docs/ops/KNOWN_ISSUES.md
- docs/product/V1_PRODUCT_CONTRACT.md
- docs/product/US_PLANNING_CAPABILITY_MATRIX.md
- docs/product/US_PLANNING_CAPABILITY_REGISTRY.json
- docs/ROADMAP.md
-->

The milestone direction and its two preserved independent contexts remain
unchanged. These are the same independent reports, not fresh reviews of this
subsequent patch. Reviewer A's multi-project engagement-evidence continuity
hypothesis and reviewer B's plan-to-assigned-work and completion-evidence
hypothesis remain separate. Finish the release gate, visibly test A, and test B
if A is falsified. Neither is permission to add an unreviewed module.

The latest full first-week run reached first-day setup but was interrupted
during outside-California setup after an unsupported source-review date was
confirmed. An unsourced legal descriptor correctly disclaimed configured law,
yet the workbench and public page still claimed dated source review. Both now
withhold that claim when source links are absent. Stored plans, descriptors,
legal content, and frozen records are unchanged. The focused suite passed 43
tests; a no-op survived and two targeted mutations failed for their stated
reasons. Fresh browser proof and a complete twelve-job outcome gate remain
required. This run is not release evidence for twelve reached outcomes.

The preceding Safety source-caveat fix passed actual packet regeneration and
download on `1775c472`, with all nine pages inspected. All 44 model artifacts
also downloaded on that build with matching hashes, readable desktop/390px
layouts, and no console errors. CI, live isolation, and populated v0.43 upgrade
checks passed on that preceding commit, not on this later patch.

No scientific decision changes. The failed distributed-loading candidate stays
retired and inconclusive. Defaults, weights, acceptance rules, observation
matches, source bytes, networks, frozen studies, and holdouts remain unchanged.
No replacement is fitted from the failure.

V1 still covers every planner type across all 50 states and DC, California as
the gold-standard implementation across its full diversity, nationwide
validated separate AequilibraE and ActivitySim methods, human-controlled
consequential decisions, and self-service operation without paid infrastructure.
Calendar, runtime, release count, and convenience do not reduce that scope.
