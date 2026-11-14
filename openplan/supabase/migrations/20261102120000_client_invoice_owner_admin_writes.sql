-- KI-2026-10-12-007, the remaining role gap. The invoice routes let only an
-- owner or admin write a client invoice or its lines (role matrix
-- `invoices.write`), and replace_client_invoice_lines checks the same rule.
-- The table policies check membership, and the writer-only policies from
-- 20260728000006 and 20260728000007 refuse viewers only, so a member could
-- still create a draft invoice, edit or void one, and add, change or delete
-- its lines through the Data API.
--
-- Additive: restrictive policies AND with the existing permissive and
-- writer-only policies, the same shape 20260728000006 uses. No policy, grant
-- or function is dropped or replaced, and no row is rewritten. Invoices and
-- lines a member wrote before this migration stay as they are.
--
-- Writers that keep working:
--   - the invoice routes, which write with the caller's session after
--     checking for owner or admin, and replace_client_invoice_lines, which
--     runs as that caller;
--   - service_role, which bypasses row security: the create route's rollback
--     delete and every worker;
--   - bill_contract_actuals, SECURITY DEFINER and owned by the table owner,
--     which row security does not apply to (FORCE ROW LEVEL SECURITY is off);
--   - foreign key actions (ON DELETE CASCADE and SET NULL), which run as the
--     table owner, so a member who deletes a project still clears it from the
--     invoices that named it.
-- The policies name `authenticated` only. Anonymous callers are already
-- refused by the permissive policies, which require auth.uid() membership.

-- True when the current actor is an owner or admin of the workspace, the
-- roles `invoices.write` allows in src/lib/auth/role-matrix.ts. SECURITY
-- INVOKER: it reads workspace_members as the caller, and members_read_own
-- limits that to the caller's own row. A NULL workspace (a line whose invoice
-- the caller cannot see) returns false, so the write is refused.
CREATE FUNCTION public.workspace_member_can_write_invoices(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = auth.uid()
      AND wm.role IN ('owner', 'admin')
  );
$$;
REVOKE ALL ON FUNCTION public.workspace_member_can_write_invoices(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_member_can_write_invoices(uuid) TO authenticated;

CREATE POLICY client_invoices_invoice_writer_insert ON public.client_invoices
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.workspace_member_can_write_invoices(workspace_id));
CREATE POLICY client_invoices_invoice_writer_update ON public.client_invoices
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.workspace_member_can_write_invoices(workspace_id))
  WITH CHECK (public.workspace_member_can_write_invoices(workspace_id));
CREATE POLICY client_invoices_invoice_writer_delete ON public.client_invoices
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.workspace_member_can_write_invoices(workspace_id));

CREATE POLICY client_invoice_line_items_invoice_writer_insert ON public.client_invoice_line_items
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.workspace_member_can_write_invoices((SELECT p.workspace_id FROM public.client_invoices p WHERE p.id = client_invoice_line_items.invoice_id)));
CREATE POLICY client_invoice_line_items_invoice_writer_update ON public.client_invoice_line_items
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.workspace_member_can_write_invoices((SELECT p.workspace_id FROM public.client_invoices p WHERE p.id = client_invoice_line_items.invoice_id)))
  WITH CHECK (public.workspace_member_can_write_invoices((SELECT p.workspace_id FROM public.client_invoices p WHERE p.id = client_invoice_line_items.invoice_id)));
CREATE POLICY client_invoice_line_items_invoice_writer_delete ON public.client_invoice_line_items
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.workspace_member_can_write_invoices((SELECT p.workspace_id FROM public.client_invoices p WHERE p.id = client_invoice_line_items.invoice_id)));
