-- One round-trip for the observed severity and role mix of many acquisitions.
--
-- ============================================================================
-- WHY THIS FUNCTION EXISTS
-- ============================================================================
--
-- Three surfaces need the same thing: how many stored collisions of each
-- severity band an acquisition holds, and how many people of each role it
-- recorded. The benefit-cost screen reads it to offer observed frequencies, the
-- RTP safety criterion reads it to show a planner what the road actually did,
-- and the grant narrative cites it.
--
-- Before this function, one of those surfaces did it with four `count(*)` HEAD
-- requests PER PROJECT (`src/app/(app)/grants/page.tsx`), so a workspace with
-- twenty projects opened its grants page with eighty round-trips whose only
-- product was eighty integers. That is the N+1 shape, and it gets worse exactly
-- as a workspace gets more useful.
--
-- Counting in the database is also the only honest way to do it at this size. A
-- county-decade extract is 10^4-10^5 crash rows and roughly twice that in person
-- rows; PostgREST caps a row read at 1,000, so "select the rows and group them
-- in TypeScript" would silently count a truncated slice and report it as the
-- total. A grouped count has no such ceiling.
--
-- ============================================================================
-- SHAPE, AND WHY IT IS LONG RATHER THAN WIDE
-- ============================================================================
--
-- Returns one row per (ingest, dimension, value) with a count, rather than a
-- column per severity band. The neutral vocabulary lives in
-- `src/lib/safety/vocabulary.ts` and gains members over time — `unknown` was
-- added in 20260812000001 and `motorcyclist` is a role no source in the corpus
-- had until 20260812000002. A wide signature would need a migration for each
-- one, and every caller would need editing on the same day. A long result set
-- needs neither: a new value simply appears, and a reader that does not know it
-- ignores it.
--
-- ZERO IS NOT REPORTED, AND THAT IS THE POINT. A band with no collisions
-- produces no row. The caller decides what an absent band means — for a
-- retrieved acquisition it is a true zero, and for an acquisition whose person
-- rows were never fetched (`safety_crash_ingests.party_completeness =
-- 'not_retrieved'`) it means nothing was counted, which is not the same as
-- nobody being hurt. Emitting a fabricated 0 here would erase that distinction
-- inside the database, where no caller could recover it.
--
-- ============================================================================
-- SECURITY
-- ============================================================================
--
-- SECURITY INVOKER, deliberately. The caller's RLS on `safety_crashes` and
-- `safety_crash_parties` governs every row this function touches, so a
-- non-member who guesses a workspace id gets an empty result rather than a
-- count of somebody else's casualties. `p_workspace_id` is a second, explicit
-- scope on top of that, not a substitute for it.
--
-- `anon` is refused EXECUTE. Person rows may never reach an anonymous surface
-- (see 20260812000002's header), and a grouped count over them is still a
-- statement about identifiable people in a small town.
--
-- STABLE, not IMMUTABLE: it reads tables.

CREATE OR REPLACE FUNCTION public.safety_crash_evidence_counts(
  p_workspace_id uuid,
  p_ingest_ids uuid[]
)
RETURNS TABLE (
  ingest_id uuid,
  dimension text,
  value text,
  record_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  SELECT
    c.ingest_id,
    'severity'::text AS dimension,
    c.severity AS value,
    count(*)::bigint AS record_count
  FROM safety_crashes c
  WHERE c.workspace_id = p_workspace_id
    AND c.ingest_id = ANY (p_ingest_ids)
  GROUP BY c.ingest_id, c.severity

  UNION ALL

  SELECT
    p.ingest_id,
    'party_role'::text AS dimension,
    p.party_role AS value,
    count(*)::bigint AS record_count
  FROM safety_crash_parties p
  WHERE p.workspace_id = p_workspace_id
    AND p.ingest_id = ANY (p_ingest_ids)
  GROUP BY p.ingest_id, p.party_role;
$$;

COMMENT ON FUNCTION public.safety_crash_evidence_counts(uuid, uuid[]) IS
  'Observed severity-band and person-role counts for a set of crash acquisitions, one row per (ingest, dimension, value). SECURITY INVOKER so caller RLS governs every counted row; anon has no EXECUTE. A value with no records produces NO ROW — the caller decides whether an absent band is a true zero or an unretrieved one, which a fabricated 0 here would destroy.';

REVOKE ALL ON FUNCTION public.safety_crash_evidence_counts(uuid, uuid[]) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.safety_crash_evidence_counts(uuid, uuid[]) TO authenticated, service_role;
