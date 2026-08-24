# OpenPlan local Land Use Plans review-reporting smoke — 2026-08-24

- App: http://localhost:3040
- Supabase: http://127.0.0.1:54321
- Plan: Local review journey 03-52-04

## Result
- PASS: Local guard passed for local land-use-plan review-reporting smoke: app=http://localhost:3040, supabase=http://127.0.0.1:54321.
- PASS: Closed review remained public, then withdrawal hid its content while retaining the release row.
- PASS: API journey completed creation, GIS finalization, Engagement closure, revision, second review, exact-hash adoption, publication, and readable annual reporting.
- PASS: Anonymous map returned only the planner-selected designation field; the private source attribute never appeared.

## Durable journey IDs
- userId: 825cb147-f365-480d-8a22-d9af224e148b
- workspaceId: 6e1341e1-0e8d-4e8a-9aae-9026e4b4257b
- documentId: db1b5d94-64dd-4420-9a84-a77fcc962993
- layerId: 1d0e4104-4434-418f-9167-4d0c7077fdb6
- layerVersionId: 3da6c7ab-b923-4a9c-a0c8-d49c99b026f4
- planId: 91569865-34e7-4461-ac1b-c3fbcfdc8c6c
- version1Id: 97cd5b23-f7bd-4b55-8c9d-f3922a120cac
- designation1Id: 5182eccf-309d-4bc5-8294-46ce6f398d76
- version1Hash: e934e5d7af96619e0c454d552233b44f6a318b8782b67af62f676b6f7a6b4129
- campaignId: ea7651e6-ad6d-4df2-9c9b-048dd9fe41f7
- release1Id: 05cb28bc-1e4c-4984-bc38-bef7a10d6086
- release1Token: 80e789f18fc84aa92653982fc1c2c25e82d340b06574e151
- version2Id: 9f4e809d-60c6-4a42-bec8-122b03097687
- version2Hash: e860b614d151fa832ea8d8121448f6f92f1e6b530f4dc90352e7d3d69fc7a56a
- designation2Id: 0a47c60a-006a-4b28-ab47-6ba6cd18fdf0
- release2Id: ca99453d-169b-40f7-a689-be03d9780a4d
- release2Token: dc90a741336345731c32ce4b9ceaf0978a6a1e1c3f7b5acd
- decisionId: 99f01739-db5f-4968-824d-4cb6892b490f
- packetReportId: 9232b4d9-3940-4d32-9ddf-fa05b8ba8b9e
- implementationReportId: a69dce03-9396-4c36-b787-eef4f9a23f47

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
