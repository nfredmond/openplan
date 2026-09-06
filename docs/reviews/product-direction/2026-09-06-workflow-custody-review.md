# Workflow custody and product direction

<!-- openplan-product-direction-review
review_date: 2026-09-06
review_by: 2026-10-05
reviewed_commit: a0376f76
current_release: v0.44.0
independent_contexts: 2
trigger: completed-distributed-loading-checkpoint-and-failed-first-week-outcomes
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
- restore-explicit-owp-upwp-coverage
- test-undated-assignment-and-shared-engagement-handoffs
paths:
- docs/reviews/product-direction/independent/2026-09-06-packet.txt
- docs/reviews/product-direction/independent/2026-09-06-a.md
- docs/reviews/product-direction/independent/2026-09-06-b.md
- docs/ops/V044_DRAFT_AND_DIAGNOSIS_CORRECTION_2026-09-06.md
- docs/ops/V044_EMPTY_REPORT_EVIDENCE_2026-09-06.md
- docs/ops/KNOWN_ISSUES.md
- docs/product/V1_PRODUCT_CONTRACT.md
- docs/product/US_PLANNING_CAPABILITY_MATRIX.md
- docs/product/US_PLANNING_CAPABILITY_REGISTRY.json
- docs/ROADMAP.md
-->

This review supersedes the earlier current-status summary, not its evidence.
The two independent reports are preserved unchanged. Both reviewers began with
the neutral packet at `2d90a31d`, inspected current source and retained outcome
evidence, and did not read one another's conclusions. They performed read-only
reviews, not new browser acceptance or model validation. The synthesizer also
reviewed `e709e2ff`, which simplifies fallback wording and fixes a test's timer
observation without changing production timer behavior or any acceptance rule.

## Agreement and release boundary

### September6 report-evidence follow-up

The synthesizer reviewed `e54b6e36`, superseding this record's earlier
`8e860ca8` binding. The two independent reports remain unchanged and did not
review this later correction. No new independent review is claimed.

The synthesizer subsequently checked `6439b084`. It makes the health-route test
set its identity inputs instead of inheriting an operator's environment. The
original full-gate failure, a surviving comment control and two expected reset
mutation failures are retained. Production health behavior is unchanged. This
test-only follow-up does not change the product direction or release boundary.

The new full run on `648504cf` found that Projects and related filters counted
an empty report's metadata as evidence. The correction uses the existing
nonempty-evidence definition and retains model-only counts and their original
claim label. It introduces no new module, write path or scientific rule. The
original browser behavior and targeted regression mutations are documented in
`docs/ops/V044_EMPTY_REPORT_EVIDENCE_2026-09-06.md`. Corrected-build QA is still
pending at this checkpoint. Main remains unchanged while the full run finishes.

The new run has already recorded partial Safety and model05 outcomes. Neither
the report-label fix nor green technical tests supplies construction benefits,
local forecast validity or a value-for-money case. Release remains withheld;
the direction and full v1 scope below are unchanged. Complete the false-evidence
correction and preserve all remaining journey outcomes before selecting the
next queued product work.

### Earlier independent review

Both reviewers withhold release. The complete twelve-job attempt on `bd865625`
had ten yes outcomes, a completed partial corridor job and a timed-out evidence
job. The latter is not a completed partial success. All twelve had zero
unexpected console errors. The current draft, disclosure and diagnosis repairs
do not supply the forecast evidence missing from job 05. A later successful
technical gate cannot replace that intended planning outcome.

The source-bound distributed-loading checkpoint is implemented. Its failed
candidate remains retired unchanged and scientifically inconclusive. No new
weights, rematching, averaged method, replacement candidate, default, acceptance
threshold or holdout opening follows from this review. The full US scope,
California depth, both validated methods, all planner practices, self-service
operation and human control remain binding. No coverage cell is promoted.

## Disagreement and checked facts

Reviewer A recommends elevating full agency OWP/UPWP administration, recovering
Nathaniel's explicit priority from the preserved September 4 requirements ledger.
Reviewer B recommends first proving an assigned plan action can reach My Work
without a deadline. Both identify shared engagement as a required integration
gap, but differ from the previous automatic engagement-first ordering.

The synthesizer checked the disputed facts against source:

- The implementation-action route accepts an assignee independently of nullable
  `dueOn`; the My Work plan-action reader filters out null `due_on`. This proves
  a query exclusion, not yet its full user-facing effect.
- Campaign coverage uses the many-project association, but the GeoPackage
  campaign query still filters by the lead `project_id`. This establishes
  inconsistent source scope. A visible two-project export test must determine
  the actual omission, including report sections that attach campaigns directly.
- The [preserved requirements ledger](https://github.com/nfredmond/openplan/blob/review/2026-09-04-evidence/docs/reviews/2026-09-04-pre-handoff/CORE_REQUIREMENTS_LEDGER.md)
  explicitly records OWP administration as Nathaniel's priority and Programs
  as its intended home. This is a verified prior record, not a fresh user
  decision or proof that its entire proposed roadmap was accepted.

## Engineering judgment and next evidence

Finish the current correction verification first. Preserve the failed full12
and withhold the tag until the unchanged intended outcomes and required checks
are satisfied. A larger explicit job 11 execution budget is reasonable after
its observed timeout; it does not fix job 05 or relabel old evidence.

For the next bounded investigation, test the undated assignment handoff, then
shared engagement coverage. Each has a specific existing reader to test and an
existing module in which to repair a confirmed failure. Do not invent a due
date, duplicate comments, weaken privacy or treat a source inspection as a
completed browser journey. Test unrelated workspaces and excluded records.

The roadmap and matrix now explicitly include the full OWP/UPWP cycle. Before
selecting its implementation lane, inspect Programs and connected funding,
work-plan, staffing, contract and reporting capabilities, and obtain an applicable
agency case. Estimates, authority, actual work, costs, billings, cash, vintages
and periods must remain distinct. No new module or paid service is selected.
This restores omitted scope without merging the old branch or displacing
mandatory nationwide model and jurisdiction work.

The old engine-landscape rationale also needs fresh primary-source review
before any future engine decision: elapsed runtime and already-closed population
synthesis work cannot justify a smaller scientific target. No engine change
is justified by this review.

## What would settle or falsify this direction

An undated assigned action already reachable in the assignee's normal My Work
would disprove the proposed handoff defect. Complete matching exports for both
covered projects, without copying comments or exposing excluded material, would
disprove the suspected campaign omission. A later explicit reversal or an
existing complete agency OWP cycle would settle the recovered priority gap.
Actual use-specific untouched validation and representative practice journeys
are required to close scientific and nationwide cells; test counts do not.

The synthesis guard must pass after restoration and reject a deliberately bad
independent-context count. A harmless control must survive. Current code and
review checks do not establish browser layout, recipient usefulness, scientific
accuracy, stranger installation, or complete first-week success.

Synthesis verification: the restored direction check passed. Changing only the
trigger description survived; setting independent contexts to one failed with
the expected requirement for two fresh contexts. The focused review, copy,
clipboard and explanation suites passed after restoration. Both preserved
independent files compare byte-for-byte with their authors' scratch reports.

## Verification addendum

The synthesizer reviewed `8e860ca8`, a documentation-only record of the
identified `c4f76eb0` build. It changes no application, worker, study, test,
acceptance rule or capability status. The two independent contexts above remain
the original reviews, not newly claimed reviews of this verification addendum.

The full local gate passed with 13,039 app checks and 135 live-RLS checks.
All 51 worker suites passed. Corrected desktop/390px browser work preserved
in-flight drafts, displayed every selected frozen explanation and full hash,
and disclosed actual export inclusion before confirmation. All 114 native
downloads matched expected source hashes; the read-only evidence journey had
zero errors and writes. Twenty-eight final screenshots were inspected. The
existing cramped run column remains an open layout issue. Proof paths, hashes,
negative controls and failed helper attempts are in the linked correction record.

Remote isolation, upgrade and nightly checks succeeded on c4f76eb0; its full CI
was still running when the record was written. Final push checks must be read
separately. No replacement full12 has run on the corrected build. Its previous
failed outcome and the unsupported forecast remain release blockers. This
addendum closes technical correction work, not the release gate or v1 scope.

The synthesizer reviewed a0376f76 after corrected-build verification of the
empty-report fix. The new record changes only the issue register and verification
report. The15a15e30 build passed full local QA and its20desktop/mobile screenshots
were inspected. Empty reports no longer count as evidence; sourced reports keep
their evidence and claim labels. Internal mobile card clipping remains open.
The direction guard rejected the record until this commit binding was updated.
Its criteria were not relaxed. The original two independent contexts did not
review this follow-up, and no new independent review is claimed. Full-run partial
outcomes still prevent release. Next-lane priorities and scientific limits stand.
