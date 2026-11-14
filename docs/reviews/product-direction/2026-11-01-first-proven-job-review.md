# Direction after the first month of hosted operation

<!-- openplan-product-direction-review
review_date: 2026-11-01
review_by: 2026-12-01
reviewed_commit: d4ca41657304bd41b74da6b6d4665f5bb1ade32e
current_release: v0.72.0
independent_contexts: 2
trigger: monthly-check-in-and-expiring-october-review
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
- first-proven-cell-is-a-safety-action-plan-and-ss4a-application-in-three-places
- evidence-belongs-in-pull-requests-and-ci-not-per-change-folders
- every-state-is-checked-by-a-table-in-ci
- successor-validation-preregistration-on-continuous-count-stations
paths:
- docs/reviews/product-direction/independent/2026-11-01-a.md
- docs/reviews/product-direction/independent/2026-11-01-b.md
- docs/reviews/product-direction/2026-10-06-integration-review.md
- docs/product/V1_PRODUCT_CONTRACT.md
- docs/product/US_PLANNING_CAPABILITY_MATRIX.md
- docs/product/US_PLANNING_CAPABILITY_REGISTRY.json
- docs/modeling/NATIONWIDE_VALIDATION_PREREGISTRATION_V1.json
- docs/ops/KNOWN_ISSUES.md
- docs/ARCHITECTURE.md
- docs/ROADMAP.md
- AGENTS.md
-->

Two fresh-context reviewers assessed main `d4ca416`, the commit production
served on 2026-11-01. Each started from the packet that
`npm run product:direction:packet` generated on the lead's Windows checkout
(commit `f1a7832`, which is `d4ca416` plus a line-ending attribute). Neither saw
the other's report or this synthesis. Their reports are kept unchanged in
`independent/2026-11-01-a.md` and `-b.md`; the harness refused their own file
writes, so the lead saved their returned text verbatim. Neither ran the app, a
test or a browser. This synthesis is the technical lead's judgment. It does not
turn source reading into runtime, legal or professional acceptance.

## What both reviewers found

1. **No planning job is proven.** The capability registry holds 0 proven, 37
   partial and 62 not-assessed entries, unchanged since September 6, and its
   review date (October 5) has passed. The jurisdiction readiness registry
   covers California, Oregon and Puerto Rico only. The twelve first-week
   journeys last ran in full on September 6.
2. **Evidence records now outweigh product change.** Reviewer A counted 579,070
   lines added under `docs/reviews/` from October 13 against 17,906 lines of
   application source. Reviewer B counted 800,327 of 961,386 added lines (83
   percent) from October 10. The October 12 plan asked for raw logs and receipts
   to move to CI artifacts; `AGENTS.md` never adopted that.
3. **Places outside California break in basic ways.** Both found no tribal
   (AIANNH) or town and township place kinds. Reviewer B verified two defects in
   code: saving crashes for a Nevada study area resolves to California's CCRS
   because its bounding rectangle covers most of Nevada, and stores nothing; and
   every county model run shows a California CEQA screening panel.
4. **The model has no path to a validated result yet.** The preregistration is
   still inconclusive and blocks new candidates until a successor freezes.
   Nine modeling drafts (PRs 374-384) have been open since October 23, and
   source-supported observation intervals exist for 0 of 337 observations.
5. **Missing jobs outside the module map.** Both name the federal TIP/STIP,
   development review, housing element work, records requests and federal
   performance targets. Reviewer B adds ADA transition plans and tribal
   programs (TTP, TTIP, TTPSF).
6. **Stale facts in governing documents.** The packet counted 0 pages and 0
   routes on Windows (fixed in PR 393). `AGENTS.md` cited 405 migrations;
   production expects 448. Health reports the last tag as the version while
   production runs 194 commits past it.

## Where they differ

- **Which cell to prove first.** Reviewer A chooses engagement, the most
  complete module, on production with an accessibility scan. Reviewer B chooses
  a safety action plan and SS4A application in rural California, rural Nevada
  and a tribal area.
- **Science instrument.** Reviewer A wants TMAS continuous stations as the
  decisive nationwide corpus. Reviewer B wants one state's untouched holdout,
  plus uploaded networks that drive runs and GeoPackage export of results.
- **Process emphasis.** Reviewer A proposes a line-ratio reminder in the
  direction check. Reviewer B adds a staging database or batched migrations and
  the aerial CI path filter.
- **Unique proposals.** Reviewer A: a sourced registry of recurring planning
  obligations by organization type and state, feeding My Work. Reviewer B: a
  51-row state table in CI, and moving aerial work behind nationwide basics.

## Decisions

**First proven cell: a safety action plan and SS4A application in three
places.** The lead takes Reviewer B's choice. Safety and SS4A are federal and
open to every state and tribe, FARS gives a national data floor, and most parts
exist (high-injury network, countermeasures, the SS4A seed, BCA and the grant
export). Proving it forces the fixes both reviewers found: correct crash source
by state, tribal geography and an accessibility check. Engagement stays the
October 6 outcome and continues alongside; its case is not abandoned.
Done when, on one identified main commit served by the hosted site, an
agent-run journey from sign-up completes in a rural California county, a rural
Nevada county and a tribal area. Each journey ends in an exported safety action
plan PDF and an SS4A application PDF that embed the high-injury map, crash
summary with source and severity coverage, countermeasures, BCA and engagement
summary. Each passes at desktop and 390px with an automated accessibility check
reporting no serious or critical violations. Nevada stores FARS crashes, not
zero. The registry cells move only through a checked evidence record bound to
that commit.

**Evidence belongs in pull requests and CI, not per-change folders.** Both
reviewers and the October 12 plan agree. This is an engineering-process
decision. `AGENTS.md` now says:
- per-change evidence (commands, results, mutation tables) goes in the pull
  request body and CI artifacts;
- new dated folders under `docs/reviews/` are for direction reviews, releases,
  scientific studies, incidents, and money, permission or custody boundaries;
- raw logs and bulky JSON receipts are not committed;
- the mutation pair applies to every changed guard and to every test of money,
  permissions, custody, public records or scientific claims; other changed
  tests must fail against the defect they cover before the fix.
PR 393 path-filters the aerial regression, which ran on every PR for 50-135
minutes. Done when, over the four weeks after this record merges, lines added
under `docs/reviews/` are fewer than lines added to application and worker
code.

**Every state is checked by a table in CI.** Reviewer B's table becomes part of
the first-cell work: one representative county per state and DC, with expected
crash source, statute panels and grant bundle, run on every PR. Lanes opened on
2026-11-02 fix the Nevada crash source, the CEQA panel, the hard-coded
"Caltrans D3" invoicing hint and demonstration text in a public template, and
add tribal and town or township place kinds.

**Successor validation preregistration on continuous-count stations.** S3
moves from Later to Next. The successor draft in PR 374 uses continuous
stations as the decisive corpus, with short counts kept as diagnostics, and
names one untouched state holdout. Freezing it needs Nathaniel's decisions on
partitions, sample size and thresholds, recorded on PR 374 since October 23.
Both engines stay separate, and the 43.3 percent figure stays a one-county
selection metric.

**Carried forward, not started here:** Reviewer A's recurring-obligation
registry is the leading candidate for M2c (My Work) after the first cell.
TIP/STIP gets a milestone candidate in the matrix at the next registry review.
The health endpoint should report the deployed commit beside the release.

## Open for Nathaniel

- **Human feedback before v1.** Both reviewers question the October 17 rule
  that agent-run checks replace human feedback before v1: Reviewer A for
  passive feedback channels, Reviewer B for usefulness and the Social Pinpoint
  comparison. That is his decision; this record does not change it.
- **Operator settings,** batched: the Supabase access token and project
  reference for the migration-drift check, a CAPTCHA key, and production run
  caps (`OPENPLAN_MONTHLY_RUN_CAP`, `OPENPLAN_MODELING_QUEUE_DEPTH`).
- **Maps module.** Reviewer B notes that in-app map making requires the
  planner's own Claude subscription, which conflicts with "no required paid
  service" for a core artifact. The Maps module was his decision.
- **PR 374 preregistration decisions** (above).

## Limits and what would change this

The registries' dates and grades are unchanged; this record does not reassess
them. External facts the reviewers marked `[VERIFY]` (Title II web rule dates,
surface transportation reauthorization after September 30, 2026, TMAS coverage,
TIGERweb layer ids) need primary sources before any code relies on them.
Reviewer B's crash and CEQA findings were verified from code, not by running
the app; the lanes fixing them must reproduce them first.

The first-cell choice should change if another named job reaches proven with
less work and exposes as many defects, or if SS4A turns out to need paid data in
some state. The evidence rule should change if a consequential defect slips
through that a per-change record would have caught. Each report names further
falsifiers.
