ALTER TABLE public.engagement_campaigns ADD COLUMN participation_starts_at timestamptz, ADD COLUMN participation_ends_at timestamptz,
  ADD CONSTRAINT engagement_participation_dates CHECK (participation_ends_at IS NULL OR participation_starts_at IS NULL OR participation_ends_at > participation_starts_at);
CREATE TABLE public.engagement_configuration_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.engagement_campaigns(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  definition_sha256 text NOT NULL,
  definition_json jsonb NOT NULL,
  UNIQUE(campaign_id,definition_sha256), UNIQUE(campaign_id,id)
);
ALTER TABLE public.engagement_configuration_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_configuration_versions FROM anon,authenticated;
GRANT SELECT ON public.engagement_configuration_versions TO authenticated;
CREATE POLICY engagement_configuration_staff_read ON public.engagement_configuration_versions FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.engagement_campaigns c JOIN public.workspace_members m ON m.workspace_id=c.workspace_id WHERE c.id=campaign_id AND m.user_id=auth.uid())
);
CREATE TRIGGER engagement_configuration_immutable BEFORE UPDATE OR DELETE ON public.engagement_configuration_versions
FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();
ALTER TABLE public.engagement_campaigns ADD COLUMN configuration_version_id uuid REFERENCES public.engagement_configuration_versions(id);
ALTER TABLE public.engagement_items ADD COLUMN configuration_version_id uuid,
 ADD CONSTRAINT engagement_item_configuration_scope FOREIGN KEY(campaign_id,configuration_version_id) REFERENCES public.engagement_configuration_versions(campaign_id,id);
ALTER TABLE public.engagement_survey_response_sessions ADD COLUMN configuration_version_id uuid,
 ADD CONSTRAINT engagement_survey_configuration_scope FOREIGN KEY(campaign_id,configuration_version_id) REFERENCES public.engagement_configuration_versions(campaign_id,id);

-- Only public definitions, never participant records, tokens, authors or internal metadata.
CREATE OR REPLACE FUNCTION public.capture_engagement_configuration(p_campaign uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE d jsonb; v uuid;
BEGIN
  PERFORM 1 FROM engagement_campaigns WHERE id=p_campaign FOR UPDATE;
  SELECT jsonb_build_object('schema',1,'campaign',jsonb_build_object(
    'title',c.title,'summary',c.summary,'instructions',c.public_description,'default_content_locale',c.default_content_locale,'engagement_type',c.engagement_type,
    'participation_starts_at',c.participation_starts_at,'participation_ends_at',c.participation_ends_at,
    'project_frame',jsonb_build_object('label',p.place_label,'bbox',jsonb_build_array(p.place_min_lon,p.place_min_lat,p.place_max_lon,p.place_max_lat),'source',p.place_source),
    'workspace_frame',jsonb_build_object('label',w.home_geography_label,'bbox',jsonb_build_array(w.home_min_lon,w.home_min_lat,w.home_max_lon,w.home_max_lat),'source',w.home_geography_source),
    'place_label',c.place_label,'place_geometry_geojson',c.place_geometry_geojson,'place_bbox',jsonb_build_array(c.place_min_lon,c.place_min_lat,c.place_max_lon,c.place_max_lat),
    'submission_geofence_enabled',c.submission_geofence_enabled,'demographics_enabled',c.demographics_enabled,
    'accessibility_contact_label',c.accessibility_contact_label,'accessibility_contact_email',c.accessibility_contact_email,
    'accessibility_contact_phone',c.accessibility_contact_phone,'accessibility_alternate_formats',c.accessibility_alternate_formats),
    'categories',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'label',x.label,'description',x.description,'color',x.color,'sort_order',x.sort_order) ORDER BY x.sort_order,x.id) FROM engagement_categories x WHERE x.campaign_id=c.id),'[]'::jsonb),
    'questions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',q.id,'question_type',q.question_type,'prompt',q.prompt,'help_text',q.help_text,'required',q.required,'category_id',q.category_id,'config_json',q.config_json,'sort_order',q.sort_order,
      'options',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',o.id,'label',o.label,'value',o.value,'metadata_json',o.metadata_json,'sort_order',o.sort_order) ORDER BY o.sort_order,o.id) FROM engagement_survey_question_options o WHERE o.question_id=q.id AND o.is_active),'[]'::jsonb)) ORDER BY q.sort_order,q.id) FROM engagement_survey_questions q WHERE q.campaign_id=c.id AND q.is_active AND q.status='published'),'[]'::jsonb),
    'translations',COALESCE((SELECT jsonb_agg(jsonb_build_object('entity_type',t.entity_type,'entity_id',t.entity_id,'field',t.field,'locale',t.locale,'translated_text',t.translated_text,'source',t.source,'source_text_hash',t.source_text_hash) ORDER BY t.entity_type,t.entity_id,t.field,t.locale) FROM engagement_content_translations t WHERE t.campaign_id=c.id AND (t.entity_type='campaign' OR (t.entity_type='category' AND EXISTS(SELECT 1 FROM engagement_categories x WHERE x.id=t.entity_id AND x.campaign_id=c.id)) OR (t.entity_type='survey_question' AND EXISTS(SELECT 1 FROM engagement_survey_questions q WHERE q.id=t.entity_id AND q.campaign_id=c.id AND q.is_active AND q.status='published')) OR (t.entity_type='survey_question_option' AND EXISTS(SELECT 1 FROM engagement_survey_question_options o JOIN engagement_survey_questions q ON q.id=o.question_id WHERE o.id=t.entity_id AND q.campaign_id=c.id AND q.is_active AND q.status='published' AND o.is_active)))),'[]'::jsonb),
    'layers',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'description',l.description,'features',l.features) ORDER BY l.id) FROM engagement_context_layers l WHERE l.campaign_id=c.id AND l.visible_to_participants),'[]'::jsonb)
  ) INTO d FROM engagement_campaigns c LEFT JOIN projects p ON p.id=c.project_id JOIN workspaces w ON w.id=c.workspace_id WHERE c.id=p_campaign;
  IF d IS NULL THEN RETURN NULL; END IF;
  INSERT INTO engagement_configuration_versions(campaign_id,definition_sha256,definition_json)
    VALUES(p_campaign,encode(digest(d::text,'sha256'),'hex'),d) ON CONFLICT(campaign_id,definition_sha256) DO NOTHING;
  SELECT id INTO v FROM engagement_configuration_versions WHERE campaign_id=p_campaign AND definition_sha256=encode(digest(d::text,'sha256'),'hex');
  UPDATE engagement_campaigns SET configuration_version_id=v WHERE id=p_campaign AND configuration_version_id IS DISTINCT FROM v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.capture_engagement_configuration(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.capture_engagement_configuration(uuid) TO service_role;
CREATE FUNCTION public.refresh_engagement_configuration() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='engagement_campaigns' THEN
    IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['updated_at','configuration_version_id']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['updated_at','configuration_version_id']) THEN RETURN NEW; END IF;
    PERFORM capture_engagement_configuration(NEW.id);
  ELSE
    PERFORM capture_engagement_configuration(COALESCE(NEW.campaign_id,OLD.campaign_id));
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
REVOKE ALL ON FUNCTION public.refresh_engagement_configuration() FROM PUBLIC;
CREATE TRIGGER engagement_campaign_configuration AFTER INSERT OR UPDATE ON public.engagement_campaigns FOR EACH ROW EXECUTE FUNCTION public.refresh_engagement_configuration();
CREATE TRIGGER engagement_category_configuration AFTER INSERT OR UPDATE OR DELETE ON public.engagement_categories FOR EACH ROW EXECUTE FUNCTION public.refresh_engagement_configuration();
CREATE TRIGGER engagement_question_configuration AFTER INSERT OR UPDATE OR DELETE ON public.engagement_survey_questions FOR EACH ROW EXECUTE FUNCTION public.refresh_engagement_configuration();
CREATE TRIGGER engagement_option_configuration AFTER INSERT OR UPDATE OR DELETE ON public.engagement_survey_question_options FOR EACH ROW EXECUTE FUNCTION public.refresh_engagement_configuration();
CREATE TRIGGER engagement_layer_configuration AFTER INSERT OR UPDATE OR DELETE ON public.engagement_context_layers FOR EACH ROW EXECUTE FUNCTION public.refresh_engagement_configuration();
CREATE TRIGGER engagement_translation_configuration AFTER INSERT OR UPDATE OR DELETE ON public.engagement_content_translations FOR EACH ROW EXECUTE FUNCTION public.refresh_engagement_configuration();
-- Historical contributions intentionally remain NULL. Today's definition cannot establish what they saw.
SELECT public.capture_engagement_configuration(id) FROM public.engagement_campaigns;

-- Refresh inherited public map frames when their source changes. No participant data enters a definition.
CREATE FUNCTION public.refresh_engagement_inherited_frame() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE campaign_id uuid;
BEGIN
 IF TG_TABLE_NAME='projects' THEN
  FOR campaign_id IN SELECT id FROM engagement_campaigns WHERE project_id=NEW.id LOOP PERFORM capture_engagement_configuration(campaign_id); END LOOP;
 ELSE
  FOR campaign_id IN SELECT id FROM engagement_campaigns WHERE workspace_id=NEW.id LOOP PERFORM capture_engagement_configuration(campaign_id); END LOOP;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.refresh_engagement_inherited_frame() FROM PUBLIC;
CREATE TRIGGER engagement_project_frame AFTER UPDATE OF place_source,place_label,place_min_lon,place_min_lat,place_max_lon,place_max_lat ON public.projects FOR EACH ROW EXECUTE FUNCTION public.refresh_engagement_inherited_frame();
CREATE TRIGGER engagement_workspace_frame AFTER UPDATE OF home_geography_source,home_geography_label,home_min_lon,home_min_lat,home_max_lon,home_max_lat ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.refresh_engagement_inherited_frame();
