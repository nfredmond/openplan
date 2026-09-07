-- Retain original copies separately from every public item reader. Legacy originals
-- begin at the first observed edit; no claim is made about earlier overwritten text.
CREATE TABLE public.engagement_item_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.engagement_campaigns(id),
  item_id uuid NOT NULL REFERENCES public.engagement_items(id),
  actor_id uuid REFERENCES auth.users(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  event text NOT NULL CHECK (event IN ('received','legacy_before_edit','reviewed')),
  reason text,
  record_json jsonb NOT NULL
);
CREATE INDEX engagement_item_history_item ON public.engagement_item_history(item_id, recorded_at);
ALTER TABLE public.engagement_item_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_item_history FROM anon, authenticated;
GRANT SELECT ON public.engagement_item_history TO authenticated;
CREATE POLICY engagement_item_history_staff_read ON public.engagement_item_history FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.engagement_campaigns c JOIN public.workspace_members m ON m.workspace_id=c.workspace_id
    WHERE c.id=campaign_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member'))
);
CREATE FUNCTION public.retain_engagement_item_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO engagement_item_history(campaign_id,item_id,actor_id,event,reason,record_json)
      VALUES(NEW.campaign_id,NEW.id,auth.uid(),'received',NULL,to_jsonb(NEW));
  ELSIF (to_jsonb(NEW)-ARRAY['updated_at','votes_count','metadata_json']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['updated_at','votes_count','metadata_json']) THEN
    IF NOT EXISTS (SELECT 1 FROM engagement_item_history WHERE item_id=OLD.id) THEN
      INSERT INTO engagement_item_history(campaign_id,item_id,actor_id,event,record_json)
        VALUES(OLD.campaign_id,OLD.id,NULL,'legacy_before_edit',to_jsonb(OLD));
    END IF;
    INSERT INTO engagement_item_history(campaign_id,item_id,actor_id,event,reason,record_json)
      VALUES(NEW.campaign_id,NEW.id,auth.uid(),'reviewed',NEW.moderation_notes,to_jsonb(NEW));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER engagement_item_history_capture AFTER INSERT OR UPDATE ON public.engagement_items
FOR EACH ROW EXECUTE FUNCTION public.retain_engagement_item_history();
CREATE FUNCTION public.refuse_engagement_history_change() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Engagement history is immutable'; END $$;
CREATE TRIGGER engagement_item_history_immutable BEFORE UPDATE OR DELETE ON public.engagement_item_history
FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();
REVOKE ALL ON FUNCTION public.retain_engagement_item_history() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refuse_engagement_history_change() FROM PUBLIC;

-- Request tokens are random client-held capabilities, never exposed by public feeds.
ALTER TABLE public.engagement_items ADD COLUMN request_id uuid, ADD COLUMN request_sha256 text;
CREATE UNIQUE INDEX engagement_items_request_unique ON public.engagement_items(campaign_id, request_id) WHERE request_id IS NOT NULL;
