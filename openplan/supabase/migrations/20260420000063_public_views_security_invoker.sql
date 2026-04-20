-- W2.1 — Flip public-data views from SECURITY DEFINER to SECURITY INVOKER.
--
-- Context: both views aggregate public-domain data (LODES jobs by tract,
-- Census ACS tracts with computed demographics). SECURITY DEFINER meant
-- they ran as the view creator, which is a privilege-escalation pattern
-- the Supabase advisor flags as ERROR. Since W1.2 just added
-- SELECT-anyone RLS policies on the underlying tables (census_tracts,
-- lodes_od), these views work fine under SECURITY INVOKER.
--
-- Reference: docs/ops/2026-04-20-security-advisor-backlog.md W2.1.

ALTER VIEW public.census_tracts_computed SET (security_invoker = true);
ALTER VIEW public.lodes_by_tract SET (security_invoker = true);
