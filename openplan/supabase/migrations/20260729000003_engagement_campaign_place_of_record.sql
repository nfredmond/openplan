-- An engagement campaign can state the area it is about, so its public portal
-- stops opening on a continent.
--
-- WHY THIS EXISTS
--   `derivePortalMapCenter` framed the resident-facing map from the campaign's
--   already-APPROVED pins, and returned nothing for a campaign that had none.
--   A brand-new campaign is exactly the case that matters: the first resident to
--   scan the QR code on the flyer got the whole United States and had to find
--   their own neighbourhood before they could say anything. The map was correct
--   only once it no longer needed to be.
--
--   The area was very often already known — the linked project's study area
--   (20260728000009) or the workspace's home geography (20260723000005) — and
--   nothing read either of them here. What was genuinely missing was the case
--   where the campaign is about somewhere ELSE: a corridor study inside a
--   county-wide agency, one neighbourhood plan out of six. That is what these
--   columns record, and it is why they OUTRANK the project and the workspace
--   rather than merely supplementing them.
--
-- POSTURE — the same four rules as 20260723000005 and 20260728000009
--   * COLUMNS ON `engagement_campaigns`, NOT A NEW TABLE. One campaign is about
--     one area; a 1:1 fact belongs on the row.
--   * JURISDICTION-NEUTRAL (source, kind, ref). No column says fips, state or
--     county. Another country means another resolver adapter, not an ALTER.
--   * ISO CODES ARE THE JURISDICTION SEAM, matching the descriptor the
--     stage-gate and grants registries already speak.
--   * EVERYTHING NULLABLE. A campaign with no stated area is normal: the portal
--     then falls back, in order, to the project's place of record, the
--     workspace's home geography, and finally the campaign's own approved pins —
--     and says which one it used.
--
-- THE COLUMN NAMES ARE DELIBERATELY THE SAME AS `projects.place_*`.
--   `src/lib/geographies/place-of-record.ts` exists precisely so a place has one
--   shape regardless of who owns it, and it says in as many words that a third
--   owner should be able to adopt it "without rearranging anything". Reusing the
--   prefix means the existing row builders and the existing narrowing apply to a
--   campaign verbatim, instead of a second set differing only in spelling. The
--   call sites that reuse them name this migration so the reader can check.
--
-- HOW THIS RELATES TO THE PER-QUESTION SURVEY MAP VIEW, WHICH IS KEPT
--   `map_point` survey questions carry their own optional `center`/`zoom`
--   (src/lib/engagement/survey.ts). Those stay: a question can legitimately ask
--   about one intersection inside a campaign-wide area. What changes is that an
--   unset question now inherits the campaign's framing instead of the continent.
--
-- RLS IS EXTENDED, NOT WEAKENED. Columns added to a table are covered by its
-- existing policies: `engagement_campaigns_read` for members, the permissive
-- update policy plus the RESTRICTIVE writer gate from 20260728000007 for writes.
-- This migration creates, alters and drops NO policy, and adds no table — the
-- policy and table counts in src/test/migrations/inventory.test.ts and
-- src/test/viewer-write-denial-guard.test.ts are unchanged by it.
--
-- ONE HONEST NOTE ABOUT THE PUBLIC PORTAL. The portal is unauthenticated by
-- design and reads through the service role, so whatever it renders is
-- world-readable to anyone holding the share token. A campaign's stated area is
-- published deliberately: it is the frame of the map every resident is being
-- asked to draw on, and telling them where the study area is is the point. The
-- boundary polygon is NOT sent to the portal — only the bbox that frames the
-- camera — because a TIGERweb county boundary is megabytes on a page opened
-- from a phone, not because it is a secret.

ALTER TABLE engagement_campaigns
  -- Which resolver produced this area ('tigerweb', or 'drawn' for a hand-drawn
  -- boundary). Namespaces place_ref.
  ADD COLUMN IF NOT EXISTS place_source TEXT,
  -- The resolver's own kind vocabulary (county / city / cdp / metro / micro).
  -- Deliberately not a CHECK-constrained enum: a new source brings a new
  -- vocabulary, and this table must not need editing to admit one.
  ADD COLUMN IF NOT EXISTS place_kind TEXT,
  -- Id inside that source's namespace. Census GEOID for tigerweb; NULL when the
  -- area was drawn, because a drawn shape has no identity to reference.
  ADD COLUMN IF NOT EXISTS place_ref TEXT,
  -- What an operator and a resident read, carried rather than derived.
  ADD COLUMN IF NOT EXISTS place_label TEXT,
  ADD COLUMN IF NOT EXISTS place_country_code TEXT,
  ADD COLUMN IF NOT EXISTS place_subdivision_code TEXT,
  ADD COLUMN IF NOT EXISTS place_min_lon DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS place_min_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS place_max_lon DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS place_max_lat DOUBLE PRECISION,
  -- The boundary itself. For a DRAWN area this is the only record of the shape —
  -- a bbox rectangle around a corridor is not that corridor — and it is what
  -- would let a campaign area seed a representativeness screen later.
  ADD COLUMN IF NOT EXISTS place_geometry_geojson JSONB,
  ADD COLUMN IF NOT EXISTS place_set_at TIMESTAMPTZ;

------------------------------------------------------------------------------
-- Integrity. Each guard stops a WRONG value being stored, never forces a value:
-- a campaign with no stated area satisfies all of them.
------------------------------------------------------------------------------

DO $$
BEGIN
  -- All four corners or none. Three of four frames a plausible, wrong map, and
  -- this bbox is the only thing the public portal receives.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engagement_campaigns_place_bbox_complete') THEN
    ALTER TABLE engagement_campaigns
      ADD CONSTRAINT engagement_campaigns_place_bbox_complete
      CHECK (num_nulls(place_min_lon, place_min_lat, place_max_lon, place_max_lat) IN (0, 4));
  END IF;

  -- On the globe. Longitude ORDERING is deliberately not constrained: a bbox
  -- spanning the antimeridian legitimately has min_lon > max_lon, and forbidding
  -- it would bake a hemisphere assumption into the schema.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engagement_campaigns_place_bbox_on_globe') THEN
    ALTER TABLE engagement_campaigns
      ADD CONSTRAINT engagement_campaigns_place_bbox_on_globe
      CHECK (
        (place_min_lon IS NULL OR (place_min_lon >= -180 AND place_min_lon <= 180))
        AND (place_max_lon IS NULL OR (place_max_lon >= -180 AND place_max_lon <= 180))
        AND (place_min_lat IS NULL OR (place_min_lat >= -90 AND place_min_lat <= 90))
        AND (place_max_lat IS NULL OR (place_max_lat >= -90 AND place_max_lat <= 90))
        AND (place_min_lat IS NULL OR place_max_lat IS NULL OR place_min_lat <= place_max_lat)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engagement_campaigns_place_country_code_iso') THEN
    ALTER TABLE engagement_campaigns
      ADD CONSTRAINT engagement_campaigns_place_country_code_iso
      CHECK (place_country_code IS NULL OR place_country_code ~ '^[A-Z]{2}$');
  END IF;

  -- The subdivision part of ISO 3166-2, without the country prefix ('CA', not
  -- 'US-CA'). Meaningless without its country, so it requires one.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engagement_campaigns_place_subdivision_code_iso') THEN
    ALTER TABLE engagement_campaigns
      ADD CONSTRAINT engagement_campaigns_place_subdivision_code_iso
      CHECK (
        place_subdivision_code IS NULL
        OR (place_country_code IS NOT NULL AND place_subdivision_code ~ '^[A-Z0-9]{1,3}$')
      );
  END IF;

  -- A half-set area is the failure this whole change is about: something that
  -- reads as "an area is set" and cannot frame anything. `place_set_at` is
  -- required alongside a source so "set but unreadable" is always
  -- distinguishable from "never set".
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engagement_campaigns_place_coherent') THEN
    ALTER TABLE engagement_campaigns
      ADD CONSTRAINT engagement_campaigns_place_coherent
      CHECK (
        (place_ref IS NULL OR place_source IS NOT NULL)
        AND (place_source IS NULL OR length(trim(place_source)) > 0)
        AND (place_kind IS NULL OR length(trim(place_kind)) > 0)
        AND (place_ref IS NULL OR length(trim(place_ref)) > 0)
        AND (place_source IS NULL OR place_set_at IS NOT NULL)
      );
  END IF;

  -- A drawn area has no identity, by construction. Storing a ref against one
  -- would invite a downstream module to resolve it and get somebody else's
  -- county. The rule lives here so it cannot be forgotten in a call site.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engagement_campaigns_place_drawn_has_no_ref') THEN
    ALTER TABLE engagement_campaigns
      ADD CONSTRAINT engagement_campaigns_place_drawn_has_no_ref
      CHECK (place_source IS DISTINCT FROM 'drawn' OR place_ref IS NULL);
  END IF;
END
$$;

COMMENT ON COLUMN engagement_campaigns.place_source IS
  'Resolver that produced this campaign''s area (''tigerweb'', or ''drawn'' for a hand-drawn boundary). Namespaces place_ref. NULL means the campaign has not stated an area — an honest state that makes the public portal fall back to the linked project''s place, then the workspace home geography, then the campaign''s own approved pins, and disclose which it used.';
COMMENT ON COLUMN engagement_campaigns.place_kind IS
  'Source-defined geography kind (county/city/cdp/metro/micro for TIGERweb). Intentionally unconstrained: a new source brings its own vocabulary.';
COMMENT ON COLUMN engagement_campaigns.place_ref IS
  'Id of the area within place_source. Census GEOID for tigerweb; always NULL when place_source is ''drawn'', because a drawn shape has no resolvable identity.';
COMMENT ON COLUMN engagement_campaigns.place_min_lon IS
  'West edge of the area''s extent. These four columns are the ONLY geography the public portal receives: they frame the resident-facing map, and the boundary polygon is withheld because it can be megabytes on a phone.';
COMMENT ON COLUMN engagement_campaigns.place_geometry_geojson IS
  'The boundary as GeoJSON. For a drawn campaign area this is the only record of the shape; the bbox is a rectangle around it, not it.';
