-- Keep the existing simple FK and add the missing campaign scope. Refuse an
-- inconsistent existing pointer rather than inventing its historical meaning.
ALTER TABLE public.engagement_campaigns
  ADD CONSTRAINT engagement_campaign_configuration_scope
  FOREIGN KEY (id, configuration_version_id)
  REFERENCES public.engagement_configuration_versions (campaign_id, id);

-- The current pointer is derived from definitions. A writer may not select an
-- older definition by changing only the pointer. Capture is idempotent, so the
-- nested pointer update stops as soon as the canonical version is selected.
CREATE OR REPLACE FUNCTION public.refresh_engagement_configuration() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='engagement_campaigns' THEN
    IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'updated_at') THEN RETURN NEW; END IF;
    PERFORM capture_engagement_configuration(NEW.id);
  ELSE
    PERFORM capture_engagement_configuration(COALESCE(NEW.campaign_id,OLD.campaign_id));
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
