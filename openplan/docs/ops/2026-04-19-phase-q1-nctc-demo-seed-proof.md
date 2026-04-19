---
title: Phase Q.1 — NCTC demo seed (workspace + project + RTP cycle + county-run)
date: 2026-04-19
decisions_doc: docs/ops/2026-04-19-phase-p-decisions-locked.md
scope_doc: docs/ops/2026-04-19-phase-q-scope.md
phase: Q.1
artifact_source: data/screening-runs/nevada-county-runtime-norenumber-freeze-20260324/
---

# Phase Q.1 — NCTC demo seed

First engineering slice of Phase Q (Phase P decision #5 — 90% plan example
anchored to Nevada County Transportation Commission). Lands the idempotent
seed that turns the existing NCTC screening artifact into a browsable demo
workspace.

The scope doc frames this as proof-of-capability, not a literal 90%-done
RTP. The seed preserves every screening-grade disclosure verbatim so the
demo surface cannot drift from the honesty the artifact already carries
(max APE 237.6%, `status_label = "internal prototype only"`).

## Shape correction (from scope doc's original Q.1)

The first draft of the scope doc had Q.1 as a POST route reading from local
disk. That was wrong: the `data/` artifact tree sits at the repo root, not
inside the Next.js bundle, so a serverless function on Vercel could not see
it. Q.1 is therefore a **local server-side seed script** run against a
Supabase project using the service-role key, not a product route. The
scope doc was revised in the same session to reflect this.

## Decisions locked ahead of the slice

Per the user's delegation ("you check all that, use browser or other
tools"), four open Phase Q decisions were answered before starting this
slice:

1. **Demo visibility:** signed-in internal only (demo user + workspace,
   not exposed on `/explore`).
2. **Q.2 chapter target:** Existing Conditions / Travel Patterns (leans
   hardest on the honest assets — screening-grade OD totals, Census tract
   attributes, LODES — and has the cleanest caveat posture).
3. **Outbound framing:** the scope doc's one-liner —
   *"Here's what OpenPlan produces when a rural RTPA like Nevada County
   runs an RTP cycle through it, grounded in real NCTC geography and a
   real screening-grade model run."*
4. **Q.3 format:** PDF one-pager first (outbound deliverable); a public
   static landing page can come later if it earns its keep.

## What this slice ships

### `supabase/migrations/20260419000059_workspaces_is_demo.sql`

Adds `workspaces.is_demo BOOLEAN NOT NULL DEFAULT false` with a partial
index on `is_demo = true`. Column comment warns that demo workspaces must
not be treated as production tenant data for billing, outbound, or usage
analytics. This is the marker the seed sets and any future observability
or billing filters should check.

### `scripts/seed-nctc-demo.ts`

Service-role seed script, idempotent across runs via deterministic UUIDs
(all prefixed `d0000001-0000-4000-8000-...`). Reads
`data/screening-runs/nevada-county-runtime-norenumber-freeze-20260324/bundle_manifest.json`
and `validation/validation_summary.json` via Node fs, then upserts:

| Table | Row | Notes |
|---|---|---|
| `auth.users` | `nctc-demo@openplan-demo.natford.example` | Created via `auth.admin.createUser` if missing; reused otherwise |
| `workspaces` | "Nevada County Transportation Commission (demo)" | `is_demo=true`, `subscription_status="pilot"` so billing gates pass |
| `workspace_members` | owner | demo user → demo workspace |
| `projects` | "NCTC 2045 RTP (proof-of-capability)" | `plan_type="regional_transportation_plan"`, `delivery_phase="analysis"` |
| `rtp_cycles` | "NCTC 2045 RTP — demo cycle" | `status="draft"`, horizon 2026–2045 |
| `project_rtp_cycle_links` | candidate | project → cycle |
| `county_runs` | `nevada-county-runtime-norenumber-freeze-20260324` | `stage="validated-screening"`, `manifest_json` + `validation_summary_json` stored verbatim |

Run locally with `pnpm seed:nctc` (defaults to `.env.local`) or
`tsx scripts/seed-nctc-demo.ts --env-file <path>` for a staging env.
`--dry-run` reads the artifacts and prints the plan without writing.

The script's `main()` is guarded so it only executes when invoked
directly (not when imported) — otherwise unit tests would kick off a
live Supabase connection at module load.

### Testable shape

`buildSeedRecords(ownerUserId, bundleManifest, validationSummary): SeedRecords`
is exported as a pure helper so the record shape can be verified without
a live Supabase instance. Inputs flow through unchanged: `manifest_json`
and `validation_summary_json` on `county_runs` are the same object
references the artifact tree provided — nothing is paraphrased, nothing
is summarized.

### `src/test/seed-nctc-demo.test.ts`

7 unit tests covering:

- Workspace carries `is_demo=true` and `subscription_status="pilot"`.
- Owner user id flows through membership, project, rtp_cycle, project_rtp_cycle_link, county_run.
- `manifest_json` and `validation_summary_json` are stored verbatim (reference equality).
- county_run carries `stage="validated-screening"`, `geography_type="county_fips"`, `geography_id="06057"`.
- Falls back to `"internal prototype only"` when validation summary omits `status_label`.
- Deterministic UUIDs tie every record to the demo workspace.
- Idempotence: same inputs → structurally equal records.
- RTP cycle horizon is 2026–2045 (matches scope doc).

### `package.json`

Adds `"seed:nctc": "tsx scripts/seed-nctc-demo.ts"` to the scripts map.

## Why this is a single commit (not split like Phase O.2)

Phase O.2 split auth hardening and quota gate into two commits because
one is a security fix and the other is a rate-limit change — they need
to be reviewable and revertable independently. Phase Q.1 is one concern:
seed a demo workspace. The migration, the script, the test, and the
package.json script entry are all load-bearing for that one deliverable;
splitting them would produce commits that don't stand on their own (the
script needs the migration, the test needs the script).

## Verification

```
npx tsc --noEmit        # exit 0
npm test                # 781/171 pass (+7 new tests, +1 new file)
npm run build           # compiled successfully in 7.1s
```

The seed script has **not** been run against a live Supabase project in
this session — that requires service-role credentials and is the natural
first action in the Q.2 session, when the chapter surface is ready to
read against the seeded workspace. A `--dry-run` flag is provided for
local sanity-checking without writes.

## Follow-ups (Q.2 and Q.3 scope)

Q.2 — author the Existing Conditions / Travel Patterns chapter against
the seeded workspace, reading the county-run manifest + validation summary
and rendering a chapter surface that preserves every screening-grade
caveat. Sequence: open the seeded project, navigate to the RTP cycle,
drill into the chapter, verify the caveat posture.

Q.3 — PDF one-pager for outbound. Non-code lane. Pairs with the Q.2 chapter
screenshot so the outbound framing ("here's what OpenPlan produces…") has
a concrete artifact to point at.

## Demo data hygiene (open thread)

`is_demo=true` is the marker, but nothing yet filters on it. Downstream
work that could produce production contamination:

- Stripe metering (when Phase O's soft-cap design becomes strict
  consumption) must exclude `is_demo` workspaces.
- Outbound email / notifications must not target the demo user's email
  as a real contact.
- Analytics/usage dashboards should filter `is_demo` out of aggregate
  metrics unless explicitly showing demo activity.

Not this slice's problem, but the column + partial index are in place so
those filters can be added cheaply when needed.
