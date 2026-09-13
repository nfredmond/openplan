-- Synthetic rows and all assertions execute inside one rolled-back transaction.
CREATE TEMP TABLE translation_scope_result(passed boolean NOT NULL);
CREATE FUNCTION pg_temp.try_translation(w uuid,c uuid,e text,target uuid,f text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE refused_by text;
BEGIN
 INSERT INTO public.engagement_content_translations(workspace_id,campaign_id,entity_type,entity_id,field,locale,translated_text,source,created_by)
 VALUES(w,c,e,target,f,'qaa','SYNTHETIC scope probe','operator',auth.uid());
 RETURN 'accepted';
EXCEPTION WHEN foreign_key_violation OR check_violation OR insufficient_privilege THEN
 GET STACKED DIAGNOSTICS refused_by=CONSTRAINT_NAME;
 RETURN COALESCE(NULLIF(refused_by,''),SQLSTATE);
END $$;

DO $proof$
DECLARE
 actor uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid();
 workspace_a uuid:=gen_random_uuid(); workspace_b uuid:=gen_random_uuid();
 campaign_a uuid:=gen_random_uuid(); campaign_b uuid:=gen_random_uuid();
 category_a uuid:=gen_random_uuid(); category_b uuid:=gen_random_uuid();
 question_a uuid:=gen_random_uuid(); question_b uuid:=gen_random_uuid();
 option_a uuid:=gen_random_uuid(); option_b uuid:=gen_random_uuid();
 response_a uuid:=gen_random_uuid(); response_b uuid:=gen_random_uuid();
 target record; observed text; refused_by text; before_definition uuid;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(actor,actor||'@example.test'),(outsider,outsider||'@example.test'),(viewer,viewer||'@example.test');
 INSERT INTO public.workspaces(id,name,slug) VALUES(workspace_a,'SYNTHETIC translation scope A',workspace_a::text),(workspace_b,'SYNTHETIC translation scope B',workspace_b::text);
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace_a,actor,'owner'),(workspace_a,viewer,'viewer'),(workspace_b,outsider,'owner');
 INSERT INTO public.engagement_campaigns(id,workspace_id,title) VALUES(campaign_a,workspace_a,'SYNTHETIC campaign A'),(campaign_b,workspace_b,'SYNTHETIC campaign B');
 INSERT INTO public.engagement_categories(id,campaign_id,label,slug) VALUES(category_a,campaign_a,'SYNTHETIC category A','scope-a'),(category_b,campaign_b,'SYNTHETIC category B','scope-b');
 INSERT INTO public.engagement_survey_questions(id,campaign_id,question_type,prompt) VALUES(question_a,campaign_a,'single_choice','SYNTHETIC question A'),(question_b,campaign_b,'single_choice','SYNTHETIC question B');
 INSERT INTO public.engagement_survey_question_options(id,campaign_id,question_id,label,value) VALUES(option_a,campaign_a,question_a,'SYNTHETIC option A','scope'),(option_b,campaign_b,question_b,'SYNTHETIC option B','scope');
 INSERT INTO public.engagement_closeloop_entries(id,campaign_id,theme_title,we_did,status) VALUES(response_a,campaign_a,'SYNTHETIC response A','SYNTHETIC action A','draft'),(response_b,campaign_b,'SYNTHETIC response B','SYNTHETIC action B','draft');
 SELECT configuration_version_id INTO before_definition FROM public.engagement_campaigns WHERE id=campaign_b;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 SET LOCAL ROLE authenticated;
 FOR target IN SELECT * FROM (VALUES
  ('campaign',campaign_a,campaign_b,'title','engagement_translation_target_field'),
  ('category',category_a,category_b,'label','engagement_translation_category_target'),
  ('survey_question',question_a,question_b,'prompt','engagement_translation_question_target'),
  ('survey_question_option',option_a,option_b,'label','engagement_translation_option_target'),
  ('close_loop_entry',response_a,response_b,'we_did','engagement_translation_response_target')
 ) AS cases(entity,own_id,foreign_id,field,refusal) LOOP
  observed:=pg_temp.try_translation(workspace_a,campaign_a,target.entity,target.own_id,target.field);
  IF observed<>'accepted' THEN RAISE EXCEPTION 'Own % translation refused: %',target.entity,observed; END IF;
  UPDATE public.engagement_content_translations SET translated_text='SYNTHETIC corrected wording' WHERE campaign_id=campaign_a AND entity_type=target.entity;
  IF NOT EXISTS(SELECT 1 FROM public.engagement_content_translations WHERE campaign_id=campaign_a AND entity_type=target.entity AND translated_text='SYNTHETIC corrected wording') THEN RAISE EXCEPTION 'Own correction failed'; END IF;
  DELETE FROM public.engagement_content_translations WHERE campaign_id=campaign_a AND entity_type=target.entity;
  observed:=pg_temp.try_translation(workspace_a,campaign_a,target.entity,target.foreign_id,target.field);
  IF observed<>target.refusal THEN RAISE EXCEPTION 'Foreign % target expected %, observed %',target.entity,target.refusal,observed; END IF;
 END LOOP;
 observed:=pg_temp.try_translation(workspace_a,campaign_b,'campaign',campaign_b,'title');
 IF observed<>'engagement_translation_campaign_workspace' THEN RAISE EXCEPTION 'Workspace forgery expected scope constraint, observed %',observed; END IF;
 observed:=pg_temp.try_translation(workspace_b,campaign_b,'campaign',campaign_b,'title');
 IF observed<>'42501' THEN RAISE EXCEPTION 'Foreign workspace write expected RLS, observed %',observed; END IF;
 observed:=pg_temp.try_translation(workspace_a,campaign_a,'campaign',campaign_a,'private_metadata');
 IF observed<>'engagement_translation_target_field' THEN RAISE EXCEPTION 'Unsupported field expected target constraint, observed %',observed; END IF;
 PERFORM set_config('request.jwt.claim.sub',viewer::text,true);
 observed:=pg_temp.try_translation(workspace_a,campaign_a,'campaign',campaign_a,'title');
 IF observed<>'42501' THEN RAISE EXCEPTION 'Viewer write expected RLS, observed %',observed; END IF;
 RESET ROLE;
 IF (SELECT configuration_version_id FROM public.engagement_campaigns WHERE id=campaign_b) IS DISTINCT FROM before_definition THEN RAISE EXCEPTION 'Foreign public definition changed'; END IF;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 observed:=pg_temp.try_translation(workspace_a,campaign_a,'category',category_a,'label');
 IF observed<>'accepted' THEN RAISE EXCEPTION 'Delete control insertion failed'; END IF;
 refused_by:=NULL;
 BEGIN UPDATE public.engagement_categories SET campaign_id=campaign_b WHERE id=category_a;
 EXCEPTION WHEN foreign_key_violation THEN GET STACKED DIAGNOSTICS refused_by=CONSTRAINT_NAME; END;
 IF refused_by IS DISTINCT FROM 'engagement_translation_category_target' THEN RAISE EXCEPTION 'Translated source move was not refused by its reference: %',refused_by; END IF;
 DELETE FROM public.engagement_categories WHERE id=category_a;
 IF EXISTS(SELECT 1 FROM public.engagement_content_translations WHERE entity_type='category' AND entity_id=category_a) THEN RAISE EXCEPTION 'Source removal stranded translation'; END IF;
 INSERT INTO pg_temp.translation_scope_result VALUES(true);
 RAISE NOTICE 'TRANSLATION_SCOPE_OK: all five own targets, corrections, withdrawal, foreign targets/workspace, viewer, field, source move and removal';
END $proof$;

SELECT 'translation-scope-verified' FROM pg_temp.translation_scope_result WHERE passed;
