-- Viewer role for workspace membership.
--
-- The application role matrix (src/lib/auth/role-matrix.ts) gains a read-only
-- "viewer" tier. workspace_members.role is deliberately bare TEXT with no
-- CHECK, so membership rows need no schema change — but two things at the DB
-- layer DID constrain roles to ('owner','admin','member') and would have made
-- a viewer invitation impossible to create or accept:
--
--   1. the CHECK constraint on workspace_invitations.role, and
--   2. the role allowlist inside public.accept_workspace_invitation.
--
-- Both are widened here, additively. The acceptance function's role-merge is
-- also generalized: the old CASE only knew that owner beats everything and
-- admin beats an invited member; with a fourth tier, the rule is stated as a
-- rank — accepting an invitation NEVER downgrades an existing membership.

-- 1. Allow 'viewer' invitations. The original CHECK was declared inline, so it
--    carries the Postgres auto-generated name.
ALTER TABLE public.workspace_invitations
  DROP CONSTRAINT IF EXISTS workspace_invitations_role_check;

ALTER TABLE public.workspace_invitations
  ADD CONSTRAINT workspace_invitations_role_check
  CHECK (role IN ('owner', 'admin', 'member', 'viewer'));

-- 2. Rank helper: strongest role first. Unknown/legacy role strings rank 0 so
--    an invitation can only ever move them UP to a known role, matching the
--    prior function's ELSE branch.
CREATE OR REPLACE FUNCTION public.workspace_role_rank(p_role text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN 4
    WHEN 'admin' THEN 3
    WHEN 'member' THEN 2
    WHEN 'viewer' THEN 1
    ELSE 0
  END;
$$;

REVOKE ALL ON FUNCTION public.workspace_role_rank(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_role_rank(text) TO service_role;

-- 3. Accept a viewer invitation, and never downgrade an existing membership.
CREATE OR REPLACE FUNCTION public.accept_workspace_invitation(
  p_invitation_id uuid,
  p_workspace_id uuid,
  p_user_id uuid,
  p_role text
)
RETURNS TABLE(final_role text, membership_changed boolean)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_existing_role text;
  v_final_role text;
  v_membership_changed boolean := false;
BEGIN
  IF p_role NOT IN ('owner', 'admin', 'member', 'viewer') THEN
    RAISE EXCEPTION 'Unsupported workspace role: %', p_role
      USING ERRCODE = '22023';
  END IF;

  SELECT wm.role
  INTO v_existing_role
  FROM public.workspace_members wm
  WHERE wm.workspace_id = p_workspace_id
    AND wm.user_id = p_user_id
  FOR UPDATE;

  -- Accepting an invitation never demotes: keep whichever of the existing and
  -- invited roles ranks higher (owner > admin > member > viewer).
  v_final_role := CASE
    WHEN v_existing_role IS NULL THEN p_role
    WHEN public.workspace_role_rank(v_existing_role) >= public.workspace_role_rank(p_role)
      THEN v_existing_role
    ELSE p_role
  END;

  IF v_existing_role IS NULL THEN
    INSERT INTO public.workspace_members(workspace_id, user_id, role)
    VALUES (p_workspace_id, p_user_id, v_final_role);
    v_membership_changed := true;
  ELSIF v_existing_role <> v_final_role THEN
    UPDATE public.workspace_members
    SET role = v_final_role
    WHERE workspace_id = p_workspace_id
      AND user_id = p_user_id;
    v_membership_changed := true;
  END IF;

  UPDATE public.workspace_invitations
  SET status = 'accepted',
      accepted_at = now(),
      accepted_by_user_id = p_user_id
  WHERE id = p_invitation_id
    AND workspace_id = p_workspace_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace invitation is no longer pending'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY SELECT v_final_role, v_membership_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_workspace_invitation(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invitation(uuid, uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.workspace_role_rank(text) IS
  'Rank of a workspace role, strongest first (owner 4 … viewer 1, unknown 0). Used by accept_workspace_invitation so acceptance never downgrades an existing membership.';
