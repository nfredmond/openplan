-- Shared public reference data becomes readable-but-not-writable by anonymous
-- and ordinary authenticated callers. Reads are untouched; only the write
-- privileges go.
--
-- WHAT WAS ALREADY TRUE, AND IT IS WORSE THAN IT SOUNDS. `census_tracts` and
-- `lodes_od` each carry ONE policy, `FOR SELECT USING (true)`, which is a
-- deliberate decision: this is public-domain Census/LODES reference data and
-- every workspace reads the same rows. But both tables also have RLS DISABLED
-- (`pg_class.relrowsecurity = false`), so the policy is not being enforced at
-- all, and they inherit Supabase's default grants — DELETE, INSERT, REFERENCES,
-- SELECT, TRIGGER, TRUNCATE, UPDATE — for `anon` and `authenticated` alike.
-- With no RLS and a full write grant, an anonymous caller can write.
--
-- THIS IS NOT THEORETICAL. Verified live against PostgREST on 2026-08-03 with
-- nothing but the public anon key and no account at all:
--
--   * INSERT of a fabricated tract into `census_tracts` — LANDED.
--   * UPDATE of a REAL pre-existing tract's `median_household_income`, from
--     67970 to 1 — LANDED. (Restored immediately from the captured original and
--     re-read to confirm; the table is back to 529 rows and the original value.)
--   * INSERT into `lodes_od` — LANDED.
--
-- WHY THIS MATTERS MORE THAN A TENANT LEAK WOULD. This is an INTEGRITY defect,
-- not a confidentiality one — the data is public by design and leaking it costs
-- nothing. The damage runs the other way. `census_tracts` feeds the equity
-- choropleth through the `census_tracts_map` view, and `median_household_income`,
-- `pop_below_poverty` and `households_zero_vehicle` are the inputs to equity and
-- Title VI / environmental-justice analysis that an agency PUBLISHES under its
-- own name. Silently rewriting one row corrupts an analysis for every workspace
-- in the deployment simultaneously, with no tenant boundary to contain it and
-- nothing in the product that would notice. A wrong number an agency defends in
-- public is worse than a right number someone else could also read.
--
-- WHY KEEP SELECT. Deliberately, and it is required, not merely conservative.
-- The equity surfaces read the `census_tracts_map` view, which is
-- `security_invoker = true`, so it executes with the CALLING role's privileges —
-- `authenticated` for `src/app/api/map-features/census-tracts/route.ts`,
-- `src/app/api/map-features/counts/route.ts` and
-- `src/app/api/geographies/census-tracts/coverage/route.ts`, which use the
-- ordinary user client. Revoking SELECT would break the choropleth for every
-- planner. Over-restriction is its own defect; this migration takes only the
-- privileges that no legitimate caller uses.
--
-- WHY NO LEGITIMATE WRITER LOSES ANYTHING. The one ingest path is
-- `src/app/api/geographies/census-tracts/ingest/route.ts`, which builds a
-- `createServiceRoleClient()` and passes it to `ingestCensusTractsForCounty`,
-- which writes through the `seed_public_census_tract` RPC. That function is NOT
-- `SECURITY DEFINER` and its ACL grants EXECUTE to `postgres` and `service_role`
-- only — so `anon` and `authenticated` cannot reach the write path through the
-- RPC either. The service role bypasses grants and RLS and is unaffected. No
-- application code changes.
--
-- WHY `spatial_ref_sys` IS NOT IN THIS MIGRATION, THOUGH IT HAS THE SAME GRANTS.
-- It is the third RLS-off table with full anonymous write grants, so it belongs
-- here on its face. It is excluded because the revoke CANNOT WORK and would
-- ship as a no-op that reads like protection. `spatial_ref_sys` is owned by
-- `supabase_admin`; migrations run as `postgres`, which holds no grant option on
-- it. Tested in a rolled-back transaction on 2026-08-03: the statement reports
-- `REVOKE` and succeeds, emitting only `WARNING: no privileges could be revoked
-- for "spatial_ref_sys"`, and re-reading `information_schema.role_table_grants`
-- shows all seven privileges still held by both roles. A migration that appears
-- to harden a table while changing nothing is worse than no migration, because
-- it stops anyone looking again. The residual exposure is small and bounded —
-- it is the PostGIS SRID catalog, holds no tenant or agency data, and its
-- `spatial_ref_sys_srid_check` CHECK constraint already rejects out-of-range
-- inserts. Recorded here so the next person does not rediscover it and assume
-- the omission was an oversight.

revoke insert, update, delete, truncate, references, trigger
  on public.census_tracts from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.lodes_od from anon, authenticated;

-- Belt and braces, matching 20260730000005: a grant to `public` would hand these
-- privileges straight back to every role, including the two revoked above.
revoke insert, update, delete, truncate, references, trigger
  on public.census_tracts from public;
revoke insert, update, delete, truncate, references, trigger
  on public.lodes_od from public;
