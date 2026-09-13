-- Retain source response copies independently of current/public response lists.
-- Migrated rows are observed baselines, not recovered original submissions.
CREATE TABLE public.engagement_response_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.engagement_campaigns(id),
  -- No response FK: removing the current response must retain its history.
  response_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  actor_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  event text NOT NULL CHECK (event IN (
    'legacy_baseline', 'created', 'corrected', 'published', 'unpublished', 'removed'
  )),
  record_json jsonb NOT NULL CHECK (jsonb_typeof(record_json) = 'object'),
  record_sha256 text GENERATED ALWAYS AS (
    encode(extensions.digest(record_json::text, 'sha256'), 'hex')
  ) STORED,
  UNIQUE (response_id, revision)
);

CREATE INDEX engagement_response_history_campaign
  ON public.engagement_response_history(campaign_id, response_id, revision);
ALTER TABLE public.engagement_response_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_response_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.engagement_response_history TO authenticated;
CREATE POLICY engagement_response_history_staff_read
  ON public.engagement_response_history FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.engagement_campaigns c
      JOIN public.workspace_members m ON m.workspace_id = c.workspace_id
      WHERE c.id = campaign_id AND m.user_id = auth.uid()
        AND m.role IN ('owner', 'admin', 'member')
    )
  );

CREATE TRIGGER engagement_response_history_immutable
  BEFORE UPDATE OR DELETE ON public.engagement_response_history
  FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();

-- The current row's write lock serializes revisions for that response. Identity
-- reuse after removal is refused, so its old copies cannot join a new response.
CREATE FUNCTION public.retain_engagement_response_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  next_revision bigint;
  history_event text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM engagement_response_history WHERE response_id = NEW.id) THEN
      RAISE EXCEPTION 'A retained response identity cannot be reused';
    END IF;
    INSERT INTO engagement_response_history(campaign_id, response_id, revision, actor_id, event, record_json)
    VALUES (NEW.campaign_id, NEW.id, 1, auth.uid(), 'created', to_jsonb(NEW));
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id THEN
      RAISE EXCEPTION 'Response identity and campaign are immutable';
    END IF;
    IF (to_jsonb(NEW) - 'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Covers a pre-migration row first changed before the baseline sweep sees it.
  INSERT INTO engagement_response_history(campaign_id, response_id, revision, event, record_json)
  SELECT OLD.campaign_id, OLD.id, 1, 'legacy_baseline', to_jsonb(OLD)
  WHERE NOT EXISTS (SELECT 1 FROM engagement_response_history WHERE response_id = OLD.id)
  ON CONFLICT (response_id, revision) DO NOTHING;

  SELECT max(revision) + 1 INTO next_revision FROM engagement_response_history WHERE response_id = OLD.id;
  IF TG_OP = 'DELETE' THEN
    INSERT INTO engagement_response_history(campaign_id, response_id, revision, actor_id, event, record_json)
    VALUES (OLD.campaign_id, OLD.id, next_revision, auth.uid(), 'removed', to_jsonb(OLD));
    RETURN OLD;
  END IF;

  history_event = CASE
    WHEN OLD.status <> 'published' AND NEW.status = 'published' THEN 'published'
    WHEN OLD.status = 'published' AND NEW.status <> 'published' THEN 'unpublished'
    ELSE 'corrected'
  END;
  INSERT INTO engagement_response_history(campaign_id, response_id, revision, actor_id, event, record_json)
  VALUES (NEW.campaign_id, NEW.id, next_revision, auth.uid(), history_event, to_jsonb(NEW));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.retain_engagement_response_history() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER engagement_response_history_capture
  AFTER INSERT OR UPDATE ON public.engagement_closeloop_entries
  FOR EACH ROW EXECUTE FUNCTION public.retain_engagement_response_history();
CREATE TRIGGER engagement_response_history_remove
  BEFORE DELETE ON public.engagement_closeloop_entries
  FOR EACH ROW EXECUTE FUNCTION public.retain_engagement_response_history();

INSERT INTO public.engagement_response_history(campaign_id, response_id, revision, event, record_json)
SELECT e.campaign_id, e.id, 1, 'legacy_baseline', to_jsonb(e)
FROM public.engagement_closeloop_entries e
ON CONFLICT (response_id, revision) DO NOTHING;
