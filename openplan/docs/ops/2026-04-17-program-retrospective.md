---
title: OpenPlan 2026-04-16 18-ticket program — retrospective
date: 2026-04-17
head_sha: 41f344b
program_doc: docs/ops/2026-04-16-openplan-integrated-deep-dive-review.md
cold_start_for: future-me, teammates, and reviewers re-entering OpenPlan
---

# 2026-04-16 18-ticket program — retrospective

## The program in one paragraph

A single-day, 18-ticket build sprint across RTP OS, Grants OS,
Modeling OS, Aerial Ops, Runtime, and UX. Motivating diagnosis: writes
land but reads don't update — the "write-back loop" is broken in
several places (grants → RTP posture, aerial → project posture,
model-run → report staleness), and surface-level code bloat has
outpaced the design constitution (`grants/page.tsx` 1600+ LOC,
dashboard as a single component). The program was conceived as a
cross-lane integration reset, not a feature push.

## Integration-discipline verdict

**Pass with caveats.** The code landed. The binding constraint moved
from "what's in the codebase" to "what's proven to actually work when
a user drives it." That's the right constraint to live under going
forward — but it means the 2026-04-16 push would have been stronger
had evidence-generation been scheduled *during* the sprint instead of
retrofitted 24 hours later.

Caveats worth naming:

1. **Unit tests alone were not enough.** Every ticket shipped with
   vitest coverage, and every ticket's mocks were more optimistic than
   the live DB turned out to be (counts-drift, aerial field drift,
   redirect-mock typing). The 68-error tsc wake-up call on 2026-04-17
   (Slice 1) was the direct consequence.
2. **Env hygiene was quietly broken.** `.env.local` had been populated
   from `vercel env pull`, i.e. production credentials. `pnpm dev`
   against a fresh checkout would have hit prod. Not caught by any
   test. Fixed on 2026-04-16 evening; backup retired 2026-04-17.
3. **"Landed" ≠ "exercised."** The Slice 4 audit (caveat gate, T16)
   surfaced a pattern the program did not anticipate: the writer path
   is wired in production, the gate-protected reader path is called
   only by tests. The gate is correct, tested, and unreachable. See
   *Surprise findings* below.

## Ticket-by-ticket status as of 41f344b

Evidence levels used below:
- **live** = exercised against real local Supabase with a real session + SSR/API fetch, documented in an ops doc.
- **unit** = vitest coverage against mocks; no live exercise yet.
- **audit** = read the code path end-to-end; no runtime exercise.

| Deep-dive ticket | Status | Evidence doc |
| --- | --- | --- |
| T1 RTP packet lifecycle (create → generate → re-ground) | **live** for create; unit for generate & re-ground | `2026-04-16-rtp-cycle-and-packet-lifecycle-proof.md` |
| T2 Unified packet freshness labels (`packet-labels.ts`) | unit | — |
| T3 `rtp_basis_stale` column + stale-mark on model_run completion | unit | — |
| T4 Scenario report write-back | unit | — |
| T5–T6 (RTP) | unit | — |
| T7 `worksurface + rail + inspector` primitives | **live** indirectly (used on aerial mission detail page) | via `2026-04-16-aerial-evidence-package-proof.md` |
| T8 (RTP posture surfacing) | **live** | `2026-04-16-writeback-loop-live-render-proof.md` |
| T9 Aerial evidence-package write-back | **live** | `2026-04-16-aerial-evidence-package-proof.md` |
| T10 `grants/page.tsx` decomposition | unit + live (grants page still 200s) | render covered in writeback-live-render-proof |
| T11 `projects.rtp_posture` + grants → RTP write-back | **live** | `2026-04-16-writeback-loop-api-proof.md` + render proof |
| T12 `project_milestones` on award creation | **live** | API proof |
| T13 `/api/funding-awards/[awardId]/closeout` | unit (no live proof yet) | — |
| T14–T15 (UX harmonization) | **live** (re-render showed consistent status badges) | render proof by side-effect |
| T16 Caveat gate (hard refusal of screening-grade) | **audit** → escalated | `2026-04-16-caveat-gate-audit.md` |
| T17 Regrounding-depth guard (MAX_REGROUNDING_DEPTH=2) | unit | — |
| T18 Dashboard decomposition | **live** (dashboard still 200s post-split) | render proof |

Take-home: 7 of 18 tickets have live proof, 10 of 18 are unit-only, 1
is audited-and-escalated. That's an improvement from 0/18 at 2026-04-16
EOD but a long way from "everything shipped is exercised."

## What closed; what deferred

**Closed with live evidence (2026-04-17 push):**
- Grants write-back API + UI render loop (T8/T10/T11/T12).
- RTP cycle detail page reads the write-back result.
- RTP packet create through `/api/reports`.
- Aerial evidence-package write-back + mission detail render.
- Env-file hygiene (three-file layout, backup retired).
- 68-error tsc drift → 0 errors.

**Deferred (unit-only, no live proof yet):**
- Packet *generate* + *re-ground* (only create is live-proven).
- Funding-award closeout (`T13`).
- Scenario report write-back (`T4`) — stale-mark + reason.
- Regrounding-depth guard (`T17`).

**Escalated as design work:**
- Caveat gate (`T16`). See `2026-04-16-caveat-gate-audit.md` for
  options. The wiring target (which reader surface consumes the gate)
  is the open question.

## Surprise findings

### 1. The "writer wired, reader dead" pattern

The caveat gate audit exposed a pattern that may repeat elsewhere:
code gets landed with *writer* coverage (API routes that mutate state)
but the corresponding *reader* is test-only or missing. In the caveat
gate case:

- `persistBehavioralOnrampKpis()` is called from
  `/api/county-runs/[countyRunId]/manifest/route.ts` — writer is alive.
- `loadBehavioralOnrampKpisForWorkspace()` — the only gate-enforcing
  reader — has zero production callers.

A similar pattern may exist for T3 (`rtp_basis_stale`) and T4
(scenario write-back). The stale-mark helpers write the column, but
does any reader filter by it? This should be grepped before those
tickets are marked live.

**Action item (for future slice):** inventory every stale-mark column
added by T3/T4 and trace at least one reader per column before calling
them integrated.

**Update 2026-04-17:** done. See
`2026-04-17-stale-mark-reader-audit.md` — T3/T4 are fully integrated
(writer in 3 model-run + scenario API routes; reader renders
`rtp_basis_stale` banner in `/reports/[reportId]/page.tsx`). T16
remains the only outstanding reader-dead case.

**Update 2026-04-17 (correction):** the previous update was
partially wrong. The stale-mark audit looked at `page.tsx` but missed
that RTP-linked reports delegate to
`src/components/reports/rtp-report-detail.tsx`, which had its own
`#packet-release-review` article **without** the stale banner. So for
every RTP packet (the common case), T4's writer was live but the
reader was dead. See `2026-04-17-scenario-writeback-proof.md` for the
live proof + fix that closed it. The "writer wired, reader dead"
pattern is now 2-for-2 (T16 still open, T4-on-RTP closed).

### 2. TS type-drift is a leading indicator, not noise

The 68-error tsc drift on 2026-04-17 looked like test hygiene. In
practice, every error was a fixture that still matched the *pre-T9*
shape of `WorkspaceOperationsSummary` — i.e. a concrete sign that
T9 (aerial fields) had been added to the canonical type but the
fixtures in 27 test files had not followed. That's a mild version of
the writer/reader drift in finding 1: the type was updated, but
consumers weren't.

Useful rule-of-thumb: if tsc is red, look for additions to core
types/interfaces and trace every consumer before declaring cleanup
done.

### 3. Mocked tests and live proofs are different kinds of evidence

The live-render proof for the grants write-back loop exposed no bugs
this time, but the *exercise* of writing it flagged that three surfaces
(`/projects`, `/grants`, `/dashboard`) all had to independently pick up
the same posture field. A single Supabase view or shared repository
would make this structural rather than by-convention. Candidate
follow-up: a `getProjectPosture(projectId, workspaceId)` repository
function that every SSR page calls, instead of each page building its
own `.select(...)`.

## What's on deck

Copied from the Slice 5 plan, lightly edited:

- **Grants OS application-status states.** Add `under_review`,
  `denied`, `awarded` to `funding_opportunities.decision_state`. Wire
  state transitions into the decision UI. ~4–8h.
- **T7 primitive pilot.** Pick one bulky page (candidates:
  `county-runs`, `models`, dashboard widget group) and migrate it onto
  `worksurface.tsx` + `inspector.tsx` + `data-table.tsx`. Validates
  the design constitution is land-able. ~full day.
- **Stale-mark reader audit.** Follow up on finding #1: inventory
  `rtp_basis_stale` and scenario-writeback stale-marks, confirm at
  least one reader per column.
- **Caveat gate wiring (blocked on design call).** When a county-run
  KPI reader surface is spec'd, wire `loadBehavioralOnrampKpisForWorkspace`
  into it from day one.
- **Live-proof the deferred tickets.** T13 closeout, T4 scenario
  write-back stale-mark, T17 regrounding-depth guard, T1 packet
  generate + re-ground.
- **Browser-GIF of the write-back loop.** Environmental blocker
  (Chrome extension pairing), not code. When that clears, add a GIF
  artifact to the live-render proof doc.
- **Teammate prod-audit.** `workspaces.updated_at` /
  `projects.updated_at` spot-check for writes that might have come
  from teammates who ran `pnpm dev` against the pre-hygiene `.env.local`.
  Requires Nathaniel's explicit go-ahead.

## What *not* to do next

- **Don't open new product lanes** (new Modeling OS features, new
  Engagement work, new Aerial Ops schema) until T4/T13/T17 have live
  proofs and the stale-mark reader audit completes. The binding
  constraint is still integration discipline.
- **Don't wire the caveat gate without a reader surface spec.** The
  audit is explicit about this: the wiring target is a design call.
- **Don't rely on mocked vitest alone for close-the-loop work.** The
  2026-04-17 drift was the cost of that habit; don't repeat it.

## Pointers

- Program definition:
  `docs/ops/2026-04-16-openplan-integrated-deep-dive-review.md`.
- This session's slice plan:
  `~/.claude/plans/eager-munching-spark.md` (local, not checked in).
- The six 2026-04-16 ops docs in `docs/ops/` are the primary
  evidence for the integration claims above.

## Commit trail (2026-04-17 program follow-up)

```
41f344b docs: note .env.local.backup removal after three-file layout exercised
06f2419 docs: caveat gate (T16) audit — defined + tested, not reachable via reader
d95e1b5 docs: live-render proof of aerial evidence-package posture write-back (T9)
33d49fa docs: live-render proof of RTP cycle posture + packet lifecycle (T1 + T17)
c5a656f test: align mock fixtures with post-aerial WorkspaceOperationsSummary shape
1e90e98 docs: live-render proof of write-back loop (T10, T11/T12/T13, T18)
c7039c5 docs: openplan env-file hygiene — split prod creds out of .env.local
fa3e884 docs: api-proof of grant-award -> rtp_posture write-back loop (T11/T12/T13)
```
