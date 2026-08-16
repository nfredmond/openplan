# OpenPlan Local Phase 1 Spine Smoke - 2026-08-16

## Command
- `cd qa-harness && npm run local-spine-smoke`

## Local Targets
- App URL: http://localhost:3200
- Supabase URL: http://127.0.0.1:54321
- Local guard result: Local guard passed for local Phase 1 spine smoke: app=http://localhost:3200, supabase=http://127.0.0.1:54321.

## Provisioning Posture
- **Self-provisioning.** This smoke reads no checked-in fixture. It creates one auth user, lets the `on_auth_user_created` trigger provision that user a workspace, and then builds every record it asserts on through the app HTTP route a planner would use.
- **Place-neutral.** No jurisdiction, agency, or real coordinate appears anywhere in the fixture. Labels are generic; every geometry is anchored on a deliberately meaningless origin (0°, 0°) so a fixture can never be mistaken for analysis geography.
- **Hermetic.** Each run works inside a workspace that did not exist a moment earlier, so there is no prior-run residue to clean and no shared state with any other smoke.

## Boundary Notes
- **All three cartographic-backdrop layers were written through product routes.** They previously had no write path at all — the deleted demo seed was their only producer, so a project or RTP cycle created through the app never appeared on the map and a corridor could not be created by any means. This run places the project marker via `PATCH /api/projects/{id}/location`, the RTP pin via `PATCH /api/rtp-cycles/{id}`, and the corridors via `POST /api/projects/{id}/corridors`, then asserts the map-features routes return them.
- The managed runs use the `ite_trip_generation` engine, which is a pure computation over a land-use program. The corridor engine was not used because it needs real geography with live Census/LODES coverage — a place-shaped dependency this smoke exists to avoid.
- The county run stays at `bootstrap-incomplete`. Advancing it to `validated-screening` requires the Python worker and real artifacts on disk; this smoke proves the project-provenance edge only, and claims nothing about model validity.

## Key IDs
- QA user email: openplan-local-spine-smoke-2026-08-16T00-11-28-271Z@example.invalid
- QA user id: 551de079-eab9-465e-aa43-32f0c4a295c2
- Workspace id: 923ca971-5a1e-43dc-88fa-53be40617293
- Canonical project id: 21f36c9a-6629-463c-a763-1968574c9828
- RTP cycle id: ec2490a6-7b74-4296-b01c-f7e0e656148a
- Project RTP link id: 48788aa2-973a-4ecc-81b7-4d4898434a85
- Project funding profile id: 49ae3f8f-0c8b-408c-ad62-39dc74eb9308
- Program id: 9dd06ce4-05cd-4ec1-a23a-06ea08720f8c
- Funding opportunity ids: 2e7a9de0-e43f-4a87-958f-553e5fc60a20, c0bb96bf-c29b-481f-85c7-75ce5d16a36f
- Funding award id: 0530b8b3-b794-4a7c-b3fc-24385c471190
- Reimbursement invoice id: 19fc5ad7-5052-498a-b86a-fe1d47cc1eb8
- Engagement campaign id: ee638739-fda0-437e-a55f-21969a7888f3
- Engagement item ids: 6b414fd0-69cd-40fd-9279-994e6fe449ba, 69be0dd4-1428-4292-8857-a69451e26e2a, addf5d3c-81a4-4757-85b3-572219c79ba1, 2c272421-00b2-49be-85e0-fbab220b3fa6
- Scenario set id: 423fc56b-e2db-47e9-b4da-ff45ff3f6c9c
- Scenario entry ids: 707c4acf-f74e-4296-8004-c0478937228b, 95af7c07-0fc4-42bc-915c-d850609f65fa
- Model id: 0754c094-0cad-40f2-b9a8-92803ad68e2e
- Managed model run ids: 0174a11b-ff63-42dc-9022-9c293c9808e4, 6a913714-d321-4268-b683-4dd38b247b0c
- County run id: 445ce8ec-f322-4e2c-a112-084465084bd8
- Project-targeted report id: 8b42ec4e-75e2-4745-8408-f86381b0c4b1
- Report evidence citation ids: 67be5d98-cd55-4e6b-a914-80027af2e9ad, 16453607-2993-47a3-94b0-843ec90801a3, 0ca19eb2-b5ca-4c4f-99d8-103554972f1c
- Data Hub dataset ids: bb8bd399-5657-4345-842c-1fa6d0df4676, f223d0ef-dcc0-46e1-bddc-7ccf529b13ec, 0d8e7020-fc15-4305-93c2-3404d51bb653
- Project corridor ids: c42c2d91-9b0e-4829-9b13-71bc9151eb3b, cc1e77c5-52f6-4e20-a939-7490c5f97c5c
- Aerial mission ids: 3fb1051b-c447-41f2-ade3-1abb1664c8e7, c0065712-270f-4210-a0c6-5b16f9c143fc, dad5fc15-156e-492c-87ff-66c551e483b5
- Aerial evidence package ids: fbe2a08a-d97e-4561-b5e7-d9c6fabf1c3c, f2bea89c-65a1-465b-a325-aa6a54a7f53a, 0dda0d39-f7cd-4cc7-b137-674db8b36aba

## Pass/Fail Notes
- PASS: Local guard passed for local Phase 1 spine smoke: app=http://localhost:3200, supabase=http://127.0.0.1:54321.
- PASS: Created one fresh QA auth user (openplan-local-spine-smoke-2026-08-16T00-11-28-271Z@example.invalid); no pre-existing fixture data is read by this run.
- PASS: Signed into the local app through the real sign-in form.
- PASS: Verified sign-up alone auto-provisions a workspace — no operator step, no seed.
- PASS: Created the canonical project Spine Smoke Project 001128 in the auto-provisioned workspace.
- PASS: Created the RTP cycle and linked the canonical project into its portfolio.
- PASS: Created the grants chain — funding profile, program, two opportunities, award, and reimbursement invoice.
- PASS: Created the engagement campaign and 4 approved, geolocated items through the moderation route.
- PASS: Created the scenario set, both entries, the model, and two succeeded managed runs through the run-launch route.
- PASS: Created a county validation run attributed to the canonical project. It stays at bootstrap-incomplete because no worker ran — the smoke proves the provenance edge, not a validated model.
- PASS: Created 3 Data Hub datasets linked to the canonical project.
- PASS: Placed the project marker and the RTP pin through the product write routes.
- PASS: Drew 2 corridors through POST /api/projects/{id}/corridors.
- PASS: Created 3 aerial missions with AOI polygons and 3 evidence packages through the aerial routes.
- PASS: Created a project-targeted analysis_summary report citing both managed runs and the county run.
- PASS: Verified all five map-feature routes surface the records this run created, scoped to its own workspace.
- PASS: Verified funding profile, program, both opportunities, award, and invoice all reuse the canonical project id.
- PASS: Verified the engagement campaign and every approved item hang from the same project/RTP spine.
- PASS: Verified both managed runs succeeded, carry their scenario entry, and wrote KPI evidence rows.
- PASS: Verified the report and its typed evidence citations preserve both managed runs and the county run.
- PASS: Verified Data Hub links, corridors, aerial missions, and aerial evidence packages all reuse the canonical project id.
- PASS: Verified the workspace still holds exactly one project after every module wrote — no module minted a second.
- PASS: Rendered the project detail surface with the shared project spine.
- PASS: Rendered the project-targeted report detail page.

## Artifacts
- docs/ops/2026-08-16-test-output/2026-08-16-local-spine-smoke-01-project-detail.png
- docs/ops/2026-08-16-test-output/2026-08-16-local-spine-smoke-02-report-detail.png

## Verdict
- PASS: project_id 21f36c9a-6629-463c-a763-1968574c9828 — created once through `POST /api/projects` — is reused across RTP linkage, the grants chain, engagement, scenarios and managed model runs, county-run modeling provenance, the project-targeted report and its typed evidence citations, Data Hub dataset links, the corridor map layer, aerial missions, and aerial evidence packages. All five map-feature routes surface those records, and the workspace still holds exactly one project after every module wrote.
