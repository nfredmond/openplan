-- Validate future estimate amounts without rounding numeric storage or rewriting
-- retained estimates, source documents, import receipts or report history.
CREATE FUNCTION public.check_project_estimate_exact_cents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.estimated_cost_amount IS NOT DISTINCT FROM OLD.estimated_cost_amount THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.estimated_cost_amount IS NOT NULL AND (
    NEW.estimated_cost_amount <= 0
    OR NEW.estimated_cost_amount > 1000000000000000
    OR NEW.estimated_cost_amount <> trunc(NEW.estimated_cost_amount, 2)
  ) THEN
    RAISE EXCEPTION 'Project estimate must be positive, at most 1000000000000000, and contain whole cents'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.check_project_estimate_exact_cents() FROM PUBLIC;

CREATE TRIGGER projects_estimate_exact_cents
BEFORE INSERT OR UPDATE OF estimated_cost_amount ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.check_project_estimate_exact_cents();
