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
- QA user email: openplan-local-engagement-handoff-2026-08-24T18-21-56-863Z@natfordplanning.com
- QA user id: cda05971-e173-43a5-9d23-f14b1b9be9fd
- Workspace id: 37026ecb-6c41-4c98-af35-13e2cef7a56a
- Project id: 97aff585-52dc-4ee1-968d-a1e9e5061243
- Campaign id: 99d39339-de56-4d83-8ece-385dbe9506de
- Category id: decc1109-1043-405a-a3ae-5142747786ac
- Engagement item id: eddaef92-98ac-4abc-9ccc-067d06034665
- Report id: 57c29b90-e0b6-4818-8012-a9c22440b5d4
- Report section id: b049d136-70a8-4717-990d-4d08dd355b3b
- Artifact id: b9af8ebd-41a4-42d2-97c7-ac77e82da9f5
- Share token: rn3bnujdbpy1ailbt5k3uykpjymj

## Pass/Fail Notes
- PASS: Local guard passed for local Engagement report handoff smoke: app=http://localhost:3200, supabase=http://127.0.0.1:54321.
- PASS: Created QA auth user openplan-local-engagement-handoff-2026-08-24T18-21-56-863Z@natfordplanning.com.
- PASS: Signed into the local app successfully.
- PASS: Created project workspace Local Engagement Handoff Smoke 182156.
- PASS: Created linked engagement campaign Local Public Feedback Campaign 182156.
- PASS: Created moderation category School access 182156.
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
