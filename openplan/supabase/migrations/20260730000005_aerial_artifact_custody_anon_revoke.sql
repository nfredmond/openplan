-- An anonymous caller cannot reach the aerial custody ledger at all, rather than
-- reaching it and being filtered.
--
-- WHAT WAS ALREADY TRUE. 20260730000004 enables RLS on
-- `aerial_artifact_custody` and its one SELECT policy is scoped to workspace
-- membership, so an anonymous request already returns nothing. Verified live
-- against PostgREST: `GET /rest/v1/aerial_artifact_custody` as `anon` answers
-- `200 []`.
--
-- WHY 200-AND-EMPTY IS NOT GOOD ENOUGH HERE. The table inherits Supabase's
-- default grants, so `anon` holds INSERT/SELECT/UPDATE/DELETE and the ONLY thing
-- standing between an anonymous caller and this data is the policy predicate
-- being right. That is one careless policy edit — a widened `USING`, a policy
-- dropped during a refactor, a future `FOR ALL` written for convenience — away
-- from exposure, and nothing would fail loudly when it happened.
--
-- WHAT IS IN THIS TABLE. `storage_path` and `storage_bucket` name where an
-- agency's aerial deliverables sit in a PRIVATE bucket, alongside byte sizes and
-- SHA-256 checksums of the imagery products of a flight over their jurisdiction.
-- It is an inventory of the evidence under planning decisions, and it belongs to
-- one workspace.
--
-- THE PRECEDENT THIS MATCHES. `engagement_content_translations` (20260729000004)
-- revokes every `anon` grant for the same reason, and its audit recorded that
-- being *stricter than its neighbours* was the point. Two defences that fail
-- independently — no grant AND a scoped policy — is the posture; a policy alone
-- is one mistake deep.
--
-- WHAT THIS DOES NOT CHANGE. Members still read through the existing policy on
-- the `authenticated` role, and the service role — which the processing callback
-- and the custody pass use — is unaffected by both grants and RLS. No
-- application code changes.

revoke all on public.aerial_artifact_custody from anon;

-- Belt and braces for anything created later in this schema by a migration that
-- forgets: PostgREST reaches tables as `anon` for unauthenticated requests, and
-- this table has no anonymous surface by design.
revoke all on public.aerial_artifact_custody from public;
