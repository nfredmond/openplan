# OpenPlan Production County Scaffold Smoke — 2026-04-05

- Base URL: https://openplan-zeta.vercel.app
- QA user email: openplan-county-scaffold-smoke-2026-04-05T04-22-31-819Z@natfordplanning.com
- Workspace id: 76e08649-74e8-4bfd-989d-4ad26854ba54
- Project id: ab8a6023-1953-441f-9512-431ea01bbb1f
- County run id: 03bd70bd-b6df-4a69-9616-8b5b6976acd8
- Registered scaffold path: /tmp/openplan-county-scaffold-smoke-2026-04-05T04-22-31-819Z.csv

## Pass/Fail Notes
- PASS: Signed into production with dedicated county scaffold smoke user.
- PASS: Created project/workspace via production API.
- PASS: Created county run record via production API.
- PASS: Ingested runtime-complete county manifest with registered scaffold path.
- PASS: Seeded initial scaffold CSV through the production scaffold API.
- PASS: Verified the seeded scaffold reloaded from the live scaffold GET endpoint.
- PASS: Promoted the county run back to a bounded screening-ready state before exercising scaffold edits.
- PASS: County run detail rendered the registered scaffold CSV in the production editor.
- PASS: Download scaffold CSV emitted the current stored CSV content.
- PASS: Imported replacement CSV file hydrated the editor without manual paste workflow.
- PASS: Save scaffold button disabled before click: false.
- PASS: Save scaffold response status: 200.
- PASS: Validation invalidation label match count after reload: 2; visible: true. Backend state was confirmed via production API regardless of this visual check.
- PASS: Saving the imported CSV persisted the new scaffold, refreshed readiness counts, and invalidated the prior validation state.

## Assertions proven on production
- County run creation and manifest ingest succeeded on the live deployment.
- The live scaffold API could store and reload a scaffold CSV at the registered path.
- County run detail loaded the stored scaffold into the editor on production.
- Download scaffold CSV exported the currently stored scaffold content.
- Import scaffold CSV file hydrated the editor with a replacement file without manual paste.
- Save scaffold CSV persisted the replacement content, refreshed readiness counts, and invalidated a previously validated county slice.

## Artifacts
- docs/ops/2026-04-05-test-output/2026-04-05-prod-county-scaffold-01-detail-ready.png
- docs/ops/2026-04-05-test-output/2026-04-05-prod-county-scaffold-02-imported.png
- docs/ops/2026-04-05-test-output/2026-04-05-prod-county-scaffold-03-saved.png
- docs/ops/2026-04-05-test-output/2026-04-05-prod-county-scaffold-download.csv

## Notes
- This smoke used dedicated production QA identities and records for verification.
- QA production records and auth identities created during this pass were subsequently cleaned up; see `docs/ops/2026-04-05-openplan-production-qa-cleanup.md`.
