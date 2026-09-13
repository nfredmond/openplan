-- Response writes now require write_engagement_response and its retained request.
-- Retire the obsolete direct-write policies; retain read access, restrictive
-- writer gates and the revoked INSERT/UPDATE/DELETE privileges. No rows change.
DROP POLICY IF EXISTS engagement_closeloop_entries_insert ON public.engagement_closeloop_entries;
DROP POLICY IF EXISTS engagement_closeloop_entries_update ON public.engagement_closeloop_entries;
DROP POLICY IF EXISTS engagement_closeloop_entries_delete ON public.engagement_closeloop_entries;
