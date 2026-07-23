-- Wave 5.4 — engagement notifications: operator in-app inbox + a no-op email seam.
-- Posture:
--  * engagement_notifications = OPERATOR inbox (what happened on a campaign).
--    Workspace-member-scoped RLS (SELECT + mark-read UPDATE via workspace_members).
--    Rows are WRITTEN by the service-role public submit routes (which have no
--    auth.uid()), so there is no INSERT policy — service-role bypasses RLS.
--  * engagement_subscriptions = participant "email me" opt-in. Holds EMAIL
--    ADDRESSES + confirm/unsubscribe tokens -> SENSITIVE: RLS on, ZERO policies,
--    REVOKE ALL FROM anon, authenticated (same posture as the survey response
--    tables / demographics). Written + read only by the service-role notifications
--    lib (enforced by a reader-inventory test).
--  * engagement_email_outbox = every queued message, observable even when no
--    transport is configured (the $0 default no-ops but still records the row so
--    nothing is silently lost). Holds recipient emails -> SENSITIVE, same posture.

------------------------------------------------------------------------------
-- 1. OPERATOR NOTIFICATIONS — workspace-member-scoped inbox.
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS engagement_notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id   uuid NOT NULL REFERENCES engagement_campaigns(id) ON DELETE CASCADE,
  type          text NOT NULL CHECK (type IN (
    'comment_submitted','comment_flagged','survey_response','closeloop_published'
  )),
  title         text NOT NULL,
  body          text NOT NULL DEFAULT '',
  payload_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_read       boolean NOT NULL DEFAULT false,
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engagement_notifications_campaign
  ON engagement_notifications (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_notifications_unread
  ON engagement_notifications (workspace_id, created_at DESC) WHERE is_read = false;

ALTER TABLE engagement_notifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_notifications' AND policyname='engagement_notifications_read') THEN
    CREATE POLICY engagement_notifications_read ON engagement_notifications FOR SELECT USING (
      EXISTS (SELECT 1 FROM workspace_members wm
              WHERE wm.workspace_id = engagement_notifications.workspace_id AND wm.user_id = auth.uid()));
  END IF;
  -- Members may only flip read state (mark-read); the app sets is_read/read_at.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_notifications' AND policyname='engagement_notifications_update') THEN
    CREATE POLICY engagement_notifications_update ON engagement_notifications FOR UPDATE
      USING (EXISTS (SELECT 1 FROM workspace_members wm
              WHERE wm.workspace_id = engagement_notifications.workspace_id AND wm.user_id = auth.uid()))
      WITH CHECK (EXISTS (SELECT 1 FROM workspace_members wm
              WHERE wm.workspace_id = engagement_notifications.workspace_id AND wm.user_id = auth.uid()));
  END IF;
END $$;

------------------------------------------------------------------------------
-- 2. SUBSCRIPTIONS — participant email opt-in. SENSITIVE (holds emails).
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS engagement_subscriptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       uuid NOT NULL REFERENCES engagement_campaigns(id) ON DELETE CASCADE,
  email             text NOT NULL,
  fingerprint       text,
  user_agent        text,
  confirmed         boolean NOT NULL DEFAULT false,
  confirm_token     text NOT NULL,
  unsubscribe_token text NOT NULL,
  confirmed_at      timestamptz,
  unsubscribed_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, email)
);

CREATE INDEX IF NOT EXISTS idx_engagement_subscriptions_campaign
  ON engagement_subscriptions (campaign_id) WHERE confirmed = true AND unsubscribed_at IS NULL;

DROP TRIGGER IF EXISTS trg_engagement_subscriptions_updated_at ON engagement_subscriptions;
CREATE TRIGGER trg_engagement_subscriptions_updated_at BEFORE UPDATE ON engagement_subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_engagement_updated_at();

------------------------------------------------------------------------------
-- 3. EMAIL OUTBOX — every queued message, observable with no transport. SENSITIVE.
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS engagement_email_outbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  uuid REFERENCES engagement_campaigns(id) ON DELETE SET NULL,
  to_email     text NOT NULL,
  subject      text NOT NULL,
  body         text NOT NULL DEFAULT '',
  template     text,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','skipped','failed')),
  transport    text,
  error        text,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_engagement_email_outbox_campaign
  ON engagement_email_outbox (campaign_id, created_at DESC);

-- Sensitive tables: RLS enabled, ZERO policies, revoked from app roles.
-- Written + read ONLY by the service-role notifications lib.
ALTER TABLE engagement_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_email_outbox  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_subscriptions FROM anon, authenticated;
REVOKE ALL ON public.engagement_email_outbox  FROM anon, authenticated;
