# v0.58.1 workspace selector patch

The header now keeps workspace selection visible below 960px and lets the menu
open beyond its label. Long names wrap in the menu. At phone widths the workspace
card takes its own row. The workspace API and membership rules are unchanged.
Only the independent header repair was brought forward from the unfinished
translation branch.

## Local release evidence

Candidate `1eef5f49162a34407202a3589c37b31953b41666` completed full QA, including
lint, dead-code checks, 14,347 enabled unit tests, provider-connector tests,
dependency audit with zero reported vulnerabilities, TypeScript and the production
webpack build. The unit suite skips 453 tests; it does not establish live RLS.
A separate run on `supabase_db_openplan-restore-target-2731143` passed all 482 live
tests across 52 files. The complete shuffled run with seed 580113 passed the same
14,347 enabled tests. All 52 Python worker suites passed with none skipped.
`checks.json` and `evidence.json` retain counts and private log hashes.

All 328 migration files match v0.58.0 byte for byte, and the selected database's
installed version inventory matches the candidate. No new migration, reset or
downgrade was performed. `schema-continuity.json` preserves the comparison; it is
not a claim that every stored SQL function body was independently audited.
The release-ordering baseline and harmless comment both passed. An incorrect
migration count in the new patch record failed the high-water and collision
checks. `release-record-controls.json` records those expected outcomes.

## Browser outcome

The production build served on `http://localhost:3261`. `which-openplan.sh`
matched the serving directory, version and candidate SHA. Fresh synthetic owner
and viewer accounts signed up through the application. The owner created a manual
invitation, and the viewer explicitly accepted with the keyboard. No existing
membership was edited and no invitation was delivered externally.

At 1440, 900, 390 and 320px, fresh sign-in led to the viewer's own workspace.
The header menu remained visible, its invited-workspace option passed an actual
center-point hit-test, and keyboard selection persisted through reload. Long
names wrapped within the viewport, with no horizontal page overflow. Desktop
and 390px open-menu screenshots were visually inspected. Baseline and harmless
CSS runs passed all four widths. Hiding the control at 390px failed its visibility
check; restoring desktop clipping failed target hit-testing. These deliberately
reproduce the two demonstrated defects without changing the application during
acceptance. `workspace-switch-browser-controls.json` records each outcome.

The baseline console contained nine map-fetch warnings and no errors or page
exceptions. Their underlying cause was not independently isolated. This is
header navigation acceptance, not map-data or clean-console acceptance. Browser
automation does not establish screen-reader experience or professional usefulness.
The broader translation workflow, language quality and separate model-validation
obligations remain unfinished.

## Failed preparation attempts retained

The first shuffled run failed six direction checks because release preparation
missed the capability registry's version marker. That marker was corrected and
the full same-seed run passed. The runner's generic order-dependence banner does
not describe this demonstrated metadata inconsistency.

The first production launch supplied an eight-character SHA; the identity tool
requires the matching twelve-character health stamp and refused acceptance.
Restarting with the full SHA resolved it. No browser account was created during
that refused attempt. A later fixture stopped because it expected 127.0.0.1 while
the app generates localhost invitation links. The failed synthetic owner and
pending manual invitation were retained. A new account pair completed through the
canonical localhost address. Credentials stay private and are excluded from the
evidence manifest. Neither failed fixture attempt is counted as acceptance.

## Landing

Local engineering gates are satisfied. Final main CI and RLS must still be
inspected before tagging and publishing v0.58.1. A separately dispatched populated
upgrade check will cover the exact release commit. No PR or human review is
required. The original checkout, demo, pending reminder constraint, translation
checkout and its 331-migration database remain intact. Continue the full V1 goal
from the translation checkout after this patch; do not restart the old v0.48 plan.
