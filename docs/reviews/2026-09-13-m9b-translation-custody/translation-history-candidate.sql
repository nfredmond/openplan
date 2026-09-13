-- Provisional next-increment foundation. Test inside BEGIN/ROLLBACK only.
-- Configuration versions remain the existing public-definition record. This
-- private journal also retains response translations and full provenance.
CREATE TABLE public.engagement_translation_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 campaign_id uuid NOT NULL REFERENCES public.engagement_campaigns(id),
 translation_id uuid NOT NULL,
 revision bigint NOT NULL CHECK (revision > 0),
 actor_id uuid,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 event text NOT NULL CHECK (event IN ('legacy_baseline','created','corrected','accepted','removed')),
 record_json jsonb NOT NULL CHECK (jsonb_typeof(record_json)='object'),
 record_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(record_json::text,'sha256'),'hex')) STORED,
 UNIQUE(translation_id,revision)
);
CREATE INDEX engagement_translation_history_campaign ON public.engagement_translation_history(campaign_id,translation_id,revision);
ALTER TABLE public.engagement_translation_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_translation_history FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.engagement_translation_history TO authenticated;
CREATE POLICY engagement_translation_history_staff_read ON public.engagement_translation_history
 FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.engagement_campaigns c JOIN public.workspace_members m ON m.workspace_id=c.workspace_id
  WHERE c.id=campaign_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member')
 ));
CREATE TRIGGER engagement_translation_history_immutable BEFORE UPDATE OR DELETE ON public.engagement_translation_history
 FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();

-- Current-row locks serialize changes to an identity. A recreated translation
-- gets a new identity; it cannot overwrite the copies of a removed identity.
CREATE FUNCTION public.retain_engagement_translation_history() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE next_revision bigint; history_event text;
BEGIN
 IF TG_OP='INSERT' THEN
  IF EXISTS(SELECT 1 FROM engagement_translation_history WHERE translation_id=NEW.id) THEN
   RAISE EXCEPTION 'A retained translation identity cannot be reused';
  END IF;
  INSERT INTO engagement_translation_history(campaign_id,translation_id,revision,actor_id,event,record_json)
  VALUES(NEW.campaign_id,NEW.id,1,auth.uid(),'created',to_jsonb(NEW));
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
   OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
   OR NEW.entity_id IS DISTINCT FROM OLD.entity_id OR NEW.field IS DISTINCT FROM OLD.field
   OR NEW.locale IS DISTINCT FROM OLD.locale THEN
   RAISE EXCEPTION 'Translation identity and address are immutable';
  END IF;
  IF (to_jsonb(NEW)-'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'updated_at') THEN RETURN NEW; END IF;
 END IF;
 INSERT INTO engagement_translation_history(campaign_id,translation_id,revision,event,record_json)
 SELECT OLD.campaign_id,OLD.id,1,'legacy_baseline',to_jsonb(OLD)
 WHERE NOT EXISTS(SELECT 1 FROM engagement_translation_history WHERE translation_id=OLD.id)
 ON CONFLICT(translation_id,revision) DO NOTHING;
 SELECT max(revision)+1 INTO next_revision FROM engagement_translation_history WHERE translation_id=OLD.id;
 IF TG_OP='DELETE' THEN
  INSERT INTO engagement_translation_history(campaign_id,translation_id,revision,actor_id,event,record_json)
  VALUES(OLD.campaign_id,OLD.id,next_revision,auth.uid(),'removed',to_jsonb(OLD));
  RETURN OLD;
 END IF;
 history_event=CASE WHEN OLD.source='machine' AND NEW.source='operator'
  AND OLD.translated_text=NEW.translated_text THEN 'accepted' ELSE 'corrected' END;
 INSERT INTO engagement_translation_history(campaign_id,translation_id,revision,actor_id,event,record_json)
 VALUES(NEW.campaign_id,NEW.id,next_revision,auth.uid(),history_event,to_jsonb(NEW));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.retain_engagement_translation_history() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER engagement_translation_history_capture AFTER INSERT OR UPDATE ON public.engagement_content_translations
 FOR EACH ROW EXECUTE FUNCTION public.retain_engagement_translation_history();
CREATE TRIGGER engagement_translation_history_remove BEFORE DELETE ON public.engagement_content_translations
 FOR EACH ROW EXECUTE FUNCTION public.retain_engagement_translation_history();
INSERT INTO public.engagement_translation_history(campaign_id,translation_id,revision,event,record_json)
 SELECT t.campaign_id,t.id,1,'legacy_baseline',to_jsonb(t) FROM public.engagement_content_translations t
 ON CONFLICT(translation_id,revision) DO NOTHING;

CREATE FUNCTION public.read_engagement_translation_history(p_campaign uuid) RETURNS jsonb
 LANGUAGE sql STABLE STRICT SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('campaignId',p_campaign,'count',count(*),'entries',COALESCE(jsonb_agg(jsonb_build_object(
  'id',h.id,'campaign_id',h.campaign_id,'translation_id',h.translation_id,'revision',h.revision,
  'actor_id',h.actor_id,'recorded_at',h.recorded_at,'event',h.event,
  'record_text',h.record_json::text,'record_sha256',h.record_sha256
 ) ORDER BY h.translation_id,h.revision),'[]'::jsonb)) FROM public.engagement_translation_history h WHERE h.campaign_id=p_campaign;
$$;
REVOKE ALL ON FUNCTION public.read_engagement_translation_history(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_engagement_translation_history(uuid) TO authenticated;
