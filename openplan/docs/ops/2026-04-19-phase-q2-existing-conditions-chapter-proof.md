---
title: Phase Q.2 — NCTC demo Existing Conditions chapter
date: 2026-04-19
decisions_doc: docs/ops/2026-04-19-phase-p-decisions-locked.md
scope_doc: docs/ops/2026-04-19-phase-q-scope.md
prior_slice: docs/ops/2026-04-19-phase-q1-nctc-demo-seed-proof.md
phase: Q.2
---

# Phase Q.2 — NCTC demo Existing Conditions chapter

Second engineering slice of Phase Q. Adds an "Existing conditions and
travel patterns" chapter (`chapter_key = existing_conditions_travel_patterns`)
to the NCTC demo RTP cycle seeded in Q.1. The chapter body is composed
directly from the bundle manifest and validation summary — no hand-typed
numbers — so every figure traces back to the frozen screening run.

## Why this chapter, and why this way

The scope doc's Q.2 target was to author the chapter the NCTC artifact
most honestly supports. Existing conditions + travel patterns was the
pick because the assets already exist in verifiable form (demographics,
demand totals, network stats, validation against five Caltrans priority
stations). Other chapters — project portfolio, financial element,
engagement — would require assets we don't have.

The 2026-04-09 `rtp_cycle_chapters` migration auto-seeds seven standard
chapters per RTP cycle. **None of them is "existing conditions."** The
two options:

- **Option A** — update the default-template migration to add an 8th
  chapter for every future workspace. Wrong: changes production tenant
  defaults to serve one demo.
- **Option B** — seed an 8th chapter only for the NCTC demo cycle,
  upserted alongside the Q.1 seed records.

Shipped Option B. The chapter lives only on the demo cycle; the default
template migration is unchanged.

## What this slice ships

### `scripts/seed-nctc-demo.ts`

Extensions on top of Q.1:

- New deterministic UUID `DEMO_EXISTING_CONDITIONS_CHAPTER_ID` and
  constants for `chapter_key` + `title`.
- New exported pure function
  `buildExistingConditionsChapterMarkdown(bundleManifest, validationSummary): string`
  that composes the chapter body. Values come from:
  - `boundary.label`, `boundary.source_path`, `boundary.area_sq_mi`, `boundary.bbox`
  - `zones.total_population` / `.total_households` / `.total_worker_residents` / `.total_jobs_est` / `.zones` / `.zone_type`
  - `demand.hbw_trips` / `.hbo_trips` / `.nhb_trips` / `.external_trips` / `.total_trips`
  - `assignment.network.links` / `.nodes` / `.zones`, `assignment.loaded_links`, `assignment.convergence.final_gap` / `.target_gap` / `.iterations`
  - `network.largest_component_pct`
  - `validation_summary.metrics.*` (median/mean/min/max APE, Spearman rho)
  - `validation_summary.screening_gate.status_label` + `.reasons`
  - `validation_summary.model_caveats` (rendered verbatim as a bullet list)
  - `validation_summary.facility_ranking` (rendered as a comparison table)
  - `validation_summary.model_run_id` (cited in the closing section so
    auditors can trace every number back to its source artifact)
- Missing values fall back to em-dash (`—`) rather than `undefined`/`NaN`.
- `SeedRecords.existingConditionsChapter` added to the exported shape.
- Upsert step 8 in `main()` writes to `rtp_cycle_chapters` with
  `onConflict: "rtp_cycle_id,chapter_key"` (the unique constraint from
  the 2026-04-09 migration) so the demo chapter is idempotent across
  re-runs.
- Chapter seeded with `status = "ready_for_review"` (not `not_started`)
  so the demo feels like an in-progress chapter rather than a placeholder.
- `sort_order = 5` so the chapter lands before `vision_goals_policy`
  (sort 10) — existing conditions is traditionally the first narrative
  chapter in an RTP.

### Chapter body outline

The rendered markdown carries, in order:

1. **Screening-grade blockquote** (the first four lines the reader sees,
   before any data). Identifies the run as a prototype and names the
   specific calibrations a production RTP would require.
2. **Study area** — name, FIPS, square miles, bounding box.
3. **Baseline demographics** — 5-row table with source attribution.
4. **Travel demand** — total trips + HBW/HBO/NHB/external breakdown +
   gateway narrative.
5. **Network and assignment** — link/node/zone counts, largest connected
   component, assignment convergence metrics.
6. **Validation** — metrics table, ranking-comparison table, screening
   gate verdict with verbatim reasons, verbatim model-caveat list.
7. **What this chapter is not** — explicit non-claims (no calibration,
   no equity impact, no transit/bike-ped accessibility).
8. **What this chapter demonstrates** — the proof-of-capability framing,
   citing the frozen run id so every number is audit-traceable.

### `src/test/seed-nctc-demo.test.ts`

Expanded to 15 tests (was 7 in Q.1). New coverage:

- `buildSeedRecords` produces the existing-conditions chapter tied to
  the demo workspace + RTP cycle with correct section_type, status,
  sort_order, required, and owner id.
- `buildExistingConditionsChapterMarkdown`:
  - Opens with the screening-grade warning block.
  - Surfaces real manifest values with locale-formatted integers
    (102,322 / 628,262 / 54,944 / 4,829).
  - Surfaces validation metrics (27.4%, 237.62%, 0.40) and the
    critical-facility threshold reason verbatim.
  - Preserves every model caveat verbatim.
  - Renders the facility ranking table with supplied rows including
    the outlier (SR 174 at Brunswick Rd, modeled 34,775 vs observed
    10,300).
  - Cites the frozen run id in the closing section.
  - Handles sparse inputs gracefully with em-dash fallbacks.

## Test + build verification

```
npx tsc --noEmit        # exit 0
npm test                # 789/171 pass (+8 new tests on top of Q.1's 7)
npm run build           # compiled successfully in 8.7s
```

## What rendering surface displays this chapter

`content_markdown` is read by the existing RTP document renderer and
the PDF export — already wired before this slice (no new UI code):

- `src/app/(app)/rtp/[rtpCycleId]/page.tsx:619` — renders content per
  chapter on the cycle detail page.
- `src/app/(app)/rtp/[rtpCycleId]/document/page.tsx:405` — renders the
  full compiled document view.
- `src/app/api/rtp-cycles/[rtpCycleId]/export/route.ts:129` — includes
  the chapter body in the PDF/HTML export.
- `src/app/api/reports/[reportId]/generate/route.ts:283` — pulls
  chapter bodies into generated reports.

So the Q.2 chapter will appear in every one of those surfaces once the
seed script is run against a live Supabase project.

## Scope discipline notes

- **No UI code shipped in Q.2.** The chapter surfaces via existing
  renderers. This slice is purely data authoring.
- **No default-template changes.** Every existing workspace keeps the
  7-chapter default. Only the demo cycle gets an 8th chapter.
- **No markdown renderer improvements.** If the existing chapter
  renderer doesn't handle tables/blockquotes ideally, that's a separate
  concern addressed in a UI slice, not here.
- **No Q.1 behavior changes.** All seven Q.1 tests still pass; the new
  tests are additive.

## Still queued: Q.3 (PDF one-pager)

Q.3 is the outbound one-pager. It's explicitly a non-code commercial
lane per the scope doc — a PDF or slide artifact summarizing what the
demo workspace + chapter *show*, aimed at prospect conversations. Not
this session's work.

## Follow-up watch items

- When the seed script is run against live Supabase, sanity-check that
  the chapter appears at `/rtp/{DEMO_RTP_CYCLE_ID}` and on the
  `/document` render. If the markdown renderer strips tables or
  blockquotes, file a UI follow-up — the data is correct regardless.
- If the underlying NCTC screening run is ever re-frozen (e.g. a new
  AequilibraE version or a different scalar calibration run), the
  chapter regenerates automatically from the new manifest + summary —
  no chapter-prose edits required. This is the point of composing the
  body from the data.
