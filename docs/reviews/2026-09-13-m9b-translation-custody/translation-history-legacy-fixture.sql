DO $seed$ BEGIN
 IF EXISTS(SELECT 1 FROM public.engagement_content_translations WHERE campaign_id='a3c41566-bfd4-40f2-b467-96ee79054ec6' AND locale='qab') THEN RAISE EXCEPTION 'Refuse existing legacy probe locale'; END IF;
 INSERT INTO public.engagement_content_translations(workspace_id,campaign_id,entity_type,entity_id,field,locale,translated_text,source,machine_model,created_by)
 SELECT workspace_id,id,'campaign',id,'title','qab','Synthetic pre-upgrade translation','machine','synthetic-legacy-model','4a21e42f-27a7-474d-9a7a-5912c70af359' FROM public.engagement_campaigns WHERE id='a3c41566-bfd4-40f2-b467-96ee79054ec6';
END $seed$;
