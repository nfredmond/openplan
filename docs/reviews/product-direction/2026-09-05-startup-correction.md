# Browser startup correction, direction addendum

<!-- openplan-product-direction-review
review_date: 2026-09-05
review_by: 2026-10-05
reviewed_commit: 79bbfa2d
current_release: v0.44.0
independent_contexts: 2
trigger: browser-only-tester-started-without-browser-tools
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
- docs/reviews/product-direction/2026-09-05-source-review-correction.md
- docs/reviews/product-direction/independent/2026-09-05-a.md
- docs/reviews/product-direction/independent/2026-09-05-b.md
- docs/reviews/product-direction/independent/2026-09-05-packet.txt
- docs/ops/V044_BROWSER_STARTUP_2026-09-05.md
- docs/ops/KNOWN_ISSUES.md
- docs/product/V1_PRODUCT_CONTRACT.md
- docs/product/US_PLANNING_CAPABILITY_MATRIX.md
- docs/product/US_PLANNING_CAPABILITY_REGISTRY.json
- docs/ROADMAP.md
-->

The two independent contexts are the preserved September 5 milestone reports,
not fresh reviews of this tester correction. Their disagreement remains intact.
Complete the release gate, then visibly test reviewer A's multi-project
engagement-evidence continuity hypothesis. If falsified, test reviewer B's
plan-to-assigned-work and completion-evidence hypothesis. No new module or
reduced product scope is authorized by this addendum.

The latest application code passed local QA and remote CI/RLS on `fe17ad3d`.
The saved Oregon plan now visibly withholds its unsupported review-date claim
at desktop and 390px. The public no-source branch remains independently
browser-unverified. An attempted full first-week run lacked browser tools in
its first job and therefore never created the shared account. It remains
incomplete; a nonzero planner outcome was not relabeled passing.

The harness now requires browser-server initialization and directs deferred
tool discovery without supplying product knowledge. It recognizes observed
tool-unavailability and startup-failure messages as infrastructure blocks.
The twelve jobs, exercise fixtures, and outcome gate are unchanged. Live probes
show a missing server fails before a tester turn and actual navigation/snapshot
calls succeed with the discovery instruction. The instruction remains
model-dependent; only actual journeys establish planner completion.

A mutation restoration initially matched the wrong empty line. I disclosed the
error and corrected both exact locations before push or a journey run. The
final restored tests pass, a unique-marker mutation fails, and fixture-producing
code is byte-identical to the previous commit. The operations record preserves
the failed check and correction rather than presenting a perfect sequence.

Discovery may collect non-destructive findings across all twelve jobs before
editing again. Any confirmed blocker still prevents release, and data-loss or
isolation risks stop the run immediately. This does not weaken an outcome or
acceptance rule. The scientific candidate remains retired and inconclusive;
defaults, source bytes, networks, frozen studies, and holdouts are unchanged.

V1 remains every planner type across all 50 states and DC, California as the
gold standard across its diversity, nationally validated separate demand
methods, human-controlled consequential decisions, and self-service operation
without paid infrastructure. No calendar, runtime, or release-count limit
reduces that destination.
