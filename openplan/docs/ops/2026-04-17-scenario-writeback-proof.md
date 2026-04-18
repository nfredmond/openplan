---
title: OpenPlan scenario writeback live-proof (T4) + rtp-report-detail banner fix
date: 2026-04-17
head_sha_before: 7a644c0
workspace_id: dd68626b-3462-4aa4-94ea-4840b2dae019
project_id: 73f7375b-a8b0-4a4a-9dfe-67f3a1066515
report_id: e7502b16-8ec0-4b88-8501-7e8e02ea5afd
---

# Scenario writeback live-proof (T4)

Closes the loop on T4 — the deep-dive's scenario-report writeback — promoted
to priority by the 2026-04-17 stale-mark reader audit. The round-trip
exercised here is: a succeeded `model_run` gets promoted to a scenario
entry, which attaches it to the linked RTP packet's scenario set, which
calls `markScenarioLinkedReportsBasisStale`, which flips
`reports.rtp_basis_stale=true` on the linked packet, which renders a
"Basis stale" banner on the report-detail SSR page.

## Why this wasn't already a live proof

The deep-dive left T4 with unit coverage only
(`src/test/scenario-report-writeback.test.ts`). The proof required:

- a scenario_set + scenario_entry,
- a model + succeeded model_run with `source_analysis_run_id`,
- a report linked via `report_runs` to that analysis run,
- RLS-correct state transitions from a real authed session.

None of those were in the 2026-04-16 proof fixture — only the award /
invoice / project posture data were.

## Surprise finding: "writer wired, reader dead" (second instance)

The first proof attempt exercised every DB-side write correctly
(`rtp_basis_stale=true`, reason, run_id, marked_at all set; scenario
entry status flipped `draft → ready` and `attached_run_id` set), but
the SSR `/reports/<reportId>` page did **not** render the "Basis stale"
banner even though the Flight payload showed `rtp_basis_stale: true`.

Root cause: the banner JSX at
`src/app/(app)/reports/[reportId]/page.tsx:1636` only runs for the
non-RTP variant of the page. Reports with `rtp_cycle_id` delegate to
`<RtpReportDetail>` (`src/components/reports/rtp-report-detail.tsx`),
which has its **own** `#packet-release-review` article — and that
article did not include the stale banner. For every RTP-linked packet
(which is the common case), the writer fired and the reader rendered
nothing.

This is the second instance of the "writer wired, reader dead" pattern
called out in `2026-04-17-program-retrospective.md`. The first was T16
(caveat gate). The pattern is not as one-off as the retro hoped.

## Fix (this commit)

`src/components/reports/rtp-report-detail.tsx`:

1. Extended the `report` prop type with
   `rtp_basis_stale`, `rtp_basis_stale_reason`, `rtp_basis_stale_run_id`,
   and `rtp_basis_stale_marked_at`. The caller at
   `src/app/(app)/reports/[reportId]/page.tsx:837` passes the whole
   `report` object, so no call-site change was needed.
2. Added the same banner JSX block that exists on the non-RTP variant,
   above the "Packet posture" section inside
   `<article id="packet-release-review">`.

`src/test/rtp-report-detail.test.tsx`:

- Added `rtp_basis_stale: false` + companion nulls to the two test
  fixtures to keep tsc green. Tests still 2/2 passing.

## Proof transcript

`openplan/scenario-writeback-proof.mjs` (new):

### Phase A — BEFORE

```
reports row: { rtp_basis_stale: false, ... }
SSR /reports/<reportId>: 200; contains "Basis stale" = false
```

### Phase B — seed dependencies

```
scenario_set   a67bbdf2-c74b-4737-bccf-9204cf347845
scenario_entry 40d6e0ab-7206-4117-99ee-ca6965532011   (status=draft, no run)
model          1a7065a8-d5fd-4048-90fe-51b9e4351f5b   (family=scenario_model)
runs (analysis) a51d102c-5e63-4c80-b133-ed9d8e62eb72
model_runs      164bf689-eb75-4b09-879d-b9ad10ba3121  (status=succeeded,
                                                       source=a51d102c-...)
report_runs     54a33bb3-f90c-4463-8cfa-7ba10fd21ff6  (report_id=e7502b16-...,
                                                       run_id=a51d102c-...)
```

### Phase C — PATCH /api/models/<modelId>/runs/<modelRunId>

Body: `{"scenarioEntryId": "40d6e0ab-..."}`

```
status = 200
body   = {
  "modelRunId":           "164bf689-...",
  "scenarioEntryId":      "40d6e0ab-...",
  "sourceAnalysisRunId":  "a51d102c-..."
}
```

### Phase D — DB side-effects

```
reports row AFTER:
  rtp_basis_stale           = true
  rtp_basis_stale_reason    = "Linked model run Proof Model Run — T4
                               promoted to scenario entry"
  rtp_basis_stale_run_id    = 164bf689-...   (model_run id)
  rtp_basis_stale_marked_at = 2026-04-18T04:31:31.645Z

scenario_entries row AFTER:
  status          = ready        (flipped from draft)
  attached_run_id = a51d102c-... (the analysis run id)
```

### Phase E — SSR re-render

```
GET /reports/e7502b16-... (authed as proof user, same cookie) → 200
markers found in HTML:
  FOUND "Basis stale"                          @ 43710
  FOUND "promoted to scenario entry"           @ 43793
  FOUND "Marked stale on"                      @ 43888
  FOUND "Regenerate the packet to re-ground"   @ 43927
```

All four markers appear inside
`<article id="packet-release-review">`, consistent with the patched
banner JSX.

## What this proves

- The `PATCH /api/models/<id>/runs/<runId>` promotion path fires
  `markScenarioLinkedReportsBasisStale` end-to-end: scenario
  entry → report_runs join → report UPDATE → SSR render.
- The stale-mark banner now renders on **RTP-linked** report-detail
  pages (the common case), not just the non-RTP variant.
- Combined with the 2026-04-17 reader audit (T3/T4 writers in 3 API
  routes + report-detail renders the banner), the scenario →
  report writeback loop is integrated top to bottom.

## What this does NOT cover

- **POST /api/models/<id>/runs (the non-promotion path).** That route
  also calls `markScenarioLinkedReportsBasisStale` after a fresh run
  succeeds. It's structurally the same code, but it wasn't exercised
  live in this proof — unit tests cover it.
- **Re-grounding.** Regenerating the packet clears `rtp_basis_stale`.
  Not tested here; belongs with the T1 packet generate + re-ground
  live proof on the deferred list.
- **`touchScenarioLinkedReportPackets` side effect.** The soft-touch
  call (bumps `reports.updated_at`) runs alongside the stale mark.
  Visible only in the DB row's `updated_at`, not surfaced in SSR
  beyond the timestamp — not asserted here.

## Script artifacts

- `openplan/scenario-writeback-proof.mjs` — driver for phases A–E.

## Fixture state after this proof

- `scenario_sets`:     1 row
- `scenario_entries`:  1 row  (status=ready)
- `models`:            1 row
- `runs`:              1 row  (the analysis run)
- `model_runs`:        1 row  (status=succeeded)
- `report_runs`:       1 row  (links proof report to analysis run)
- `reports.rtp_basis_stale`: **true** on `e7502b16-...`

Subsequent T4 re-runs will need a fresh report or a DB reset of the
stale columns to start from a clean baseline.

## Retro adjustment

The 2026-04-17 retro noted T3/T4 as "fully wired" based on the audit
of the non-RTP page. That claim was partially incorrect: the RTP
variant — which is the path that matters for any packet linked to an
RTP cycle — was reader-dead. With this commit, it is not.

The retro's "writer wired, reader dead" count now reads:
- T16 (caveat gate): dead — still blocked on design call.
- T4 (scenario writeback on `<RtpReportDetail>`): **fixed here**.

If the retrospective is revised, this finding should land under
"Surprise findings #1".
