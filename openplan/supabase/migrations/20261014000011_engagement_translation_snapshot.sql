-- Return current source words, visibility and retained translation revisions
-- from one statement snapshot. A scalar JSON result is not a paginated rowset.
CREATE FUNCTION public.read_engagement_translation_snapshot(p_campaign uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE snapshot jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(
  SELECT 1 FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id
  WHERE c.id=p_campaign AND m.user_id=auth.uid()
 ) THEN RAISE EXCEPTION 'Campaign access required' USING ERRCODE='42501'; END IF;

 WITH categories AS MATERIALIZED (
  SELECT id,campaign_id,label,description,sort_order,created_at FROM engagement_categories WHERE campaign_id=p_campaign
 ), questions AS MATERIALIZED (
  SELECT id,campaign_id,prompt,help_text,is_active,status,sort_order,created_at
   FROM engagement_survey_questions WHERE campaign_id=p_campaign
 ), options AS MATERIALIZED (
  SELECT o.id,o.campaign_id,o.question_id,o.label,o.is_active,o.sort_order
   FROM engagement_survey_question_options o JOIN questions q ON q.id=o.question_id
   WHERE o.campaign_id=p_campaign
 ), responses AS MATERIALIZED (
  SELECT id,campaign_id,theme_title,you_said,we_did,status,sort_order,created_at
   FROM engagement_closeloop_entries WHERE campaign_id=p_campaign
 ), translations AS MATERIALIZED (
  SELECT t.id,t.workspace_id,t.campaign_id,t.entity_type,t.entity_id,t.field,t.locale,
   t.translated_text,t.source,t.machine_model,t.source_text_hash,t.created_by,t.updated_at,
   (SELECT max(h.revision) FROM engagement_translation_history h WHERE h.translation_id=t.id AND h.campaign_id=p_campaign) AS revision
   FROM engagement_content_translations t WHERE t.campaign_id=p_campaign
 )
 SELECT jsonb_build_object(
  'schema',1,'campaignId',p_campaign,
  'campaign',jsonb_build_object('id',c.id,'title',c.title,'summary',c.summary,
   'public_description',c.public_description,'default_content_locale',c.default_content_locale),
  'categories',COALESCE((SELECT jsonb_agg(to_jsonb(k)-'sort_order'-'created_at' ORDER BY sort_order,created_at,id) FROM categories k),'[]'::jsonb),
  'questions',COALESCE((SELECT jsonb_agg(to_jsonb(q)-'sort_order'-'created_at' ORDER BY sort_order,created_at,id) FROM questions q),'[]'::jsonb),
  'options',COALESCE((SELECT jsonb_agg(to_jsonb(o)-'sort_order' ORDER BY sort_order,id) FROM options o),'[]'::jsonb),
  'responses',COALESCE((SELECT jsonb_agg(to_jsonb(r)-'sort_order'-'created_at' ORDER BY sort_order,created_at,id) FROM responses r),'[]'::jsonb),
  'translations',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM translations t),'[]'::jsonb),
  'counts',jsonb_build_object('categories',(SELECT count(*) FROM categories),'questions',(SELECT count(*) FROM questions),
   'options',(SELECT count(*) FROM options),'responses',(SELECT count(*) FROM responses),'translations',(SELECT count(*) FROM translations))
 ) INTO snapshot FROM engagement_campaigns c WHERE c.id=p_campaign;
 IF snapshot IS NULL THEN RAISE EXCEPTION 'Campaign no longer exists' USING ERRCODE='42501'; END IF;
 RETURN snapshot;
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_translation_snapshot(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_engagement_translation_snapshot(uuid) TO authenticated;
