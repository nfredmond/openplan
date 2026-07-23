-- Wave 5.1 — structured survey / form builder over the engagement module.
-- Posture:
--  * engagement_survey_questions + _question_options = SURVEY DEFINITION,
--    authored by workspace members -> OPERATOR-scoped RLS, campaign->workspace,
--    mirroring engagement_categories exactly.
--  * engagement_survey_response_sessions + _answers = PUBLIC-SUBMITTED data
--    (fingerprints, verbatim text, map coords, file paths) -> SENSITIVE:
--    RLS ENABLED, ZERO policies, REVOKE ALL FROM anon, authenticated. Same
--    posture as engagement_item_votes / engagement_item_demographics. Written
--    only by the service-role submit route; read only by campaign-scoped
--    service-role SSR (enforced by a reader-inventory test). NEVER anon RLS.
--  * Reporting/public aggregation reads count status='approved' sessions only
--    (moderation parity with engagement_demographics_summary).
--  * Answers snapshot question_type (+ prompt) and hold a denormalized
--    answer_text so history survives option/question edits or deletion.

-- 0. Optional per-campaign soft one-response flag (NOT a hard DB unique -- the
--    IP-only fingerprint would lock out shared NAT/library/office Wi-Fi).
ALTER TABLE engagement_campaigns
  ADD COLUMN IF NOT EXISTS survey_one_response_per_fingerprint boolean NOT NULL DEFAULT false;

------------------------------------------------------------------------------
-- 1. QUESTIONS -- operator-scoped definition.
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS engagement_survey_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES engagement_campaigns(id) ON DELETE CASCADE,
  category_id   uuid REFERENCES engagement_categories(id) ON DELETE SET NULL, -- optional survey section
  question_type text NOT NULL CHECK (question_type IN (
    'single_choice','multiple_choice','likert','rating','ranking',
    'map_point','budget_allocation','free_text','file_upload'
  )),
  prompt        text NOT NULL,
  help_text     text,
  required      boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,   -- soft-archive instead of delete once responses exist
  sort_order    integer NOT NULL DEFAULT 0,
  config_json   jsonb NOT NULL DEFAULT '{}'::jsonb,   -- per-type config, validated by survey.ts
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

------------------------------------------------------------------------------
-- 2. QUESTION OPTIONS -- operator-scoped; only choice/ranking/budget use it.
--    campaign_id denormalized (like votes) so RLS + scope is one column.
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS engagement_survey_question_options (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id   uuid NOT NULL REFERENCES engagement_survey_questions(id) ON DELETE CASCADE,
  campaign_id   uuid NOT NULL REFERENCES engagement_campaigns(id) ON DELETE CASCADE,
  label         text NOT NULL,
  value         text,                                  -- optional stable slug/code
  is_active     boolean NOT NULL DEFAULT true,          -- soft-archive once responses exist
  sort_order    integer NOT NULL DEFAULT 0,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,     -- e.g. {"unit_cost":250} for budget lines
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_id, value)
);

------------------------------------------------------------------------------
-- 3. RESPONSE SESSIONS -- SENSITIVE, service-role only. One row per submission.
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS engagement_survey_response_sessions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id            uuid NOT NULL REFERENCES engagement_campaigns(id) ON DELETE CASCADE,
  respondent_fingerprint text,                          -- buildPublicSubmissionClientFingerprint (IP-only)
  source_type            text NOT NULL DEFAULT 'public'
                           CHECK (source_type IN ('internal','public','meeting','email')),
  status                 text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','approved','rejected','flagged')),
  submitted_by           text,                          -- optional self-entered name/email
  metadata_json          jsonb NOT NULL DEFAULT '{}'::jsonb, -- safety fingerprints, referer, UA, auto_flag_reason
  moderation_notes       text,
  created_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL, -- set for staff-entered rows
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

------------------------------------------------------------------------------
-- 4. RESPONSE ANSWERS -- SENSITIVE, service-role only.
--    question_id ON DELETE SET NULL + question_type/prompt snapshot = durable.
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS engagement_survey_answers (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id               uuid NOT NULL REFERENCES engagement_survey_response_sessions(id) ON DELETE CASCADE,
  question_id              uuid REFERENCES engagement_survey_questions(id) ON DELETE SET NULL, -- history outlives deletion
  campaign_id              uuid NOT NULL REFERENCES engagement_campaigns(id) ON DELETE CASCADE, -- denormalized scope
  question_type            text NOT NULL CHECK (question_type IN (
    'single_choice','multiple_choice','likert','rating','ranking',
    'map_point','budget_allocation','free_text','file_upload'
  )),                                                    -- snapshot: survives question deletion
  question_prompt_snapshot text,                         -- prompt at submit time, for durable export
  answer_json              jsonb NOT NULL,               -- canonical typed value
  answer_text              text,                         -- denormalized human/search projection
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, question_id),                      -- one answer per question per submission
  CONSTRAINT engagement_survey_answers_json_object_check CHECK (jsonb_typeof(answer_json) = 'object')
);

------------------------------------------------------------------------------
-- Indexes
------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_survey_questions_campaign_sort
  ON engagement_survey_questions(campaign_id, sort_order ASC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_survey_options_question_sort
  ON engagement_survey_question_options(question_id, sort_order ASC);
CREATE INDEX IF NOT EXISTS idx_survey_options_campaign
  ON engagement_survey_question_options(campaign_id);
CREATE INDEX IF NOT EXISTS idx_survey_sessions_campaign_created
  ON engagement_survey_response_sessions(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_survey_sessions_campaign_status
  ON engagement_survey_response_sessions(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_survey_sessions_campaign_fp_created
  ON engagement_survey_response_sessions(campaign_id, respondent_fingerprint, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_survey_answers_campaign_question
  ON engagement_survey_answers(campaign_id, question_id);
CREATE INDEX IF NOT EXISTS idx_survey_answers_session
  ON engagement_survey_answers(session_id);

------------------------------------------------------------------------------
-- Integrity triggers (defense-in-depth for the service-role write path).
------------------------------------------------------------------------------
-- option.campaign_id must equal its question's campaign_id.
CREATE OR REPLACE FUNCTION validate_survey_option_campaign()
RETURNS TRIGGER AS $$
DECLARE q_campaign uuid;
BEGIN
  SELECT campaign_id INTO q_campaign FROM engagement_survey_questions WHERE id = NEW.question_id;
  IF q_campaign IS NULL THEN RAISE EXCEPTION 'survey question % not found', NEW.question_id; END IF;
  IF q_campaign <> NEW.campaign_id THEN
    RAISE EXCEPTION 'survey option campaign must match its question campaign';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SET search_path = public, pg_temp;

-- answer.campaign_id + answer.question_type must match the question, and the
-- question's campaign must match the session's campaign. Question checks are
-- skipped when question_id is NULL (a question was deleted -> ON DELETE SET NULL
-- fires a FK UPDATE on this row; snapshot columns keep it interpretable).
CREATE OR REPLACE FUNCTION validate_survey_answer_integrity()
RETURNS TRIGGER AS $$
DECLARE q_campaign uuid; q_type text; s_campaign uuid;
BEGIN
  SELECT campaign_id INTO s_campaign FROM engagement_survey_response_sessions WHERE id = NEW.session_id;
  IF s_campaign IS NULL THEN RAISE EXCEPTION 'survey session % not found', NEW.session_id; END IF;
  IF s_campaign <> NEW.campaign_id THEN
    RAISE EXCEPTION 'survey answer campaign must match its session campaign';
  END IF;
  IF NEW.question_id IS NOT NULL THEN
    SELECT campaign_id, question_type INTO q_campaign, q_type
      FROM engagement_survey_questions WHERE id = NEW.question_id;
    IF q_campaign IS NULL THEN RAISE EXCEPTION 'survey question % not found', NEW.question_id; END IF;
    IF q_campaign <> NEW.campaign_id THEN
      RAISE EXCEPTION 'survey answer campaign must match its question campaign';
    END IF;
    IF q_type <> NEW.question_type THEN
      RAISE EXCEPTION 'survey answer question_type must match its question';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_survey_option_campaign ON engagement_survey_question_options;
CREATE TRIGGER trg_survey_option_campaign
  BEFORE INSERT OR UPDATE ON engagement_survey_question_options
  FOR EACH ROW EXECUTE FUNCTION validate_survey_option_campaign();

DROP TRIGGER IF EXISTS trg_survey_answer_integrity ON engagement_survey_answers;
CREATE TRIGGER trg_survey_answer_integrity
  BEFORE INSERT OR UPDATE ON engagement_survey_answers
  FOR EACH ROW EXECUTE FUNCTION validate_survey_answer_integrity();

------------------------------------------------------------------------------
-- updated_at triggers (reuse set_engagement_updated_at from 20260314000020).
------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_survey_questions_updated_at ON engagement_survey_questions;
CREATE TRIGGER trg_survey_questions_updated_at BEFORE UPDATE ON engagement_survey_questions
  FOR EACH ROW EXECUTE FUNCTION set_engagement_updated_at();
DROP TRIGGER IF EXISTS trg_survey_options_updated_at ON engagement_survey_question_options;
CREATE TRIGGER trg_survey_options_updated_at BEFORE UPDATE ON engagement_survey_question_options
  FOR EACH ROW EXECUTE FUNCTION set_engagement_updated_at();
DROP TRIGGER IF EXISTS trg_survey_sessions_updated_at ON engagement_survey_response_sessions;
CREATE TRIGGER trg_survey_sessions_updated_at BEFORE UPDATE ON engagement_survey_response_sessions
  FOR EACH ROW EXECUTE FUNCTION set_engagement_updated_at();

------------------------------------------------------------------------------
-- RLS: operator-scoped definition tables (mirror engagement_categories).
------------------------------------------------------------------------------
ALTER TABLE engagement_survey_questions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_survey_question_options ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_survey_questions' AND policyname='engagement_survey_questions_read') THEN
    CREATE POLICY engagement_survey_questions_read ON engagement_survey_questions FOR SELECT USING (
      EXISTS (SELECT 1 FROM engagement_campaigns campaign JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
              WHERE campaign.id = engagement_survey_questions.campaign_id AND wm.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_survey_questions' AND policyname='engagement_survey_questions_insert') THEN
    CREATE POLICY engagement_survey_questions_insert ON engagement_survey_questions FOR INSERT WITH CHECK (
      EXISTS (SELECT 1 FROM engagement_campaigns campaign JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
              WHERE campaign.id = engagement_survey_questions.campaign_id AND wm.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_survey_questions' AND policyname='engagement_survey_questions_update') THEN
    CREATE POLICY engagement_survey_questions_update ON engagement_survey_questions FOR UPDATE
      USING (EXISTS (SELECT 1 FROM engagement_campaigns campaign JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
              WHERE campaign.id = engagement_survey_questions.campaign_id AND wm.user_id = auth.uid()))
      WITH CHECK (EXISTS (SELECT 1 FROM engagement_campaigns campaign JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
              WHERE campaign.id = engagement_survey_questions.campaign_id AND wm.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_survey_questions' AND policyname='engagement_survey_questions_delete') THEN
    CREATE POLICY engagement_survey_questions_delete ON engagement_survey_questions FOR DELETE USING (
      EXISTS (SELECT 1 FROM engagement_campaigns campaign JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
              WHERE campaign.id = engagement_survey_questions.campaign_id AND wm.user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_survey_question_options' AND policyname='engagement_survey_question_options_read') THEN
    CREATE POLICY engagement_survey_question_options_read ON engagement_survey_question_options FOR SELECT USING (
      EXISTS (SELECT 1 FROM engagement_campaigns campaign JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
              WHERE campaign.id = engagement_survey_question_options.campaign_id AND wm.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_survey_question_options' AND policyname='engagement_survey_question_options_insert') THEN
    CREATE POLICY engagement_survey_question_options_insert ON engagement_survey_question_options FOR INSERT WITH CHECK (
      EXISTS (SELECT 1 FROM engagement_campaigns campaign JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
              WHERE campaign.id = engagement_survey_question_options.campaign_id AND wm.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_survey_question_options' AND policyname='engagement_survey_question_options_update') THEN
    CREATE POLICY engagement_survey_question_options_update ON engagement_survey_question_options FOR UPDATE
      USING (EXISTS (SELECT 1 FROM engagement_campaigns campaign JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
              WHERE campaign.id = engagement_survey_question_options.campaign_id AND wm.user_id = auth.uid()))
      WITH CHECK (EXISTS (SELECT 1 FROM engagement_campaigns campaign JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
              WHERE campaign.id = engagement_survey_question_options.campaign_id AND wm.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_survey_question_options' AND policyname='engagement_survey_question_options_delete') THEN
    CREATE POLICY engagement_survey_question_options_delete ON engagement_survey_question_options FOR DELETE USING (
      EXISTS (SELECT 1 FROM engagement_campaigns campaign JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
              WHERE campaign.id = engagement_survey_question_options.campaign_id AND wm.user_id = auth.uid()));
  END IF;
END $$;

------------------------------------------------------------------------------
-- RLS: sensitive response tables -- enabled, ZERO policies, service-role only.
------------------------------------------------------------------------------
ALTER TABLE engagement_survey_response_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_survey_answers           ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_survey_response_sessions FROM anon, authenticated;
REVOKE ALL ON public.engagement_survey_answers           FROM anon, authenticated;
