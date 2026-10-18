BEGIN;

-- One scalar bypasses API row-set limits. STABLE keeps all reads in one
-- statement snapshot. This reads legacy gross subtotals, not cash or terms.
CREATE FUNCTION public.engagement_billed_summaries_v1(
  p_workspace_id uuid, p_engagement_id uuid DEFAULT NULL,
  p_exclude_invoice_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  summaries jsonb;
BEGIN
  -- Membership and underlying RLS both apply. An unknown scope cannot become
  -- an empty successful financial position. No actor argument is accepted.
  IF p_workspace_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Engagement summary workspace is unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_engagement_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.invoicing_engagements e
    WHERE e.id = p_engagement_id AND e.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Engagement summary scope is unavailable' USING ERRCODE = '42501';
  END IF;

  -- Refuse visible inconsistent attribution rather than omit its money.
  IF EXISTS (
    SELECT 1 FROM public.client_invoices i
    JOIN public.invoicing_engagements e ON e.id = i.engagement_id
    WHERE e.workspace_id = p_workspace_id
      AND (p_engagement_id IS NULL OR e.id = p_engagement_id)
      AND i.workspace_id <> e.workspace_id
      AND (p_exclude_invoice_id IS NULL OR i.id <> p_exclude_invoice_id)
      AND i.status IN ('sent', 'paid', 'draft')
  ) THEN
    RAISE EXCEPTION 'Invoice workspace does not match its engagement' USING ERRCODE = '22000';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'engagement_id', e.id, 'not_to_exceed_amount', e.not_to_exceed_amount::text,
    'billed', jsonb_build_object('amount', a.billed::text, 'missing', a.billed_missing::text, 'invalid', a.billed_invalid::text),
    'draft', jsonb_build_object('amount', a.draft::text, 'missing', a.draft_missing::text, 'invalid', a.draft_invalid::text)
  ) ORDER BY e.id), '[]'::jsonb) INTO summaries
  FROM public.invoicing_engagements e
  CROSS JOIN LATERAL (
    SELECT
      coalesce(sum(i.subtotal_amount) FILTER (WHERE i.status IN ('sent', 'paid')), 0) AS billed,
      coalesce(sum(i.subtotal_amount) FILTER (WHERE i.status = 'draft'), 0) AS draft,
      count(*) FILTER (WHERE i.status IN ('sent', 'paid') AND i.subtotal_amount IS NULL) AS billed_missing,
      count(*) FILTER (WHERE i.status = 'draft' AND i.subtotal_amount IS NULL) AS draft_missing,
      count(*) FILTER (WHERE i.status IN ('sent', 'paid') AND (i.subtotal_amount < 0 OR i.subtotal_amount::text IN ('NaN', 'Infinity', '-Infinity'))) AS billed_invalid,
      count(*) FILTER (WHERE i.status = 'draft' AND (i.subtotal_amount < 0 OR i.subtotal_amount::text IN ('NaN', 'Infinity', '-Infinity'))) AS draft_invalid
    FROM public.client_invoices i
    WHERE i.engagement_id = e.id AND i.workspace_id = p_workspace_id
      AND (p_exclude_invoice_id IS NULL OR i.id <> p_exclude_invoice_id)
  ) a
  WHERE e.workspace_id = p_workspace_id
    AND (p_engagement_id IS NULL OR e.id = p_engagement_id);

  RETURN jsonb_build_object('version', 1, 'workspace_id', p_workspace_id,
    'engagement_id', p_engagement_id, 'exclude_invoice_id', p_exclude_invoice_id,
    'complete', true, 'data', summaries, 'error', NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.engagement_billed_summaries_v1(uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.engagement_billed_summaries_v1(uuid, uuid, uuid) TO authenticated;

COMMIT;
