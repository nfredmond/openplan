-- Account and storage limits for a deployment with public signup
-- (KI-2026-10-12-014). Additive: two new functions. No table, column, policy
-- or row changes; existing rows are not read, validated or rewritten.
--
-- These are abuse protection that the operator sets through the application's
-- environment, not a tier of service. OpenPlan is free and has no paid plan.
--
-- 1. create_owned_workspace. One account could create any number of
--    workspaces through /api/workspaces/bootstrap, and each workspace carries
--    its own AI and run allowance. This function counts the workspaces the
--    person already owns and creates the workspace and its owner membership
--    in one transaction, under a per-person advisory lock, so parallel
--    requests cannot pass the count together. The limit comes from the caller
--    (OPENPLAN_MAX_OWNED_WORKSPACES, default 5). Only service_role may call
--    it, so a signed-in user cannot reach it with their own token. A refusal
--    writes nothing and returns {created:false, owned, limit}. A slug that is
--    already taken raises 23505, which the route retries with a new suffix.
--    The signup trigger handle_new_user still creates each person's first
--    workspace; a new person owns none, so the limit never refuses it.
--
-- 2. workspace_storage_bytes. Uploads were capped per file only. This sums
--    the stored size of every Storage object whose path begins with the
--    workspace id, in any bucket. Buckets whose paths begin with the workspace
--    id: kb-documents, gtfs-uploads, aerial-imagery, aerial-artifacts,
--    project-map-packages, report-artifacts, grant-application-exports and
--    project-evidence-bundles. Buckets that do not, and are therefore not
--    counted:
--      engagement-photos   <campaign>/<photo>; public uploads with their own
--                          per-campaign byte allowance and a daily sweep
--                          (photo-upload-allowance.ts), kept out so the public
--                          cannot fill a workspace's limit
--      run-artifacts       model-runs/<run>/...; written by the modeling
--                          worker, bounded by OPENPLAN_MONTHLY_RUN_CAP
--      network-packages    no writer in the application
--    The size is Storage's own metadata->>'size', recorded after the bytes
--    arrive, so an issued but unused upload URL counts nothing.
--    The scan filters on the path prefix; with few objects per deployment
--    that is cheap. A usage ledger is the follow-up if it ever is not.

BEGIN;

-- 1. Workspaces one person may own --------------------------------------------

CREATE FUNCTION public.create_owned_workspace(
  p_user_id uuid,
  p_name text,
  p_slug text,
  p_stage_gate_template_id text,
  p_stage_gate_template_version text,
  p_stage_gate_template_selection text,
  p_stage_gate_binding_source text,
  p_max_owned integer
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  owned integer;
  created public.workspaces;
BEGIN
  IF p_user_id IS NULL OR p_max_owned IS NULL OR p_max_owned < 1
    OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 120
    OR p_slug IS NULL OR length(p_slug) NOT BETWEEN 1 AND 48
    OR p_stage_gate_template_id IS NULL OR p_stage_gate_template_version IS NULL
    OR p_stage_gate_template_selection IS NULL OR p_stage_gate_binding_source IS NULL THEN
    RAISE EXCEPTION 'Name the person, the workspace, its stage-gate binding and a positive limit' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('owned_workspaces:' || p_user_id::text, 0));
  SELECT count(*) INTO owned FROM public.workspace_members
    WHERE user_id = p_user_id AND lower(btrim(role)) = 'owner';
  IF owned >= p_max_owned THEN
    RETURN jsonb_build_object('created', false, 'owned', owned, 'limit', p_max_owned);
  END IF;
  INSERT INTO public.workspaces(name, slug, stage_gate_template_id, stage_gate_template_version,
      stage_gate_template_selection, stage_gate_binding_source)
    VALUES (btrim(p_name), p_slug, p_stage_gate_template_id, p_stage_gate_template_version,
      p_stage_gate_template_selection, p_stage_gate_binding_source)
    RETURNING * INTO created;
  INSERT INTO public.workspace_members(workspace_id, user_id, role) VALUES (created.id, p_user_id, 'owner');
  RETURN jsonb_build_object('created', true, 'owned', owned + 1, 'limit', p_max_owned,
    'workspace', jsonb_build_object(
      'id', created.id,
      'slug', created.slug,
      'stage_gate_template_id', created.stage_gate_template_id,
      'stage_gate_template_version', created.stage_gate_template_version,
      'stage_gate_template_selection', created.stage_gate_template_selection));
END $$;
REVOKE ALL ON FUNCTION public.create_owned_workspace(uuid, text, text, text, text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_owned_workspace(uuid, text, text, text, text, text, text, integer) TO service_role;

-- 2. Bytes one workspace stores ------------------------------------------------

CREATE FUNCTION public.workspace_storage_bytes(p_workspace_id uuid)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  total bigint;
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Name the workspace' USING ERRCODE = '22023';
  END IF;
  -- A UUID's text form holds only hex digits and hyphens, so the pattern has
  -- no LIKE wildcards in it other than the trailing %.
  SELECT coalesce(sum(CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,18}$' THEN (o.metadata->>'size')::bigint ELSE 0 END), 0)::bigint
    INTO total
    FROM storage.objects o
    WHERE o.name LIKE p_workspace_id::text || '/%';
  RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.workspace_storage_bytes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_storage_bytes(uuid) TO service_role;

COMMIT;
