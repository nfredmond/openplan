-- A translation's declared workspace must own its campaign. Each polymorphic
-- target must belong to that same campaign, including direct authenticated
-- writes. Generated references make the relationships native foreign keys;
-- concurrent source moves cannot strand or reinterpret a translation.
-- Existing inconsistent rows refuse this migration and require investigation.
ALTER TABLE public.engagement_campaigns
 ADD CONSTRAINT engagement_campaigns_id_workspace_key UNIQUE(id,workspace_id);
ALTER TABLE public.engagement_categories
 ADD CONSTRAINT engagement_categories_campaign_id_key UNIQUE(campaign_id,id);
ALTER TABLE public.engagement_survey_questions
 ADD CONSTRAINT engagement_questions_campaign_id_key UNIQUE(campaign_id,id);
ALTER TABLE public.engagement_survey_question_options
 ADD CONSTRAINT engagement_options_campaign_id_key UNIQUE(campaign_id,id);
ALTER TABLE public.engagement_closeloop_entries
 ADD CONSTRAINT engagement_responses_campaign_id_key UNIQUE(campaign_id,id);

ALTER TABLE public.engagement_content_translations
 ADD COLUMN category_target_id uuid GENERATED ALWAYS AS (CASE WHEN entity_type='category' THEN entity_id END) STORED,
 ADD COLUMN question_target_id uuid GENERATED ALWAYS AS (CASE WHEN entity_type='survey_question' THEN entity_id END) STORED,
 ADD COLUMN option_target_id uuid GENERATED ALWAYS AS (CASE WHEN entity_type='survey_question_option' THEN entity_id END) STORED,
 ADD COLUMN response_target_id uuid GENERATED ALWAYS AS (CASE WHEN entity_type='close_loop_entry' THEN entity_id END) STORED,
 ADD CONSTRAINT engagement_translation_campaign_workspace FOREIGN KEY(campaign_id,workspace_id)
  REFERENCES public.engagement_campaigns(id,workspace_id) ON UPDATE RESTRICT ON DELETE CASCADE,
 ADD CONSTRAINT engagement_translation_category_target FOREIGN KEY(campaign_id,category_target_id)
  REFERENCES public.engagement_categories(campaign_id,id) ON UPDATE RESTRICT ON DELETE CASCADE,
 ADD CONSTRAINT engagement_translation_question_target FOREIGN KEY(campaign_id,question_target_id)
  REFERENCES public.engagement_survey_questions(campaign_id,id) ON UPDATE RESTRICT ON DELETE CASCADE,
 ADD CONSTRAINT engagement_translation_option_target FOREIGN KEY(campaign_id,option_target_id)
  REFERENCES public.engagement_survey_question_options(campaign_id,id) ON UPDATE RESTRICT ON DELETE CASCADE,
 ADD CONSTRAINT engagement_translation_response_target FOREIGN KEY(campaign_id,response_target_id)
  REFERENCES public.engagement_closeloop_entries(campaign_id,id) ON UPDATE RESTRICT ON DELETE CASCADE,
 ADD CONSTRAINT engagement_translation_target_field CHECK (
  (entity_type='campaign' AND entity_id=campaign_id AND field IN ('title','summary','public_description')) OR
  (entity_type='category' AND field IN ('label','description')) OR
  (entity_type='survey_question' AND field IN ('prompt','help_text')) OR
  (entity_type='survey_question_option' AND field='label') OR
  (entity_type='close_loop_entry' AND field IN ('theme_title','you_said','we_did'))
 );
