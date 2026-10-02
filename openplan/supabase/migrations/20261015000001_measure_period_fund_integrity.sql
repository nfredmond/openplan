-- A period, fund and workspace form one financial parent. Preserve existing
-- rows; enforce new writes immediately and validate clean installations.
ALTER TABLE public.measure_fund_periods
  ADD CONSTRAINT measure_period_fund_workspace_uniq UNIQUE (id, measure_fund_id, workspace_id);

ALTER TABLE public.measure_allocations
  ADD CONSTRAINT measure_allocations_period_fund_fk
  FOREIGN KEY (period_id, measure_fund_id, workspace_id)
  REFERENCES public.measure_fund_periods (id, measure_fund_id, workspace_id)
  ON DELETE CASCADE NOT VALID;

ALTER TABLE public.measure_period_off_the_top
  ADD CONSTRAINT measure_period_off_the_top_period_fund_fk
  FOREIGN KEY (period_id, measure_fund_id, workspace_id)
  REFERENCES public.measure_fund_periods (id, measure_fund_id, workspace_id)
  ON DELETE CASCADE NOT VALID;

ALTER TABLE public.measure_period_reserve
  ADD CONSTRAINT measure_period_reserve_period_fund_fk
  FOREIGN KEY (period_id, measure_fund_id, workspace_id)
  REFERENCES public.measure_fund_periods (id, measure_fund_id, workspace_id)
  ON DELETE CASCADE NOT VALID;

-- Historic mismatches need an operator's recorded reconciliation, not deletion
-- or reassignment by an upgrade. NOT VALID still enforces every new write.
DO $$
DECLARE v_table text; v_count bigint;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['measure_allocations', 'measure_period_off_the_top', 'measure_period_reserve'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I c WHERE NOT EXISTS (SELECT 1 FROM public.measure_fund_periods p WHERE (p.id,p.measure_fund_id,p.workspace_id) = (c.period_id,c.measure_fund_id,c.workspace_id))', v_table) INTO v_count;
    IF v_count = 0 THEN
      EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', v_table, v_table || '_period_fund_fk');
    ELSE
      RAISE WARNING '% contains % pre-existing period/fund mismatches; reconcile and validate its period_fund_fk constraint. No records were changed.', v_table, v_count;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.replace_measure_period_allocation(
  p_measure_fund_id uuid,
  p_period_id       uuid,
  p_allocations     jsonb,
  p_off_the_top     jsonb,
  p_reserves        jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_replaced_allocations integer;
  v_replaced_off_the_top integer;
  v_replaced_reserves    integer;
  v_allocations          jsonb;
BEGIN
  -- Serialize replacements on the actual visible parent, including empty sets.
  PERFORM 1 FROM public.measure_fund_periods
   WHERE id = p_period_id AND measure_fund_id = p_measure_fund_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The allocation period does not belong to this fund or is unavailable'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF p_allocations IS NULL OR p_off_the_top IS NULL OR p_reserves IS NULL
     OR jsonb_typeof(p_allocations) <> 'array'
     OR jsonb_typeof(p_off_the_top) <> 'array'
     OR jsonb_typeof(p_reserves) <> 'array' THEN
    RAISE EXCEPTION 'replace_measure_period_allocation: every row set must be a JSON array'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- THE SCOPE CHECK, now over three arrays. Every row must belong to the period
  -- being replaced. Without it a caller could smuggle rows for a period the
  -- DELETEs below do not clear, and they would be added BESIDE that period's
  -- existing figures — the every-line-appears-twice outcome the wholesale
  -- replacement exists to prevent. RLS cannot see this: the rows are in the
  -- caller's own workspace either way.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_allocations) AS entry
     WHERE (entry->>'period_id')::uuid IS DISTINCT FROM p_period_id
        OR (entry->>'measure_fund_id')::uuid IS DISTINCT FROM p_measure_fund_id
  ) OR EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_off_the_top) AS entry
     WHERE (entry->>'period_id')::uuid IS DISTINCT FROM p_period_id
        OR (entry->>'measure_fund_id')::uuid IS DISTINCT FROM p_measure_fund_id
  ) OR EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_reserves) AS entry
     WHERE (entry->>'period_id')::uuid IS DISTINCT FROM p_period_id
        OR (entry->>'measure_fund_id')::uuid IS DISTINCT FROM p_measure_fund_id
  ) THEN
    RAISE EXCEPTION
      'replace_measure_period_allocation: every row must name period % of fund %',
      p_period_id, p_measure_fund_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- The counts are returned for the reason the route's own comment gives: a
  -- recompute that replaced 12 lines and one that replaced 0 are different
  -- events, and only the first is a correction of something a person saw.
  WITH removed AS (
    DELETE FROM public.measure_allocations
     WHERE period_id = p_period_id
       AND measure_fund_id = p_measure_fund_id
    RETURNING id
  )
  SELECT count(*)::integer INTO v_replaced_allocations FROM removed;

  WITH removed AS (
    DELETE FROM public.measure_period_off_the_top
     WHERE period_id = p_period_id
       AND measure_fund_id = p_measure_fund_id
    RETURNING id
  )
  SELECT count(*)::integer INTO v_replaced_off_the_top FROM removed;

  WITH removed AS (
    DELETE FROM public.measure_period_reserve
     WHERE period_id = p_period_id
       AND measure_fund_id = p_measure_fund_id
    RETURNING id
  )
  SELECT count(*)::integer INTO v_replaced_reserves FROM removed;

  WITH added AS (
    INSERT INTO public.measure_allocations (
      workspace_id, measure_fund_id, period_id, category_id, recipient_id,
      allocation_rule_id, amount, computation_basis, rationale, stated_by, stated_on
    )
    SELECT
      (entry->>'workspace_id')::uuid,
      (entry->>'measure_fund_id')::uuid,
      (entry->>'period_id')::uuid,
      entry->>'category_id',
      (entry->>'recipient_id')::uuid,
      (entry->>'allocation_rule_id')::uuid,
      (entry->>'amount')::numeric,
      entry->>'computation_basis',
      entry->>'rationale',
      (entry->>'stated_by')::uuid,
      (entry->>'stated_on')::date
    FROM jsonb_array_elements(p_allocations) AS entry
    RETURNING id, measure_fund_id, period_id, category_id, recipient_id,
              allocation_rule_id, amount, computation_basis, rationale, stated_by, stated_on
  )
  SELECT coalesce(jsonb_agg(to_jsonb(added)), '[]'::jsonb) INTO v_allocations FROM added;

  INSERT INTO public.measure_period_off_the_top (
    workspace_id, measure_fund_id, period_id, off_the_top_id, label,
    amount, uncapped_amount, cap_amount, cap_basis, cap_status,
    allocation_rule_id, stated_by, stated_on
  )
  SELECT
    (entry->>'workspace_id')::uuid,
    (entry->>'measure_fund_id')::uuid,
    (entry->>'period_id')::uuid,
    entry->>'off_the_top_id',
    entry->>'label',
    (entry->>'amount')::numeric,
    (entry->>'uncapped_amount')::numeric,
    (entry->>'cap_amount')::numeric,
    entry->>'cap_basis',
    entry->>'cap_status',
    (entry->>'allocation_rule_id')::uuid,
    (entry->>'stated_by')::uuid,
    (entry->>'stated_on')::date
  FROM jsonb_array_elements(p_off_the_top) AS entry;

  INSERT INTO public.measure_period_reserve (
    workspace_id, measure_fund_id, period_id, reserve_id, label,
    basis_kind, basis_category_id, basis_category_label, basis_amount,
    percent, amount, computed_amount,
    allocation_rule_id, stated_by, stated_on
  )
  SELECT
    (entry->>'workspace_id')::uuid,
    (entry->>'measure_fund_id')::uuid,
    (entry->>'period_id')::uuid,
    entry->>'reserve_id',
    entry->>'label',
    entry->>'basis_kind',
    entry->>'basis_category_id',
    entry->>'basis_category_label',
    (entry->>'basis_amount')::numeric,
    (entry->>'percent')::numeric,
    (entry->>'amount')::numeric,
    (entry->>'computed_amount')::numeric,
    (entry->>'allocation_rule_id')::uuid,
    (entry->>'stated_by')::uuid,
    (entry->>'stated_on')::date
  FROM jsonb_array_elements(p_reserves) AS entry;

  RETURN jsonb_build_object(
    'replaced_allocation_count', v_replaced_allocations,
    'replaced_off_the_top_count', v_replaced_off_the_top,
    'replaced_reserve_count', v_replaced_reserves,
    'allocations', v_allocations
  );
END;
$$;
