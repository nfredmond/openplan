---
title: OpenPlan packet regenerate re-ground live-proof (T1 generate path)
date: 2026-04-18
head_sha_before: 4e724d5
workspace_id: dd68626b-3462-4aa4-94ea-4840b2dae019
project_id: 73f7375b-a8b0-4a4a-9dfe-67f3a1066515
report_id: e7502b16-8ec0-4b88-8501-7e8e02ea5afd
---

# T1 packet generate + re-ground live-proof

Closes the remaining half of T1 — the deep-dive's packet lifecycle
(create → generate → re-ground) had only the `create` leg live-proven
on 2026-04-16 (`2026-04-16-rtp-cycle-and-packet-lifecycle-proof.md`,
explicitly acknowledged at lines 203-207 as uncovering the `generate`
path). This doc proves the `generate` leg **and** closes a bug that
the 2026-04-17 scenario-writeback proof's stale-banner CTA implied
was already working.

## The bug: regenerate was not re-grounding

The scenario-writeback banner added yesterday reads:

> **Basis stale** … Regenerate the packet to re-ground it on the new run.

The call-to-action instructs the operator to hit the regenerate button,
which invokes `POST /api/reports/<reportId>/generate`. That route
updated `status`, `generated_at`, `latest_artifact_url`,
`latest_artifact_kind`, and `metadata_json` — but **never cleared the
four `rtp_basis_stale_*` columns**.

Net effect: the operator regenerates, the flag stays `true`, and the
stale banner continues to render after regeneration. The writer
(`markScenarioLinkedReportsBasisStale`) has an inverse-writer
counterpart that simply didn't exist. This is the third instance of
the "writer wired, reader dead" pattern this week — except here it's
the *inverse* writer that was dead, not the reader.

## Fix (this commit)

`src/app/api/reports/[reportId]/generate/route.ts`:

Both `reports.update({...})` blocks (the RTP-variant path around line
459, the non-RTP-variant path around line 955) now clear the stale
columns on successful generation:

```ts
rtp_basis_stale: false,
rtp_basis_stale_reason: null,
rtp_basis_stale_run_id: null,
rtp_basis_stale_marked_at: null,
```

The `looksLikePendingSchema` fallback branches (lines 471 and 967)
are intentionally **not** modified. Those fall back to the legacy
column set for environments whose schema predates the stale columns —
adding the fields there would re-trigger the same fallback in a loop.

`src/test/report-generate-route.test.ts`:

Extended the existing "persists an html artifact and updates report
status" assertion to require all four stale-clear fields in the
update payload. 7/7 suite still green.

## Fixture state going in

The scenario-writeback proof from 2026-04-17 left the fixture in the
exact state this proof needs:

- `reports.e7502b16-...`
  - `status = draft`
  - `generated_at = null`
  - `rtp_basis_stale = true`
  - `rtp_basis_stale_reason = "Linked model run Proof Model Run — T4
    promoted to scenario entry"`
  - `rtp_basis_stale_run_id = 164bf689-...` (the model_run id)
  - `rtp_basis_stale_marked_at = 2026-04-18T04:31:31.645Z`

## Proof transcript

Driver: `openplan/rtp-regenerate-proof.mjs` (new).

### Phase A — BEFORE

```
DB reports row BEFORE:
  status                     = draft
  generated_at               = null
  rtp_basis_stale            = true
  rtp_basis_stale_reason     = "Linked model run Proof Model Run — T4
                                promoted to scenario entry"
  rtp_basis_stale_run_id     = 164bf689-...
  rtp_basis_stale_marked_at  = 2026-04-18T04:31:31.645+00:00

SSR /reports/e7502b16-...  → 200
  FOUND "Basis stale"                          @ 43710
  FOUND "promoted to scenario entry"           @ 43793
  FOUND "Marked stale on"                      @ 43888
  FOUND "Regenerate the packet to re-ground"   @ 43927
```

### Phase B — POST `/api/reports/<reportId>/generate`

Body: `{"format":"html"}`

```
status = 200
body   = {
  "reportId":        "e7502b16-...",
  "artifactId":      "439d6c81-c6e7-4b68-92b9-ccc72cbffaa5",
  "format":          "html",
  "latestArtifactUrl":
    "/reports/e7502b16-...#artifact-439d6c81-...",
  "warnings":        []
}
```

### Phase C — DB AFTER

```
reports row AFTER:
  status                     = generated
  generated_at               = 2026-04-18T07:05:11.574+00:00
  rtp_basis_stale            = false
  rtp_basis_stale_reason     = null
  rtp_basis_stale_run_id     = null
  rtp_basis_stale_marked_at  = null

PASS: rtp_basis_stale is false
PASS: rtp_basis_stale_reason is null
PASS: rtp_basis_stale_run_id is null
PASS: rtp_basis_stale_marked_at is null
PASS: status is generated
PASS: generated_at is set
```

### Phase D — SSR AFTER

```
GET /reports/e7502b16-... (same authed session) → 200
  GONE    "Basis stale"
  GONE    "promoted to scenario entry"
  GONE    "Marked stale on"
  FOUND   "Packet generated" @ 46801
```

## What this proves

- `POST /api/reports/<id>/generate` is the re-ground write path. It
  completes the writer-counterwriter pair started by
  `markScenarioLinkedReportsBasisStale` (scenario-writeback.ts:129).
- The stale banner's CTA ("Regenerate the packet to re-ground it") is
  now truthful end-to-end: click regenerate → flag clears → banner
  disappears.
- T1 packet lifecycle is **fully** live-proven for the first time:
  create (2026-04-16) + generate + re-ground (this proof). Only PDF
  artifact generation and the chained `generateAfterCreate=true`
  convenience path remain unproven at the live layer.

## What this does NOT cover

- **`generateAfterCreate=true` chain from `createRtpPacketRecord`.**
  That path calls create, then generate, in one request from the
  assistant runtime (`src/lib/reports/client.ts:75`). Structurally
  the same two routes this proof covers individually; not exercised
  as a single chained call here.
- **PDF artifact generation.** The generate route returns 501 for
  `format: "pdf"` today; not in scope.
- **`MAX_REGROUNDING_DEPTH` guard (T17).** That guard lives in the
  assistant-host `executeAction` orchestration layer
  (`src/lib/runtime/action-registry.ts:178,226`). It's an in-memory
  recursion cap on post-action prompt chains, not an API-observable
  side effect. Unit tests cover it; a live proof would require an
  assistant session, which is a different surface.

## Script artifacts

- `openplan/rtp-regenerate-proof.mjs` — driver for phases A–D.

## Fixture state after this proof

- `reports.e7502b16-...`:
  - `status = generated`
  - `generated_at = 2026-04-18T07:05:11.574Z`
  - all four `rtp_basis_stale_*` columns = null/false
- New `report_artifacts` row id `439d6c81-...` (html).

Re-running this proof requires flipping the report back into a stale
draft state — either via the scenario-writeback proof or by manually
setting `rtp_basis_stale = true` on the row.

## Retro adjustment

The 2026-04-17 retrospective listed T1 as "live for create; unit for
generate & re-ground" and the 2026-04-16 lifecycle proof explicitly
uncovered the generate path. With this proof:

- T1 create: **live** (2026-04-16).
- T1 generate: **live** (this proof).
- T1 re-ground (stale-flag clear): **live** (this proof) — and the
  retro never flagged this specific bug; it's a finding, not just a
  closure.

## "Writer wired, reader dead" census update

Yesterday's variant-reader audit
(`2026-04-17-variant-reader-audit.md`) put the count at 4: T16 open,
T4-on-RtpReportDetail closed, plus `projects.rtp_posture` body and
`projects.aerial_posture` as new findings. Today's proof surfaces a
fifth case on the opposite axis — a writer existed with no
counter-writer:

- `markScenarioLinkedReportsBasisStale` (writes `true`): live and
  proved 2026-04-17.
- Regenerate clears the flag (writes `false`): did not exist before
  today — closed by this commit.

Census:

- T16 caveat gate: dead.
- T4-on-`<RtpReportDetail>` banner: fixed.
- `projects.rtp_posture` body: dead (design call).
- `projects.aerial_posture`: dead (design call).
- T1 regenerate re-ground writer: **fixed here**.

Three fixed, two awaiting design calls.
