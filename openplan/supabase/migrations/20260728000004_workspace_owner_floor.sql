-- A workspace can never lose its last owner — enforced in the database.
--
-- WHY THIS IS NOT AN APPLICATION CHECK
--   /api/workspaces/members counts owners and then issues a separate write.
--   That is check-then-act: two owners who demote (or remove) each other at
--   the same moment each observe two owners, both writes commit, and the
--   workspace ends with zero owners. That state is unrecoverable in-app —
--   only an owner may grant the owner role, and invitations refuse the owner
--   role outright — so it would take operator SQL to repair. A free,
--   self-serve product must not have a lockout that needs a founder.
--
--   The application keeps its own pre-check for a friendly 409; this trigger
--   is the guarantee. It also covers every OTHER write path — service-role
--   scripts, a future route, a psql session — which an app check cannot.
--
-- HOW IT IS MADE ATOMIC
--   Counting alone is not enough: in READ COMMITTED, two concurrent
--   demotions each still see the other's owner row. The trigger therefore
--   takes a row lock on the parent workspace first, which serializes every
--   owner-losing change for that workspace. The second transaction then
--   counts AFTER the first has committed, sees zero remaining owners, and is
--   refused.
--
--   SECURITY DEFINER is required, not incidental: the count must see every
--   membership row, and the only SELECT policy on workspace_members is
--   members_read_own (20260316000024). Under the caller's RLS the count would
--   read zero other owners and refuse a legitimate demotion.

CREATE OR REPLACE FUNCTION public.enforce_workspace_owner_floor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  remaining_owners integer;
BEGIN
  -- Serialize owner-losing changes per workspace. A missing workspace row
  -- means this is the cascade from DELETE FROM workspaces: the workspace is
  -- going away, so there is nothing left to own and nothing to protect.
  PERFORM 1 FROM public.workspaces WHERE id = OLD.workspace_id FOR UPDATE;

  IF FOUND THEN
    SELECT count(*)
      INTO remaining_owners
      FROM public.workspace_members
     WHERE workspace_id = OLD.workspace_id
       AND role = 'owner'
       AND user_id <> OLD.user_id;

    IF remaining_owners = 0 THEN
      RAISE EXCEPTION 'workspace % would be left without an owner', OLD.workspace_id
        USING ERRCODE = 'OP409';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_workspace_owner_floor() FROM PUBLIC;

-- Two triggers rather than one: TG_OP is not available in a WHEN clause, and
-- NEW does not exist for DELETE.
DROP TRIGGER IF EXISTS workspace_members_owner_floor_update ON public.workspace_members;
CREATE TRIGGER workspace_members_owner_floor_update
  BEFORE UPDATE ON public.workspace_members
  FOR EACH ROW
  WHEN (OLD.role = 'owner' AND NEW.role IS DISTINCT FROM 'owner')
  EXECUTE FUNCTION public.enforce_workspace_owner_floor();

DROP TRIGGER IF EXISTS workspace_members_owner_floor_delete ON public.workspace_members;
CREATE TRIGGER workspace_members_owner_floor_delete
  BEFORE DELETE ON public.workspace_members
  FOR EACH ROW
  WHEN (OLD.role = 'owner')
  EXECUTE FUNCTION public.enforce_workspace_owner_floor();

-- The invitation role CHECK has allowed 'owner' since 20260424000073, but no
-- code path can create one: the route's schema accepts admin/member/viewer
-- and refuses owner explicitly. Narrowing the constraint to what the product
-- actually permits closes the drift (verified zero existing rows use it).
ALTER TABLE public.workspace_invitations
  DROP CONSTRAINT IF EXISTS workspace_invitations_role_check;

ALTER TABLE public.workspace_invitations
  ADD CONSTRAINT workspace_invitations_role_check
  CHECK (role IN ('admin', 'member', 'viewer'));
