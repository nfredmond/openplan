-- The staff editor now retains exact intent and the legacy HTTP writes refuse.
-- Keep reads under existing RLS; ordinary clients must use the checked command
-- to change saved words. Privileged migration/restore fixtures remain possible.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
 ON TABLE public.engagement_content_translations FROM PUBLIC, anon, authenticated;

-- Anonymous callers cannot execute the command. Authenticated callers still
-- undergo its locked staff-membership, source, version and exact-retry checks.
REVOKE ALL ON FUNCTION public.write_engagement_translations(uuid,uuid,text,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.write_engagement_translations(uuid,uuid,text,text,text,jsonb) TO authenticated;
