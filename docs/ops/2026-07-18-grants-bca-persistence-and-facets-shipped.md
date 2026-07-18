# Grants lane round 3: BCA persistence, narrative facts, live-search facets (2026-07-18)

## What shipped

Closes the loop the first two rounds opened: saved benefit-cost screenings are now durable
project evidence that feeds the `[fact:N]` narrative contract, and the grants.gov live search
gained agency/eligibility facets populated from the API's own metadata.

### BCA persistence (`project_bca_screenings`)

- **Migration `20260718000089`** — append-only table mirroring the narrative-drafts pattern:
  workspace/project scoped, member read + insert RLS (`created_by = auth.uid()`), no
  UPDATE/DELETE grants, latest-per-project indexes, plus a `project_bca_screenings_latest`
  `DISTINCT ON (project_id)` view (security_invoker) for the grants-page read. **Not applied to
  any DB by this PR** — apply it to the local stack with `npm exec supabase migration up` (or
  `db reset` to re-apply all migrations) from `openplan/`, and to the linked hosted project
  with `npm exec supabase db push`, after merge (coordinate per the concurrent-sessions
  protocol; the shared local stack belongs to whoever holds the claim).
- **`POST /api/projects/[projectId]/bca-screenings`** — programs.write-gated. The result is
  **recomputed server-side** through the pure engine from wire-schema-validated inputs
  (`src/lib/bca/schema.ts`, strict zod discriminated unions); `result_json` is never client
  math. Engine rejections map to 400 (config) / 422 (insufficient data).
- **Panel** — "Save screening to project record" (primary action; memo download secondary),
  last-saved line with "Load saved inputs" (round-trips through the wire schema; malformed
  stored payloads prefill nothing), save/failure notices.

### Narrative facts + bca-support cue

- `src/lib/grants/bca-evidence.ts` — defensive `parseStoredBcaScreening` (null on any
  malformed payload), latest-per-project builder, fact claims that each end with the verbatim
  `BCA_SCREENING_CAVEAT`, and a one-line cue summary.
- Narrative-draft route loads the latest screening and appends its claims to the fact list;
  the prompt now requires the BCA caveat verbatim whenever screening facts are cited and
  forbids describing results as an application BCA.
- Fifth evidence-readiness cue `bca-support`: success + summary when a screening is saved,
  **neutral** (not warning) when missing — absence only matters for benefit-cost-scored
  sources (HSIP/BUILD/INFRA-class), and alarm fatigue is a real cost. Surfaced automatically
  on registry cards via the generic cue grid.

### grants.gov facets

- Search2 responses carry facet metadata (`agencies[].subAgencyOptions`, `eligibilities`)
  with counts; the parser now extracts both (flattened, count-desc sorted, malformed-tolerant)
  and the section renders Agency / Applicant eligibility selects populated from the live
  response — no hardcoded agency lists. Filter codes are alphabet-validated end to end
  (lib throw → route 400).

## Post-merge step

`project_bca_screenings` (and its `_latest` view) exist only as a migration file until someone
applies it: `npm exec supabase migration up` or `db reset` for the local stack, `db push` for
the linked hosted project. Until then the grants page renders normally (empty screening map)
but saving returns an insert error.

## Tests

~60 new/updated across: `project-bca-screenings-migration` (3, content assertions),
`project-bca-screenings-route` (8), `grants-bca-evidence` (8), `grants-evidence-readiness`
(5-cue pins + bca-support), `grants-bca-screening` (19 incl. save/load flows),
`funding-opportunity-narrative-route` (BCA caveat pin), grants-gov lib/route/section
(24/15/13 after facets).
