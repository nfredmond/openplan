ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS subscription_plan TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'pilot',
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_current_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_updated_at TIMESTAMPTZ DEFAULT now();

UPDATE workspaces
SET
  subscription_plan = COALESCE(subscription_plan, CASE WHEN plan IN ('starter', 'professional') THEN plan ELSE NULL END),
  subscription_status = COALESCE(subscription_status, CASE WHEN plan = 'pilot' THEN 'pilot' ELSE 'inactive' END),
  billing_updated_at = COALESCE(billing_updated_at, now());

CREATE INDEX IF NOT EXISTS idx_workspaces_subscription_status
  ON workspaces(subscription_status);
