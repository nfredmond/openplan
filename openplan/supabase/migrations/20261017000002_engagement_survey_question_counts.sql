-- Survey response counts for a planner's own session, without the answers.
--
-- WHY THIS FUNCTION EXISTS
--
-- Survey answers belong to members of the public. 20260805000005 revoked every
-- client privilege on `engagement_survey_answers` and
-- `engagement_survey_response_sessions`, so only a service-role reader can
-- touch them, and the campaign page aggregates them that way after its own
-- access check. The Planner Agent's tools may not reach the service-role
-- client (a source guard in assistant-chat-tools.test.ts), so its survey read
-- always failed. In a live test on 2026-10-11 the agent told a planner that
-- survey results "couldn't be read from chat" on every campaign.
--
-- This function returns what that tool needs and nothing more: the number of
-- approved responses and, per question, its type, the prompt the respondent
-- saw and how many approved responses answered it. No answer, no answer text,
-- no session id, no respondent detail leaves the function.
--
-- SECURITY
--
-- SECURITY DEFINER because the caller has no privilege on the two tables. The
-- definer access is bounded by the explicit check below: the caller must be a
-- member of the workspace that owns the campaign, in any role, which is the
-- same audience the campaign page shows aggregated results to. A non-member,
-- or a campaign id that does not exist, gets the same refusal, so the function
-- cannot be used to test which campaign ids exist. `search_path` is empty and
-- every name is schema-qualified. `anon` and `public` cannot execute it.
--
-- WHAT COUNTS
--
-- The same rows the campaign page aggregates (`loadApprovedSurveyAnswers`):
-- answers whose session is approved, excluding answers a reviewer redacted
-- (`answer_json` carries `reviewed_redaction`). Questions are grouped by
-- configuration version, question id, prompt snapshot and type, as the page
-- groups them, so a question whose wording changed between versions is two
-- rows rather than one total that mixes two questions.
CREATE FUNCTION public.engagement_campaign_survey_question_counts(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace uuid;
  v_approved bigint;
  v_questions jsonb;
BEGIN
  SELECT c.workspace_id INTO v_workspace
  FROM public.engagement_campaigns c
  WHERE c.id = p_campaign_id;

  IF v_workspace IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = v_workspace AND m.user_id = (SELECT auth.uid())
  ) THEN
    RAISE EXCEPTION 'Survey counts are not available for this campaign' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_approved
  FROM public.engagement_survey_response_sessions s
  WHERE s.campaign_id = p_campaign_id AND s.status = 'approved';

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'configurationVersionId', g.configuration_version_id,
      'questionId', g.question_id,
      'questionType', g.question_type,
      'prompt', g.question_prompt_snapshot,
      'answeredCount', g.answered_count
    ) ORDER BY g.answered_count DESC, g.question_prompt_snapshot NULLS LAST), '[]'::jsonb)
  INTO v_questions
  FROM (
    SELECT s.configuration_version_id, a.question_id, a.question_type, a.question_prompt_snapshot,
      count(*)::bigint AS answered_count
    FROM public.engagement_survey_answers a
    JOIN public.engagement_survey_response_sessions s ON s.id = a.session_id
    WHERE a.campaign_id = p_campaign_id
      AND s.campaign_id = p_campaign_id
      AND s.status = 'approved'
      AND NOT (jsonb_typeof(a.answer_json) = 'object' AND a.answer_json ? 'reviewed_redaction')
    GROUP BY s.configuration_version_id, a.question_id, a.question_type, a.question_prompt_snapshot
  ) g;

  RETURN jsonb_build_object('approvedResponseCount', v_approved, 'questions', v_questions);
END
$$;

REVOKE ALL ON FUNCTION public.engagement_campaign_survey_question_counts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.engagement_campaign_survey_question_counts(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.engagement_campaign_survey_question_counts(uuid) TO authenticated;
