-- Phase Q.1 — add is_demo marker to workspaces so the NCTC demo seed can
-- be filtered out of observability / billing / outbound paths that must
-- not treat demo data as production.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_workspaces_is_demo
  ON workspaces(is_demo)
  WHERE is_demo = true;

COMMENT ON COLUMN workspaces.is_demo IS
  'Marks seeded demo/proof-of-capability workspaces (e.g. NCTC 90% plan example). Must not be treated as production tenant data for billing, outbound, or usage analytics.';
