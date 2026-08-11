-- A campaign can carry a human-readable public address alongside its token.
--
-- ============================================================== WHY
--
-- The share token (28 lowercase alphanumeric characters, ~144 bits) is the
-- right credential for a link nobody should guess, and the wrong thing to
-- print on a flyer, read out at a public meeting, or type from a bus-shelter
-- poster. `public_slug` is the printable address: /engage/downtown-corridor-plan
-- instead of /engage/k3f9x2m8q1z7w4b6n0j5h8v2c9t1.
--
-- ============================== THE ENTROPY TRADEOFF IS DELIBERATE
--
-- A slug is guessable BY DESIGN — that is what makes it printable. It gives up
-- none of the token's protection, because the application only ever resolves a
-- slug for a campaign whose status is 'active': a slug on a draft or closed
-- campaign resolves nothing. An active campaign is already public on its token
-- link, so the slug never exposes anything a resident could not already reach —
-- it only makes the address speakable. Staged and draft campaigns remain
-- reachable through the unguessable token path alone (and, for members, the
-- operator preview).
--
-- ============================== WHY GLOBALLY UNIQUE, NOT PER-WORKSPACE
--
-- The slug is a path segment on a public route that carries no workspace
-- context, so two workspaces holding the same slug would be indistinguishable
-- at the door. Global uniqueness is the constraint the URL shape imposes.
--
-- ============================== WHY THE FORMAT CHECK IS STRICT
--
-- Lowercase kebab (a-z, 0-9, single hyphens, no leading/trailing hyphen),
-- 3-64 characters. Share tokens are exactly 28 lowercase alphanumerics, so a
-- token is also a syntactically valid slug — the application disambiguates by
-- trying the token column first, which means a slug can never shadow a live
-- token. The CHECK exists so a slug is always something a person can say aloud
-- and type from paper, in any locale: no uppercase to lose over the phone, no
-- characters a URL would escape.

ALTER TABLE engagement_campaigns
  ADD COLUMN IF NOT EXISTS public_slug TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'engagement_campaigns_public_slug_format_check'
  ) THEN
    ALTER TABLE engagement_campaigns
      ADD CONSTRAINT engagement_campaigns_public_slug_format_check
      CHECK (
        public_slug IS NULL
        OR (
          char_length(public_slug) BETWEEN 3 AND 64
          AND public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'engagement_campaigns_public_slug_unique'
  ) THEN
    ALTER TABLE engagement_campaigns
      ADD CONSTRAINT engagement_campaigns_public_slug_unique
      UNIQUE (public_slug);
  END IF;
END
$$;

COMMENT ON COLUMN engagement_campaigns.public_slug IS
  'Optional printable public address for the portal (/engage/{slug}). Lowercase kebab, 3-64 chars, globally unique; NULL means the campaign is reachable by share token only. Guessable by design — the low entropy is the point of a printed address — and safe because resolution requires status = active, so a slug never resolves a campaign the public could not already reach by its token.';
