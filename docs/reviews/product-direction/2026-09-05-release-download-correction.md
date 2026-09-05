# Release download correction, direction addendum

<!-- openplan-product-direction-review
review_date: 2026-09-05
review_by: 2026-10-05
reviewed_commit: 8559bbf2
current_release: v0.44.0
independent_contexts: 2
trigger: release-browser-blocker-after-independent-direction-review
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
- docs/reviews/product-direction/independent/2026-09-05-a.md
- docs/reviews/product-direction/independent/2026-09-05-b.md
- docs/reviews/product-direction/independent/2026-09-05-packet.txt
- docs/ops/V044_BROWSER_INTERRUPTION_2026-09-05.md
- docs/ops/KNOWN_ISSUES.md
- docs/product/V1_PRODUCT_CONTRACT.md
- docs/product/US_PLANNING_CAPABILITY_MATRIX.md
- docs/product/US_PLANNING_CAPABILITY_REGISTRY.json
- docs/ROADMAP.md
-->

This adds the reviewed download correction to the earlier September 5 direction
decision. It does not replace its independent reports or imply that those two
reviewers examined this later patch. The two independent contexts are the same
preserved milestone reviews. This addendum reviews only the subsequent release
blocker and its narrow correction.

The earlier decision remains in force. Complete the first-week outcomes before
release. Then reproduce reviewer A's suspected multi-project engagement-evidence
handoff failure from visible navigation. If that hypothesis is falsified, test
reviewer B's plan-to-assigned-work-to-completion-evidence gap. Their disagreement
is preserved, not resolved by code inspection alone. Neither proposal authorizes
a new module or a smaller v1.

At `898a26e2`, local QA, remote CI, live isolation, and an upgrade from v0.43.0
passed. Repeated browser attachment clicks nevertheless stalled because the
new v0.44 evidence links entered page navigation. The five links now use native
download anchors. The added assertion failed on the old implementation; a
harmless comment survived; removing the selected audit's download attribute
failed; the restored assertion passed. Browser verification remains pending.
This is a release correction, not evidence for selecting a new product lane.

No data source, migration, model output, frozen study, acceptance rule, default,
geography partition, or claim tier changed. All 50 states and DC, every planner
type, California's full gold-standard scope, and nationwide scientific validation
of both separate demand methods remain binding. Runtime and release count do
not reduce that scope. The failed distributed-loading candidate remains retired.

The interrupted run `2026-09-05T02-57-00-885Z` is incomplete, not a successful
first-week outcome. The next clean build must pass the download and Safety/report
checks, the complete twelve-job gate, QA, and current remote CI before tagging.
