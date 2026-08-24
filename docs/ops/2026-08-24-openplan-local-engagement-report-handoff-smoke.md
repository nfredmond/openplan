# OpenPlan Local Engagement Report Handoff Smoke — 2026-08-24

## Local Targets
- App URL: http://localhost:3200
- Supabase URL: http://127.0.0.1:54321
- Local guard result: Local guard passed for local Engagement report handoff smoke: app=http://localhost:3200, supabase=http://127.0.0.1:54321.

## Mutation Summary
- Created one local QA auth user and one project workspace, then wrote an engagement campaign, moderation category, public feedback item, handoff report, report section, and generated report artifact.

## Cleanup / Idempotency Posture
- Local-only guard runs before service-role auth mutation and refuses Vercel, Supabase cloud, and arbitrary remote targets.
- This timestamped workflow smoke intentionally creates fresh local proof records on each run. It is safe to rerun against local Supabase, but old local QA users/workspaces/records remain until the local database is reset or cleaned manually.

## Key IDs
- QA user email: openplan-local-engagement-handoff-2026-08-24T20-00-27-211Z@natfordplanning.com
- QA user id: 9938047b-4996-4d89-a63b-d790b56819da
- Workspace id: cb26a254-933d-4acc-972f-28e10a7d87ae
- Project id: 299f49ad-b494-49d2-a639-8f026a9dcc9a
- Campaign id: 53d642c0-a947-48a3-904c-e7e03be501b1
- Category id: 582d4ccc-ea3b-4e8b-b35e-00e2abd2bb50
- Engagement item id: f6ac4299-78e9-4944-98a9-628f57949818
- Report id: 6d6305a4-3c9f-47a5-821b-b1827aa6b532
- Report section id: c08f97c2-e357-4669-aec5-66f96c6ae288
- Artifact id: 6e59a097-1aec-441f-995c-be4fd555f077
- Share token: xwjy2n4r22fgn6yb380987hok9fe

## Pass/Fail Notes
- PASS: Local guard passed for local Engagement report handoff smoke: app=http://localhost:3200, supabase=http://127.0.0.1:54321.
- PASS: Created QA auth user openplan-local-engagement-handoff-2026-08-24T20-00-27-211Z@natfordplanning.com.
- PASS: Signed into the local app successfully.
- PASS: Created project workspace Local Engagement Handoff Smoke 200027.
- PASS: Created linked engagement campaign Local Public Feedback Campaign 200027.
- PASS: Created moderation category School access 200027.
- PASS: Activated public engagement portal with a server-minted share token (28 chars).
- PASS: Submitted public feedback through the share portal and received the public success state.
- PASS: Verified the public item persisted as pending, categorized, and source_type=public.
- PASS: Approved the public item through the staff moderation registry and verified durable status.
- PASS: Verified approved feedback is visible on the public Community feedback tab.
- PASS: Created a handoff report, and found its summary in the page chrome and its section list under the evidence tab.
- PASS: Verified report section provenance froze the campaign id and handoff-ready count.
- PASS: Generated an HTML packet and verified handoff provenance plus live engagement counts in the artifact preview.
- PASS: Verified the report artifact source context preserved engagement item counts.

## Artifacts
- 2026-08-24-local-engagement-report-handoff-01-public-submit.png
- 2026-08-24-local-engagement-report-handoff-02-moderation-approved.png
- 2026-08-24-local-engagement-report-handoff-03-public-feedback-published.png
- 2026-08-24-local-engagement-report-handoff-04-generated-artifact.png

## Verdict
- PASS: Local rendered/API smoke confirms public engagement intake, pending moderation persistence, staff approval, public feedback publication, handoff report provenance, HTML packet generation, and artifact source-context traceability through the shared project/campaign/report spine.
