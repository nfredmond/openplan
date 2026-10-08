# Project engagement evidence distinction

## Problem and change

The project evidence board described engagement as missing when campaigns were linked but no report retained contribution context. Browser review of build `9dfbeaa4a8f33a35d8ffe9bfe1442fb03447836d` exposed this mismatch in the synthetic engagement handoff project.

The board now distinguishes linked campaigns from retained report contributions. A linked campaign without retained report contributions receives an attention state and a report preparation action. Historical report evidence remains visible when no current campaign appears in the recent list. The campaign count says “recent” because the existing reader bounds its results. Report counts do not describe current intake or establish public release.

Campaign query failures and coverage-join failures preserve an unknown state. A successful lead-campaign query does not erase a failed coverage join. The change adds no database query, migration or public release action.

## Verification at the implementation checkpoint

- The project detail and crosslink suites pass all 94 tests.
- ESLint passes for the four changed implementation and test files.
- Page tests assert the campaign projection and coverage-join projection and project filter.
- A harmless helper comment preserves all 29 helper tests. Restoring the old missing classification fails the linked-campaign test.
- A harmless page comment preserves all 65 page tests. Removing campaign-read failure propagation fails the campaign-read test. Removing coverage-join failure propagation fails the coverage-join test. Each broken mutation fails one test for its intended behavior; edits were restored.
- `git diff --check` passes.

Private logs and mutation results remain under `/home/nathaniel/.local/state/openplan/project-engagement-evidence-20261007-proof`. They contain local verification records and are not a portable release artifact.

## Remaining boundaries

The tests use mocked database reads. They do not prove live row-level security, campaign coverage completeness, practitioner acceptance or rendered layout. Production build, TypeScript verification, and identified-build desktop and 390px browser journeys remain pending for this change. The earlier browser finding establishes the defect, not acceptance of this implementation. This checkpoint does not declare a release or completion of V1.

## Combined-branch build correction

The first production build of `4e72fb85` compiled but failed TypeScript because the packet-geography and crosslink-board test fixtures omitted the required `campaignCount`. The combined follow-up branch supplies explicit zero counts for those empty fixtures. Its component suite also caught a changed caveat fragment. The wording now preserves the adopted-outreach/public-response warning while distinguishing representative participation.

All four related suites pass 115 tests on the corrected combined branch. The prior failed build is retained; this result does not relabel that checkpoint as passing. The next production build targets the combined follow-up head, which includes the project, resource assessment and published model changes. Browser acceptance remains pending.
