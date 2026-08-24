# OpenPlan local Land Use Plans review-reporting smoke — 2026-08-24

- App: http://localhost:3200
- Supabase: http://127.0.0.1:54321
- Plan: Local review journey 19-58-58

## Result
- PASS: Local guard passed for local land-use-plan review-reporting smoke: app=http://localhost:3200, supabase=http://127.0.0.1:54321.
- PASS: Closed review remained public, then withdrawal hid its content while retaining the release row.
- PASS: API journey completed creation, GIS finalization, Engagement closure, revision, second review, exact-hash adoption, publication, and readable annual reporting.
- PASS: Anonymous map returned only the planner-selected designation field; the private source attribute never appeared.

## Durable journey IDs
- userId: e2cb35c9-b7c0-4cba-aa0c-f6ef666492ee
- workspaceId: cd708e96-6dd9-481c-82d0-9e6503f8bdb1
- documentId: bb1e29c8-f7a1-40f0-bedb-028fba6581e0
- layerId: d0b729a8-8595-4488-a989-6fb7dcef1289
- layerVersionId: 26ddb373-f301-4e40-896f-f34293784ed1
- planId: 6cf39a1e-f652-4ac1-aa7a-af52a7fda2af
- version1Id: 5690ddf9-0a2e-4933-9434-814015503055
- designation1Id: 9758b678-b884-4cd3-9433-0c5294d60796
- version1Hash: c750b6e344da793389d4de2fd5d4f1f3f5c9b9f71714d27b17bd1728616bb6e3
- campaignId: 73073625-6bfc-4b6a-87b9-d21aed8a1511
- release1Id: 5e586164-3ee8-4aca-95bb-42cb462d63b9
- release1Token: 544a1bd7551104d2eeca0a3563643d1e92880969a57a87ea
- version2Id: 8871302d-5c68-462d-8771-99294098c9f0
- version2Hash: 62dcf8f51371d62296131401cd71ca63b1edfbfeba75b6cac3e778130d0ced3c
- designation2Id: c0d5c541-a77b-41c5-95a6-33acf07aad53
- release2Id: 599a900c-2cf3-44fb-abc5-d2ed1fd6afa4
- release2Token: 15650a03ae50faf7991b146eb496b89fbe09d55e3e760823
- decisionId: 6ed8a11c-aa38-49c7-acbc-ce5ba0fee547
- packetReportId: d0329ded-08eb-4d95-8d2b-df20385cd000
- implementationReportId: 807c7824-84dd-4413-b42f-193baad9da38

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
