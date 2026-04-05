# OpenPlan Production County Scaffold Smoke — 2026-04-05

- Base URL: https://openplan-zeta.vercel.app
- QA user email: openplan-county-scaffold-smoke-2026-04-05T03-52-04-149Z@natfordplanning.com
- Workspace id: 8638f1c0-6595-42f4-a357-5225c62d6d25
- Project id: 9907dc06-c5a8-4c48-a381-3eefe72e71ed
- County run id: f77f49e9-a455-47dc-95d9-0f93ba6da544
- Registered scaffold path: /tmp/openplan-county-scaffold-smoke-2026-04-05T03-52-04-149Z.csv

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
- PASS: Validation invalidation label visible after reload: false. Backend state was confirmed via production API regardless of this visual check.
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
- `openplan-zeta.vercel.app` was explicitly rebound to the functioning `natford/openplan` production deployment before this proof run.
