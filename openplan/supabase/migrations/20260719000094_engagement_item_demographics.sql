-- E5a — optional, self-reported respondent demographics for engagement, for
-- Title VI / representativeness SCREENING. Privacy is the whole design:
--   * Per-campaign opt-in: planners must enable collection (demographics_enabled).
--   * Coarse bands only — age band (never DOB), ZIP-3 (never ZIP-5 + street),
--     a language / tenure / race vocabulary. Every field optional.
--   * The row table is service-role-write / zero-policy (like engagement_item_votes)
--     and REVOKEd from anon+authenticated — individual demographics are NEVER
--     readable per-row and never join into any public select or the CSV export.
--   * The ONLY member read path is engagement_demographics_summary(), which returns
--     k-anonymized aggregate band counts (cells < 5 collapsed into 'suppressed').
-- This is screening context, not a statistical sample or a civil-rights finding.

-- Per-campaign opt-in switch. Off by default; a planner turns it on deliberately.
ALTER TABLE engagement_campaigns
  ADD COLUMN IF NOT EXISTS demographics_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS engagement_item_demographics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL UNIQUE REFERENCES engagement_items(id) ON DELETE CASCADE,
  -- Denormalized campaign_id (same as the votes table) so the aggregate can scope
  -- + join to workspace without a three-table hop.
  campaign_id uuid NOT NULL REFERENCES engagement_campaigns(id) ON DELETE CASCADE,
  age_band text CHECK (age_band IN (
    'under_18','18_24','25_34','35_44','45_54','55_64','65_plus','prefer_not_to_say'
  )),
  -- ZIP-3 prefix only (HIPAA Safe-Harbor style coarsening); never ZIP-5.
  zip3 text CHECK (zip3 IS NULL OR zip3 ~ '^[0-9]{3}$'),
  primary_language text CHECK (primary_language IN (
    'en','es','zh','vi','tl','ko','ar','hy','fa','ru','pa','other','prefer_not_to_say'
  )),
  race_ethnicity text[] CHECK (
    race_ethnicity IS NULL OR (
      array_length(race_ethnicity, 1) <= 8 AND
      race_ethnicity <@ ARRAY['ai_an','asian','black','hispanic','nhpi','white','mena','other','prefer_not_to_say']::text[]
    )
  ),
  household_tenure text CHECK (household_tenure IN ('rent','own','other','prefer_not_to_say')),
  consented boolean NOT NULL DEFAULT false,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engagement_item_demographics_campaign
  ON engagement_item_demographics(campaign_id);

-- RLS on, zero policies: service-role only, exactly like engagement_item_votes.
ALTER TABLE engagement_item_demographics ENABLE ROW LEVEL SECURITY;
-- Defense in depth beyond RLS, since this is the most sensitive engagement data:
-- no direct table access for app roles. The aggregate function (SECURITY DEFINER)
-- and the service-role write path are the only ways in.
REVOKE ALL ON public.engagement_item_demographics FROM anon, authenticated;

-- k-anonymized aggregate — the ONLY member-facing read of demographics. Returns
-- band counts per dimension with any cell < 5 collapsed into a 'suppressed'
-- bucket, so no small group is re-identifiable. SECURITY DEFINER because the
-- table is zero-policy; an explicit membership guard on auth.uid() re-imposes
-- workspace scope that RLS would otherwise provide.
CREATE OR REPLACE FUNCTION public.engagement_demographics_summary(p_campaign_id uuid)
RETURNS TABLE (dimension text, band text, respondent_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM engagement_campaigns c
    JOIN workspace_members wm ON wm.workspace_id = c.workspace_id
    WHERE c.id = p_campaign_id AND wm.user_id = auth.uid()
  ) THEN
    RETURN; -- non-member (or unauthenticated) → no rows
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT d.age_band, d.primary_language, d.household_tenure, d.race_ethnicity
    FROM engagement_item_demographics d
    JOIN engagement_items i ON i.id = d.item_id
    WHERE d.campaign_id = p_campaign_id
      AND i.status = 'approved'
  ),
  unpivoted AS (
    SELECT 'age_band'::text AS dim, age_band AS bnd FROM base WHERE age_band IS NOT NULL
    UNION ALL SELECT 'primary_language', primary_language FROM base WHERE primary_language IS NOT NULL
    UNION ALL SELECT 'household_tenure', household_tenure FROM base WHERE household_tenure IS NOT NULL
    UNION ALL SELECT 'race_ethnicity', unnest(race_ethnicity) FROM base WHERE race_ethnicity IS NOT NULL
  ),
  counts AS (
    SELECT dim, bnd, count(*)::bigint AS n FROM unpivoted GROUP BY dim, bnd
  )
  SELECT c.dim, c.bnd, c.n FROM counts c WHERE c.n >= 5
  UNION ALL
  -- The residual 'suppressed' bucket is itself floored at 5 (HAVING): a
  -- sub-5 residual is dropped entirely, never published. Since sum >= 5 with
  -- each collapsed cell < 5 implies >= 2 cells, no single small group's size
  -- is ever disclosed. Per-dimension totals are never published, so the
  -- dropped residual cannot be reconstructed from the __meta__ count.
  SELECT c.dim, 'suppressed'::text, sum(c.n)::bigint FROM counts c WHERE c.n < 5 GROUP BY c.dim HAVING sum(c.n) >= 5
  UNION ALL
  SELECT '__meta__'::text, 'respondents_with_demographics'::text, count(*)::bigint FROM base;
END;
$$;

COMMENT ON FUNCTION public.engagement_demographics_summary(uuid) IS
  'k-anonymized (cells <5 suppressed) aggregate band counts of self-reported respondent demographics for a campaign. SECURITY DEFINER + explicit workspace-membership guard; the underlying table is service-role-only. Screening context for Title VI/representativeness — NOT a statistical sample or a civil-rights determination (E5a).';

GRANT EXECUTE ON FUNCTION public.engagement_demographics_summary(uuid) TO authenticated;
