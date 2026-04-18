---
title: OpenPlan variant-reader audit — writer-wired, reader-dead surfaces
date: 2026-04-17
head_sha: 1b24d43
scope: projects.rtp_posture, projects.aerial_posture, variant-component delegation
triggered_by: 2026-04-17-scenario-writeback-proof.md finding — T4-on-RtpReportDetail
---

# Variant-reader audit (2026-04-17)

## Why this exists

The T4 scenario-writeback proof earlier today uncovered a second
instance of the "writer wired, reader dead" pattern the retrospective
had flagged as one-off (caveat gate / T16). Instead of stopping at "fix
the one I found," this audit sweeps sibling writers to see whether the
pattern is really localized or structural.

The audit covers three sibling writers that all touch `projects` via
similar JSONB-posture columns:

1. `projects.rtp_posture` + `rtp_posture_updated_at` — written by
   `src/lib/projects/rtp-posture-writeback.ts:161-168`.
2. `projects.aerial_posture` + `aerial_posture_updated_at` — written
   by `src/lib/aerial/posture-writeback.ts:70-80`.
3. Variant-component delegation in `src/app/(app)/**/page.tsx` — every
   place where a page hands its `report`/`project`/etc. object to a
   subcomponent that then has to repeat the render logic.

Method: grep for writes (`rtp_posture: `, `aerial_posture: `), grep
for reads (any non-test reference to the column name), and reconcile
against the SSR render path.

## Finding 1 — `projects.rtp_posture` (JSONB body): reader-dead

**Writer.** `rebuildProjectRtpPosture` in
`src/lib/projects/rtp-posture-writeback.ts:161-168` sets the whole
`ProjectRtpPosture` object — `status`, `label`, `reason`,
`pipelineStatus`, `pipelineLabel`, `pipelineReason`,
`reimbursementStatus`, `reimbursementLabel`, `reimbursementReason`,
`fundingNeedAmount`, `localMatchNeedAmount`, `committedFundingAmount`,
`committedMatchAmount`, `likelyFundingAmount`,
`totalPotentialFundingAmount`, `remainingFundingGap`,
`remainingMatchGap`, `unfundedAfterLikelyAmount`, `nextObligationAt`,
`awardRiskCount`, `awardCount`, `pursuedOpportunityCount`.

Called from the grants writeback loop proved live on 2026-04-16.

**Reader.** None. `rg "rtp_posture[^_]"` hits only the writer and its
unit test. No `.select()` anywhere in `src/app/**` or `src/lib/**`
reads back the stored JSONB.

What *does* render is the sibling timestamp column:
`projects.rtp_posture_updated_at` appears at
`src/app/(app)/rtp/[rtpCycleId]/page.tsx:826-828` as
`Posture cached {formatRtpDateTime(...)}`. That's the full UI
footprint. None of the actual posture fields (status, reason,
pipeline state, reimbursement state, dollar amounts) reach a user.

**Consequence.** The grants → RTP writeback loop proven live on
2026-04-16 is truthful about "the column got updated" but the
posture *content* never becomes legible to an operator. The retro
framed this as an integration win; in reality the reader is a
single timestamp.

**Design call, not a mechanical fix.** Wiring candidates:

- `/rtp/[rtpCycleId]/page.tsx` — already renders the timestamp next
  to each portfolio project; add a posture-status pill and a
  sentence-form reason under it.
- `/projects/[projectId]/page.tsx` — the `RTP portfolio posture`
  section (line 1180) currently renders *inferred* posture via
  `buildProjectFundingStackSummary` rather than reading the cached
  column. Either read the cached column or drop the writer.
- Workspace dashboard — portfolio-level rollup of RTP posture by
  project would surface `awardRiskCount` / `unfundedAfterLikelyAmount`.

Not recommending a wire-it target in this doc. The writer is already
live; the surfacing question is a product-design call.

## Finding 2 — `projects.aerial_posture` (JSONB + timestamp): fully reader-dead

**Writer.** `rebuildProjectAerialPosture` in
`src/lib/aerial/posture-writeback.ts:70-80` sets `aerial_posture`
(the JSONB — `missionCount`, `readyPackageCount`,
`verificationReadiness`, etc.) *and* `aerial_posture_updated_at`.

Called from the aerial write-back path proved live on 2026-04-16
(`2026-04-16-aerial-evidence-package-proof.md`).

**Reader.** None. Neither the JSONB body nor the timestamp appears
in any `.select()` outside tests:

```
rg "aerial_posture[^_]"          → writer + unit test only
rg "aerial_posture_updated_at"   → writer + unit test only
```

**Surprise.** `src/app/(app)/aerial/missions/[missionId]/page.tsx:115-118`
**recomputes** aerial posture on every SSR render by calling
`buildAerialProjectPosture(missions, packages)` directly, rather
than reading the cached column that the writer is keeping fresh.

So the cached column is not just unused — it is actively *bypassed*
by the only surface that would logically consume it.

**Consequence.** The 2026-04-16 aerial evidence-package live-proof is
valid at the API/DB layer (the row gets written) but whatever the
mission detail page renders has no causal dependency on the writer.
If the writer stopped firing tomorrow, the mission page would render
identically.

**Design call.** Same shape as finding 1. Either:

- Use the cached column on mission detail and other aerial-adjacent
  pages (project detail, dashboard aerial widget), so the write has a
  consumer; or
- Delete the writer + both columns + the migration, since the
  live-recompute path is already canonical.

## Finding 3 — Variant-component delegation inventory (for future drift)

`rg "return\s+<[A-Z]\w+Detail"` across `src/app/(app)/**/page.tsx`
surfaces exactly three delegation patterns:

| Caller | Delegates to | Pattern |
| --- | --- | --- |
| `src/app/(app)/reports/[reportId]/page.tsx:836` | `<RtpReportDetail>` | conditional on `report.rtp_cycle_id` |
| `src/app/(app)/county-runs/[countyRunId]/page.tsx:30` | `<CountyRunDetailClient>` | unconditional — client-component wrapper, no branch |
| `src/app/(app)/county-runs/page.tsx:29` | `<CountyRunsPageClient>` | same — list-page wrapper |

Only the first is a true variant: the parent page has a non-RTP
rendering branch (inline, with its own posture/stale banner) *and*
delegates to a subcomponent on the RTP branch. That is the shape
where "writer wired, reader dead" can hide:

- Parent fetches a superset of columns.
- Inline branch renders all of them.
- Variant subcomponent renders a subset — missing fields are silently
  dropped.

This was the exact failure mode fixed in `1b24d43` (T4 on
`<RtpReportDetail>` previously rendered no stale banner).

The county-runs case is not a variant; the page just hands off
render entirely to a client component. No drift risk of the same
shape.

**Recommendation for future work.** Any new variant-component
delegation added to `src/app/(app)/**/page.tsx` should also mirror
the prop-type audit: if the parent page selects a field, the variant
must either render it or explicitly drop it with a comment.

## Revised "writer wired, reader dead" census

The retro's post-T4-fix count was:

- T16 caveat gate: dead (blocked on design call).
- T4-on-`<RtpReportDetail>`: fixed.

After this audit, the census is:

- T16 caveat gate: dead (unchanged).
- T4-on-`<RtpReportDetail>`: fixed.
- `projects.rtp_posture` JSONB body: dead. Timestamp surfaces; body
  does not.
- `projects.aerial_posture` JSONB + timestamp: dead. Mission page
  bypasses cached column entirely via live-recompute.

Four total; one fixed, three awaiting design calls on wiring targets.

## What this audit does NOT cover

- **Other writer/reader pairs outside the posture/scenario stack.**
  T3 (`rtp_basis_stale` on `reports`) was already audited and is
  fully integrated. T4 is now fixed. The stale-mark column census
  is complete; the posture-column census (this doc) is the newly
  surfaced gap.
- **Migrations.** Not reviewed whether these columns can simply be
  dropped. That's a DB-design call after the wire-vs-delete decision.
- **Runtime telemetry.** No instrumentation exists to confirm how
  often `rebuildProjectRtpPosture` / `rebuildProjectAerialPosture`
  actually fire in production. If they fire rarely, the reader-dead
  finding is academic.

## Next actions (not performed here)

- Decide wire-or-delete for `rtp_posture` JSONB body. If wire,
  candidate surfaces are `/rtp/[rtpCycleId]` and `/projects/[projectId]`
  RTP portfolio posture section.
- Decide wire-or-delete for `aerial_posture` column. If wire, candidate
  surfaces are aerial mission detail (replacing the live-recompute)
  and project detail aerial context.
- Revisit the 2026-04-16 live-proof claims for grants→RTP and aerial
  evidence-package writeback: both proofs are valid at the write
  layer but their downstream visibility is narrower than the retro
  implied.

## Commit trail leading into this audit

```
1b24d43 docs: scenario writeback live-proof + RTP report variant banner
```

This audit doc is its own commit — additive, no code changes.
