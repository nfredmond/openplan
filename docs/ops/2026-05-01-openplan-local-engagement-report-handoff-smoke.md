# OpenPlan Local Engagement Report Handoff Smoke — 2026-05-01

- Base URL: http://localhost:3000
- QA user email: openplan-local-engagement-handoff-2026-05-01T07-46-07-684Z@natfordplanning.com
- QA user id: e13d4413-6a00-49b9-8b35-f0b78f849a0a
- Workspace id: a13d9ec2-5714-4b15-b253-f0ff465de27c
- Project id: 7e46171e-7d20-47f2-b29f-69f9783e6d56
- Campaign id: 4494bdf4-1b63-4e8e-b6fc-6994cda086bc
- Category id: da85eb66-9a91-4c41-8bb2-c0265ce0c93c
- Engagement item id: a94eb042-8135-4b1e-b68a-c0745aa5ff27
- Report id: a2a7f180-efe7-4b84-bbc9-cf47afc0120c
- Report section id: d74be586-c786-4d91-9f6a-42fb8f5cb692
- Artifact id: bd1170d2-7eaf-4355-aea2-44910c9e00de
- Share token: localengage074607

## Pass/Fail Notes
- PASS: Created QA auth user openplan-local-engagement-handoff-2026-05-01T07-46-07-684Z@natfordplanning.com.
- PASS: Signed into the local app successfully.
- PASS: Created project workspace Local Engagement Handoff Smoke 074607.
- PASS: Created linked engagement campaign Local Public Feedback Campaign 074607.
- PASS: Created moderation category School access 074607.
- PASS: Activated public engagement portal with share token localengage074607.
- PASS: Submitted public feedback through the share portal and received the public success state.
- PASS: Verified the public item persisted as pending, categorized, and source_type=public.
- PASS: Approved the public item through the staff moderation registry and verified durable status.
- PASS: Verified approved feedback is visible on the public Community feedback tab.
- PASS: Created a handoff report from the engagement campaign detail surface.
- PASS: Verified report section provenance froze the campaign id and handoff-ready count.
- PASS: Generated an HTML packet and verified handoff provenance plus live engagement counts in the artifact preview.
- PASS: Verified the report artifact source context preserved engagement item counts.

## Artifacts
- 2026-05-01-local-engagement-report-handoff-01-public-submit.png
- 2026-05-01-local-engagement-report-handoff-02-moderation-approved.png
- 2026-05-01-local-engagement-report-handoff-03-public-feedback-published.png
- 2026-05-01-local-engagement-report-handoff-04-generated-artifact.png

## Verdict
- PASS: Local rendered/API smoke confirms public engagement intake, pending moderation persistence, staff approval, public feedback publication, handoff report provenance, HTML packet generation, and artifact source-context traceability through the shared project/campaign/report spine.
