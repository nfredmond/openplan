-- Engagement headline upgrade: map comments as points, lines, and polygons,
-- optional photo attachments, and community "support" votes.
--
-- Posture notes:
-- - engagement_items.geometry stores a GeoJSON Geometry (Point | LineString |
--   Polygon) as JSONB. latitude/longitude stay populated as the representative
--   point (the geometry itself for points, the centroid for lines/polygons) so
--   every existing lat/lng surface — map-features backdrop, CSV export,
--   moderation registry, geography analytics — keeps working unchanged.
-- - engagement_item_votes has RLS ENABLED with NO policies on purpose: all
--   reads/writes are mediated by service-role API routes with explicit
--   share-token + approval filters (same posture as the public portal after
--   20260717000082 dropped the anon policies). Do NOT add anon policies.
-- - The engagement-photos bucket is PRIVATE and service-role only: no
--   storage.objects policies at all. Uploads go through
--   POST /api/engage/[shareToken]/photo-upload; reads happen exclusively via
--   short-TTL signed URLs minted server-side (public portal: approved items
--   only; staff moderation queue: after an RLS-scoped campaign read succeeds).

-- 1. Geometry, photo, and vote-count columns on engagement_items.
ALTER TABLE engagement_items
  ADD COLUMN IF NOT EXISTS geometry JSONB,
  ADD COLUMN IF NOT EXISTS photo_path TEXT,
  ADD COLUMN IF NOT EXISTS votes_count INTEGER NOT NULL DEFAULT 0;

-- Light shape guard at the database layer. Full structural validation
-- (vertex caps, ring closure, WGS84 bounds) lives in
-- src/lib/engagement/geometry.ts and runs in every write path.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'engagement_items_geometry_type_check'
  ) THEN
    ALTER TABLE engagement_items
      ADD CONSTRAINT engagement_items_geometry_type_check
      CHECK (
        geometry IS NULL
        OR geometry->>'type' IN ('Point', 'LineString', 'Polygon')
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'engagement_items_votes_count_check'
  ) THEN
    ALTER TABLE engagement_items
      ADD CONSTRAINT engagement_items_votes_count_check
      CHECK (votes_count >= 0);
  END IF;
END
$$;

-- 2. Community support votes. One vote per (item, anonymous fingerprint);
--    the unique constraint is the real idempotency guard — client-side
--    localStorage memory is only a soft UI hint.
CREATE TABLE IF NOT EXISTS engagement_item_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES engagement_items(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES engagement_campaigns(id) ON DELETE CASCADE,
  voter_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, voter_fingerprint)
);

-- Supports the vote-rate-limit lookup (campaign + fingerprint + recency).
CREATE INDEX IF NOT EXISTS idx_engagement_item_votes_campaign_fingerprint_created
  ON engagement_item_votes(campaign_id, voter_fingerprint, created_at DESC);

-- RLS on, zero policies: service-role only (see posture notes above).
ALTER TABLE engagement_item_votes ENABLE ROW LEVEL SECURITY;

-- 3. Denormalized votes_count maintained by trigger on insert/delete.
CREATE OR REPLACE FUNCTION apply_engagement_item_vote_delta()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE engagement_items
    SET votes_count = votes_count + 1
    WHERE id = NEW.item_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE engagement_items
    SET votes_count = GREATEST(votes_count - 1, 0)
    WHERE id = OLD.item_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_engagement_item_votes_count ON engagement_item_votes;
CREATE TRIGGER trg_engagement_item_votes_count
AFTER INSERT OR DELETE ON engagement_item_votes
FOR EACH ROW
EXECUTE FUNCTION apply_engagement_item_vote_delta();

-- 4. Private storage bucket for public-submitted photos.
--    Path convention: <campaign_id>/<uuid>.<jpg|png|webp>
--    Deliberately NO storage.objects policies (unlike report-artifacts):
--    pending/rejected photos must never be reachable except through
--    server-minted signed URLs.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'engagement-photos',
  'engagement-photos',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
) ON CONFLICT (id) DO NOTHING;
