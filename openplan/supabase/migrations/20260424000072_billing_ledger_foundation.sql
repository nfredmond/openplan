-- Billing ledger foundation.
--
-- Keep workspaces.* subscription columns as the cached gate/read model, while
-- adding normalized subscription and usage-event rows for commercial readiness.

CREATE TABLE IF NOT EXISTS public.subscriptions (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  quota_buckets JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_idx
  ON public.subscriptions(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS subscriptions_stripe_subscription_idx
  ON public.subscriptions(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS subscriptions_status_idx
  ON public.subscriptions(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  bucket_key TEXT NOT NULL DEFAULT 'runs',
  weight INTEGER NOT NULL CHECK (weight > 0),
  source_route TEXT,
  idempotency_key TEXT UNIQUE,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stripe_reported_at TIMESTAMPTZ,
  stripe_report_event_id TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_events_workspace_occurred_idx
  ON public.usage_events(workspace_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS usage_events_workspace_reporting_idx
  ON public.usage_events(workspace_id, stripe_reported_at, occurred_at);

CREATE INDEX IF NOT EXISTS usage_events_bucket_reporting_idx
  ON public.usage_events(bucket_key, stripe_reported_at, occurred_at);

CREATE INDEX IF NOT EXISTS usage_events_event_key_idx
  ON public.usage_events(event_key, occurred_at DESC);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscriptions_workspace_read ON public.subscriptions;
CREATE POLICY subscriptions_workspace_read ON public.subscriptions
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = subscriptions.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS usage_events_workspace_read ON public.usage_events;
CREATE POLICY usage_events_workspace_read ON public.usage_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = usage_events.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

REVOKE ALL ON TABLE public.subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.subscriptions TO authenticated;
GRANT ALL ON TABLE public.subscriptions TO service_role;

REVOKE ALL ON TABLE public.usage_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.usage_events TO authenticated;
GRANT ALL ON TABLE public.usage_events TO service_role;

CREATE OR REPLACE FUNCTION public.set_subscriptions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_subscriptions_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_subscriptions_updated_at() TO service_role;

DROP TRIGGER IF EXISTS trg_set_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER trg_set_subscriptions_updated_at
BEFORE UPDATE ON public.subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.set_subscriptions_updated_at();

INSERT INTO public.subscriptions (
  workspace_id,
  plan,
  status,
  stripe_customer_id,
  stripe_subscription_id,
  current_period_end,
  quota_buckets,
  metadata_json,
  created_at,
  updated_at
)
SELECT
  w.id,
  COALESCE(NULLIF(w.subscription_plan, ''), NULLIF(w.plan, ''), 'starter') AS plan,
  COALESCE(NULLIF(w.subscription_status, ''), CASE WHEN w.plan = 'pilot' THEN 'pilot' ELSE 'inactive' END) AS status,
  w.stripe_customer_id,
  w.stripe_subscription_id,
  w.subscription_current_period_end,
  '{}'::jsonb,
  jsonb_build_object('backfilledFrom', 'workspaces'),
  COALESCE(w.created_at, now()),
  COALESCE(w.billing_updated_at, now())
FROM public.workspaces w
ON CONFLICT (workspace_id) DO UPDATE
SET
  plan = EXCLUDED.plan,
  status = EXCLUDED.status,
  stripe_customer_id = EXCLUDED.stripe_customer_id,
  stripe_subscription_id = EXCLUDED.stripe_subscription_id,
  current_period_end = EXCLUDED.current_period_end,
  updated_at = now();

COMMENT ON TABLE public.subscriptions IS
  'Normalized per-workspace subscription ledger. User roles may read their workspace row through RLS; writes are service-role only and mirrored to workspaces billing snapshot columns.';

COMMENT ON TABLE public.usage_events IS
  'Normalized per-workspace usage ledger for quota and later Stripe period-close reporting. User roles may read their workspace usage through RLS; writes are service-role only.';
