-- Browser clients freeze through the scoped command route. This leaves existing
-- frozen records, adoption transitions and ordinary working edits unchanged.
CREATE FUNCTION public.guard_land_use_plan_freeze_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.state <> 'working')
     OR (TG_OP = 'UPDATE' AND OLD.state = 'working' AND NEW.state <> 'working') THEN
    IF current_user NOT IN ('service_role', 'postgres') THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Freezing requires the verified server command path';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER aa_land_use_plan_freeze_server_write
  BEFORE INSERT OR UPDATE ON public.land_use_plan_versions
  FOR EACH ROW EXECUTE FUNCTION public.guard_land_use_plan_freeze_write();
