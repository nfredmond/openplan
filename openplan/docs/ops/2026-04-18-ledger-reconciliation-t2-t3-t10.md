---
title: 18-ticket ledger reconciliation — T2, T3, T10, T18 bookkeeping close
date: 2026-04-18
program_doc: docs/ops/2026-04-16-openplan-integrated-deep-dive-review.md
supersedes_ledger_in: docs/ops/2026-04-18-program-retrospective-update.md
phase: M-bookkeeping
---

# Ledger reconciliation (post-Phase M)

Phase M moved T5+T6 from unit-only → live (`docs/ops/2026-04-18-assistant-action-audit-live-proof.md`). While scoping Phase N, a recon pass against the 2026-04-18 retrospective's ticket ledger surfaced three tickets whose code is already shipped and proven but whose bookkeeping was never updated. This doc closes that gap.

## What was stale

The 2026-04-18 retrospective update's ledger reads:

- **Live (10/18):** T1, T4, T8, T9, T11, T12, T13, T14, T15, T17
- **Unit-only (7/18):** T2, T3, T5, T6, T10, T16, T18
- **Deferred (1/18):** T16 caveat-gate wiring

Phase M closes T5+T6. Recon shows T2, T3, and T10 are also already structurally done with the evidence already on disk — just never written up as closed.

## T2 — packet freshness label unification

**Deep-dive acceptance (line 386-388):** "a single grep for status strings returns one file's worth of constants."

**Evidence:**

```
$ grep -rE '"(No packet|Refresh recommended|Packet current|Needs reset|Preset unknown|No packet record)"' src --include='*.ts' --include='*.tsx' | grep -v '^src/test/'
src/lib/reports/packet-labels.ts:2:  NO_PACKET: "No packet",
src/lib/reports/packet-labels.ts:3:  REFRESH_RECOMMENDED: "Refresh recommended",
src/lib/reports/packet-labels.ts:4:  CURRENT: "Packet current",
src/lib/reports/packet-labels.ts:11:  NO_RECORD: "No packet record",
src/lib/reports/packet-labels.ts:12:  NEEDS_RESET: "Needs reset",
src/lib/reports/packet-labels.ts:13:  PRESET_UNKNOWN: "Preset unknown",
```

Outside tests, the raw strings exist only inside `packet-labels.ts` itself. All production consumers import the `PACKET_FRESHNESS_LABELS` / `PACKET_POSTURE_LABELS` constants — 19 files reference the module:

- `src/lib/assistant/{context,operations,respond,rtp-packet-posture}.ts`
- `src/lib/grants/modeling-evidence.ts`
- `src/lib/operations/workspace-summary.ts`
- `src/lib/reports/catalog.ts`
- `src/app/(app)/{programs,projects,reports,rtp,scenarios,engagement}/**/page.tsx`
- `src/components/rtp/rtp-registry-packet-row-action.tsx`

**Verdict:** T2 live. No further work required.

## T3 — `rtp_basis_stale` column + stale-marking

**Deep-dive acceptance (line 390-392):** "linked `model_run.status → succeeded` marks all linked reports `rtp_basis_stale = true` with reason; packet detail shows 'basis stale since {run}' banner."

**Evidence:**

- Migration `supabase/migrations/20260416000049_reports_rtp_basis_staleness.sql` adds the column family (`rtp_basis_stale`, `rtp_basis_stale_reason`, `rtp_basis_stale_run_id`, `rtp_basis_stale_marked_at`).
- Writer `markScenarioLinkedReportsBasisStale` at `src/lib/reports/scenario-writeback.ts:83` sets all four columns when a succeeded model_run is promoted to a scenario entry.
- Reader banner in `src/components/reports/rtp-report-detail.tsx` renders "Basis stale" + reason + marked_at inside `<article id="packet-release-review">`.
- Full round-trip proof: `docs/ops/2026-04-17-scenario-writeback-proof.md` — labeled "(T4)" in its title but its acceptance content exactly matches T3's deep-dive acceptance (model_run → succeeded → column flip → SSR banner). The doc's Phase E transcript shows `"Basis stale"`, `"promoted to scenario entry"`, `"Marked stale on"`, and `"Regenerate the packet to re-ground"` all present in the rendered HTML.
- The 2026-04-18 retrospective's "writer wired, reader dead" census (row 2) already records this fix as done ("T4 stale banner on `<RtpReportDetail>` — fixed (1b24d43, proven 2026-04-17)"). The T4 label there is wrong — that row's content is T3's acceptance, not T4's metadata-version-marker acceptance.

**Verdict:** T3 live. The 2026-04-17 scenario-writeback proof is the T3 live proof, mis-labeled T4.

## T10 — grants opportunities page decomposition

**Deep-dive observation (2026-04-16):** `components/grants: 0` — zero extracted components; grants page was mega-size.

**Evidence as of 2026-04-18:**

```
$ ls src/components/grants/
grants-award-conversion-section.tsx
grants-awards-reimbursement-section.tsx
grants-funding-need-editor-section.tsx
grants-modeling-triage-section.tsx
grants-opportunity-creator-section.tsx
grants-opportunity-registry-card.tsx
grants-opportunity-registry-section.tsx
grants-page-intro-header.tsx
grants-queue-callout.tsx
grants-reimbursement-triage-section.tsx
grants-workspace-queue-section.tsx

$ wc -l 'src/app/(app)/grants/page.tsx'
677 src/app/(app)/grants/page.tsx
```

11 extracted components, page down to 677 LOC. The 2026-04-18 retrospective already names T10 as structurally done and says "a one-line audit... would close the ticket bookkeeping. ~15 min." This is that audit.

**Verdict:** T10 live. No further decomposition required at this ticket's scope. Future extractions (the retro suggests 2-3 more slices) are a separate, unbooked hygiene task, not a T10 reopening.

## T18 — dashboard decomposition

**Deep-dive acceptance (line 450-452):** "Extract 4-6 widget components: packet posture, funding pressure, scenario freshness, aerial verification, next action. `dashboard/page.tsx` uses widgets; each widget tests independently."

**Evidence:**

```
$ wc -l 'src/app/(app)/dashboard/page.tsx'
258

$ ls src/components/dashboard/
dashboard-kpi-grid.tsx
dashboard-operator-guidance.tsx
dashboard-quick-actions.tsx
dashboard-workspace-intro.tsx
```

Five widget-role components compose the page: the four `components/dashboard/*` above plus `components/operations/workspace-command-board.tsx` (the cross-lane tile `dashboard/page.tsx` imports at line 7). Dashboard page is 258 LOC — trivially inside any size cap.

Independent widget tests:

- `src/test/dashboard-widgets.test.tsx` — 12 test cases
- `src/test/dashboard-page.test.tsx` — 3 test cases
- `src/test/workspace-command-board.test.tsx` — 3 test cases

The deep-dive's five named logical areas (packet posture, funding pressure, scenario freshness, aerial verification, next action) don't map 1:1 to widget names but are covered across KPI grid + operator guidance + command board composition. The acceptance line's structural requirements ("dashboard/page.tsx uses widgets; each widget tests independently") are satisfied.

**Verdict:** T18 live. No further widget extraction required at this ticket's scope.

## Revised ledger (16/18 live)

| Before (2026-04-18 retro update) | After (this doc, 2026-04-18 evening) |
|---|---|
| Live 10/18 | **Live 16/18:** T1, T2, T3, T4, T5, T6, T8, T9, T10, T11, T12, T13, T14, T15, T17, T18 |
| Unit-only 7/18 | **Unit-only 1/18:** T16 (writer wired, reader design-gated) |
| Deferred 1/18 | **Deferred 1/18:** T16 caveat-gate wiring (same item, the sole design-blocker) |

The T16 entry appears in both unit-only (T16 writer is implemented and unit-tested) and deferred (T16 reader surface is design-gated) columns because the ticket has two halves with different states. That's not new — the 2026-04-17 retro already flagged this.

## What this unlocks

With T2, T3, T5, T6, T10, T18 all live-closed today:

- **Every T1–T18 ticket except T16's reader surface is live or integration-tested.** The "writer wired, reader dead" census's remaining open rows (`projects.rtp_posture` body, `projects.aerial_posture`, T16 caveat gate) are all design-gated.
- **The 18-ticket program's first ledger is structurally complete.** T16 is the sole open item, and it's blocked on a reader-surface design call, not on engineering effort. The binding constraint "commit-splitting + live-loop proof, not more breadth" has been satisfied end-to-end.
- **Next productive work is design-gated, not build-gated.** Three design calls remain (T16 caveat-gate reader surface, `projects.rtp_posture` body presentation, `projects.aerial_posture` presentation). Until any of those are resolved, new engineering work should be scoped as either (a) pilot-readiness breadth (legal pages, quota asymmetry, nested error boundaries — explicitly deferred by the "what not to do next" guidance), or (b) hygiene (further page decompositions, ESLint max-lines rule enforcement per cross-cutting rule #4).

## Scope of this commit

- No code changes. Bookkeeping + evidence links only.
- The 2026-04-18 retrospective update's "Updated evidence scorecard" section remains load-bearing for the closures through Phase M; this doc supersedes only its unit-only / live counts.
- No truth-state-lock changes. `internal prototype only` + max APE 237.62% language preserved.

## Pointers

- Deep-dive program source: `docs/ops/2026-04-16-openplan-integrated-deep-dive-review.md`
- Prior retro: `docs/ops/2026-04-18-program-retrospective-update.md`
- Phase M live proof (T5+T6): `docs/ops/2026-04-18-assistant-action-audit-live-proof.md`
- T3 live proof (mislabeled T4): `docs/ops/2026-04-17-scenario-writeback-proof.md`
- T17 chain-test proof: `docs/ops/2026-04-18-t17-regrounding-depth-chain-test.md`
