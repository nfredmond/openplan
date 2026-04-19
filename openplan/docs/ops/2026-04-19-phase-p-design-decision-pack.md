---
title: Phase P design decision pack — 5 Nathaniel-only asks
date: 2026-04-19
audience: Nathaniel
purpose: unblock Phases O, Q, S, R.1 + the T16 escalation with one sitting of design calls
---

# Phase P design decision pack

Five decisions gate everything design-flavored in OpenPlan right now. None of them is a coding question — each needs a judgment call only you can make. Nothing else in the codebase is meaningfully unblockable until these land.

The 18-ticket integration-discipline program is at **Live 16/18, Unit-only 1/18, Deferred 1/18** (`docs/ops/2026-04-18-program-retrospective-update.md`). Phase C mega-page decomposition shipped in full (C.1/C.2-slice-1/C.3/C.4). The next phases — O (quota closure), Q (90% plan examples), S (T16 reader + posture bodies), R.1 (Phase-4 drift cleanups) — all queue behind your answers here.

Each section below has the same shape: *the ask*, *what it unblocks*, *what we know*, *options*, *if unanswered*. Skim, answer in whichever order you like, hand any single answer back to an agent and the corresponding engineering slice starts immediately.

---

## 1. T16 reader-surface pick

### The ask

Which reader surface should `loadBehavioralOnrampKpisForWorkspace()` enforce the caveat gate on?

### What it unblocks

- Phase S (partial) — T16 caveat-gate wiring, the sole deferred ticket in the 18-ticket program.
- First visible surface for behavioral-onramp / county-run KPIs.

### What we know

Writer side is alive:
- `POST /api/county-runs/[countyRunId]/manifest/route.ts:188` writes `model_run_kpis` rows with `kpi_category='behavioral_onramp'` on manifest upload.

Reader side is dead:
- `loadBehavioralOnrampKpisForWorkspace()` at `src/lib/models/behavioral-onramp-kpis.ts:191` is the only function that routes these rows through `partitionScreeningGradeRows`. It has **zero** production callers (only three test call sites).
- The existing kpis route `GET /api/models/[modelId]/runs/[modelRunId]/kpis/route.ts:139–144` filters by `run_id=<modelRunId>` and behavioral-onramp rows have `run_id=NULL`, so that route never sees them.

Net: the gate is correct, 100% unit-tested, and unreachable. Every manifest upload populates `model_run_kpis` rows that nothing ever reads. Full audit: `docs/ops/2026-04-16-caveat-gate-audit.md`.

### Options

1. **County-run detail page.** A new or extended reader on the county-run detail route (the natural home, given the manifest upload lives there). Most work, most honest result — behavioral KPIs surface where the county-run lives.
2. **Model detail evidence panel.** Add a behavioral-onramp section to the existing model-run evidence surface. Less new UI, but couples screening-grade KPIs into the planning-grade model view, which is the exact bleed the gate was written to prevent.
3. **Workspace-level ops dashboard card.** Single workspace-scoped card that always routes through the gate. Lowest surface-area answer; also lowest planner utility.

### If unanswered

T16 stays the sole deferred ticket. Every county-run manifest keeps writing rows that never get read. The gate remains a well-tested helper with no production job.

---

## 2. `rtp_posture` body content

### The ask

What copy + gradient treatment should render for the **body** of the project RTP posture on the RTP cycle detail page? (Timestamp renders; body doesn't.)

### What it unblocks

- Phase S (partial) — RTP posture reader surfacing.
- Closes writer/reader census case #3 in `docs/ops/2026-04-18-program-retrospective-update.md`.

### What we know

`projects.rtp_posture` is written by `src/lib/projects/rtp-posture-writeback.ts` on funding-award creation, invoice status change, closeout, and report-generation paths. Write is alive and live-proven (`docs/ops/2026-04-16-writeback-loop-api-proof.md` + `docs/ops/2026-04-17-funding-award-closeout-proof.md`).

Only one reader consumes the column today: `src/app/(app)/rtp/[rtpCycleId]/page.tsx:826–828` renders `Posture cached {formatRtpDateTime(project.rtp_posture_updated_at)}` — timestamp only. The body (reimbursement status, remaining funding gap, committed amount, reason phrase from the write-back) is not rendered anywhere.

Example live body (from 2026-04-17 closeout proof):
```json
{
  "reimbursementStatus": "paid",
  "reimbursementReason": "Linked award invoices marked paid now match or exceed the committed award total.",
  "remainingFundingGap": 0,
  "committedFundingAmount": 250000
}
```

### Options

1. **Compact inline summary** on the cycle detail row — one line: "Committed $X · remaining gap $Y · reimbursement *<status>*". Minimal pixels, reads at a glance.
2. **Expandable posture block** per project — click/hover reveals status, reason, committed, gap, and the cached timestamp. Most information, more UI weight.
3. **Dedicated posture column** in the portfolio table — `status / gap` as a single cell, sortable. Best scan/compare, but the portfolio rows are already dense.

Gradient treatment open question: does posture get the planning-grade calm gradient used on most cycle surfaces, a warm-alert gradient when `remainingFundingGap > 0`, or stays monochrome? The frontend design constitution prefers calm density — a warning gradient would be a deliberate departure.

### If unanswered

Phase S writer/reader census case #3 stays open. Closeouts, write-backs, and reimbursements keep updating a column nobody sees. Any Phase-4 drift audit of RTP posture surfaces will hit this same unanswered-question wall.

---

## 3. `aerial_posture` body content

### The ask

Same pattern as #2: what copy + gradient treatment should render for the **body** of `projects.aerial_posture`?

### What it unblocks

- Phase S (partial) — aerial-posture reader surfacing.
- Closes writer/reader census case #4 in the 2026-04-18 retro update.

### What we know

`projects.aerial_posture` is written by `src/lib/aerial/posture-writeback.ts` on aerial evidence-package mutations. Write is alive and live-proven (`docs/ops/2026-04-16-aerial-evidence-package-proof.md`).

The mission detail page currently **bypasses** the column by recomputing posture inline at render time — faster to ship, but it means every read of the column by a future surface is free floating, and the mission page won't benefit from a change unless that recompute is removed.

Two fields that most obviously carry planner-facing meaning: latest-capture posture (age of the newest evidence package) and deliverable-readiness (whether the project has a complete-enough evidence set for a client-facing bundle).

### Options

1. **Compact inline on project detail** — similar shape to #2 Option 1: "Evidence captured *<age>* · deliverables *<ready/incomplete>*".
2. **Dedicated aerial posture card** on the project detail page — full status, reason, latest-capture timestamp, deliverable-readiness, and next-capture suggestion. Heaviest.
3. **Aerial-posture row inside a unified "project posture" section** — pair with #2 so RTP posture and aerial posture share real estate, consistent left-rail treatment. Best parallelism, highest design upfront cost.

Open question: should the mission page be rewired to **read** from `aerial_posture` instead of recomputing? If #3 above, probably yes (single source of truth). If #1 or #2, the mission page bypass can stay.

### If unanswered

Phase S writer/reader census case #4 stays open. `aerial_posture` keeps drifting from whatever the mission page recomputes inline; drift surfaces first when a new reader is added and the two disagree.

---

## 4. Quota asymmetry — scope + weight

### The ask

Two sub-questions, one section (both have to answer for Phase O to kick off):

- **4a. Quota scope.** Should `checkMonthlyRunQuota` stay per-workspace, or split per-project?
- **4b. Quota weight.** Should all consumption types count equally, or are model-run-launches weighted more than analysis runs?

### What it unblocks

- Phase O — Quota asymmetry closure. Mechanical wiring across the 77 uncovered endpoints once 4a and 4b land.

### What we know

- `checkMonthlyRunQuota` currently has **2 callers** (`/api/analysis`, `/api/models/[modelId]/runs/[modelRunId]/launch`). **2/79 routes** enforce the quota gate. Phase N audit (`docs/ops/2026-04-18-phase-n-legal-pages-proof.md:16`) and Phase P (`docs/ops/2026-04-18-phase-p-error-boundaries-proof.md:129`) both restated this.
- The 77 uncovered endpoints span reports, engagement APIs, projects, grants, modeling, and aerial. No design-gated carve-outs; just unwired.
- Workspace-scoped quota is the current behavior. Per-project would require extending the function signature and updating the 2 current callers.
- Weight is currently uniform — a 5-minute AequilibraE model-run launch and a 30-second screening-grade analysis both consume 1 unit.

### Options

**4a — quota scope:**
1. **Stay per-workspace.** Simplest, matches current behavior. May unfairly cap a larger agency running 3 concurrent RTPs in the same workspace.
2. **Split per-project.** More realistic for agencies with multiple parallel RTPs but requires schema + function-signature changes and a UI change (quota readout appears in the dashboard).
3. **Per-workspace with per-project soft warnings.** Hybrid — hard ceiling stays at workspace, but per-project consumption is tracked and exposed so one project dominating the quota is visible. Most user-info, most code.

**4b — quota weight:**
1. **Uniform (current).** Easiest to reason about. Undercounts the cost of model-run launches (compute-heavy) and overcounts lightweight analysis.
2. **Binary weight.** Model-run launches count as N units (configurable, maybe 5 or 10); everything else counts as 1. Simple, honest, deploy-ready.
3. **Per-endpoint tunable weight.** Every endpoint declares its weight in a shared map. Most fair, most config surface, most drift-prone.

### If unanswered

Phase O stays gated. The 77 uncovered endpoints keep shipping without quota enforcement — an integrity risk if any of them get hit at high frequency by a misconfigured pilot or automated caller. No user-facing bug today; a latent failure mode.

---

## 5. 90% plan example — agency/RTPA pick

### The ask

Which agency or RTPA should anchor the "plans at 90%" showcase?

### What it unblocks

- Phase Q — 90% plan examples.
- Priorities.md `Now (this week)` item 4 ("Build strong 90% plan examples to send to potential clients as proof-of-capability materials").
- Priorities.md `Next (2-4 weeks)` item 2 ("Package 90% plan examples into repeatable outbound-ready materials for agencies and consulting prospects").
- The outbound-materials lane in the OpenPlan commercial roadmap.

### What we know

This is a commercial-lane decision, not a code-shape decision. The pick drives:
- Which agency's GTFS feed, census tracts, and LODES data get loaded as the demo dataset.
- Which real project list gets modeled into the example RTP.
- Which equity and compliance framing the example showcases (rural vs. suburban vs. tribal vs. metro).
- Which client you imagine receiving the packet.

OpenPlan's reference-point geography per `/home/narford/CLAUDE.md`: Northern California, Grass Valley, Nevada County, rural agencies, RTPAs, small cities, counties, tribes, under-resourced communities.

### Options

1. **Nevada County RTPA (NCTC).** Strong local connection. Pilot work already exists (`openplan/data/screening-runs/nevada-county-runtime-norenumber-freeze-20260324/`). Rural, under-resourced — aligns with the covenant framing. Risk: local-only signal may not generalize to other agency pitches.
2. **A sister rural RTPA (e.g., Placer County, El Dorado County, Butte CAG).** Preserves rural-RTPA framing without tipping your hand on the Nevada County relationship. Requires a fresh data load.
3. **A small urban city MPO sub-element.** (e.g., a small SACOG member agency or a Grass Valley / Truckee / Auburn sub-element.) Shows the product works for municipal planning, not just regional planning. Widest demo audience but weakest pitch to the RTPA segment.
4. **Tribal partner anchor.** Strongest covenant alignment — protects a disadvantaged community and demonstrates the product's fit for under-resourced tribal planning. Requires explicit permission from the tribe; likely not a one-session decision.

### If unanswered

Phase Q stays gated. Outbound materials stall. Commercial roadmap can advance on strategy but not on concrete example packets. Week-level revenue goals in Priorities.md `Now` drift without this.

---

## Execution sequence if all five answered today

Ordered by *next-session unblock cost* (smallest first):

1. **#4 quota (4a + 4b)** → Phase O. Mechanical wiring across 77 endpoints. ~1 full session once answers land.
2. **#1 T16 reader pick** → Phase S.1 (caveat-gate wiring). New reader surface + gate wiring. ~1 session if Option 3 (workspace card), ~2 sessions if Option 1 (county-run detail page).
3. **#2 + #3 posture bodies** → Phase S.2 and S.3. Probably shipped together if Option 3 on #3 ("unified project posture section"). ~1 session.
4. **#5 agency pick** → Phase Q. Data load + packet authoring + outbound-materials drafting. Spans multiple sessions and involves commercial-lane work beyond engineering.

Any single answer is enough to kick off the corresponding phase. No ordering dependency between the five.

---

## Pointers

- Ledger: `docs/ops/2026-04-18-program-retrospective-update.md`
- T16 audit: `docs/ops/2026-04-16-caveat-gate-audit.md`
- Writer/reader census: `docs/ops/2026-04-18-program-retrospective-update.md` (section "Updated 'writer wired, reader dead' census")
- Quota evidence: `docs/ops/2026-04-18-phase-p-error-boundaries-proof.md:129–147`
- Phase C completion docs:
  - `docs/ops/2026-04-18-phase-c1-projects-detail-decomposition-proof.md`
  - `docs/ops/2026-04-18-phase-c2-explore-decomposition-proof.md`
  - `docs/ops/2026-04-18-phase-c3-reports-detail-decomposition-proof.md`
  - `docs/ops/2026-04-18-phase-c4-rtp-registry-decomposition-proof.md`
- Priorities source: `knowledge/Priorities.md`
- OpenPlan project brief: `knowledge/PARA/Projects/OpenPlan.md`
