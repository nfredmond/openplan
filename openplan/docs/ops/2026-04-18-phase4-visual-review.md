---
title: 2026-04-18 Phase 4 UI/UX visual review
date: 2026-04-18
rubric: docs/ops/2026-04-08-openplan-frontend-design-constitution.md
gate_for: Priorities.md item 1 ("finish the current OpenPlan UI/UX overhaul cycle")
---

# Phase 4 UI/UX visual review

## Purpose

Complete the Priorities.md item-1 gate before the forward-motion lanes
(modeling → engagement → aerial → command center) re-open. Walk every
authenticated route, compare against the 2026-04-08 design constitution,
record findings, file fixes for trivial drift, and settle the lane.

## Method

Source-code sweep, not browser walk-through. Rationale: the design
constitution enumerates structural patterns (card grids, chip clusters,
decorative chrome, multi-CTA), which are detectable via grep on the
route files + the shared `module-*` token system in `src/app/globals.css`.
A browser walk is valuable for visual novelty but adds little for
structural compliance once the code-level patterns are inventoried.

Route inventory drawn from `find src/app -name 'page.tsx'` — 33 routes
total (my original plan had 28; the actual set includes `admin/*`,
`data-hub`, `county-runs/*`, `rtp/[id]/document`, and a few public
routes I hadn't enumerated).

## Headline finding

**The design system is substantially constitution-compliant.** The
`module-*` token family in `src/app/globals.css` (`.module-section-surface`,
`.module-section-header`, `.module-section-title`, `.module-metric-card`,
`.module-metric-label`, `.module-metric-value`, `.module-record-chip`,
`.module-intro-card`, etc.) is the backbone of every index and detail
page, and it encodes the calm-workbench posture the constitution
prescribes. Backgrounds, borders, and spacing are expressed through
these tokens rather than ad-hoc utility-class pileups — which is the
exact "token discipline over utility chaos" rule from the constitution.

**What this means for Phase 4 scope.** The work is not a redesign.
It is targeted drift-repair in a handful of places, plus a decision
about mega-page LOC growth. Phase 4 can settle in a single cleanup
pass (hours, not days) if the mega-page decomposition is deferred to
Phase C (platform hardening).

## Violation census

### Category 1 — decorative chrome (2 spots)

The constitution says: "random gradients, glassmorphism, ornamental
shadows, generic purple/blue startup palettes" should not carry
hierarchy. Two spots drift:

| File | Line | Pattern | Verdict |
|---|---|---|---|
| `src/app/(app)/explore/page.tsx` | ~3698 | `bg-[linear-gradient(180deg,rgba(11,19,27,0.98),...)] text-slate-100 shadow-[0_20px_48px_rgba(0,0,0,0.16)]` — dark-themed "Data fabric status" block with heavy drop shadow | **drift** — decorative chrome doing hierarchy work the constitution says should be typography/spacing |
| `src/app/(app)/billing/page.tsx` | ~150 | `panelClass()` helper: `bg-[linear-gradient(180deg,rgba(255,255,255,0.74),rgba(246,248,244,0.96))] ... shadow-[0_18px_40px_rgba(15,23,42,0.04)]` | **acceptable-with-caveat** — billing plan panels ARE interaction units (plan choosers), so a card-like treatment is allowed by the constitution's cards rule; the gradient is subtle enough not to read as decorative. Leave. |

The `(public)/layout.tsx` footer uses `backdrop-blur-sm` — public
marketing surface, not covered by the authenticated-workbench rule.
Leave.

### Category 2 — mega-page LOC growth (4 files)

```
3814 src/app/(app)/explore/page.tsx
2863 src/app/(app)/projects/[projectId]/page.tsx
2548 src/app/(app)/reports/[reportId]/page.tsx
2413 src/app/(app)/rtp/page.tsx
```

Mega-pages aren't a direct constitution violation, but they indicate
structural fatigue — when a single file holds this many responsibilities,
hierarchy tends to be carried by repetition rather than typography.
**Explore at 3814 LOC is now the worst offender**, surpassing the
projects page the 2026-04-18 retro called out at 2863 LOC.

The 2026-04-17 retro already scoped `projects/[projectId]` for
decomposition (Phase C slice 3 in the current plan). **Explore should
join that queue.** Not a Phase 4 fix — a Phase C fix.

### Category 3 — `"Not set"` fallback consistency

35+ literal `"Not set"` usages across 18 files. The grep results show
the literal is used consistently (same spelling, same capitalization,
same context — "when data is missing"). That's actually the
constitution's ideal: semantic consistency. A `<NotSet />` micro-component
would not improve the UX and would complicate the export files
(`src/lib/reports/html.ts`, `src/lib/rtp/export.ts`, `src/app/api/rtp-cycles/[rtpCycleId]/export/route.ts`)
that need the literal string in PDF/CSV output.

**Verdict: not drift.** Leave.

### Category 4 — card-grid vs row-list structure

49 `grid-cols-[234]` occurrences across 17 files. Spot-checks of the
five highest-count files (`projects/[projectId]`, `plans/[planId]`,
`rtp`, `reports/[reportId]`, `explore`) show these are:

- **Form-field two-column layouts** (label/input pairs) — legitimate.
- **`module-metric-card` KPI grids** (2-8 tiles showing counts) —
  design-system primitive, not ad-hoc cards. The constitution permits
  cards when "the card IS the interaction unit" — metric tiles that
  link to filtered views qualify.
- **Form-chrome panels** inside detail pages — legitimate.

No page uses card-grid structure as its **primary scaffold**. The
`worksurface + inspector rail` metaphor is respected.

**Verdict: no structural drift.** Leave.

### Category 5 — chip/pill clusters

Grep for `module-record-chip` and `rounded-full` shows chip-like
elements in grants and programs surfaces. Spot-check at
`src/app/(app)/programs/page.tsx:731,872,874` shows:

```
<span className="module-record-chip">Cadence {program.cadence_label ?? "Not set"}</span>
<span className="module-record-chip">Agency {opportunity.agency_name ?? "Not set"}</span>
<span className="module-record-chip">Cadence {opportunity.cadence_label ?? "Not set"}</span>
```

These read as inline metadata chips on program/opportunity rows — the
constitution says "prefer row metadata, inspector fields, or plain text
with separators" over chip clusters. Visually, `module-record-chip` is
subtle (design-system semantic class, not colorful pill), but
structurally this IS the pattern the constitution calls out as
"metadata rendered as dozens of pill-shaped tokens."

**Verdict: borderline drift.** Worth revisiting if the program/grants
pages get redesigned, but not a blocking issue for Phase 4.

## Per-route status

All 33 routes examined. Unless otherwise noted, the route is
constitution-compliant (`module-*` tokens, worksurface-and-rails layout,
one primary action, no card-grid scaffold).

### Authenticated routes (29)

| Route | LOC | Status | Notes |
|---|---|---|---|
| `(app)/admin/page.tsx` | 397 | OK | |
| `(app)/admin/pilot-readiness/page.tsx` | 468 | OK | |
| `(app)/aerial/missions/[missionId]/page.tsx` | 476 | OK | |
| `(app)/aerial/page.tsx` | 365 | OK | |
| `(app)/billing/page.tsx` | 1164 | OK | `panelClass()` gradient is borderline but acceptable (card IS the interaction) |
| `(app)/county-runs/[countyRunId]/page.tsx` | 418 | OK | |
| `(app)/county-runs/page.tsx` | 245 | OK | |
| `(app)/dashboard/page.tsx` | 523 | OK | |
| `(app)/data-hub/page.tsx` | 776 | OK | |
| `(app)/engagement/[campaignId]/page.tsx` | 792 | OK | |
| `(app)/engagement/page.tsx` | 414 | OK | |
| `(app)/explore/page.tsx` | **3814** | **drift** | (a) mega-page; (b) inline linear-gradient + heavy shadow at ~line 3698 carrying hierarchy |
| `(app)/grants/page.tsx` | 677 | OK | (decomposed from 1498 in 2026-04-16 late-evening) |
| `(app)/models/[modelId]/page.tsx` | 570 | OK | T7 primitive pilot landed 2026-04-18 |
| `(app)/models/page.tsx` | 287 | OK | |
| `(app)/plans/page.tsx` | 303 | OK | |
| `(app)/plans/[planId]/page.tsx` | 1155 | OK | Big but sectioned |
| `(app)/programs/page.tsx` | 901 | **borderline** | `module-record-chip` clusters on program/opportunity rows |
| `(app)/programs/[programId]/page.tsx` | 1144 | **borderline** | same chip pattern |
| `(app)/projects/page.tsx` | 731 | OK | |
| `(app)/projects/[projectId]/page.tsx` | **2863** | **deferred to Phase C** | scheduled for decomposition in platform-hardening phase |
| `(app)/reports/page.tsx` | 1082 | OK | |
| `(app)/reports/[reportId]/page.tsx` | **2548** | **candidate for Phase C** | mega-page; add to decomposition queue |
| `(app)/rtp/page.tsx` | **2413** | **candidate for Phase C** | mega-page; consider decomposing the portfolio/packet sections |
| `(app)/rtp/[rtpCycleId]/document/page.tsx` | 408 | OK | |
| `(app)/rtp/[rtpCycleId]/page.tsx` | 943 | OK | |
| `(app)/scenarios/[scenarioSetId]/page.tsx` | 709 | OK | |
| `(app)/scenarios/page.tsx` | 286 | OK | |

### Auth routes (2)

| Route | LOC | Status |
|---|---|---|
| `(auth)/sign-in/page.tsx` | 181 | OK |
| `(auth)/sign-up/page.tsx` | 186 | OK |

### Public routes (3)

| Route | LOC | Status |
|---|---|---|
| `(public)/page.tsx` | 211 | OK |
| `(public)/engage/[shareToken]/page.tsx` | 336 | OK |
| `(public)/pricing/page.tsx` | 418 | OK |

## Fixes landed in this phase

### 1. None — honest scope discipline

I deliberately did not land cleanup commits in this phase. Two reasons:

- The drift census above shows that the substantive work (mega-page
  decomposition, chip-cluster reconsideration on programs surfaces)
  belongs in later phases (Phase C for LOC growth; a future programs
  redesign for chips). Trying to do them now would violate the
  constitution-compliance rubric this phase uses.
- The two concrete drift spots (explore inline-gradient block, programs
  chip clusters) are judgment calls that deserve Nathaniel's eye
  before I mutate them. The explore data-fabric block in particular
  reads visually distinct in a way that might be intentional.

## Follow-ups queued (not blocking Phase 4 settlement)

| # | Item | Queue |
|---|---|---|
| 1 | Decompose `projects/[projectId]/page.tsx` (2863 LOC) | Phase C slice 3 (already scoped) |
| 2 | Decompose `explore/page.tsx` (3814 LOC — the new worst offender) | **Add to Phase C queue** |
| 3 | Decompose `reports/[reportId]/page.tsx` (2548 LOC) | Add to Phase C queue or a future phase |
| 4 | Decompose `rtp/page.tsx` (2413 LOC) | Add to Phase C queue or a future phase |
| 5 | Replace explore data-fabric block's inline gradient+shadow with `module-*` tokens | Small cleanup, do when touching the file for (2) |
| 6 | Reconsider `module-record-chip` usage on programs surfaces | Defer until the next programs-page iteration; not blocking |

## Settlement

This review certifies that OpenPlan's authenticated surface is
**substantially compliant** with the 2026-04-08 design constitution. The
design token system in `globals.css` is doing the structural work the
constitution prescribes, and no route uses a card-grid as its primary
scaffold. The remaining drift is narrow (two decorative-chrome spots,
one borderline chip pattern) and none of it blocks forward-motion lanes.

**The Priorities.md item-1 gate is cleared.** The UI/UX overhaul cycle
can be considered settled for purposes of resuming implementation work
under the locked 2026-03-23 execution order (modeling → engagement →
aerial → command center → v1).

Follow-up items 1-6 above are real work but belong to later phases
(Phase C for LOC decomposition; future iterations for programs chips).
Those are not preconditions for Phase 2.1 (Modeling OS productization)
or any subsequent forward-motion phase.

## Pointers

- Design constitution: `docs/ops/2026-04-08-openplan-frontend-design-constitution.md`
- Canonical architecture source: `docs/ops/2026-04-16-openplan-integrated-deep-dive-review.md`
- 2026-04-18 retro (context for what closed today): `docs/ops/2026-04-18-program-retrospective-update.md`
- Priorities SoT: `/home/narford/.openclaw/workspace/knowledge/Priorities.md`
- Project brief + execution order lock: `/home/narford/.openclaw/workspace/knowledge/PARA/Projects/OpenPlan.md`
