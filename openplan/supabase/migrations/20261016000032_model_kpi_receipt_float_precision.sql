-- Managed PostgreSQL installations may default to extra_float_digits=0.
-- Preserve the stored binary float's full JSON representation so exact KPI
-- receipt validation does not reject ordinary computed fractional values.
-- This retains the existing immutable request, ownership and precision guards.
ALTER FUNCTION public.record_legacy_model_kpi(uuid, jsonb)
  SET extra_float_digits = 3;
ALTER FUNCTION public.write_model_attempt_kpi(uuid, uuid, jsonb)
  SET extra_float_digits = 3;
