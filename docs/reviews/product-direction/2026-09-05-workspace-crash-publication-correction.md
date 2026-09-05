# Crash publication evidence correction

<!-- openplan-product-direction-review
review_date: 2026-09-05
review_by: 2026-10-05
reviewed_commit: 9ae8f7ab
current_release: v0.44.0
independent_contexts: 2
trigger: crash-publication-false-output-correction
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
- docs/ops/V044_ARCHIVE_APPROVAL_BOUNDARY_2026-09-05.md
- docs/ops/V044_SAFETY_MAP_SCALE_2026-09-05.md
- docs/ops/V044_CRASH_PUBLICATION_METADATA_2026-09-05.md
- docs/ops/V044_MODEL_ARTIFACT_DOWNLOAD_2026-09-05.md
- docs/reviews/product-direction/2026-09-05-worker-storage-download-correction.md
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

The Safety journey found a new false-output blocker on `ac333fa2`: file-update
metadata was presented as crash coverage. The complete twelve-job run was
interrupted after four completed yes outcomes. The Safety result and remaining
jobs do not pass by implication.

`f01ced15` distinguishes file updates from coverage across ingestion, history,
analysis, and reports. Existing records are interpreted without rewriting them.
Each contributor retains separate metadata, and no common cutoff is invented
for a merged analysis. The 140 focused tests and TypeScript pass. A no-op
survived and 18 semantic mutations failed. Full QA, current browser/report
proof, and a new complete outcome gate remain required before tagging.

The first full QA attempt then exposed a stale 0.42 readiness-version assertion
and an unhandled copy-confirmation timer after leaving the evidence panel.
The assertion is updated and the timer now has unmount cleanup. Both have
surviving no-op and targeted failure evidence. These are verification repairs,
not a new product lane. Full QA must run again; its earlier failure is retained.

The two independent milestone reviews remain the retained reviews linked
above. This is a synthesizer's correction addendum, not two new independent
reviews. Their disagreement and the selected next investigation, shared
engagement-evidence continuity, are preserved. The latest journey adds concrete
evidence for that investigation: sentence citation counts without inspectable
links. It does not establish that stored grounding was lost.

The broader capability map remains partial or unassessed as recorded. This
repair makes no new statutory, geographic, safety-benefit, or scientific
validation claim. It adds no module or write path and changes no default,
acceptance rule, frozen study, or holdout. The distributed-loading candidate
remains retired and inconclusive. The ultimate v1 scope is unchanged.

CI, RLS, and the exact-commit upgrade rehearsal passed on `ac333fa2`; those
results do not verify the new repair. The full development dependency audit's
ten advisories remain recorded separately from the clean production audit.

## Database correction supersedes the no-migration assumption

After full local QA passed, the real browser acquisition on `eb2f385b` exposed
a missed database pairing constraint. This was an implementation regression;
the mocked test and metadata-free live fixture could not detect it. The fresh
twelve-job run was stopped after first-day setup. Its partial execution is not
a release pass.

`ffc060e6` adds migration `20260905000003_crash_resource_update_provenance.sql`
and a real producer/Postgres regression. The test reproduced the exact failure
before migration and now verifies both acquisitions, metadata readback,
cross-workspace denial, and malformed-pair refusals. Surviving no-op and
targeted mutation evidence is retained. No historical row was rewritten.
Release inventory is 246 migrations. Full QA, real source/report browser proof,
and all twelve outcomes must run again. This correction does not alter the
scientific result, next capability investigation, or v1 scope.

## Failed-acquisition follow-up

`708a5d43` passed local full QA, remote CI, isolation, and both upgrade runs.
Actual source retrieval and reloaded publication disclosures passed. One
first-day browser session failed with resource errors; its cause is unknown.
A fresh browser recovered the same account, and a new first-day journey
completed without findings or console errors. The failed evidence is retained,
and the reliability investigation is queued in the capability registry.

Supplemental Reports inspection then found that the shared work queue falsely
inferred absent observed records from failed acquisition counts. Safety showed
completed acquisitions for the same area and years. `2415e709` corrects both
summary producers without changing counts, records, geography or model logic.
The regression failed before correction. A no-op survived; each producer's
false-absence mutation failed separately. All 45 focused tests passed restored.

This remains a false-output repair within the existing release, not a change
in product direction. Retained independent reviews and their disagreement
still apply. Full QA, rendered report proof, and a fresh complete twelve-job
run are required before tagging. No completed subset substitutes for that gate.

## Printed Safety map follow-up

The resumed acceptance run on `ca3acf18` reached the Safety outcome, including
the corrected source-publication disclosure and a byte-verified report. Main
agent inspection of that PDF then found a separate false-output defect: the
street-context renderer stretched geographic axes independently while drawing
one scale bar. The run was interrupted during the corridor journey.

`c7a35fc3` corrects the shared screen/report projection, preserves geographic
proportions, handles local date-line crossings, and discloses when a single
local scale is unsuitable. Fifty focused tests pass; a no-op survived and ten
semantic mutations failed. Real after-output inspection and full release
verification remain pending, as recorded in the linked correction proof.

This is another evidence-correctness repair within the current release, not a
new direction review or a change to the retained independent recommendations.
The original modeling result, defaults, holdouts, and full v1 scope remain
unchanged. The project journey's partial outcome also remains unresolved.

Boundary follow-up `c37a0c7c` also removes a one-meter minimum that could push
the scale bar outside sub-meter frames, and preserves nonzero label precision.
The focused suite is now 52 tests, with the two additional semantic mutations
rejected. Full QA on the earlier correction passed tests, isolation, and audit
but failed its build at Node's two-gigabyte heap limit. A bounded rerun with an
explicit build heap and current rendered evidence remain required.

## Ordinary archive boundary follow-up

The map correction passed full QA, all four remote workflows, desktop/390px
inspection, and independent PDF byte checks on `820da584`. Its complete
twelve-journey outcome gate remained unfinished.

The repeated project handoff failure exposed an older boundary error: governed
submission prerequisites had been imposed on every project evidence archive.
`8876f814` allows the existing snapshot workflow to retain evidence without
inventing a linked plan or forcing a single PDF. Missing prerequisites remain
explicit; route and database checks still refuse governed submission without
them. Sixteen mutations failed, a no-op survived, and 52 focused tests pass.
Rebuilt archive/GIS evidence and complete release verification remain pending.

This restores the intended project handoff within the existing module. It
does not broaden agent authority or weaken approval, source custody, model
acceptance, or the full v1 scope. The two retained independent reviews and their
disagreement remain the direction evidence; this addendum is not a third review.

Freshness follow-up `9ae8f7ab` keeps an intentionally unselected plan from being
called changed evidence. Missing bindings and changed selected plans still
fail, and no-plan archives remain ineligible for governed submission. Both
new mutation cases fail as intended. The interrupted earlier QA is not a pass;
verification restarts on this corrected boundary.
