# OpenPlan Local Phase 1 Spine Smoke - 2026-07-28

> **DATED RECORD — 2026-07-28.** This describes what was true on the day it was written.
> It is kept because it records *why* decisions were made, which nothing else captures.
> **Do not treat any factual claim here as current** — verify against the code, the
> database, or `CHANGELOG.md` before acting on it. A stale doc that reads as current
> costs more than a missing one: on 2026-07-30 a roadmap in this folder listed two
> "remaining" items that had both already shipped, and nearly cost a full rebuild of a
> feature that already exists.


## Command
- `cd qa-harness && npm run local-spine-smoke`

## Local Targets
- App URL: http://localhost:3001
- Supabase URL: http://127.0.0.1:54321
- Local guard result: Local guard passed for local Phase 1 spine smoke: app=http://localhost:3001, supabase=http://127.0.0.1:54321.

## Provisioning Posture
- **Self-provisioning.** This smoke reads no checked-in fixture. It creates one auth user, lets the `on_auth_user_created` trigger provision that user a workspace, and then builds every record it asserts on through the app HTTP route a planner would use.
- **Place-neutral.** No jurisdiction, agency, or real coordinate appears anywhere in the fixture. Labels are generic; every geometry is anchored on a deliberately meaningless origin (0°, 0°) so a fixture can never be mistaken for analysis geography.
- **Hermetic.** Each run works inside a workspace that did not exist a moment earlier, so there is no prior-run residue to clean and no shared state with any other smoke.

## Boundary Notes
- **All three cartographic-backdrop layers were written through product routes.** They previously had no write path at all — the deleted demo seed was their only producer, so a project or RTP cycle created through the app never appeared on the map and a corridor could not be created by any means. This run places the project marker via `PATCH /api/projects/{id}/location`, the RTP pin via `PATCH /api/rtp-cycles/{id}`, and the corridors via `POST /api/projects/{id}/corridors`, then asserts the map-features routes return them.
- The managed runs use the `ite_trip_generation` engine, which is a pure computation over a land-use program. The corridor engine was not used because it needs real geography with live Census/LODES coverage — a place-shaped dependency this smoke exists to avoid.
- The county run stays at `bootstrap-incomplete`. Advancing it to `validated-screening` requires the Python worker and real artifacts on disk; this smoke proves the project-provenance edge only, and claims nothing about model validity.

## Key IDs
- QA user email: openplan-local-spine-smoke-2026-07-28T21-33-16-741Z@example.invalid
- QA user id: a43d0624-aaae-4711-a2d8-9db70cfe3f5e
- Workspace id: edf33924-3448-4137-a92f-d8a9c7917c82
- Canonical project id: 2c327f9f-84b7-4076-9028-018c79071a96
- RTP cycle id: 164acf6b-a769-41d0-9e05-01ae55b61862
- Project RTP link id: 766aa687-39ce-42d4-9b1a-469b80bda935
- Project funding profile id: 97205d55-5324-4392-98ca-7e0341ef90c7
- Program id: eec485c1-5655-4ea2-b630-26cca152b794
- Funding opportunity ids: 98d7485d-a3a6-4d0e-847c-fdc88700be7d, 3a75cb51-b583-4db2-95f9-3ab13f678bea
- Funding award id: 90892581-6228-4021-af51-566d6d85777d
- Reimbursement invoice id: 9125e367-73f9-493c-a668-dde68bda8d27
- Engagement campaign id: d21ba869-ba54-4610-b84d-cae2ec32ed50
- Engagement item ids: bfc49f5c-6b78-43d7-a049-bac85ae32397, f9ad550b-5e3b-40f1-991e-7a0c3df118b4, 98c9b8d0-8366-46a2-bcdf-582f39d32ad4, 1148438f-a68c-43b3-ba9b-d6133b9e4d3a
- Scenario set id: ed796df0-1b5c-402d-82bb-d6d363ed594d
- Scenario entry ids: c5fb692e-c543-4f60-9e35-eba601c84112, d65b4974-1998-4c11-89c2-9685519a947c
- Model id: 9a55fee7-cb49-48f3-a733-754f855011ba
- Managed model run ids: 5ec1acd1-bf90-4b30-aaf6-6b66ca10352a, fc493331-bf2c-464e-84b0-eaf44b1e2419
- County run id: d4a983ef-e651-4525-9d06-56e63ecb6249
- Project-targeted report id: 0c3d78ac-0429-4bba-a806-0023f4c4753d
- Report evidence citation ids: ccc17a51-f32e-41c8-a8d5-6d86d6b9e3cd, 779ec0e0-aff7-486f-8651-028695964a3e, 646c2bd2-8b18-47cb-93ed-4a522e77f50b
- Data Hub dataset ids: 7672764d-9a29-423f-ba5d-4130f08940fd, 7b549615-01da-4e0b-8f3d-a7da5ff94982, 753c8d17-e55b-4c4e-9ef4-0ac6c06dff5e
- Project corridor ids: 96732b6a-c61a-45d4-ba69-e9f3001bb9d2, 052c301b-11dd-4f41-b714-1857d6c11569
- Aerial mission ids: 9f3bc60a-4020-4c5f-9c9e-7caa61c53689, 51571b58-a78a-4d9d-b617-4d4daeebb348, 2a14c0e5-adac-4f3b-9026-a72bbc18e339
- Aerial evidence package ids: 29a369ae-2ef6-4011-9de4-f8ddb9c8624f, 930f1613-6919-478b-aea1-bb2543c3a662, ef65b9d3-c920-43e7-9882-a276111de671

## Pass/Fail Notes
- PASS: Local guard passed for local Phase 1 spine smoke: app=http://localhost:3001, supabase=http://127.0.0.1:54321.
- PASS: Created one fresh QA auth user (openplan-local-spine-smoke-2026-07-28T21-33-16-741Z@example.invalid); no pre-existing fixture data is read by this run.
- PASS: Signed into the local app through the real sign-in form.
- PASS: Verified sign-up alone auto-provisions a workspace — no operator step, no seed.
- PASS: Created the canonical project Spine Smoke Project 213316 in the auto-provisioned workspace.
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
- docs/ops/2026-07-28-test-output/2026-07-28-local-spine-smoke-01-project-detail.png
- docs/ops/2026-07-28-test-output/2026-07-28-local-spine-smoke-02-report-detail.png

## Verdict
- PASS: project_id 2c327f9f-84b7-4076-9028-018c79071a96 — created once through `POST /api/projects` — is reused across RTP linkage, the grants chain, engagement, scenarios and managed model runs, county-run modeling provenance, the project-targeted report and its typed evidence citations, Data Hub dataset links, the corridor map layer, aerial missions, and aerial evidence packages. All five map-feature routes surface those records, and the workspace still holds exactly one project after every module wrote.
