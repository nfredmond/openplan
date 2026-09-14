# v0.61.1 optional-project report API fix

September 14, 2026. Local engineering acceptance is complete. Final release-commit CI and publication are recorded separately; this document alone does not establish a published tag.

The generic report detail API returned 500 for a saved consultation report whose project_id is null. It tried to compare a project UUID column with null before reading the report sections and artifacts. The actual producer stores a consultation-owned board_packet without a project. The specialized report page already worked; v0.61 documented the remaining API defect.

The handler now skips the project lookup only when the report has no project, returning project:null with the report's normal sections, citations and artifacts. A named project is still read and genuine lookup errors remain errors. Authorization and shared access resolution are unchanged. No migrations, worker or artifact-rendering changes are required.

## Evidence

The before browser record `report-project-api-before-1440-1789406731580.json` returned 500 on identified release build b35142774503. [After evidence](browser-results.json) covers production build b0b947b3ee23 from the isolated translation-command-workflow-2026-09-13 checkout at port3262; the identity check reported MATCH.

Desktop 1440 and 390px journeys entered through sign-in, Engagement, Record and the retained report. The API returned 200 with project:null and its retained artifact record. Each PDF/XLSX/ZIP download matched the earlier retained hash and length. Keyboard navigation and actual download controls were visually inspected; no horizontal overflow or console errors occurred. Each journey also created a new project report through the Reports form, then read the correctly named project and all nine initial sections. Anonymous reads of both report APIs and the retained files were denied. The two control report pages were visually inspected. These are synthetic engineering workflows, not agency usefulness evidence.

Full local QA on b0b947b3 passed 15,362 tests with 533 skips in 1,312 test files, lint, configured deadcode check, provider connector tests, dependency audit and production webpack/TypeScript build. [Mutation evidence](mutation-results.json) retains a 17-test baseline and harmless survivor; unconditional project read, skipped actual project, swallowed project failure and missing projected project_id all fail the intended tests. The shared access resolver runs, but its database queries are mocked there; the browser/API and final RLS checks are separate. All mutations were restored.

The first unit fixture used report-type labels that were not actual stored types. It was corrected to the real board_packet producer before retaining the final failing/passing reproduction; the independent live failure already established the defect. The [release ledger proof](v0611-release-records.json) passes baseline/harmless controls and detects an incorrect migration count, absent last migration and missing release section. No old migration is changed or re-counted.

The browser source and behavior are unchanged by the later version, release ledger and evidence updates. Final main CI remains required before tagging. The prior v0.61 populated upgrade and 52-worker-suite evidence remain applicable to unchanged migrations/workers; this API fix makes no new upgrade or worker capability claim. The pending reminder constraint is untouched. Full M9b and V1 scope remain open.
