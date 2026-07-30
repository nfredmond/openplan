-- Save-and-resume for a campaign survey answered by an ANONYMOUS participant.
--
-- WHY THIS IS ITS OWN TABLE AND NOT A STATUS ON engagement_survey_response_sessions.
--
-- `engagement_survey_response_sessions.status` is a MODERATION state
-- (pending/approved/rejected/flagged) — it says what a reviewer has decided
-- about a submitted response, not how far a respondent got. Adding a progress
-- value to it, or a `submitted_at IS NULL` convention beside it, would put
-- part-finished drafts into the same table every count in the product reads:
--   * aggregateCampaignSurvey() counts sessions,
--   * the moderation queue lists them,
--   * the representativeness reading is built from approved ones,
--   * loadRecentFingerprintSessions() rate-limits on them.
-- Every one of those would then need a filter nobody can forget, forever. A
-- survey reporting 40 responses when 12 are abandoned drafts is a false claim
-- about turnout, made to an agency that will publish it, and the cheapest
-- guarantee against it is that a draft is not the same kind of row as a
-- response. It is structurally impossible for anything reading sessions or
-- answers to count what is in here.
--
-- SENSITIVITY. A draft holds a resident's part-finished answers, which on these
-- surveys include demographics. Same posture as the response tables: RLS
-- ENABLED, ZERO policies, REVOKE ALL FROM anon/authenticated. Reached only by
-- the service-role draft routes, through the confined reader module.
--
-- THE RESUME CREDENTIAL. `resume_token_hash` is the SHA-256 of a 256-bit random
-- token that is generated once, handed to the browser once, and NEVER stored.
-- The database cannot reopen a draft it holds, which is the property that makes
-- a stolen backup not a key to every part-finished response. See
-- src/lib/engagement/survey-drafts.ts.
--
-- RETENTION. `expires_at` is set by the application from ONE constant
-- (SURVEY_DRAFT_RETENTION_DAYS in src/lib/engagement/survey.ts) — the same
-- number the participant is shown. Reads filter on it, so an expired draft is
-- unreachable the moment it expires whether or not the row has been swept yet;
-- the routes also delete expired rows for the campaign they touch.

CREATE TABLE IF NOT EXISTS engagement_survey_response_drafts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id            uuid NOT NULL REFERENCES engagement_campaigns(id) ON DELETE CASCADE,
  -- SHA-256 hex of the resume token. Unique across the table: the token is
  -- globally random, so one hash naming two drafts would be a defect, not a
  -- namespacing question.
  resume_token_hash      text NOT NULL UNIQUE,
  -- IP-only fingerprint, used ONLY to bound how many live drafts one connection
  -- may create. Never used to reopen a draft: a shared network would then let
  -- one resident resume another's answers.
  respondent_fingerprint text,
  -- {"version":1,"answers":[{"questionId":uuid,"answer":<canonical answer_json>}]}
  answers_json           jsonb NOT NULL DEFAULT '{"version":1,"answers":[]}'::jsonb,
  answered_count         integer NOT NULL DEFAULT 0 CHECK (answered_count >= 0),
  expires_at             timestamptz NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engagement_survey_drafts_json_object_check CHECK (jsonb_typeof(answers_json) = 'object'),
  CONSTRAINT engagement_survey_drafts_expiry_after_creation CHECK (expires_at > created_at)
);

-- Resume: (campaign, hash). The hash alone is unique, but every read is
-- campaign-scoped so a token minted on one campaign cannot address another's row.
CREATE INDEX IF NOT EXISTS idx_survey_drafts_campaign_token
  ON engagement_survey_response_drafts(campaign_id, resume_token_hash);
-- Expiry sweep.
CREATE INDEX IF NOT EXISTS idx_survey_drafts_campaign_expires
  ON engagement_survey_response_drafts(campaign_id, expires_at);
-- Live-draft cap per connection.
CREATE INDEX IF NOT EXISTS idx_survey_drafts_campaign_fingerprint
  ON engagement_survey_response_drafts(campaign_id, respondent_fingerprint);

DROP TRIGGER IF EXISTS trg_survey_drafts_updated_at ON engagement_survey_response_drafts;
CREATE TRIGGER trg_survey_drafts_updated_at BEFORE UPDATE ON engagement_survey_response_drafts
  FOR EACH ROW EXECUTE FUNCTION set_engagement_updated_at();

ALTER TABLE engagement_survey_response_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_survey_response_drafts FROM anon, authenticated;
