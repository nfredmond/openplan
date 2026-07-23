-- Wave 5.2 — "You said / We did" close-the-loop entries over the engagement module.
-- Posture:
--  * engagement_closeloop_entries = OPERATOR-AUTHORED narrative (what the
--    community said + what the agency did), authored by workspace members ->
--    OPERATOR-scoped RLS, campaign->workspace, mirroring engagement_categories /
--    engagement_survey_questions exactly. NOT public-submitted, so NOT the
--    sensitive service-role-only posture -- there is no anon/public write path.
--  * The PUBLIC portal reads status='published' rows only, via the service-role
--    SSR client (share_token + campaign status='active' gated), the same way it
--    reads approved engagement_items. anon has zero RLS access to this table.
--  * AI draft-assist seeds the "you said" text from generateEngagementSynthesis
--    (deterministic $0 fallback when no key); ai_assisted records that provenance
--    honestly. Drafts are NEVER auto-published -- status starts 'draft' and only
--    an explicit operator publish stamps published_at.

CREATE TABLE IF NOT EXISTS engagement_closeloop_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    uuid NOT NULL REFERENCES engagement_campaigns(id) ON DELETE CASCADE,
  category_id    uuid REFERENCES engagement_categories(id) ON DELETE SET NULL, -- optional theme tag
  theme_title    text NOT NULL,
  you_said       text NOT NULL DEFAULT '',   -- what the community told us (may be AI-seeded)
  we_did         text NOT NULL DEFAULT '',   -- the agency response (operator writes this)
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  ai_assisted    boolean NOT NULL DEFAULT false,  -- honest provenance: was you_said AI-seeded
  source_item_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],  -- provenance trail into engagement_items
  sort_order     integer NOT NULL DEFAULT 0,
  published_at   timestamptz,                -- set on publish, cleared on unpublish
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_closeloop_campaign_sort
  ON engagement_closeloop_entries (campaign_id, sort_order, created_at);
-- The public portal reads published rows for one campaign, ordered -- a partial
-- index keeps that read cheap and skips drafts entirely.
CREATE INDEX IF NOT EXISTS idx_closeloop_published
  ON engagement_closeloop_entries (campaign_id, sort_order, created_at)
  WHERE status = 'published';

-- Keep published_at consistent with status regardless of what the writer sends:
-- publishing stamps it (if unset), unpublishing clears it.
CREATE OR REPLACE FUNCTION sync_closeloop_published_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'published' THEN
    IF NEW.published_at IS NULL THEN NEW.published_at = now(); END IF;
  ELSE
    NEW.published_at = NULL;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_closeloop_published_at ON engagement_closeloop_entries;
CREATE TRIGGER trg_closeloop_published_at
  BEFORE INSERT OR UPDATE ON engagement_closeloop_entries
  FOR EACH ROW EXECUTE FUNCTION sync_closeloop_published_at();

-- updated_at trigger (reuse set_engagement_updated_at from 20260314000020).
DROP TRIGGER IF EXISTS trg_closeloop_updated_at ON engagement_closeloop_entries;
CREATE TRIGGER trg_closeloop_updated_at BEFORE UPDATE ON engagement_closeloop_entries
  FOR EACH ROW EXECUTE FUNCTION set_engagement_updated_at();

------------------------------------------------------------------------------
-- RLS: operator-scoped (mirror engagement_categories / engagement_survey_questions).
-- The public portal reads via service-role, which bypasses RLS; anon never
-- reaches this table directly (no anon policy).
------------------------------------------------------------------------------
ALTER TABLE engagement_closeloop_entries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_closeloop_entries' AND policyname='engagement_closeloop_entries_read') THEN
    CREATE POLICY engagement_closeloop_entries_read ON engagement_closeloop_entries FOR SELECT USING (
      EXISTS (SELECT 1 FROM engagement_campaigns campaign JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
              WHERE campaign.id = engagement_closeloop_entries.campaign_id AND wm.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_closeloop_entries' AND policyname='engagement_closeloop_entries_insert') THEN
    CREATE POLICY engagement_closeloop_entries_insert ON engagement_closeloop_entries FOR INSERT WITH CHECK (
      EXISTS (SELECT 1 FROM engagement_campaigns campaign JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
              WHERE campaign.id = engagement_closeloop_entries.campaign_id AND wm.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_closeloop_entries' AND policyname='engagement_closeloop_entries_update') THEN
    CREATE POLICY engagement_closeloop_entries_update ON engagement_closeloop_entries FOR UPDATE
      USING (EXISTS (SELECT 1 FROM engagement_campaigns campaign JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
              WHERE campaign.id = engagement_closeloop_entries.campaign_id AND wm.user_id = auth.uid()))
      WITH CHECK (EXISTS (SELECT 1 FROM engagement_campaigns campaign JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
              WHERE campaign.id = engagement_closeloop_entries.campaign_id AND wm.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_closeloop_entries' AND policyname='engagement_closeloop_entries_delete') THEN
    CREATE POLICY engagement_closeloop_entries_delete ON engagement_closeloop_entries FOR DELETE USING (
      EXISTS (SELECT 1 FROM engagement_campaigns campaign JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
              WHERE campaign.id = engagement_closeloop_entries.campaign_id AND wm.user_id = auth.uid()));
  END IF;
END $$;
