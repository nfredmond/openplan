# OpenPlan local Land Use Plans review-reporting smoke — 2026-08-24

- App: http://localhost:3200
- Supabase: http://127.0.0.1:54321
- Plan: Local review journey 09-20-48

## Result
- PASS: Local guard passed for local land-use-plan review-reporting smoke: app=http://localhost:3200, supabase=http://127.0.0.1:54321.
- PASS: Closed review remained public, then withdrawal hid its content while retaining the release row.
- PASS: API journey completed creation, GIS finalization, Engagement closure, revision, second review, exact-hash adoption, publication, and readable annual reporting.
- PASS: Anonymous map returned only the planner-selected designation field; the private source attribute never appeared.

## Durable journey IDs
- userId: 2b8a4691-b6c6-4c1b-abff-b5d2c377cb87
- workspaceId: 04b0b7b6-752a-49de-8ed4-2212a6047d08
- documentId: 74b77d6e-12d0-4fad-a652-918debe74b4e
- layerId: 0890ac17-5d2b-4298-b99b-c1a1a709705a
- layerVersionId: d56ab8fa-47a0-4119-96e2-cc9e2802c08f
- planId: ada29bd9-897d-4b2c-a2b0-11eaaba424e2
- version1Id: f14eb7ea-31d5-4a1f-830b-d73029854e66
- designation1Id: e2420b8e-5a58-4d2b-a3b4-503429de8609
- version1Hash: 53753686c92a905781f76427ad80b4037e194889996a845d50e278bd9da083ab
- campaignId: 4d8f091d-a16d-49fa-a30b-49cd99df4c4b
- release1Id: 8753181e-1ec9-4095-902a-fb3a0c0ddbdc
- release1Token: 6fc753040dfb52ee2c070660bd02dbf4361751c465c6d130
- version2Id: 205e2ecc-cf7e-4edc-9dd9-be6431adc670
- version2Hash: 06895c11ba7ca2118cb38d0d9c1c5e2f2f9f0c26d647f6e91eb7b100dba1c6de
- designation2Id: fe7a1280-836c-438e-a73f-e7da84965b08
- release2Id: 002a7dd0-4c89-47c9-af1e-7b62eb119bed
- release2Token: 8001213c2923d245a3cee58b5541226a0faff79613e964e5
- decisionId: 5695581c-05f0-4ada-9584-3cbe7b47c81f
- packetReportId: 44dcaf30-c177-45a3-970e-51bf1c1bc973
- implementationReportId: ac3112c2-f85a-4bce-9fd2-eaf9cf05eb92

## Screenshots
- 2026-08-24-land-use-review-02-my-work-dated-links.png
- 2026-08-24-land-use-review-01-closed-record-desktop.png
- 2026-08-24-land-use-review-03-adopted-workbench-desktop.png
- 2026-08-24-land-use-review-04-adopted-workbench-mobile-report-link.png
- 2026-08-24-land-use-review-05-second-review-map-desktop.png
- 2026-08-24-land-use-review-06-second-review-map-mobile.png
- 2026-08-24-land-use-review-07-adopted-map-desktop.png
- 2026-08-24-land-use-review-08-printable-plan-packet.png
- 2026-08-24-land-use-review-09-readable-implementation-report.png

This smoke is local-only and intentionally leaves its timestamped QA workspace and records in the local database for inspection.
