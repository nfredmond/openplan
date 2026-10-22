BEGIN;

-- KL-2026-09-04-023. One scalar response, not a capped PostgREST row set.
-- STABLE fixes the MVCC snapshot for every read and schema fallback below.
-- Caller privileges and existing table/child RLS apply without a definer bypass.
CREATE FUNCTION public.project_budget_inputs_v1(p_project_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  result jsonb;
  rows jsonb;
  projection text;
  assignee_pending boolean := false;
  budget_pending boolean := false;
  budget_amount_pending boolean := false;
  percent_complete_pending boolean := false;
BEGIN
  -- Inaccessible and nonexistent projects both refuse, never report zero money.
  IF p_project_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = p_project_id
  ) THEN
    RAISE EXCEPTION 'Project budget inputs are unavailable' USING ERRCODE = '42501';
  END IF;

  result := jsonb_build_object('version', 1, 'project_id', p_project_id);
  BEGIN
    -- Establish optional-column absence from this relation's catalog. A read
    -- dependency failing with undefined_column must not invent a migration gap.
    IF to_regclass('public.project_deliverables') IS NULL THEN
      RAISE EXCEPTION 'relation "public.project_deliverables" does not exist' USING ERRCODE = '42P01';
    END IF;
    SELECT NOT coalesce(bool_or(a.attname = 'assignee_user_id'), false),
           NOT coalesce(bool_or(a.attname = 'budget_amount'), false),
           NOT coalesce(bool_or(a.attname = 'percent_complete'), false)
      INTO assignee_pending, budget_amount_pending, percent_complete_pending
      FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = to_regclass('public.project_deliverables')
        AND a.attnum > 0 AND NOT a.attisdropped;
    budget_pending := budget_amount_pending OR percent_complete_pending;

    -- Preserve each readable optional field. Fixed projections avoid widening
    -- confidential fields; the only query parameter is the bound project id.
    projection := 'd.id, d.title, d.summary, d.owner_label, d.due_date, d.status, d.created_at';
    IF NOT budget_amount_pending THEN
      projection := projection || ', d.budget_amount';
    END IF;
    IF NOT percent_complete_pending THEN
      projection := projection || ', d.percent_complete';
    END IF;
    IF NOT assignee_pending THEN
      projection := projection || ', d.assignee_user_id';
    END IF;
    EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(r) - ''updated_at'' ORDER BY r.updated_at DESC, r.id), ''[]''::jsonb)
      FROM (SELECT ' || projection || ', d.updated_at FROM public.project_deliverables d WHERE d.project_id = $1) r'
      INTO rows USING p_project_id;
    result := result || jsonb_build_object('deliverables', jsonb_build_object('complete', true, 'data', rows, 'error', NULL));
  EXCEPTION WHEN OTHERS THEN
    result := result || jsonb_build_object('deliverables', jsonb_build_object('complete', false, 'data', NULL,
      'error', jsonb_build_object('code', SQLSTATE, 'message', SQLERRM)));
  END;

  BEGIN
    SELECT jsonb_build_object('budget_amount', p.budget_amount) INTO STRICT rows
      FROM public.projects p WHERE p.id = p_project_id;
    result := result || jsonb_build_object('statedBudget', jsonb_build_object('complete', true, 'data', rows, 'error', NULL));
  EXCEPTION WHEN OTHERS THEN
    result := result || jsonb_build_object('statedBudget', jsonb_build_object('complete', false, 'data', NULL,
      'error', jsonb_build_object('code', SQLSTATE, 'message', SQLERRM)));
  END;

  BEGIN
    SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.entry_date DESC, r.id), '[]'::jsonb)
      INTO rows FROM (
        SELECT s.id, s.deliverable_id, s.entry_date, s.amount, s.description, s.vendor_label, s.created_at
        FROM public.project_spend_entries s WHERE s.project_id = p_project_id
      ) r;
    result := result || jsonb_build_object('spendEntries', jsonb_build_object('complete', true, 'data', rows, 'error', NULL));
  EXCEPTION WHEN OTHERS THEN
    result := result || jsonb_build_object('spendEntries', jsonb_build_object('complete', false, 'data', NULL,
      'error', jsonb_build_object('code', SQLSTATE, 'message', SQLERRM)));
  END;

  BEGIN
    -- Each line set is aggregated in SQL before any API row limit. Both parent
    -- and child SELECT policies still apply. Refuse a visible inconsistent
    -- workspace link instead of silently dropping money from the full source.
    IF EXISTS (
      SELECT 1 FROM public.client_invoices i
      JOIN public.projects p ON p.id = i.project_id
      WHERE i.project_id = p_project_id AND i.status IN ('sent', 'paid')
        AND i.workspace_id <> p.workspace_id
    ) THEN
      RAISE EXCEPTION 'Invoice workspace does not match its project' USING ERRCODE = '22000';
    END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb)
      INTO rows FROM (
        SELECT i.id, i.status, (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', l.id, 'deliverable_id', l.deliverable_id, 'amount', l.amount
          ) ORDER BY l.id), '[]'::jsonb)
          FROM public.client_invoice_line_items l WHERE l.invoice_id = i.id
        ) AS client_invoice_line_items
        FROM public.client_invoices i
        WHERE i.project_id = p_project_id AND i.status IN ('sent', 'paid')
      ) r;
    result := result || jsonb_build_object('clientInvoices', jsonb_build_object('complete', true, 'data', rows, 'error', NULL));
  EXCEPTION WHEN OTHERS THEN
    result := result || jsonb_build_object('clientInvoices', jsonb_build_object('complete', false, 'data', NULL,
      'error', jsonb_build_object('code', SQLSTATE, 'message', SQLERRM)));
  END;

  RETURN result || jsonb_build_object(
    'deliverableAssigneeColumnPending', assignee_pending,
    'deliverableBudgetColumnsPending', budget_pending
  );
END;
$$;

REVOKE ALL ON FUNCTION public.project_budget_inputs_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_budget_inputs_v1(uuid) TO authenticated;

COMMIT;
