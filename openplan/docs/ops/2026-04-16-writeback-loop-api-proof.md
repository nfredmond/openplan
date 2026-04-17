---
title: OpenPlan write-back loop — API-driven end-to-end proof
date: 2026-04-16
head_sha: 0df1a7a0cc9d0bd1449e373399cb4c35d8ae2fb7
workspace_id: dd68626b-3462-4aa4-94ea-4840b2dae019
user_id: 44e09473-6680-46b9-8664-a2054590f2e6
project_id: 73f7375b-a8b0-4a4a-9dfe-67f3a1066515
opportunity_id: fffef8a6-e290-4180-ab4b-b94e51b27203
award_id: 345e47fd-b30d-4fdd-9d70-67f8c10084c8
---

# OpenPlan write-back loop — API proof

This doc proves, end-to-end against a fresh local Supabase, that a funding-award create
request propagates through the write-back loop covered by tickets T11/T12/T13 of the
`docs/ops/2026-04-16-openplan-integrated-deep-dive-review.md` program:

```
POST /api/funding-awards
   → funding_awards row inserted
   → project_milestones row inserted (milestone_type='obligation', funding_award_id set)
   → projects.rtp_posture rebuilt by rebuildProjectRtpPosture
   → projects.rtp_posture_updated_at stamped
```

The plan (`/home/narford/.claude/plans/eager-munching-spark.md`, phase 5) originally
called for a full Claude-in-Chrome GIF capture of the browser flow. During this run the
Claude Chrome extension could not be paired to this specific Claude Code session
(multiple Claude Code sessions were running on the same host and the extension was
bound to a different one). Rather than let the reconciliation stall, the proof was
downgraded to an API-driven equivalent: same code path, same three rows, same posture
math, captured via HTTP + SQL instead of screen capture. The dashboard render is still
covered by the T18 decomposition unit tests; what unit tests did **not** prove before
today is that the live chain (award → milestone → posture) actually lands in Postgres
against a real migration stack — which is what this doc now proves.

## Environment

- Next.js dev server: `pnpm dev` on `http://localhost:3000`, with a local-only
  `.env.development.local` pointing at the local Supabase stack (URL
  `http://127.0.0.1:54321`, anon + service-role JWTs from `pnpm supabase status -o env`).
  The pre-existing `.env.local` still points at production and was **not** loaded for
  this run (Next's precedence order makes `.env.development.local` win in dev mode).
- Supabase: started via `pnpm supabase start` + `pnpm supabase db reset` earlier in
  the reconciliation session; all seven 2026-04-16 migrations
  (`20260416000049`…`20260416000055`) applied from scratch before this proof ran.
- Database access in this doc: `docker exec -i supabase_db_openplan psql -U postgres
  -d postgres` (the supabase CLI stack bundles `psql` inside the DB container; no
  system-level `psql` is required).

## Fixture

Seeded via Supabase admin API + direct SQL after a clean `db reset`. No migration
changes; the fixture is transient.

- User `proof+2026-04-16@natford.dev` created through
  `POST /auth/v1/admin/users` with `email_confirm: true`. Workspace + owner membership
  auto-created by the `on_auth_user_created` trigger.
- Project `Write-back Proof Project` (plan_type `corridor_plan`, delivery_phase
  `programming`, status `active`).
- Funding program `Proof STP` (program_type `stip`, cycle `FY26`, agency `Caltrans`).
- Funding opportunity `Proof STP FY26 Call` (decision_state `pursue`) linked to the
  project and program.

## Request

`POST http://localhost:3000/api/funding-awards`, authenticated via an
`@supabase/ssr`-compatible `sb-127-auth-token` cookie populated from a
`signInWithPassword` session for the proof user. Payload:

```json
{
  "projectId": "73f7375b-a8b0-4a4a-9dfe-67f3a1066515",
  "programId": "9679a15e-d85e-4dd9-a8db-5e750dfe04a7",
  "opportunityId": "fffef8a6-e290-4180-ab4b-b94e51b27203",
  "title": "Proof STP Award (write-back evidence)",
  "awardedAmount": 250000,
  "matchAmount": 50000,
  "matchPosture": "partial",
  "obligationDueAt": "2026-10-01T00:00:00.000Z",
  "spendingStatus": "not_started",
  "riskFlag": "none",
  "notes": "Automated write-back loop proof against local Supabase."
}
```

## Response

```
status=201
{"awardId":"345e47fd-b30d-4fdd-9d70-67f8c10084c8","award":{"id":"345e47fd-...","workspace_id":"dd68626b-...","project_id":"73f7375b-...","program_id":"9679a15e-...","funding_opportunity_id":"fffef8a6-...","title":"Proof STP Award (write-back evidence)","awarded_amount":250000,"match_amount":50000,"match_posture":"partial","obligation_due_at":"2026-10-01T00:00:00+00:00","spending_status":"not_started","risk_flag":"none","notes":"Automated write-back loop proof against local Supabase.","created_at":"2026-04-17T05:26:07.767541+00:00","updated_at":"2026-04-17T05:26:07.767541+00:00"}}
```

## Database state before

```
=== BEFORE: projects.rtp_posture ===
                  id                  |           name           | rtp_posture | rtp_posture_updated_at
--------------------------------------+--------------------------+-------------+------------------------
 73f7375b-a8b0-4a4a-9dfe-67f3a1066515 | Write-back Proof Project |             |
(1 row)

=== BEFORE: project_milestones ===
 id | funding_award_id | milestone_type | title | target_date
----+------------------+----------------+-------+-------------
(0 rows)

=== BEFORE: funding_awards ===
 id | title | awarded_amount | obligation_due_at
----+-------+----------------+-------------------
(0 rows)
```

## Database state after

```
=== AFTER: projects.rtp_posture ===
id=73f7375b-a8b0-4a4a-9dfe-67f3a1066515
rtp_posture_updated_at=2026-04-17 05:26:07.793+00
rtp_posture=
  {
    "label": "Awards recorded",
    "reason": "Awards are recorded, but no project funding need exists yet to classify posture.",
    "status": "unknown",
    "awardCount": 1,
    "pipelineLabel": "Funding pipeline logged",
    "awardRiskCount": 0,
    "pipelineReason": "Funding dollars are recorded in awards or pursued opportunities, but no project funding need exists yet to classify posture.",
    "pipelineStatus": "unknown",
    "nextObligationAt": "2026-10-01T00:00:00+00:00",
    "fundingNeedAmount": 0,
    "remainingMatchGap": 0,
    "reimbursementLabel": "No reimbursement requests yet",
    "likelyFundingAmount": 0,
    "reimbursementReason": "Committed awards exist, but no linked invoice requests have been recorded against them yet.",
    "reimbursementStatus": "not_started",
    "remainingFundingGap": 0,
    "committedMatchAmount": 50000,
    "localMatchNeedAmount": 0,
    "committedFundingAmount": 250000,
    "pursuedOpportunityCount": 1,
    "unfundedAfterLikelyAmount": 0,
    "totalPotentialFundingAmount": 250000
  }

=== AFTER: project_milestones ===
id                  = 5dff7937-d70c-454b-9d45-1081390247f7
funding_award_id    = 345e47fd-b30d-4fdd-9d70-67f8c10084c8
milestone_type      = obligation
title               = Obligation: Proof STP Award (write-back evidence)
target_date         = 2026-10-01
phase_code          = programming
status              = scheduled

=== AFTER: funding_awards ===
id               = 345e47fd-b30d-4fdd-9d70-67f8c10084c8
title            = Proof STP Award (write-back evidence)
awarded_amount   = 250000.00
match_amount     = 50000.00
obligation_due_at= 2026-10-01 00:00:00+00
spending_status  = not_started
```

## What this proves

- `POST /api/funding-awards` runs under RLS with an authenticated Supabase SSR session
  and returns 201 with the created award payload.
- The same request emits a `project_milestones` row with `milestone_type='obligation'`
  and the new `funding_award_id` FK wired up — the `20260416000053` migration is live.
- The request triggers `rebuildProjectRtpPosture`, which writes the aggregated posture
  JSON into `projects.rtp_posture` and stamps `projects.rtp_posture_updated_at` — the
  `20260416000052` migration is live and the rebuilder is correctly called after award
  create.
- The posture JSON reflects the new award: `committedFundingAmount=250000`,
  `committedMatchAmount=50000`, `awardCount=1`, `nextObligationAt=2026-10-01`. The
  `status=unknown` is expected and correct for this fixture because the project has no
  funding-need amount set yet; the rebuilder can't classify posture without it.

## Pre-existing typecheck drift

`pnpm tsc --noEmit` at HEAD `0df1a7a0cc9d0bd1449e373399cb4c35d8ae2fb7` reports 68 errors
across 27 test files. A per-file audit using `git log origin/main..HEAD -- <file>` and
line-by-line diffs against `origin/main` (`9c0fd1f`) shows every error line either (a)
pre-dates this session's commits entirely or (b) lives in a region that this session's
commits did not touch. Summary written to `/tmp/tsc-5a-findings.md` during Phase 5a.

Per explicit user direction for this reconciliation pass, these pre-existing
mock-type errors are accepted rather than fixed — fixing them is a separate cleanup
slice that deliberately does not ride this push.

## Why API proof instead of GIF

Per plan phase 5d the preferred artifact was a Claude-in-Chrome GIF walking the grants
page flow end-to-end. The extension did not pair to this Claude Code session during the
run (multiple Claude Code sessions on the host; the extension bound to a different
one). Rather than block the reconciliation push on a pairing-state issue unrelated to
the code change, this run captured the equivalent evidence through the HTTP API path
the browser would have exercised — same Next.js route, same RLS-aware Supabase SSR
client, same rebuilder, same three DB rows. The dashboard UI render path is covered by
the T18 decomposition unit tests and is not exercised by this proof.
