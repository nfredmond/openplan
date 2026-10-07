-- Preserve plan-owned study geography, authorities and attributed applicability.
-- Historical absence is intentional. Existing frozen snapshots are not changed.
ALTER TABLE public.land_use_plans
  ADD COLUMN plan_context jsonb,
  ADD COLUMN plan_context_hash text GENERATED ALWAYS AS (
    CASE WHEN plan_context IS NULL THEN NULL
    ELSE encode(extensions.digest(plan_context::text, 'sha256'), 'hex') END
  ) STORED;

ALTER TABLE public.land_use_plans ADD CONSTRAINT land_use_plan_context_shape CHECK (
  plan_context IS NULL OR (
    jsonb_typeof(plan_context) = 'object'
    AND plan_context->>'schemaVersion' = '1'
    AND jsonb_typeof(plan_context->'place') = 'object'
    AND jsonb_typeof(plan_context->'assessment') = 'object'
    AND jsonb_typeof(plan_context->'assessment'->'authorities') = 'array'
    AND jsonb_array_length(plan_context->'assessment'->'authorities') > 0
    AND plan_context->>'savedBy' IS NOT NULL
    AND plan_context->>'savedAt' IS NOT NULL
  ) IS TRUE
);
COMMENT ON COLUMN public.land_use_plans.plan_context IS
  'Staff-stated plan authority and applicability, separate from office home and study-place identity. Frozen versions retain their own copy.';
