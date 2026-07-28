-- Per-workspace integration keys: a team's own provider credentials
-- (Anthropic, Census, Mapbox), stored encrypted, overriding the deployment's
-- environment variables per tenant. The deployment env stays authoritative for
-- self-hosters; a workspace key, when present and decryptable, wins for that
-- workspace's requests.
--
-- SECURITY POSTURE — service-role only, by construction:
--   * key_ciphertext is AES-256-GCM ciphertext produced in the application
--     layer with a server-held secret (OPENPLAN_INTEGRATION_KEY_SECRET).
--     The database never sees plaintext, and neither does any browser: reads
--     that leave the server carry provider + key_last4 + timestamps only.
--   * RLS is enabled with NO policies for authenticated, and the default
--     Supabase grant to authenticated/anon is revoked outright below —
--     revoking PUBLIC alone is theater (precedent: 20260722000005,
--     20260727000013/14). Every read and write goes through server routes
--     that enforce owner/admin via the role matrix and return metadata only.
--   * One row per (workspace, provider); replacing a key overwrites the row.

CREATE TABLE IF NOT EXISTS public.workspace_integration_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('anthropic', 'census', 'mapbox')),
  key_ciphertext TEXT NOT NULL,
  key_last4 TEXT NOT NULL,
  configured_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workspace_integration_keys_one_per_provider UNIQUE (workspace_id, provider)
);

CREATE INDEX IF NOT EXISTS workspace_integration_keys_workspace_idx
  ON public.workspace_integration_keys(workspace_id);

ALTER TABLE public.workspace_integration_keys ENABLE ROW LEVEL SECURITY;

-- No RLS policies on purpose: with RLS enabled and zero policies, even a
-- stray grant would return no rows. The revokes below remove the grants too,
-- so authenticated/anon cannot query the table at all. Only the service role
-- (which bypasses RLS) reads or writes, and only inside server routes.
REVOKE ALL ON public.workspace_integration_keys FROM PUBLIC;
REVOKE ALL ON public.workspace_integration_keys FROM anon;
REVOKE ALL ON public.workspace_integration_keys FROM authenticated;
