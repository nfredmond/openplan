# Pilot Onboarding Runbook

_Date: 2026-02-26_

## Objective
Provision a new pilot tenant workspace in under 10 minutes with a repeatable checklist.

## 10-Minute Provisioning Checklist
1. Confirm pilot owner account can sign in and has verified email access.
2. Collect agency workspace name and desired plan (default is `pilot`).
3. Mint a user session token (browser sign-in or Supabase auth flow).
4. Call `POST /api/workspaces/bootstrap` with workspace payload.
5. Verify response includes `workspaceId`, `slug`, `plan`, `stageGateTemplate`, and `onboardingChecklist`.
6. Confirm owner row exists in `workspace_members` with role `owner`.
7. Ask pilot owner to open dashboard and validate workspace access.
8. Run one corridor analysis and confirm run appears in recent history.
9. Export a PDF report and save as baseline artifact for pilot kickoff.
10. Schedule first weekly check-in and record pilot success criteria.

## API Endpoint
- Route: `POST /api/workspaces/bootstrap`
- Auth: required (`createClient().auth.getUser()` must resolve a user)
- Request body:
  - `workspaceName` (string, required)
  - `plan` (string, optional; defaults to `pilot`)
  - `stageGateTemplateId` (string, optional; defaults to `ca_stage_gates_v0_1`)

## Exact API Call Example
```bash
curl -X POST "http://localhost:3000/api/workspaces/bootstrap" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -d '{
    "workspaceName": "City of Springfield Transportation",
    "plan": "pilot",
    "stageGateTemplateId": "ca_stage_gates_v0_1"
  }'
```

Example successful response:
```json
{
  "workspaceId": "11111111-1111-4111-8111-111111111111",
  "slug": "city-of-springfield-transportation",
  "plan": "pilot",
  "stageGateTemplate": {
    "id": "ca_stage_gates_v0_1",
    "version": "0.1.0",
    "jurisdiction": "CA",
    "bindingMode": "workspace_bootstrap_interim",
    "lapmFormIdsStatus": "deferred_to_v0_2"
  },
  "onboardingChecklist": [
    "Confirm primary workspace owner and backup admin contacts.",
    "Set pilot success metrics and first corridor delivery deadline.",
    "Upload at least one production corridor GeoJSON file.",
    "Run first corridor analysis and validate score transparency panel.",
    "Export PDF report and archive with timestamped run metadata.",
    "Schedule pilot readout and weekly KPI review cadence."
  ]
}
```

## Failure Handling
- `400`: Invalid payload or unsupported `stageGateTemplateId`. Re-submit with valid `workspaceName` and a supported template (`ca_stage_gates_v0_1`).
- `401`: User is unauthenticated. Re-authenticate and retry.
- `500`: Insert or membership provisioning failed. Check API logs for route `workspaces.bootstrap` and retry after resolving DB issue.

## OP-003 Interim Binding Notes
- Workspace bootstrap now binds California stage-gate template metadata as an interim OP-003 control.
- Binding source is `workspace_bootstrap_interim` until canonical project creation ships in v0.2.
- Exact LAPM exhibit/form IDs remain deferred to planning/legal-reviewed v0.2 (`lapmFormIdsStatus: deferred_to_v0_2`).
