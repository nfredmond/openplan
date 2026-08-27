-- Exact guided-run links are immutable while their parent comparison exists.
-- A parent scenario/project/workspace cascade must still remove the contained
-- row; otherwise the child trigger defeats its declared ON DELETE CASCADE.

CREATE OR REPLACE FUNCTION public.refuse_scenario_comparison_model_run_link_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'scenario comparison model-run links are append-only';
END;
$$;
