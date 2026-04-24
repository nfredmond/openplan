-- Workspace invitation ledger for supervised customer onboarding.
--
-- The application stores only token hashes; invitation tokens are returned once
-- by service-role API routes and are never persisted in plaintext.

CREATE TABLE IF NOT EXISTS public.workspace_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT,
  invited_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (email_normalized = lower(btrim(email_normalized))),
  CHECK (position('@' in email_normalized) > 1)
);

CREATE INDEX IF NOT EXISTS workspace_invitations_workspace_idx
  ON public.workspace_invitations(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS workspace_invitations_email_idx
  ON public.workspace_invitations(email_normalized, created_at DESC);

CREATE INDEX IF NOT EXISTS workspace_invitations_pending_idx
  ON public.workspace_invitations(workspace_id, email_normalized, expires_at)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS workspace_invitations_one_pending_per_email_idx
  ON public.workspace_invitations(workspace_id, email_normalized)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS workspace_invitations_token_prefix_idx
  ON public.workspace_invitations(token_prefix);

ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_invitations_member_read ON public.workspace_invitations;
CREATE POLICY workspace_invitations_member_read ON public.workspace_invitations
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_invitations.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

REVOKE ALL ON TABLE public.workspace_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.workspace_invitations TO authenticated;
GRANT ALL ON TABLE public.workspace_invitations TO service_role;

CREATE OR REPLACE FUNCTION public.set_workspace_invitations_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_workspace_invitations_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_workspace_invitations_updated_at() TO service_role;

DROP TRIGGER IF EXISTS trg_set_workspace_invitations_updated_at ON public.workspace_invitations;
CREATE TRIGGER trg_set_workspace_invitations_updated_at
BEFORE UPDATE ON public.workspace_invitations
FOR EACH ROW
EXECUTE FUNCTION public.set_workspace_invitations_updated_at();

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
  IF p_role NOT IN ('owner', 'admin', 'member') THEN
    RAISE EXCEPTION 'Unsupported workspace role: %', p_role
      USING ERRCODE = '22023';
  END IF;

  SELECT wm.role
  INTO v_existing_role
  FROM public.workspace_members wm
  WHERE wm.workspace_id = p_workspace_id
    AND wm.user_id = p_user_id
  FOR UPDATE;

  v_final_role := CASE
    WHEN v_existing_role = 'owner' THEN 'owner'
    WHEN v_existing_role = 'admin' AND p_role = 'member' THEN 'admin'
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

COMMENT ON TABLE public.workspace_invitations IS
  'Service-role-written invitation ledger for supervised workspace onboarding. Stores token hashes only; workspace members may read rows for their workspace through RLS.';
