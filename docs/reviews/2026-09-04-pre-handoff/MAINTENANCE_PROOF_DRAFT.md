# Evidence-guard maintenance proof

Prepared in an isolated review checkout on September 4, 2026. This record must
be reconciled with the final main commit before it describes landed changes.
The active development checkout, live database, browsers, workers and acceptance
records were not used as mutation targets.

## Defects reproduced and protection retained

| Boundary | Original result | Maintenance and negative proof |
|---|---|---|
| First-week outcome and resume | A synthetic completed/yes job with no browser directory passed verification | Require a nonempty regular captured page and a regular console log. Missing/empty/unrelated records leave completion inconclusive and cause resume to retry |
| Browser console record identity | Initial repair skipped a symbolic-link fatal console log when another regular empty log existed; a linked browser directory could borrow another job's captures | Reject linked browser directory and linked relevant page/console records, including dangling links. Four new cases fail against the first repair; directory and record bypass mutations fail their specific cases |
| Proven capability promotion | A cell could be promoted to proven without any attributed proof | Require a current valid cell review date and nonempty repository-contained evidence files whose exact SHA-256 matches. Missing/empty/changed files, invalid/stale/future dates and duplicate/outside references are rejected |
| QA execution of evidence tests | Four existing harness decision suites were not invoked by normal app QA/CI | A Vitest wrapper executes the original Node suites. The regression runner imports Playwright only when actually running a browser campaign. A capture-bypass mutation fails through the wrapper |
| Scenario failure and comparison checks | Two existing suites stopped at a transitive server-only import marker, executing no assertions | File-local test shim permits RSC code under jsdom without replacing real server loaders, page/panel subjects or assertions. All 22 existing tests execute. Three actual source regressions each fail a specific existing assertion |
| Offline RLS source check | A Boolean tautology added no protection | Removed that assertion while retaining source-inventory and live-catalog checks. Removing the required offline RLS assertion still fails the retained guard |
| Documentation mechanical references | Narrow checks existed beside exact marketing sentence, word-count and repeated-phrase requirements | Retain command/path/env/link and nonempty checks, extend their document scope, retire exact repository marketing/prose requirements. Broken reference, empty guide and changed public-claim mutations fail; current public-page and paid-feature guards remain |

The scenario mutations removed an incomparable-metric explanation, made the
registry report a failed read as a missing baseline, and removed the page-to-panel
disclosure property. Each failed exactly one existing assertion; source bytes
were restored afterward. This is a test-environment correction, not removal of
the production server/client boundary.

## Mutation controls and actual execution

Every mutation group first ran a comment-only or formatting-only mutation and
observed a survivor. Targeted failures were checked for their actual assertion
or guard reason, not merely a nonzero command exit. Restored sources passed the
relevant checks. No unsupported reporter or absent dependency was accepted as a
mutation kill.

The final focused review-copy batch executed eight Vitest suites: 71 passed,
nine live-RLS tests skipped because this was not a live database run. The four
wrapped Node suites execute their own assertions, including 43 first-week
discovery checks after the symlink repair. Focused lint passed. Earlier isolated
type checking passed; final consolidated-source type/build/CI status is recorded
in the parent review after handoff. These counts are not browser acceptance or
all-worker coverage.

The published distributed-work-loading verifier accepted its recorded source SHA
and rejected an all-zero wrong SHA. Existing frozen artifacts were unchanged.
This verifies the checked custody relationships and conservation conditions,
not model accuracy or an independent nationwide acceptance result.

## What remains outside these checks

- A page file can contain irrelevant text and an empty console log can be
  fabricated. Record presence is necessary, not proof of a real browser job.
  Runtime identity, evidence provenance, retained captures, artifact inspection
  and independent review still matter.
- A hash establishes exact bytes, not that the evidence supports the claimed
  planner, geography, legal rule, science or human outcome. The capability ledger
  still lacks a complete relational job/role/geography proof system.
- A local test shim does not establish that production client/server bundling is
  safe. Build and real navigation remain separate checks.
- Source-string RLS and public-copy guards protect narrow mechanical statements.
  They do not replace live tenant/role probes or actual content/behavior review.
- Documentation checks cannot establish installation, useful maps, legal provider
  eligibility, a consistent backup or successful full recovery.

No check was weakened to excuse a product defect. Retired prose checks were
redundant or tested wording rather than the protection they claimed. Scientific
thresholds, holdouts, source matching, candidate selection and model defaults
were not changed.
