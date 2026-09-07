-- Reuse definitions only. A new consultation starts private, closed to submissions,
-- with draft questions and hidden layers. No response, photograph, vote or history is copied.
ALTER TABLE public.engagement_campaigns ADD COLUMN setup_request_id uuid,
 ADD COLUMN setup_source_configuration_id uuid REFERENCES public.engagement_configuration_versions(id);
CREATE UNIQUE INDEX engagement_setup_request_unique ON public.engagement_campaigns(workspace_id,setup_request_id) WHERE setup_request_id IS NOT NULL;
CREATE FUNCTION public.reuse_engagement_setup(p_campaign uuid,p_version uuid,p_request uuid,p_title text,p_project uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c engagement_campaigns; existing engagement_campaigns; d jsonb; target uuid; row_json jsonb; option_json jsonb; new_id uuid; ids jsonb='{}'; old_id text; mapped_id text; config_text text;
BEGIN
 SELECT * INTO c FROM engagement_campaigns WHERE id=p_campaign FOR UPDATE;
 IF c.id IS NULL OR NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=c.workspace_id AND user_id=auth.uid() AND role IN ('owner','admin','member')) THEN RAISE EXCEPTION 'Staff access required'; END IF;
 SELECT * INTO existing FROM engagement_campaigns WHERE workspace_id=c.workspace_id AND setup_request_id=p_request;
 IF FOUND THEN
  IF existing.setup_source_configuration_id IS DISTINCT FROM p_version OR existing.title IS DISTINCT FROM p_title OR existing.project_id IS DISTINCT FROM p_project THEN RAISE EXCEPTION 'Request identifier belongs to different setup'; END IF;
  RETURN existing.id;
 END IF;
 IF p_request IS NULL OR p_version IS DISTINCT FROM c.configuration_version_id OR length(btrim(p_title)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Setup changed; reload and review before reuse'; END IF;
 IF p_project IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=p_project AND workspace_id=c.workspace_id) THEN RAISE EXCEPTION 'Project is outside this workspace'; END IF;
 SELECT definition_json INTO d FROM engagement_configuration_versions WHERE id=p_version AND campaign_id=c.id;
 INSERT INTO engagement_campaigns(workspace_id,project_id,title,summary,public_description,engagement_type,status,allow_public_submissions,created_by,setup_request_id,setup_source_configuration_id,
   default_content_locale,accessibility_contact_label,accessibility_contact_email,accessibility_contact_phone,accessibility_alternate_formats,place_source,place_kind,place_ref,place_label,place_country_code,place_subdivision_code,place_min_lon,place_min_lat,place_max_lon,place_max_lat,place_geometry_geojson,place_set_at)
 VALUES(c.workspace_id,p_project,btrim(p_title),d->'campaign'->>'summary',d->'campaign'->>'instructions',c.engagement_type,'draft',false,auth.uid(),p_request,p_version,
   c.default_content_locale,c.accessibility_contact_label,c.accessibility_contact_email,c.accessibility_contact_phone,c.accessibility_alternate_formats,c.place_source,c.place_kind,c.place_ref,c.place_label,c.place_country_code,c.place_subdivision_code,c.place_min_lon,c.place_min_lat,c.place_max_lon,c.place_max_lat,c.place_geometry_geojson,c.place_set_at) RETURNING id INTO target;
 ids=jsonb_build_object(c.id::text,target);
 FOR row_json IN SELECT value FROM jsonb_array_elements(d->'categories') LOOP
  new_id=gen_random_uuid();ids=ids||jsonb_build_object(row_json->>'id',new_id);
  INSERT INTO engagement_categories(id,campaign_id,label,slug,description,color,sort_order,created_by)
   VALUES(new_id,target,row_json->>'label',new_id::text,row_json->>'description',row_json->>'color',(row_json->>'sort_order')::integer,auth.uid());
 END LOOP;
 -- Allocate every question/option ID before translating conditional references.
 FOR row_json IN SELECT value FROM jsonb_array_elements(d->'questions') LOOP
  ids=ids||jsonb_build_object(row_json->>'id',gen_random_uuid());
  FOR option_json IN SELECT value FROM jsonb_array_elements(row_json->'options') LOOP ids=ids||jsonb_build_object(option_json->>'id',gen_random_uuid()); END LOOP;
 END LOOP;
 FOR row_json IN SELECT value FROM jsonb_array_elements(d->'questions') LOOP
  config_text=COALESCE(row_json->'config_json','{}'::jsonb)::text;
  FOR old_id,mapped_id IN SELECT key,value FROM jsonb_each_text(ids) LOOP config_text=replace(config_text,old_id,mapped_id); END LOOP;
  INSERT INTO engagement_survey_questions(id,campaign_id,category_id,question_type,prompt,help_text,required,sort_order,config_json,status,is_active,created_by)
   VALUES((ids->>(row_json->>'id'))::uuid,target,(ids->>(row_json->>'category_id'))::uuid,row_json->>'question_type',row_json->>'prompt',row_json->>'help_text',(row_json->>'required')::boolean,(row_json->>'sort_order')::integer,config_text::jsonb,'draft',true,auth.uid());
  FOR option_json IN SELECT value FROM jsonb_array_elements(row_json->'options') LOOP
   INSERT INTO engagement_survey_question_options(id,campaign_id,question_id,label,value,sort_order,is_active,metadata_json)
    VALUES((ids->>(option_json->>'id'))::uuid,target,(ids->>(row_json->>'id'))::uuid,option_json->>'label',option_json->>'value',(option_json->>'sort_order')::integer,true,COALESCE(option_json->'metadata_json','{}'::jsonb));
  END LOOP;
 END LOOP;
 -- Context layers are copied from the current reviewed configuration but hidden
 -- until staff review their suitability for the new consultation.
 INSERT INTO engagement_context_layers(workspace_id,campaign_id,name,description,source_format,source_filename,source_byte_size,srs_authority,srs_code,srs_name,srs_basis,features,feature_count,source_feature_count,dropped_feature_count,truncated,geometry_kinds,bbox,display_color,sort_order,visible_to_participants,created_by)
 SELECT workspace_id,target,name,description,source_format,source_filename,source_byte_size,srs_authority,srs_code,srs_name,srs_basis,features,feature_count,source_feature_count,dropped_feature_count,truncated,geometry_kinds,bbox,display_color,sort_order,false,auth.uid() FROM engagement_context_layers WHERE campaign_id=c.id AND visible_to_participants;
 INSERT INTO engagement_content_translations(workspace_id,campaign_id,entity_type,entity_id,field,locale,translated_text,source,machine_model,source_text_hash,created_by)
 SELECT c.workspace_id,target,t.entity_type,(ids->>t.entity_id::text)::uuid,t.field,t.locale,t.translated_text,t.source,t.machine_model,t.source_text_hash,auth.uid()
 FROM engagement_content_translations t WHERE t.campaign_id=c.id AND ids ? t.entity_id::text AND t.entity_type<>'close_loop_entry';
 RETURN target;
END $$;
REVOKE ALL ON FUNCTION public.reuse_engagement_setup(uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reuse_engagement_setup(uuid,uuid,uuid,text,uuid) TO authenticated;
