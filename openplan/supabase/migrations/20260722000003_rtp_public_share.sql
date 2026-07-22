-- RTP "why" engine: opt-in public "what we fund and why" share view.
--
-- A cycle can be published to a read-only public URL (share token) so an agency can
-- show the community the prioritized portfolio, the "why" (VMT/GHG/safety/equity +
-- local–federal alignment), and committed funding. Public access is SERVICE-ROLE
-- MEDIATED by the public route (filtered on token + enabled) — no anon RLS policy is
-- added, so the token and cycle data are never exposed via PostgREST enumeration.
ALTER TABLE rtp_cycles
  ADD COLUMN IF NOT EXISTS public_share_token TEXT,
  ADD COLUMN IF NOT EXISTS public_share_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rtp_cycles_public_share_token
  ON rtp_cycles(public_share_token)
  WHERE public_share_token IS NOT NULL;
