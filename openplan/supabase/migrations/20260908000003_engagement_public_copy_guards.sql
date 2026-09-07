CREATE OR REPLACE FUNCTION public.guard_engagement_public_copy() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c record;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.source_type='public' THEN
      SELECT * INTO c FROM engagement_campaigns WHERE id=NEW.campaign_id FOR SHARE;
      IF c.status <> 'active' OR NOT c.allow_public_submissions OR c.submissions_closed_at IS NOT NULL
        OR c.participation_starts_at > clock_timestamp() OR c.participation_ends_at <= clock_timestamp() THEN
        RAISE EXCEPTION 'Campaign is not accepting contributions';
      END IF;
      IF NEW.configuration_version_id IS NOT NULL AND NEW.configuration_version_id IS DISTINCT FROM c.configuration_version_id THEN
        RAISE EXCEPTION 'Campaign configuration changed; review it before submitting';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.parent_item_id IS DISTINCT FROM OLD.parent_item_id OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id OR NEW.configuration_version_id IS DISTINCT FROM OLD.configuration_version_id
    OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.request_sha256 IS DISTINCT FROM OLD.request_sha256 THEN
    RAISE EXCEPTION 'Contribution identity and historical configuration are immutable';
  END IF;
  IF ROW(NEW.title,NEW.body,NEW.submitted_by,NEW.status,NEW.photo_path,NEW.geometry,NEW.latitude,NEW.longitude,NEW.category_id,NEW.source_type) IS DISTINCT FROM ROW(OLD.title,OLD.body,OLD.submitted_by,OLD.status,OLD.photo_path,OLD.geometry,OLD.latitude,OLD.longitude,OLD.category_id,OLD.source_type) THEN
    IF NULLIF(btrim(NEW.moderation_notes),'') IS NULL THEN RAISE EXCEPTION 'A human review reason is required'; END IF;
    NEW.updated_at=clock_timestamp();
    NEW.metadata_json=NEW.metadata_json-'ai_translations';
    UPDATE engagement_closeloop_entries SET status='draft',published_at=NULL WHERE campaign_id=NEW.campaign_id AND NEW.id=ANY(source_item_ids);
    UPDATE engagement_campaigns SET ai_synthesis_json=NULL,ai_synthesized_at=NULL WHERE id=NEW.campaign_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_engagement_public_copy() FROM PUBLIC;
CREATE TRIGGER zz_engagement_public_copy_guard BEFORE INSERT OR UPDATE ON public.engagement_items FOR EACH ROW EXECUTE FUNCTION public.guard_engagement_public_copy();
CREATE FUNCTION public.engagement_cache_reviewed_translation(p_item_id uuid,p_language text,p_translation text,p_title text,p_body text,p_source_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE engagement_items SET metadata_json=jsonb_set(metadata_json,'{ai_translations}',
    COALESCE(metadata_json->'ai_translations','{}'::jsonb)||jsonb_build_object(p_language,jsonb_build_object('text',p_translation,'sourceHash',p_source_hash)))
  WHERE id=p_item_id AND status='approved' AND title IS NOT DISTINCT FROM p_title AND body=p_body;
  GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;
REVOKE ALL ON FUNCTION public.engagement_cache_reviewed_translation(uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.engagement_cache_reviewed_translation(uuid,text,text,text,text,text) TO service_role;

-- A published response cannot disclose a source that still awaits publication.
CREATE FUNCTION public.guard_engagement_response_publication() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status='published' AND EXISTS(SELECT 1 FROM unnest(NEW.source_item_ids) source_id WHERE NOT EXISTS(
  SELECT 1 FROM engagement_items i WHERE i.id=source_id AND i.campaign_id=NEW.campaign_id AND i.status='approved'
    AND (i.parent_item_id IS NULL OR EXISTS(SELECT 1 FROM engagement_items p WHERE p.id=i.parent_item_id AND p.campaign_id=NEW.campaign_id AND p.status='approved' AND p.parent_item_id IS NULL))
 )) THEN RAISE EXCEPTION 'Review and publish linked contributions before publishing the staff response'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_engagement_response_publication() FROM PUBLIC;
CREATE TRIGGER engagement_response_publication_guard BEFORE INSERT OR UPDATE ON public.engagement_closeloop_entries FOR EACH ROW EXECUTE FUNCTION public.guard_engagement_response_publication();
