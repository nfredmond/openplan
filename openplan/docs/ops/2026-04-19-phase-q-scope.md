---
title: Phase Q — NCTC 90% plan example (scope + session sequence)
date: 2026-04-19
decisions_doc: docs/ops/2026-04-19-phase-p-decisions-locked.md
phase: Q (scope)
anchor_agency: Nevada County Transportation Commission (NCTC)
artifact_source: data/screening-runs/nevada-county-runtime-norenumber-freeze-20260324/
---

# Phase Q — NCTC 90% plan example

Phase P decision #5 picked **Nevada County RTPA (NCTC)** as the anchor
agency for the "90% plan example" commercial-lane work. That decision
didn't define what the example *is*. This doc nails down scope, inventories
what's available vs. missing, and sequences the work into session-sized
slices so future sessions can start from a concrete brief instead of
re-deriving scope.

**No code shipped in this phase's first session.** This is a scoping doc.
The first engineering slice is Q.1, sequenced below.

## Disambiguation: what "90% plan example" actually means

The phrase could mean two very different things:

1. **Literal interpretation.** A real RTP at 90% completion for NCTC —
   chapters, project list, funding plan, public review packet, equity
   analysis — built on planning-grade data. This would require months of
   calibration work and an actual engagement with NCTC.
2. **Proof-of-capability interpretation.** A seeded demonstration plan
   showing what OpenPlan *produces* when an agency uses it for an RTP —
   using NCTC as the concrete geography so the example doesn't feel
   synthetic. Every screening-grade artifact is honestly labeled.

**Phase Q is interpretation #2.** Interpretation #1 is not feasible with
today's NCTC assets (see "Asset inventory" below) and would require a
commercial engagement we don't have. Priorities.md says "strong 90% plan
examples to send to potential clients as **proof-of-capability**
materials" — the phrasing already aligns with #2.

The honest one-line framing for outbound: *"Here's what OpenPlan produces
when a rural RTPA like Nevada County runs an RTP cycle through it,
grounded in real NCTC geography and a real screening-grade model run."*

## Asset inventory (what's already real)

### NCTC geography + modeling artifact (exists)

`data/screening-runs/nevada-county-runtime-norenumber-freeze-20260324/`:

- `bundle_manifest.json` — 973.8 sq mi, 26 tract-fragment zones, 102,322
  population, 45,064 worker residents, 48,252 estimated jobs.
- `run_output/link_volumes.csv` — 4,829 loaded links from AequilibraE
  assignment (final gap 0.0095 at 50 iterations).
- `run_output/loaded_links.geojson` + `top_loaded_links.geojson` — real
  geometry ready for map rendering.
- `validation/validation_report.md` + `validation_summary.json` — Caltrans
  2023 priority AADT validation (5 matched stations, median APE 27.4%,
  max APE 237.6%, Spearman rho 0.40).

### Honesty gates already embedded

The artifact declares itself `screening_grade: true` and
`validation.status_label: "internal prototype only"`. The caveat list
ships inside the manifest:

> - screening-grade only
> - OSM default speeds/capacities
> - tract fragments are not calibrated TAZs
> - jobs are estimated from tract-scale demographic proxies
> - external gateways are inferred from major boundary-crossing roads

Good. Means the example can disclose everything truthfully without having
to invent disclosures.

### UI surfaces that *could* render NCTC evidence (exist but not wired)

`src/app/(app)/county-runs/page.tsx` is the geography-first staging
surface. The `county_runs` table has `manifest_json`,
`validation_summary_json`, and stage columns. Staging works end-to-end;
execution does not. Per `docs/ops/2026-04-18-modeling-nevada-county-live-proof.md`:

> Wiring that bridge requires either (a) a modeling worker service that
> ingests `county_runs.manifest_json` and emits the screening-run
> artifact directory, or (b) **an import path from the artifact directory
> back into `county_runs.manifest_json` for read-only evidence
> surfacing. Option (b) is much cheaper.**

That import route is the natural Q.1 slice.

## Gaps (what a real proof-of-capability packet still needs)

| Gap | Shape | Session estimate |
|---|---|---|
| No way to land the existing NCTC screening artifact into `county_runs` for UI surfacing | Single POST route: read local artifact directory → write structured fields into `manifest_json` + `validation_summary_json` | 1 session (Q.1) |
| No seeded NCTC workspace / project / RTP cycle bound to the county-run | Seed script + linked `projects.county_run_id` or equivalent; RTP cycle scaffolded with NCTC framing | 1 session (Q.2) |
| No authored narrative — the example packet has no words, just numbers | One chapter authored as a static MDX or seeded report with honest "proof-of-capability" framing and screening-grade disclosures in every load-bearing claim | 1 session (Q.3) |
| No outbound-ready one-pager / PDF that links the demo to a client-sendable summary | Commercial-lane work: copy, design, PDF build. Not code. | 1 session (Q.4) — non-code |
| No demo-mode toggle (if the example should be visible to unauthenticated visitors) | Optional route-group or read-only link-share. Open design question. | Decision, not session |

## Session sequence (Q.1 – Q.4)

Ordered smallest→largest, each session standalone and testable.

### Q.1 — Import NCTC screening artifact into `county_runs`

Scope:

- New POST route `/api/county-runs/[countyRunId]/import-artifact` that
  accepts a local artifact directory path, reads
  `bundle_manifest.json` + `validation/validation_summary.json` +
  `validation/validation_report.md`, and writes:
  - `manifest_json` — bundle manifest verbatim
  - `validation_summary_json` — validation summary verbatim
  - stage → appropriate advance (bootstrap-complete /
    runtime-complete / validation-scaffolded / validated-screening
    based on what's present)
  - audit events on success + lookup failures
- Auth: same pattern as Phase O.2 ingest (401/404/403 on
  user/county_run/membership).
- Quota: same pattern (402/500/429).
- Tests: 401/404/403/402/429 + 200 happy path ingesting a fixture
  artifact.
- Proof doc.

Exit criteria: the existing NCTC artifact can be surfaced on
`/county-runs/[countyRunId]` through a normal POST from a seeded
workspace, and every disclosure in the manifest renders verbatim in the
UI. No synthetic data introduced.

### Q.2 — Seed an NCTC workspace + project + RTP cycle

Scope:

- New seed script under `scripts/` (or a supabase migration with fixed
  UUIDs, per existing patterns) that creates:
  - One workspace "Nevada County Transportation Commission (demo)" with
    pilot subscription_status.
  - One project "NCTC 2045 RTP (proof-of-capability)" linked to the
    Q.1-imported `county_runs` row.
  - One RTP cycle bound to that project.
  - Explicit demo-marker field (e.g., `is_demo=true`) on the workspace
    so it's never mistaken for real client data in observability /
    billing paths.
- Tests: seed idempotence + that the demo-marker is honored wherever
  billing or outbound paths check for production workspaces.
- Proof doc.

Exit criteria: after a `supabase db reset` + `pnpm seed:nctc`, an
operator can sign in (or an assistant can load the workspace by URL)
and see a real NCTC-geography RTP cycle with screening-grade evidence
attached.

### Q.3 — Author one chapter with honest disclosures

Scope:

- Pick one RTP chapter that's high-signal and tractable on screening
  data (recommendation: "Existing Conditions / Travel Patterns" — it's
  what loaded-link volumes + validation naturally support).
- Author the chapter as either (a) seeded rows in the existing reports /
  packet tables, or (b) a static MDX page keyed off the seeded project.
  Pick (a) if it can be done without schema changes; (b) otherwise.
- Every numeric claim carries a disclosure phrase — not a separate
  footnote, but inline alongside the figure ("27% median APE against
  Caltrans 2023 priority counts — screening-grade posture only").
- Tests: chapter renders from seeded data; screening-grade caveats
  render wherever assignment volumes are shown.
- Proof doc.

Exit criteria: a reviewer reading only this one chapter can tell
(i) what OpenPlan produces, (ii) what the data says, (iii) what
caveats apply, without having to click anything outside the page.

### Q.4 — Outbound one-pager / PDF (commercial lane, not code)

Scope:

- One-pager PDF or rendered page suitable for sending to a prospective
  small-agency client: "What OpenPlan produces for an RTPA like yours."
- Links to the Q.1–Q.3 demo surface. Not self-contained — the point is
  to get a client to click through to the live example.
- Respects the Nat Ford covenant language on AI disclosure, fairness,
  and vulnerable-community protection.

Exit criteria: Nathaniel (or Claire) can send the one-pager in cold
outreach without any copy-edits.

This session is **commercial-lane, not engineering**. It does not need
a code diff, tests, or a build step. The proof doc is a short note
linking the PDF + the demo URL.

## What Phase Q explicitly will NOT do

- **Run the Python modeling pipeline from the app.** The existing NCTC
  artifact is used as-is. Python execution from `/county-runs` is a
  separate modeling-worker phase (see `2026-04-18-modeling-os-runtime-design.md`).
- **Pretend the model is planning-grade.** Max APE of 237.6% on one
  Caltrans station means this cannot claim facility-level accuracy.
  Every surface that renders assignment volumes must show the
  screening-grade gate.
- **Claim NCTC is a customer.** "Demo anchored in NCTC geography" is the
  honest framing. NCTC has not endorsed, paid for, or reviewed the
  example. Outbound materials must not imply otherwise.
- **Build a tribal-partner anchor.** That was Phase P option 4 and was
  explicitly deferred because it needs permission and is not a
  one-session decision.
- **Replace the 90% plan example with a generic multi-agency demo.** The
  point of picking NCTC is the concrete-geography signal. Genericizing
  loses the pitch.

## Open decisions for Nathaniel (before Q.2 starts)

These do not block Q.1. They do block Q.2+.

1. **Demo workspace visibility.** Should the seeded NCTC demo workspace
   be (a) accessible only to signed-in internal users, (b) accessible
   via an unauthenticated share link, or (c) a full public route group?
   - Default recommendation: (b). Matches "send to prospects" intent
     without exposing workspace-level billing plumbing to arbitrary
     visitors.
2. **Chapter pick for Q.3.** Existing Conditions / Travel Patterns is
   the recommended chapter (most data support). Confirm or pick a
   different one.
3. **Outbound framing sign-off.** The one-line framing in this doc —
   *"what OpenPlan produces when a rural RTPA like Nevada County runs
   an RTP cycle through it"* — is the honest pitch. Confirm or rewrite.
4. **Q.4 format.** PDF one-pager, marketing landing page, or both?
   Affects whether Q.4 is design-only or design + frontend.

## Writer/reader census + covenant check

- **Writer/reader:** this phase does not introduce new cached-column
  writer/reader pairs. Q.1 adds a writer (artifact import) and a reader
  (county-run page already surfaces `manifest_json`) — symmetrical.
- **Covenant check:**
  - Truth without spin → every screening-grade disclosure ships as
    first-class data in the UI, not as a footnote.
  - Fair exchange → outbound materials must carry Nat Ford covenant
    pricing language, not a race-to-the-bottom pitch.
  - Protect vulnerable communities → NCTC is rural + under-resourced;
    the example must not frame that as a deficit.
  - AI disclosure → any AI-generated chapter copy carries the covenant
    disclosure template.
  - Accountability → all example artifacts are reproducible from the
    seed script + the existing screening artifact. No hand-edited
    numbers.

## Verification

This session produces no code. Verification is:

- Nathaniel (or a reviewer) reads this doc and can answer the open
  decisions above.
- A future agent session opens this doc + the Q.1 section and can
  start implementation without re-deriving scope.

## Pointers

- Phase P decision: `docs/ops/2026-04-19-phase-p-decisions-locked.md`
  (decision #5)
- Option analysis: `docs/ops/2026-04-19-phase-p-design-decision-pack.md`
  (section 5)
- Modeling honesty anchor: `docs/ops/2026-04-18-modeling-nevada-county-live-proof.md`
- Modeling runtime design (future Python-execution phase):
  `docs/ops/2026-04-18-modeling-os-runtime-design.md`
- Priorities source: `knowledge/Priorities.md` (lines 9, 31)
- NCTC artifact root:
  `data/screening-runs/nevada-county-runtime-norenumber-freeze-20260324/`
- County-run UI:
  `src/app/(app)/county-runs/page.tsx`
  `src/app/(app)/county-runs/[countyRunId]/page.tsx`
