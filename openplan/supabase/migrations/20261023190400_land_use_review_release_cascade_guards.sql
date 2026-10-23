-- A restored workspace cascade can reach review releases before their plan.
-- Match the live plan/workspace ownership rule in 20261016000009 while keeping
-- the complete review-release insert, identity, close and withdrawal guard.
CREATE OR REPLACE FUNCTION public.guard_land_use_plan_review_release()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.land_use_plans
      WHERE id = OLD.plan_id AND workspace_id = OLD.workspace_id
    ) OR NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Public review releases are append-only';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.land_use_plan_versions version
      WHERE version.id = NEW.version_id
        AND version.plan_id = NEW.plan_id
        AND version.workspace_id = NEW.workspace_id
        AND version.state = 'public_review'
        AND version.content_hash = NEW.version_content_hash
        AND version.frozen_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Review release must name the exact frozen public-review version hash';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
    OR NEW.version_id IS DISTINCT FROM OLD.version_id
    OR NEW.version_content_hash IS DISTINCT FROM OLD.version_content_hash
    OR NEW.round_number IS DISTINCT FROM OLD.round_number
    OR NEW.share_token IS DISTINCT FROM OLD.share_token
    OR NEW.review_method IS DISTINCT FROM OLD.review_method
    OR NEW.review_open_on IS DISTINCT FROM OLD.review_open_on
    OR NEW.review_close_on IS DISTINCT FROM OLD.review_close_on
    OR NEW.engagement_campaign_id IS DISTINCT FROM OLD.engagement_campaign_id
    OR NEW.external_review_document_id IS DISTINCT FROM OLD.external_review_document_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Published review release identity is immutable';
  END IF;

  IF OLD.status <> 'open' AND NEW.status <> 'withdrawn' THEN
    RAISE EXCEPTION 'A closed review release is immutable';
  END IF;
  IF OLD.status = 'withdrawn' THEN
    RAISE EXCEPTION 'A withdrawn review release is immutable';
  END IF;
  IF NEW.status = 'closed' THEN
    NEW.outcome_hash := encode(
      extensions.digest(convert_to(NEW.outcome_snapshot::text, 'UTF8'), 'sha256'),
      'hex'
    );
  END IF;
  RETURN NEW;
END;
$$;
