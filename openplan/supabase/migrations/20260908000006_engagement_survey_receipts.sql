ALTER TABLE public.engagement_survey_response_sessions ADD COLUMN request_id uuid, ADD COLUMN request_sha256 text;
CREATE UNIQUE INDEX engagement_survey_request_unique ON public.engagement_survey_response_sessions(campaign_id,request_id) WHERE request_id IS NOT NULL;
CREATE FUNCTION public.submit_engagement_survey(p_campaign uuid,p_request uuid,p_hash text,p_version uuid,p_session jsonb,p_answers jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c record; s engagement_survey_response_sessions; a jsonb;
BEGIN
 SELECT * INTO c FROM engagement_campaigns WHERE id=p_campaign FOR UPDATE;
 IF p_request IS NOT NULL THEN
  SELECT * INTO s FROM engagement_survey_response_sessions WHERE campaign_id=p_campaign AND request_id=p_request;
  IF FOUND THEN
   IF s.request_sha256 IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Request identifier belongs to different answers'; END IF;
   RETURN s.id;
  END IF;
 END IF;
 IF c.id IS NULL OR c.status<>'active' OR NOT c.allow_public_submissions OR c.submissions_closed_at IS NOT NULL OR c.participation_starts_at>clock_timestamp() OR c.participation_ends_at<=clock_timestamp() THEN RAISE EXCEPTION 'Survey is not accepting responses'; END IF;
 IF p_version IS NOT NULL AND p_version IS DISTINCT FROM c.configuration_version_id THEN RAISE EXCEPTION 'Survey definition changed; review it before sending'; END IF;
 INSERT INTO engagement_survey_response_sessions(campaign_id,request_id,request_sha256,configuration_version_id,respondent_fingerprint,source_type,status,submitted_by,metadata_json)
 VALUES(p_campaign,p_request,p_hash,p_version,p_session->>'respondent_fingerprint','public',COALESCE(p_session->>'status','pending'),p_session->>'submitted_by',COALESCE(p_session->'metadata_json','{}'::jsonb)) RETURNING * INTO s;
 FOR a IN SELECT value FROM jsonb_array_elements(p_answers) LOOP
  INSERT INTO engagement_survey_answers(session_id,campaign_id,question_id,question_type,question_prompt_snapshot,answer_json,answer_text)
   VALUES(s.id,p_campaign,(a->>'questionId')::uuid,a->>'questionType',a->>'questionPromptSnapshot',a->'answerJson',a->>'answerText');
 END LOOP;
 RETURN s.id;
END $$;
REVOKE ALL ON FUNCTION public.submit_engagement_survey(uuid,uuid,text,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_engagement_survey(uuid,uuid,text,uuid,jsonb,jsonb) TO service_role;
CREATE TABLE public.engagement_survey_review_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),campaign_id uuid NOT NULL REFERENCES public.engagement_campaigns(id),session_id uuid NOT NULL REFERENCES public.engagement_survey_response_sessions(id),
 actor_id uuid REFERENCES auth.users(id),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),reason text NOT NULL,before_json jsonb NOT NULL,after_json jsonb NOT NULL
);
ALTER TABLE public.engagement_survey_review_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_survey_review_history FROM anon,authenticated;
GRANT SELECT ON public.engagement_survey_review_history TO authenticated;
CREATE POLICY engagement_survey_history_read ON public.engagement_survey_review_history FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.engagement_campaigns c JOIN public.workspace_members m ON m.workspace_id=c.workspace_id WHERE c.id=campaign_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member')));
CREATE TRIGGER engagement_survey_history_immutable BEFORE UPDATE OR DELETE ON public.engagement_survey_review_history FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();
CREATE FUNCTION public.review_engagement_survey(p_campaign uuid,p_session uuid,p_expected timestamptz,p_status text,p_reason text,p_redactions jsonb DEFAULT '{}'::jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c record; s engagement_survey_response_sessions; old_answers jsonb; new_answers jsonb; answer_id text; replacement text;
BEGIN
 SELECT * INTO c FROM engagement_campaigns WHERE id=p_campaign;
 IF NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=c.workspace_id AND user_id=auth.uid() AND role IN ('owner','admin','member')) THEN RAISE EXCEPTION 'Staff review access required'; END IF;
 SELECT * INTO s FROM engagement_survey_response_sessions WHERE id=p_session AND campaign_id=p_campaign FOR UPDATE;
 IF NOT FOUND OR s.updated_at<>p_expected THEN RAISE EXCEPTION 'Survey response changed; reload before review'; END IF;
 IF p_status NOT IN ('pending','flagged','approved','rejected') OR NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'A review state and reason are required'; END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) INTO old_answers FROM engagement_survey_answers a WHERE session_id=s.id;
 FOR answer_id,replacement IN SELECT key,value FROM jsonb_each_text(p_redactions) LOOP
  IF NOT EXISTS(SELECT 1 FROM engagement_survey_answers WHERE id=answer_id::uuid AND session_id=s.id) THEN RAISE EXCEPTION 'Answer does not belong to selected response'; END IF;
  UPDATE engagement_survey_answers SET answer_text=replacement,answer_json=jsonb_build_object('reviewed_redaction',replacement) WHERE id=answer_id::uuid AND session_id=s.id;
 END LOOP;
 UPDATE engagement_survey_response_sessions SET status=p_status,moderation_notes=p_reason,updated_at=clock_timestamp() WHERE id=s.id;
 SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) INTO new_answers FROM engagement_survey_answers a WHERE session_id=s.id;
 INSERT INTO engagement_survey_review_history(campaign_id,session_id,actor_id,reason,before_json,after_json)
 VALUES(p_campaign,s.id,auth.uid(),p_reason,jsonb_build_object('status',s.status,'answers',old_answers),jsonb_build_object('status',p_status,'answers',new_answers));
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.review_engagement_survey(uuid,uuid,timestamptz,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_engagement_survey(uuid,uuid,timestamptz,text,text,jsonb) TO authenticated;
