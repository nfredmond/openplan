# OpenPlan Local Engagement Report Handoff Smoke — 2026-07-28

## Local Targets
- App URL: http://localhost:3001
- Supabase URL: http://127.0.0.1:54321
- Local guard result: Local guard passed for local Engagement report handoff smoke: app=http://localhost:3001, supabase=http://127.0.0.1:54321.

## Mutation Summary
- Created one local QA auth user and one project workspace, then wrote an engagement campaign, moderation category, public feedback item, handoff report, report section, and generated report artifact.

## Cleanup / Idempotency Posture
- Local-only guard runs before service-role auth mutation and refuses Vercel, Supabase cloud, and arbitrary remote targets.
- This timestamped workflow smoke intentionally creates fresh local proof records on each run. It is safe to rerun against local Supabase, but old local QA users/workspaces/records remain until the local database is reset or cleaned manually.

## Key IDs
- QA user email: openplan-local-engagement-handoff-2026-07-28T18-28-20-682Z@natfordplanning.com
- QA user id: d01b4b78-7fc8-4318-ab2d-ede0c9a46f08
- Workspace id: 56910fe9-97c8-481e-9475-ae587f2d44b1
- Project id: 110a9092-39f8-498a-9a9d-8f5384ba1cad
- Campaign id: b3f00287-3355-4dad-bbd3-d2f845438e21
- Category id: f403b45e-5090-4f64-9c3a-2ddff06c19e9
- Engagement item id: 4f8aa5d9-deeb-4c7c-8635-28cfb9c755cb
- Report id: 85d0093c-3328-41e5-ba8b-2deeaf6c759b
- Report section id: e590ffa8-4ab2-488a-88c7-50cee720c68f
- Artifact id: 7837f8d7-041a-48ae-9773-420c185a4468
- Share token: 8zhq2nm8toke7imhf56uryo3tdm3

## Pass/Fail Notes
- PASS: Local guard passed for local Engagement report handoff smoke: app=http://localhost:3001, supabase=http://127.0.0.1:54321.
- PASS: Created QA auth user openplan-local-engagement-handoff-2026-07-28T18-28-20-682Z@natfordplanning.com.
- PASS: Signed into the local app successfully.
- PASS: Created project workspace Local Engagement Handoff Smoke 182820.
- PASS: Created linked engagement campaign Local Public Feedback Campaign 182820.
- PASS: Created moderation category School access 182820.
- PASS: Activated public engagement portal with a server-minted share token (28 chars).
- PASS: Submitted public feedback through the share portal and received the public success state.
- PASS: Verified the public item persisted as pending, categorized, and source_type=public.
- PASS: Approved the public item through the staff moderation registry and verified durable status.
- PASS: Verified approved feedback is visible on the public Community feedback tab.
- PASS: Created a handoff report from the engagement campaign detail surface.
- PASS: Verified report section provenance froze the campaign id and handoff-ready count.
- PASS: Generated an HTML packet and verified handoff provenance plus live engagement counts in the artifact preview.
- PASS: Verified the report artifact source context preserved engagement item counts.

## Artifacts
- 2026-07-28-local-engagement-report-handoff-01-public-submit.png
- 2026-07-28-local-engagement-report-handoff-02-moderation-approved.png
- 2026-07-28-local-engagement-report-handoff-03-public-feedback-published.png
- 2026-07-28-local-engagement-report-handoff-04-generated-artifact.png

## Verdict
- PASS: Local rendered/API smoke confirms public engagement intake, pending moderation persistence, staff approval, public feedback publication, handoff report provenance, HTML packet generation, and artifact source-context traceability through the shared project/campaign/report spine.
