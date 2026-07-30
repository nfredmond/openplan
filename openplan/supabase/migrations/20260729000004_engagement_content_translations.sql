-- Per-locale variants of the text a public agency wrote, for the participant
-- surfaces of the engagement module.
--
-- WHAT WAS MISSING. OpenPlan could translate a resident's comment into eleven
-- languages and could not ask its own question in any of them. Half of that gap
-- is OpenPlan's own chrome, which is a typed message catalog in
-- src/lib/engagement/portal-i18n/messages.ts. The other half is the text the
-- AGENCY wrote — the campaign title, the category labels, the survey prompts —
-- which OpenPlan does not author and therefore cannot ship. This table is where
-- that half lives.
--
-- WHY THE OPERATOR'S OWN TRANSLATION IS AUTHORITATIVE, AND WHY `source` IS NOT
-- OPTIONAL METADATA. An agency can be held to what it publishes. A Spanish
-- title a person at the agency wrote is the agency's statement; a Spanish title
-- a language model produced is a convenience that may be wrong and that nobody
-- at the agency ever said. Rendering the two identically publishes the machine's
-- wording as the agency's own, in front of members of the public, in the exact
-- context Title VI language-access obligations are about. So provenance is
-- stored per row, NOT NULL, and the resolver
-- (src/lib/engagement/portal-i18n/operator-text.ts) cannot hand a caller text
-- without it. An operator row always beats a machine row for the same field.
--
-- ONE TABLE, NOT ONE PER ENTITY, AND NOT JSONB. Three designs were on the table.
--
--   PER-LOCALE JSONB on each row (engagement_campaigns.translations_json …).
--   Rejected. Every write becomes a read-modify-write of the whole blob, so two
--   translators working at once silently lose each other's work. Machine output
--   would land in the same column as the operator's authored content, which is
--   the one distinction this feature exists to keep. And the operator questions
--   that actually get asked — "which campaigns have no Spanish title?", "what
--   is stale since the English changed?" — are unindexable inside a blob.
--
--   ONE TABLE PER ENTITY (engagement_campaign_translations,
--   engagement_category_translations, engagement_survey_question_translations).
--   Rejected. The same six columns and the same four policies, three times over
--   — and the entity count is not stable: survey questions and categories are
--   already separate tables, options are a third, and close-loop entries are a
--   fourth translatable thing that the participant surface reads today. A fifth
--   will follow. Each new one would mean a migration, four more policies, and
--   another branch in the resolver.
--
--   ONE POLYMORPHIC TABLE, chosen. `entity_type` + `entity_id` + `field` is the
--   address; one index, one set of policies, one query per page. Adding the
--   fifth translatable entity is a value in a CHECK and a call in the resolver.
--
--   The cost of the choice, stated rather than hidden: `entity_id` cannot carry
--   a foreign key, because it points at four different tables. Campaign
--   deletion is still covered — `campaign_id` cascades — but deleting a single
--   category or question would strand its translations, so the trigger at the
--   bottom of this file removes them. Referential integrity by trigger is worse
--   than by constraint; it is the price of not having five near-identical
--   tables, and it is paid in one place.
--
-- WHY `locale` IS NOT CONSTRAINED TO A LIST OF LANGUAGES. The supported set
-- lives in ONE place — TRANSLATION_LANGUAGES in
-- src/lib/engagement/translation-languages.ts — and a CHECK repeating it here
-- would be a second taxonomy that drifts from the first the day a language is
-- added. It is also the wrong shape for where this product is going: the US is
-- the current scope, worldwide is the target, and a language set frozen into a
-- database constraint is a schema migration standing between OpenPlan and its
-- next country. The column is constrained to the SHAPE of a language tag; the
-- application is the authority on which tags mean anything, and a row naming a
-- locale no build supports is inert — nothing reads it.
--
-- WHY THERE IS NO ANON POLICY, THOUGH THIS IS WORLD-READABLE CONTENT. Same
-- posture as engagement_context_layers (20260729000002), for the same reason.
-- Publication happens in ONE place: the service-role portal loader, gated on
-- the campaign's share_token AND status = 'active'. An anon SELECT policy would
-- additionally expose every campaign's translations through PostgREST to anyone
-- holding the project's public anon key — including translations of DRAFT
-- campaigns that have not been published to anybody — and would make "what can
-- the public see?" a question you answer by reading policy predicates instead
-- of by reading one query.

CREATE TABLE IF NOT EXISTS public.engagement_content_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Denormalized from the campaign for the same reason engagement_context_layers
  -- denormalizes it: every policy below keys off it, and reaching the workspace
  -- through a subquery on engagement_campaigns would run that subquery per row
  -- of a translation list.
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- The participant read is "every translation this campaign has, in one
  -- locale", so campaign_id is the query key as well as the cascade root.
  campaign_id UUID NOT NULL REFERENCES public.engagement_campaigns(id) ON DELETE CASCADE,

  -- THE ADDRESS. Kept in step with PORTAL_TRANSLATABLE_ENTITIES in
  -- src/lib/engagement/portal-i18n/operator-text.ts. The resolver ignores an
  -- entity_type it does not recognise rather than rendering it, so a value
  -- added here ahead of the code is inert rather than dangerous.
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'campaign',
    'category',
    'survey_question',
    'survey_question_option',
    'close_loop_entry'
  )),
  entity_id UUID NOT NULL,

  -- The SOURCE COLUMN's own name — 'title', 'summary', 'public_description',
  -- 'label', 'description', 'prompt', 'help_text', 'you_said', 'we_did'. Not
  -- constrained to a list: the set differs per entity_type, so a single CHECK
  -- would either be a cross-product nobody maintains or a lie about which
  -- combinations are real. The resolver only ever asks for fields it is
  -- rendering, so an unknown field is unread.
  field TEXT NOT NULL CHECK (btrim(field) <> ''),

  -- A BCP-47-shaped language tag. See the header for why this is a shape check
  -- and not a list of languages.
  locale TEXT NOT NULL CHECK (locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),

  -- An empty translation is worse than no translation: it replaces text a
  -- resident could read with nothing, and reports success doing it.
  translated_text TEXT NOT NULL CHECK (btrim(translated_text) <> ''),

  -- WHO SAID THIS. 'operator' is the agency's own words and carries no caveat
  -- on screen; 'machine' is model output and is labelled every time it is
  -- rendered. There is no third value and no default — a translation whose
  -- origin nobody recorded is exactly the row this column exists to prevent.
  source TEXT NOT NULL CHECK (source IN ('operator', 'machine')),

  -- The model that produced a machine translation, so an agency asked "where
  -- did this Spanish come from?" has an answer years later. Meaningless for an
  -- operator row, and the constraint says so rather than leaving a column that
  -- means different things depending on a sibling.
  machine_model TEXT,
  CONSTRAINT engagement_content_translations_model_matches_source CHECK (
    (source = 'machine') OR (machine_model IS NULL)
  ),

  -- THE SOURCE TEXT THIS WAS A TRANSLATION OF, hashed.
  --
  -- An agency edits the English title and the Spanish silently becomes a
  -- translation of a sentence that no longer exists — which is a worse failure
  -- than having no Spanish, because it looks maintained. Storing the hash lets
  -- an operator surface say "the English changed after this was translated"
  -- without storing a second copy of the source text. Nullable because a
  -- translation typed straight into the operator UI may never have had one
  -- captured, and a fabricated hash would be worse than an absent one.
  source_text_hash TEXT,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One translation per field per language. Two rows would mean the portal
  -- picking one arbitrarily, and a resident being shown a different official
  -- sentence on refresh.
  CONSTRAINT engagement_content_translations_unique_field
    UNIQUE (entity_type, entity_id, field, locale)
);

-- THE PARTICIPANT READ: every translation for one campaign in one locale, which
-- is the single query a portal page makes.
CREATE INDEX IF NOT EXISTS engagement_content_translations_portal_idx
  ON public.engagement_content_translations(campaign_id, locale);

-- The cleanup trigger's lookup, and the operator question "what has been
-- translated for this category?".
CREATE INDEX IF NOT EXISTS engagement_content_translations_entity_idx
  ON public.engagement_content_translations(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS engagement_content_translations_workspace_idx
  ON public.engagement_content_translations(workspace_id, updated_at DESC);

ALTER TABLE public.engagement_content_translations ENABLE ROW LEVEL SECURITY;

-- Reads: any member of the owning workspace, viewers included. A viewer must be
-- able to see what their agency has published in every language.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'engagement_content_translations'
      AND policyname = 'engagement_content_translations_member_read'
  ) THEN
    CREATE POLICY engagement_content_translations_member_read
      ON public.engagement_content_translations
      FOR SELECT USING (
        workspace_id IN (
          SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

-- Writes are ROLE-AWARE rather than membership-only, so they need no companion
-- RESTRICTIVE gate from 20260728000006/7. Publishing an agency's official
-- wording in another language is unambiguously a write, and the viewer tier's
-- contract is "read everything, change nothing".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'engagement_content_translations'
      AND policyname = 'engagement_content_translations_writer_insert'
  ) THEN
    CREATE POLICY engagement_content_translations_writer_insert
      ON public.engagement_content_translations
      FOR INSERT WITH CHECK (
        public.workspace_member_can_write(workspace_id)
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'engagement_content_translations'
      AND policyname = 'engagement_content_translations_writer_update'
  ) THEN
    CREATE POLICY engagement_content_translations_writer_update
      ON public.engagement_content_translations
      FOR UPDATE
      USING (public.workspace_member_can_write(workspace_id))
      WITH CHECK (public.workspace_member_can_write(workspace_id));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'engagement_content_translations'
      AND policyname = 'engagement_content_translations_writer_delete'
  ) THEN
    CREATE POLICY engagement_content_translations_writer_delete
      ON public.engagement_content_translations
      FOR DELETE USING (public.workspace_member_can_write(workspace_id));
  END IF;
END
$$;

-- anon is granted nothing, on purpose. The public portal reads this table
-- through the service role behind the campaign's share token; that route IS the
-- publication rule. See the header.
REVOKE ALL ON TABLE public.engagement_content_translations FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.engagement_content_translations TO authenticated;
GRANT ALL ON TABLE public.engagement_content_translations TO service_role;

-- THE PRICE OF THE POLYMORPHIC ADDRESS, PAID IN ONE PLACE.
--
-- `entity_id` cannot carry a foreign key because it points at four tables, so
-- deleting a category or a question would leave its translations behind. One
-- generic trigger function, parameterised by entity_type, removes them. It is
-- SECURITY DEFINER so the cleanup is deterministic: whoever was entitled to
-- delete the parent gets its translations removed too, without a second
-- authorization question whose only possible answers are "yes" and "leave
-- garbage".
CREATE OR REPLACE FUNCTION public.delete_engagement_content_translations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  DELETE FROM public.engagement_content_translations
  WHERE entity_type = TG_ARGV[0]
    AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.delete_engagement_content_translations() IS
  'Removes the per-locale translations of a deleted engagement entity. Needed because engagement_content_translations addresses its target polymorphically (entity_type + entity_id) and so cannot carry a foreign key to it. Campaign deletion is handled by the campaign_id cascade instead; this covers the children.';

DROP TRIGGER IF EXISTS engagement_categories_translations_cleanup ON public.engagement_categories;
CREATE TRIGGER engagement_categories_translations_cleanup
  AFTER DELETE ON public.engagement_categories
  FOR EACH ROW EXECUTE FUNCTION public.delete_engagement_content_translations('category');

DROP TRIGGER IF EXISTS engagement_survey_questions_translations_cleanup ON public.engagement_survey_questions;
CREATE TRIGGER engagement_survey_questions_translations_cleanup
  AFTER DELETE ON public.engagement_survey_questions
  FOR EACH ROW EXECUTE FUNCTION public.delete_engagement_content_translations('survey_question');

DROP TRIGGER IF EXISTS engagement_survey_options_translations_cleanup ON public.engagement_survey_question_options;
CREATE TRIGGER engagement_survey_options_translations_cleanup
  AFTER DELETE ON public.engagement_survey_question_options
  FOR EACH ROW EXECUTE FUNCTION public.delete_engagement_content_translations('survey_question_option');

DROP TRIGGER IF EXISTS engagement_closeloop_translations_cleanup ON public.engagement_closeloop_entries;
CREATE TRIGGER engagement_closeloop_translations_cleanup
  AFTER DELETE ON public.engagement_closeloop_entries
  FOR EACH ROW EXECUTE FUNCTION public.delete_engagement_content_translations('close_loop_entry');

-- WHAT LANGUAGE THE CAMPAIGN ITSELF WAS WRITTEN IN.
--
-- NULLABLE, with no default, and that is the point. Defaulting it to 'en' would
-- bake "agencies write in English" into the schema of a product whose stated
-- target is worldwide — and would make the portal say "shown in English" about
-- a campaign an agency wrote in Spanish. Left null, the resolver PRESUMES the
-- portal default and reports the presumption
-- (`PortalText.textLocaleStated === false`), so the sentence a resident reads
-- degrades from "shown in English" to "shown as the project team wrote it",
-- which claims nothing nobody established.
--
-- Read by a SEPARATE query in loadPortalTranslationIndex rather than folded
-- into the portal's main campaign select, deliberately: between a deploy and
-- this migration a select naming this column ERRORS, and in the main select
-- that would 404 every public engagement page in the deployment. Read apart, the
-- same window costs only the source-language label.
ALTER TABLE public.engagement_campaigns
  ADD COLUMN IF NOT EXISTS default_content_locale TEXT
    CHECK (default_content_locale IS NULL OR default_content_locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$');

COMMENT ON TABLE public.engagement_content_translations IS
  'Per-locale variants of operator-authored engagement text (campaign title/summary/public_description, category label/description, survey question prompt/help_text, option label, close-loop entry fields). Addressed polymorphically by entity_type + entity_id + field. source = ''operator'' is the agency''s own wording and is authoritative; source = ''machine'' is model output and must be labelled wherever it is rendered. Workspace members read; writing members insert, update and delete; anon has no policy and no grant — the public portal reads through the service role behind the campaign share token.';

COMMENT ON COLUMN public.engagement_content_translations.source IS
  'Who produced this text. ''operator'': a person at the agency wrote or approved it, so it carries no caveat on screen and the agency can be held to it. ''machine'': a language model produced it, so every participant surface that renders it must label it as machine translation. An operator row always beats a machine row for the same (entity, field, locale).';

COMMENT ON COLUMN public.engagement_content_translations.locale IS
  'A BCP-47-shaped language tag. Deliberately NOT constrained to a list of languages: the supported set is TRANSLATION_LANGUAGES in src/lib/engagement/translation-languages.ts, and a copy of it here would be a second taxonomy that drifts — and a schema migration standing between this product and its next country. A row naming an unsupported locale is inert; nothing reads it.';

COMMENT ON COLUMN public.engagement_content_translations.source_text_hash IS
  'Hash of the source text this was translated from, so an operator surface can report "the original changed after this was translated" without storing a second copy of it. Nullable: a translation typed directly into the operator UI may never have had one captured, and a fabricated hash is worse than an absent one.';

COMMENT ON COLUMN public.engagement_campaigns.default_content_locale IS
  'The language the campaign''s own title, summary and description are written in. NULL means nobody stated it, which is different from English: the participant portal then presumes the portal default and DISCLOSES the presumption, saying "shown as the project team wrote it" rather than naming a language nobody recorded.';
