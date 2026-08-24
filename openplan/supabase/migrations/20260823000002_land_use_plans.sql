-- Land Use Plans: jurisdiction-neutral authoring, immutable review/adoption
-- versions, mapped designation references, implementation, and annual reports.
-- Legal terminology and requirement lists stay in the TypeScript descriptor
-- registry. These tables store descriptor keys and planner records only.

CREATE TABLE public.land_use_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (btrim(title) <> ''),
  descriptor_id text NOT NULL CHECK (btrim(descriptor_id) <> ''),
  plan_kind_key text NOT NULL CHECK (btrim(plan_kind_key) <> ''),
  authority_label text NOT NULL CHECK (btrim(authority_label) <> ''),
  geography_label text NOT NULL CHECK (btrim(geography_label) <> ''),
  geography_geojson jsonb,
  local_requirements_notice text,
  current_working_version_id uuid,
  current_adopted_version_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  CHECK (geography_geojson IS NULL OR jsonb_typeof(geography_geojson) = 'object')
);

-- Reports can now belong directly to a land-use plan instead of requiring a
-- synthetic project. Existing project reports remain unchanged.
ALTER TABLE public.reports ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE public.reports ADD COLUMN land_use_plan_id uuid
  REFERENCES public.land_use_plans(id) ON DELETE CASCADE;
ALTER TABLE public.reports ADD CONSTRAINT reports_at_most_one_parent CHECK (
  project_id IS NULL OR land_use_plan_id IS NULL
);
CREATE INDEX reports_land_use_plan_idx ON public.reports(land_use_plan_id, updated_at DESC)
  WHERE land_use_plan_id IS NOT NULL;

CREATE TABLE public.land_use_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number >= 1),
  version_kind text NOT NULL CHECK (version_kind IN ('original', 'amendment')),
  state text NOT NULL DEFAULT 'working'
    CHECK (state IN ('working', 'public_review', 'adopted', 'superseded', 'repealed')),
  based_on_version_id uuid REFERENCES public.land_use_plan_versions(id) ON DELETE NO ACTION,
  applicable_requirement_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  content_hash text CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  frozen_snapshot jsonb,
  frozen_at timestamptz,
  frozen_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_report_id uuid REFERENCES public.reports(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  UNIQUE (plan_id, version_number),
  FOREIGN KEY (plan_id, workspace_id)
    REFERENCES public.land_use_plans(id, workspace_id) ON DELETE CASCADE,
  CHECK (
    (state = 'working' AND content_hash IS NULL AND frozen_snapshot IS NULL AND frozen_at IS NULL AND frozen_by IS NULL)
    OR
    (state <> 'working' AND content_hash IS NOT NULL AND frozen_snapshot IS NOT NULL AND frozen_at IS NOT NULL AND frozen_by IS NOT NULL)
  )
);

ALTER TABLE public.land_use_plans
  ADD CONSTRAINT land_use_plans_working_version_fk
  FOREIGN KEY (current_working_version_id) REFERENCES public.land_use_plan_versions(id) ON DELETE SET NULL,
  ADD CONSTRAINT land_use_plans_adopted_version_fk
  FOREIGN KEY (current_adopted_version_id) REFERENCES public.land_use_plan_versions(id) ON DELETE SET NULL;

CREATE TABLE public.land_use_plan_content_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  parent_node_id uuid REFERENCES public.land_use_plan_content_nodes(id) ON DELETE CASCADE,
  node_kind text NOT NULL CHECK (node_kind IN ('section','goal','objective','policy','standard','program','implementation_action')),
  requirement_key text,
  title text NOT NULL CHECK (btrim(title) <> ''),
  body text,
  sort_order integer NOT NULL DEFAULT 0,
  evidence_document_id uuid REFERENCES public.kb_documents(id) ON DELETE SET NULL,
  evidence_url text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (version_id, workspace_id)
    REFERENCES public.land_use_plan_versions(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE public.land_use_plan_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  version_id uuid NOT NULL,
  related_plan_id uuid REFERENCES public.land_use_plans(id) ON DELETE NO ACTION,
  related_plan_label text NOT NULL CHECK (btrim(related_plan_label) <> ''),
  relationship_kind text NOT NULL CHECK (relationship_kind IN ('parent','child','overlapping','supersedes','implements')),
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (plan_id, workspace_id)
    REFERENCES public.land_use_plans(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (version_id, workspace_id)
    REFERENCES public.land_use_plan_versions(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE public.land_use_plan_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  event_kind text NOT NULL CHECK (event_kind IN ('internal_consistency','environmental_review','public_draft','hearing','recommendation','comment_response')),
  occurred_on date,
  decision_body text,
  engagement_campaign_id uuid REFERENCES public.engagement_campaigns(id) ON DELETE SET NULL,
  evidence_document_id uuid REFERENCES public.kb_documents(id) ON DELETE SET NULL,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (version_id, workspace_id)
    REFERENCES public.land_use_plan_versions(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE public.land_use_plan_designations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  layer_id uuid NOT NULL REFERENCES public.workspace_gis_layers(id) ON DELETE NO ACTION,
  layer_version_id uuid NOT NULL REFERENCES public.workspace_gis_layer_versions(id) ON DELETE NO ACTION,
  designation_set_label text NOT NULL CHECK (btrim(designation_set_label) <> ''),
  legend_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(legend_metadata) = 'object'),
  map_note text NOT NULL DEFAULT 'Future land-use designations express plan policy. They are not zoning and do not change parcel entitlements.',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  UNIQUE (version_id, layer_version_id),
  FOREIGN KEY (version_id, workspace_id)
    REFERENCES public.land_use_plan_versions(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE public.land_use_plan_designation_policy_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  designation_id uuid NOT NULL,
  policy_node_id uuid NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (designation_id, policy_node_id),
  FOREIGN KEY (designation_id, workspace_id)
    REFERENCES public.land_use_plan_designations(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (version_id, workspace_id)
    REFERENCES public.land_use_plan_versions(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (policy_node_id, workspace_id)
    REFERENCES public.land_use_plan_content_nodes(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE public.land_use_plan_implementation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  content_node_id uuid REFERENCES public.land_use_plan_content_nodes(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (btrim(title) <> ''),
  description text,
  responsible_party text,
  assignee_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  due_on date,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','completed','deferred')),
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  program_id uuid REFERENCES public.programs(id) ON DELETE SET NULL,
  evidence_document_id uuid REFERENCES public.kb_documents(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (version_id, workspace_id)
    REFERENCES public.land_use_plan_versions(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE public.land_use_plan_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  version_id uuid NOT NULL,
  version_content_hash text NOT NULL CHECK (version_content_hash ~ '^[0-9a-f]{64}$'),
  decision_kind text NOT NULL CHECK (decision_kind IN ('adoption','amendment','repeal')),
  decision_body text NOT NULL CHECK (btrim(decision_body) <> ''),
  instrument_type text NOT NULL CHECK (btrim(instrument_type) <> ''),
  instrument_identifier text NOT NULL CHECK (btrim(instrument_identifier) <> ''),
  vote text,
  decided_on date NOT NULL,
  effective_on date,
  supporting_document_id uuid NOT NULL REFERENCES public.kb_documents(id) ON DELETE NO ACTION,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (plan_id, workspace_id)
    REFERENCES public.land_use_plans(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (version_id, workspace_id)
    REFERENCES public.land_use_plan_versions(id, workspace_id) ON DELETE NO ACTION
);

CREATE TABLE public.land_use_plan_implementation_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  adopted_version_id uuid NOT NULL,
  reporting_period_start date NOT NULL,
  reporting_period_end date NOT NULL,
  summary text,
  action_status_snapshot jsonb NOT NULL CHECK (jsonb_typeof(action_status_snapshot) = 'array'),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  report_id uuid REFERENCES public.reports(id) ON DELETE SET NULL,
  generated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (plan_id, workspace_id)
    REFERENCES public.land_use_plans(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (adopted_version_id, workspace_id)
    REFERENCES public.land_use_plan_versions(id, workspace_id) ON DELETE NO ACTION,
  CHECK (reporting_period_end >= reporting_period_start)
);

-- This table has no public reader and no path into report snapshots. Even
-- members see it only inside the authenticated plan workbench.
CREATE TABLE public.land_use_plan_consultation_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  version_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('not_started','initiated','in_progress','complete','not_applicable')),
  evidence_document_id uuid REFERENCES public.kb_documents(id) ON DELETE SET NULL,
  confidential_notes text,
  contains_sensitive_locations boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (plan_id, workspace_id)
    REFERENCES public.land_use_plans(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (version_id, workspace_id)
    REFERENCES public.land_use_plan_versions(id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX land_use_plans_workspace_updated_idx ON public.land_use_plans(workspace_id, updated_at DESC);
CREATE INDEX land_use_plan_versions_plan_idx ON public.land_use_plan_versions(plan_id, version_number DESC);
CREATE INDEX land_use_plan_nodes_version_idx ON public.land_use_plan_content_nodes(version_id, parent_node_id, sort_order);
CREATE INDEX land_use_plan_reviews_version_idx ON public.land_use_plan_review_events(version_id, occurred_on);
CREATE INDEX land_use_plan_actions_due_idx ON public.land_use_plan_implementation_actions(workspace_id, due_on) WHERE due_on IS NOT NULL AND status NOT IN ('completed','deferred');

CREATE OR REPLACE FUNCTION public.set_land_use_plan_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER land_use_plans_updated_at BEFORE UPDATE ON public.land_use_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_land_use_plan_updated_at();
CREATE TRIGGER land_use_plan_versions_updated_at BEFORE UPDATE ON public.land_use_plan_versions
  FOR EACH ROW EXECUTE FUNCTION public.set_land_use_plan_updated_at();
CREATE TRIGGER land_use_plan_nodes_updated_at BEFORE UPDATE ON public.land_use_plan_content_nodes
  FOR EACH ROW EXECUTE FUNCTION public.set_land_use_plan_updated_at();
CREATE TRIGGER land_use_plan_actions_updated_at BEFORE UPDATE ON public.land_use_plan_implementation_actions
  FOR EACH ROW EXECUTE FUNCTION public.set_land_use_plan_updated_at();
CREATE TRIGGER land_use_plan_consultations_updated_at BEFORE UPDATE ON public.land_use_plan_consultation_records
  FOR EACH ROW EXECUTE FUNCTION public.set_land_use_plan_updated_at();

CREATE OR REPLACE FUNCTION public.refuse_frozen_land_use_plan_content()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE target_version_id uuid;
BEGIN
  target_version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  IF EXISTS (
    SELECT 1 FROM public.land_use_plan_versions
    WHERE id = target_version_id AND frozen_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Frozen land-use plan content is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'land_use_plan_content_nodes',
    'land_use_plan_relationships',
    'land_use_plan_designations',
    'land_use_plan_designation_policy_links'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_refuse_frozen BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.refuse_frozen_land_use_plan_content()',
      table_name,
      table_name
    );
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.limit_frozen_land_use_plan_action_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.land_use_plan_versions
    WHERE id = COALESCE(NEW.version_id, OLD.version_id) AND frozen_at IS NOT NULL
  ) THEN
    IF TG_OP <> 'UPDATE' OR
      NEW.version_id IS DISTINCT FROM OLD.version_id OR
      NEW.content_node_id IS DISTINCT FROM OLD.content_node_id OR
      NEW.title IS DISTINCT FROM OLD.title OR
      NEW.description IS DISTINCT FROM OLD.description OR
      NEW.responsible_party IS DISTINCT FROM OLD.responsible_party OR
      NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id OR
      NEW.due_on IS DISTINCT FROM OLD.due_on OR
      NEW.project_id IS DISTINCT FROM OLD.project_id OR
      NEW.program_id IS DISTINCT FROM OLD.program_id
    THEN
      RAISE EXCEPTION 'A frozen implementation action may only update status and implementation evidence';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER land_use_plan_actions_limit_frozen_update
  BEFORE INSERT OR UPDATE OR DELETE ON public.land_use_plan_implementation_actions
  FOR EACH ROW EXECUTE FUNCTION public.limit_frozen_land_use_plan_action_update();

CREATE OR REPLACE FUNCTION public.refuse_frozen_land_use_plan_version_rewrite()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.frozen_at IS NOT NULL AND (
    NEW.plan_id IS DISTINCT FROM OLD.plan_id OR
    NEW.version_number IS DISTINCT FROM OLD.version_number OR
    NEW.version_kind IS DISTINCT FROM OLD.version_kind OR
    NEW.based_on_version_id IS DISTINCT FROM OLD.based_on_version_id OR
    NEW.applicable_requirement_keys IS DISTINCT FROM OLD.applicable_requirement_keys OR
    NEW.content_hash IS DISTINCT FROM OLD.content_hash OR
    NEW.frozen_snapshot IS DISTINCT FROM OLD.frozen_snapshot OR
    NEW.frozen_at IS DISTINCT FROM OLD.frozen_at OR
    NEW.frozen_by IS DISTINCT FROM OLD.frozen_by
  ) THEN
    RAISE EXCEPTION 'Frozen land-use plan version is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER land_use_plan_versions_refuse_frozen_rewrite
  BEFORE UPDATE ON public.land_use_plan_versions
  FOR EACH ROW EXECUTE FUNCTION public.refuse_frozen_land_use_plan_version_rewrite();

-- Adoption is valid only for the exact frozen public-review hash. The route
-- gives a useful response; this trigger is the final wall for every writer.
CREATE OR REPLACE FUNCTION public.verify_land_use_plan_decision_hash()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.land_use_plan_versions v
    WHERE v.id = NEW.version_id
      AND v.plan_id = NEW.plan_id
      AND v.workspace_id = NEW.workspace_id
      AND v.state = 'public_review'
      AND v.content_hash = NEW.version_content_hash
      AND v.frozen_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Decision must reference the exact frozen public-review version hash';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER land_use_plan_decisions_verify_hash
  BEFORE INSERT ON public.land_use_plan_decisions
  FOR EACH ROW EXECUTE FUNCTION public.verify_land_use_plan_decision_hash();

CREATE OR REPLACE FUNCTION public.record_land_use_plan_adoption(
  p_workspace_id uuid,
  p_plan_id uuid,
  p_version_id uuid,
  p_version_content_hash text,
  p_decision_kind text,
  p_decision_body text,
  p_instrument_type text,
  p_instrument_identifier text,
  p_vote text,
  p_decided_on date,
  p_effective_on date,
  p_supporting_document_id uuid,
  p_created_by uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE decision_id uuid;
BEGIN
  INSERT INTO public.land_use_plan_decisions (
    workspace_id, plan_id, version_id, version_content_hash, decision_kind,
    decision_body, instrument_type, instrument_identifier, vote, decided_on,
    effective_on, supporting_document_id, created_by
  ) VALUES (
    p_workspace_id, p_plan_id, p_version_id, p_version_content_hash, p_decision_kind,
    p_decision_body, p_instrument_type, p_instrument_identifier, p_vote, p_decided_on,
    p_effective_on, p_supporting_document_id, p_created_by
  ) RETURNING id INTO decision_id;

  UPDATE public.land_use_plan_versions
    SET state = 'superseded'
    WHERE plan_id = p_plan_id AND state = 'adopted' AND id <> p_version_id;
  UPDATE public.land_use_plan_versions
    SET state = 'adopted'
    WHERE id = p_version_id AND plan_id = p_plan_id AND content_hash = p_version_content_hash;
  IF NOT FOUND THEN RAISE EXCEPTION 'Frozen version changed before adoption'; END IF;

  UPDATE public.land_use_plans
    SET current_adopted_version_id = p_version_id, current_working_version_id = NULL
    WHERE id = p_plan_id AND workspace_id = p_workspace_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan changed before adoption'; END IF;
  RETURN decision_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_land_use_plan_adoption(uuid,uuid,uuid,text,text,text,text,text,text,date,date,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_land_use_plan_adoption(uuid,uuid,uuid,text,text,text,text,text,text,date,date,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.verify_land_use_plan_designation_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_gis_layer_versions version
    WHERE version.id = NEW.layer_version_id
      AND version.layer_id = NEW.layer_id
      AND version.workspace_id = NEW.workspace_id
      AND version.ingest_status = 'ready'
  ) THEN
    RAISE EXCEPTION 'Designation must reference a ready version of the selected GIS layer';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER land_use_plan_designations_verify_layer_version
  BEFORE INSERT OR UPDATE ON public.land_use_plan_designations
  FOR EACH ROW EXECUTE FUNCTION public.verify_land_use_plan_designation_version();

CREATE OR REPLACE FUNCTION public.refuse_land_use_plan_append_only_rewrite()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM public.land_use_plans WHERE id = OLD.plan_id
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Land-use plan decisions and frozen implementation reports are append-only';
END;
$$;

CREATE TRIGGER land_use_plan_decisions_append_only
  BEFORE UPDATE OR DELETE ON public.land_use_plan_decisions
  FOR EACH ROW EXECUTE FUNCTION public.refuse_land_use_plan_append_only_rewrite();
CREATE TRIGGER land_use_plan_reports_append_only
  BEFORE UPDATE OR DELETE ON public.land_use_plan_implementation_reports
  FOR EACH ROW EXECUTE FUNCTION public.refuse_land_use_plan_append_only_rewrite();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'land_use_plans','land_use_plan_versions','land_use_plan_content_nodes',
    'land_use_plan_relationships','land_use_plan_review_events','land_use_plan_designations',
    'land_use_plan_designation_policy_links','land_use_plan_implementation_actions',
    'land_use_plan_decisions','land_use_plan_implementation_reports',
    'land_use_plan_consultation_records'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I_member_read ON public.%I FOR SELECT USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()))',
      table_name, table_name
    );
    EXECUTE format(
      'CREATE POLICY %I_writer_all ON public.%I FOR ALL USING (public.workspace_member_can_write(workspace_id)) WITH CHECK (public.workspace_member_can_write(workspace_id))',
      table_name, table_name
    );
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', table_name);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', table_name);
  END LOOP;
END
$$;

ALTER TABLE public.land_use_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.land_use_plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.land_use_plan_content_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.land_use_plan_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.land_use_plan_review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.land_use_plan_designations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.land_use_plan_designation_policy_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.land_use_plan_implementation_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.land_use_plan_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.land_use_plan_implementation_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.land_use_plan_consultation_records ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.land_use_plan_consultation_records IS
  'Private consultation status and evidence. Never included in public plan packets; may contain confidential notes or sensitive-location flags.';
COMMENT ON COLUMN public.land_use_plan_designations.map_note IS
  'Required planner-facing disclosure that future land-use designations are plan policy, not zoning.';
