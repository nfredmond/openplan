---
title: OpenPlan aerial evidence-package posture — live proof (T9)
date: 2026-04-16
head_sha: 33d49fa (post-slice-2 head; aerial proof adds one commit on top)
workspace_id: dd68626b-3462-4aa4-94ea-4840b2dae019
user_id: 44e09473-6680-46b9-8664-a2054590f2e6
project_id: 73f7375b-a8b0-4a4a-9dfe-67f3a1066515
mission_id: bbbbbbbb-2222-4222-8222-222222222222
---

# OpenPlan aerial evidence-package posture — live proof

Closes the evidence loop on T9 (Aerial Ops → project posture write-back)
the same way the 2026-04-16 grants + RTP proofs closed T10/T11/T12/T13/T17/T1:
by exercising the real API + SSR surfaces against a live local Supabase
instead of mocked unit tests.

## What T9 is supposed to do

1. A user POSTs to `POST /api/aerial/evidence-packages` with
   `{ missionId, title, packageType, status, verificationReadiness }`.
2. The route inserts a row into `aerial_evidence_packages`.
3. If the mission is linked to a project, the route calls
   `rebuildAerialProjectPosture()` which:
   - queries all workspace+project missions and their packages,
   - computes posture via `buildAerialProjectPosture()`,
   - writes `projects.aerial_posture` (JSONB) +
     `projects.aerial_posture_updated_at` on the project row.
4. `/aerial/missions/<missionId>` server-renders the new package and the
   computed mission posture in an inspector chain.

This proof exercises all four steps end-to-end through the real route
handler, the real `buildAerialProjectPosture()` helper, and the real
SSR page component.

## Fixture

Reuses the 2026-04-16 proof workspace/project/user and adds one aerial
mission:

```sql
INSERT INTO aerial_missions (
  id, workspace_id, project_id, title, status, mission_type,
  geography_label, collected_at, notes
) VALUES (
  'bbbbbbbb-2222-4222-8222-222222222222',
  'dd68626b-3462-4aa4-94ea-4840b2dae019',
  '73f7375b-a8b0-4a4a-9dfe-67f3a1066515',
  'Proof Mission — Corridor Survey 2026-04-16',
  'complete', 'corridor_survey',
  'Grass Valley SR-49 segment',
  '2026-04-10T15:30:00+00:00',
  'Seeded for 2026-04-16 T9 live-render proof.'
);
```

Pre-POST state:

```
 relation                               | count / value
----------------------------------------+---------------
 aerial_missions  (workspace)           | 1
 aerial_evidence_packages (workspace)   | 0
 projects.aerial_posture                | null
 projects.aerial_posture_updated_at     | null
```

## Auth

Same pattern as the prior proofs: admin password-reset → anon
`signInWithPassword` → session packed into an `@supabase/ssr`-compatible
`sb-127-auth-token` cookie. Same user, same session shape.

## Transcript

`openplan/aerial-evidence-proof.mjs` (added today):

```
step 3: PRE-POST aerial_posture on project = { aerial_posture: null,
                                                aerial_posture_updated_at: null }

step 4: POST /api/aerial/evidence-packages status = 201
          response: {
  "packageId": "f0079fb7-2b81-4bcb-82e0-d9a01282a592",
  "package": {
    "id": "f0079fb7-...",
    "mission_id": "bbbbbbbb-2222-4222-8222-222222222222",
    "workspace_id": "dd68626b-...",
    "project_id": "73f7375b-...",
    "title": "Proof Ortho — Measurable Output 2026-04-16",
    "package_type": "measurable_output",
    "status": "ready",
    "verification_readiness": "ready",
    "notes": "Seeded for 2026-04-16 T9 live-render proof."
  }
}

step 6: POST-POST aerial_posture on project =
{
  "aerial_posture": {
    "missionCount": 1,
    "readyPackageCount": 1,
    "activeMissionCount": 0,
    "completeMissionCount": 1,
    "verificationReadiness": "ready"
  },
  "aerial_posture_updated_at": "2026-04-17T07:16:31.558+00:00"
}

step 7: GET /aerial/missions/bbbbbbbb-... status=200 size=170975 bytes
  Proof Mission — Corridor Survey 2026-04-16   FOUND @18860
  Corridor survey                              FOUND @20846
  Proof Ortho                                  FOUND @23429
  measurable_output                            FOUND @23563
  Write-back Proof Project                     FOUND @27197
  Grass Valley SR-49 segment                   FOUND @20922
  Complete                                     FOUND @20787
  Ready                                        FOUND @24095
```

## What this proves

- `POST /api/aerial/evidence-packages` inserts a real row into
  `aerial_evidence_packages` with the correct FK chain
  (mission → workspace → project).
- `rebuildAerialProjectPosture()` runs as a side effect and writes the
  aggregate to `projects.aerial_posture`. The posture JSONB correctly
  reflects `missionCount=1`, `readyPackageCount=1`,
  `completeMissionCount=1`, `verificationReadiness=ready` for this
  fixture.
- `projects.aerial_posture_updated_at` is set to the rebuild timestamp.
- `/aerial/missions/<missionId>` server-renders:
  - the mission title, type ("Corridor survey"), geography label, and
    status badge ("Complete"),
  - the newly-created package (title, `measurable_output` type label,
    "Ready" verification badge),
  - the linked project name ("Write-back Proof Project") in the
    evidence-chain inspector.
- RLS passes end-to-end via the same workspace-members cookie-auth
  pattern the other proofs use.

## What this proof does NOT cover

- Multi-mission portfolios. The fixture has one mission → one package.
  `buildAerialProjectPosture()` aggregation across many missions is
  exercised only by its unit tests.
- `/aerial/` (operations overview) rendering. Only the mission-detail
  page is fetched here.
- `/projects/<projectId>` surfacing the aerial posture. The project row
  now carries the posture, but the `projects/[projectId]/page.tsx`
  render of it is not verified in this proof (it would not have
  regressed on today's API path).
- Package-lifecycle transitions (`processing` → `ready` → `shared`).
  The proof inserts the package in `ready` state directly.

## Script artifacts

- `openplan/aerial-evidence-proof.mjs` — the proof script.
- `/tmp/aerial-mission-proof.html` — captured mission-detail HTML.

Both require `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_ANON_KEY` in the
environment and a running `pnpm dev` against the local Supabase with
the proof fixture present.
