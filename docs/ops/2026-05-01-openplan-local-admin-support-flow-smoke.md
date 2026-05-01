# OpenPlan Local Admin Support Flow Smoke — 2026-05-01

- Base URL: http://localhost:3000
- Reviewer email: openplan-local-admin-reviewer@natfordplanning.com
- Reviewer user id: 2a2c9b5e-bc50-424f-9452-2141b62d2057
- Access request id: 3a79416b-404b-462d-8ab3-e6e25d511f4b
- Provisioned workspace id: d168d5f4-6323-42b8-be60-0422c5f0e733
- Owner invitation id: 8da59cce-33ad-4ac4-9b8f-b5e0364426fe
- Invitee email: openplan-local-admin-support-owner-2026-05-01T08-04-31-930Z@natfordplanning.com
- Invitee user id: 62455897-e470-4164-97bd-aeb2afe8cc62
- Review event ids: be7e08de-ec18-4e29-98ec-fe2167a64b2f, 2a81174e-7c0f-41ed-a2a1-6ab0ab65a261, 8c73131d-d295-42ee-8ea9-b7eb1d3d172b

## Pass/Fail Notes
- PASS: Updated allowlisted reviewer account openplan-local-admin-reviewer@natfordplanning.com.
- PASS: Submitted public request-access intake through the rendered form.
- PASS: Verified service-role-only access_requests row started as new with no provisioned workspace.
- PASS: Signed in as the allowlisted reviewer and loaded the admin operations intake queue.
- PASS: Recorded reviewing and contacted triage events through the authenticated admin API.
- PASS: Verified the admin operations surface exposes provisioning only after contacted status.
- PASS: Created a pilot workspace and one-time manual owner invitation from the admin surface.
- PASS: Reloaded the admin queue and verified the persisted provisioned row does not reload the invitation token.
- PASS: Verified triage/provisioning review-event audit path: new -> reviewing -> contacted -> provisioned.
- PASS: Verified workspace ledger carries pilot plan and pilot subscription posture.
- PASS: Verified the owner invitation ledger is pending, owner-scoped, and linked to the reviewer.
- PASS: Created the invited owner account after provisioning so the invite acceptance path could run.
- PASS: Accepted the owner invite as the prospect account and verified owner membership in the provisioned workspace.
- PASS: The one-time owner invitation URL was used in memory only; committed screenshots and this memo do not contain the invite token.

## Artifacts
- 2026-05-01-local-admin-support-flow-01-request-submitted.png
- 2026-05-01-local-admin-support-flow-02-intake-queue.png
- 2026-05-01-local-admin-support-flow-03-triaged-ready.png
- 2026-05-01-local-admin-support-flow-04-provisioned-invite.png
- 2026-05-01-local-admin-support-flow-05-invite-accepted-dashboard.png

## Verdict
- PASS: Local rendered/API smoke confirms public access-request intake, allowlisted admin triage, provision-only-after-contacted gating, pilot workspace provisioning, billing posture write-back, owner invitation ledgering, review-event audit trail, and invited-owner acceptance into the provisioned workspace.
