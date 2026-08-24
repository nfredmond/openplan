-- Keep direct decision/report deletion refused while allowing their parent plan
-- and workspace to cascade away. During that cascade the parent plan row is no
-- longer visible to the child trigger.
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
