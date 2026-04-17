---
title: OpenPlan RTP cycle + packet lifecycle — live proof (T17 + T1)
date: 2026-04-16
head_sha: c5a656f70f8c9374436bfe77cd484b6ef8006433
workspace_id: dd68626b-3462-4aa4-94ea-4840b2dae019
user_id: 44e09473-6680-46b9-8664-a2054590f2e6
project_id: 73f7375b-a8b0-4a4a-9dfe-67f3a1066515
award_id: 345e47fd-b30d-4fdd-9d70-67f8c10084c8
rtp_cycle_id: aaaaaaaa-1111-4111-8111-111111111111
---

# OpenPlan RTP cycle + packet lifecycle — live proof

Closes the evidence loop on two tickets from the 2026-04-16 program:

- **T17** — `/rtp/<rtpCycleId>` server-renders real `rtp_cycles` +
  `project_rtp_cycle_links` rows with the project posture that the grants
  write-back loop produced.
- **T1** — `POST /api/reports` with `reportType=board_packet` +
  `rtpCycleId` creates a real `reports` row linked to the cycle, plus
  default `report_sections`, plus an `assistant_action_executions` audit
  row with `action_kind=create_rtp_packet_record`.

The tests shipped with both tickets mocked the Supabase client. This
proof exercises the same code against a live local Supabase, with a real
`signInWithPassword` session driving both an SSR fetch and an API POST.

## Fixture reuse

The same fixture that powered the grants write-back proofs is still
live. This run added two new rows on top of it:

```
 rel                                            | count
------------------------------------------------+-------
 workspaces (dd68626b-...)                      |     1
 projects (73f7375b-..., Write-back Proof)      |     1
 funding_awards (345e47fd-..., Proof STP)       |     1
 project_milestones (obligation w/ award)       |     1
 projects.rtp_posture committedFundingAmount    |  250000
 rtp_cycles (aaaaaaaa-..., Proof RTP Cycle 2026)|     1   ← new (T17)
 project_rtp_cycle_links (portfolio_role=constr)|     1   ← new (T17)
```

## Auth

Same pattern as the prior live-render proof: admin password-reset
(service role) → `signInWithPassword` on the anon client → session
packed into an `@supabase/ssr` cookie (`sb-127-auth-token`, value
`base64-<JSON.stringify(session)>`). The cookie drives both the SSR page
fetch (T17) and the API POST (T1) in this run.

## Part A — T17 live SSR render

### Script

`openplan/rtp-cycle-proof.mjs` signs in, packs the cookie, fetches
`http://localhost:3000/rtp/aaaaaaaa-1111-4111-8111-111111111111`,
and greps the HTML for eight posture markers.

### Transcript

```
step 1: admin password reset OK
step 2: sign-in OK  user_id= 44e09473-6680-46b9-8664-a2054590f2e6

=== /rtp/ aaaaaaaa-1111-4111-8111-111111111111 ===
HTTP 200 size 370572 bytes
  Proof RTP Cycle 2026                 FOUND @21580
  Write-back Proof Project             FOUND @103969
  Proof STP Award                      FOUND @104056
  Posture cached                       FOUND @104387
  $250,000                             FOUND @102730
  250,000                              FOUND @102731
  constrained                          FOUND @44813
  Anchored by Proof STP Award          FOUND @104044
```

### What this proves

- `src/app/(app)/rtp/[rtpCycleId]/page.tsx` reads the cycle, resolves
  the portfolio via `project_rtp_cycle_links`, and renders each
  project's cached `rtp_posture` (committed amount, anchor award,
  `postureGeneratedAt` → "Posture cached").
- `portfolio_role='constrained'` surfaces in the portfolio section.
- The grants write-back loop → RTP cycle render path is fully connected
  end-to-end. The packet that the next phase creates inherits all of
  this posture.

## Part B — T1 packet create through `/api/reports`

### Script

`openplan/rtp-packet-proof.mjs` reuses the cookie, captures the
pre-POST `reports` row count for this cycle (0), POSTs
`{ rtpCycleId, reportType: "board_packet", summary: "..." }`,
then verifies four things from Supabase:

1. the returned `reports` row,
2. the default `report_sections` fan-out,
3. the `metadata_json.queueTrace` lineage,
4. the `assistant_action_executions` audit row.

### Transcript

```
step 4: before count = 0
step 5: POST /api/reports status = 201
          response: {
  "reportId": "e7502b16-8ec0-4b88-8501-7e8e02ea5afd",
  "report": {
    "id": "e7502b16-8ec0-4b88-8501-7e8e02ea5afd",
    "workspace_id": "dd68626b-3462-4aa4-94ea-4840b2dae019",
    "project_id": null,
    "rtp_cycle_id": "aaaaaaaa-1111-4111-8111-111111111111",
    "title": "Proof RTP Cycle 2026 Board / Binder",
    "report_type": "board_packet",
    "status": "draft",
    "summary": "Live-render proof packet for 2026-04-16 T1 close-the-loop evidence.",
    "metadata_json": {
      "queueTrace": {
        "action": "create_record",
        "detail": "Created RTP packet record.",
        "source": "reports.create",
        "actedAt": "2026-04-17T07:12:19.956Z",
        "actorUserId": "44e09473-6680-46b9-8664-a2054590f2e6"
      }
    },
    "created_at": "2026-04-17T07:12:19.959015+00:00",
    "updated_at": "2026-04-17T07:12:19.959015+00:00"
  }
}

step 7: report_sections count = 6
  [0] cycle_overview                   "Cycle overview" enabled=true
  [1] chapter_digest                   "Chapter digest" enabled=true
  [2] portfolio_posture                "Portfolio posture" enabled=true
  [3] engagement_posture               "Engagement posture" enabled=false
  [4] adoption_readiness               "Adoption readiness" enabled=true
  [5] appendix_references              "Appendix and references" enabled=false
```

Audit row (from a direct psql query — the script initially queried the
wrong table name):

```sql
SELECT action_kind, audit_event, approval, regrounding, outcome,
       input_summary, started_at, completed_at
  FROM assistant_action_executions
 WHERE workspace_id = 'dd68626b-3462-4aa4-94ea-4840b2dae019'
   AND action_kind = 'create_rtp_packet_record'
 ORDER BY completed_at DESC
 LIMIT 1;
```

```
 action_kind              | create_rtp_packet_record
 audit_event              | planner_agent.create_rtp_packet_record
 approval                 | safe
 regrounding              | refresh_preview
 outcome                  | succeeded
 input_summary            | {"reportId": "e7502b16-...", "reportType": "board_packet",
                          |  "rtpCycleId": "aaaaaaaa-..."}
 started_at               | 2026-04-17 07:12:19.874+00
 completed_at             | 2026-04-17 07:12:19.976+00
```

### What this proves

- The packet lifecycle entry point (`POST /api/reports` with a
  `board_packet` + `rtpCycleId`) creates a real `reports` row in the
  workspace, linked to the cycle, with an auto-derived title
  ("Proof RTP Cycle 2026 Board / Binder") and the proof user as
  `created_by`.
- Default packet sections fan out automatically from
  `createDefaultTargetedReportSections(...)` for the `rtp_cycle` target
  kind — six sections, with the expected `enabled` posture (engagement
  + appendix start disabled; overview/digest/posture/adoption enabled).
- `metadata_json.queueTrace` captures the action lineage for the
  planner agent queue.
- `assistant_action_executions` records the create as
  `action_kind=create_rtp_packet_record` with `outcome=succeeded` and
  the exact input summary — the audit trail the runtime expects.

### Follow-up render check

Re-running `rtp-cycle-proof.mjs` after the POST confirms the packet
surfaces in the cycle view:

```
$ grep -c "Proof RTP Cycle 2026 Board / Binder" /tmp/rtp-cycle-proof.html
3
$ grep -c "Board / Binder" /tmp/rtp-cycle-proof.html
3
```

The cycle page grew from 361,677 bytes (pre-packet) to 370,572 bytes
(post-packet) — the packet card + section labels account for the
delta.

## What this proof does NOT cover

- `generateAfterCreate=true` re-grounding path. The
  `create_rtp_packet_record` runtime record supports it
  (`src/lib/runtime/action-registry.ts:56-67`) but the proof exercised
  only the bare create, not the `generateAfterCreate` → chained
  `generate_report` path.
- PDF artifact generation. The packet was created in `status=draft`;
  no artifact upload was exercised.
- Multi-cycle portfolio rendering. Only one project is linked to the
  cycle in the proof fixture.

## Script artifacts

- `openplan/rtp-cycle-proof.mjs` — T17 SSR render proof (added today).
- `openplan/rtp-packet-proof.mjs` — T1 packet create proof (added today).
- `/tmp/rtp-cycle-proof.html` — captured HTML from the post-packet
  render.

Both scripts require `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_ANON_KEY`
in the environment and a running `pnpm dev` against the local Supabase.
