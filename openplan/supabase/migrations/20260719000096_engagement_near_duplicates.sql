-- E9 (near-duplicates) — fuzzy near-duplicate detection over engagement comment
-- bodies via pg_trgm trigram similarity. Complements the EXACT body_fingerprint
-- dedup (which only catches verbatim reposts within a short window) by surfacing
-- paraphrased / typo'd near-duplicates so a moderator can collapse them in the
-- queue. This is a lexical similarity SCREENING aid — NOT a semantic / embedding
-- model and NOT an automatic merge; a human still decides.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index on body for index-backed '%' near-match self-joins.
CREATE INDEX IF NOT EXISTS idx_engagement_items_body_trgm
  ON engagement_items USING gin (body gin_trgm_ops);

-- Near-duplicate pairs within a workspace (optionally one campaign). SECURITY
-- INVOKER: the caller's RLS on engagement_items/_campaigns applies; p_workspace_id
-- is a further explicit scope. Rejected items are excluded. The pg_trgm '%'
-- operator prefilters at its 0.3 default (index-backed); p_threshold (>= 0.3)
-- narrows further. Per-workspace seq/index scan — fine at screening volumes.
CREATE OR REPLACE FUNCTION public.engagement_near_duplicate_pairs(
  p_workspace_id uuid,
  p_campaign_id uuid DEFAULT NULL,
  p_threshold double precision DEFAULT 0.55
)
RETURNS TABLE (
  item_a uuid,
  item_b uuid,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  SELECT a.id, b.id, similarity(a.body, b.body)::double precision AS sim
  FROM engagement_items a
  JOIN engagement_items b
    ON a.campaign_id = b.campaign_id
   AND a.id < b.id
   AND a.body % b.body
  JOIN engagement_campaigns ec ON ec.id = a.campaign_id
  WHERE ec.workspace_id = p_workspace_id
    AND (p_campaign_id IS NULL OR a.campaign_id = p_campaign_id)
    AND a.status <> 'rejected'
    AND b.status <> 'rejected'
    AND similarity(a.body, b.body) >= GREATEST(p_threshold, 0.3)
  -- Bounded: a form-letter drive of N near-identical comments would otherwise
  -- emit the full N*(N-1)/2 clique. The top pairs by similarity still connect
  -- those components under the app's union-find; the app flags truncation at the
  -- cap. Keeps this hot (SSR) path bounded exactly where near-dup matters most.
  ORDER BY sim DESC
  LIMIT 2000;
$$;

COMMENT ON FUNCTION public.engagement_near_duplicate_pairs(uuid, uuid, double precision) IS
  'Fuzzy near-duplicate comment pairs (pg_trgm trigram similarity >= threshold), workspace-scoped (SECURITY INVOKER -> caller RLS applies), optional campaign narrow, rejected excluded. A lexical SCREENING aid for the moderation queue — NOT a semantic/embedding model or an automatic merge (E9).';

GRANT EXECUTE ON FUNCTION public.engagement_near_duplicate_pairs(uuid, uuid, double precision) TO authenticated;
