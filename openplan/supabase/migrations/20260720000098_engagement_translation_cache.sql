-- E8 (multilingual) — atomically cache ONE machine translation into an item's
-- metadata without a read-modify-write race. Two participants translating the
-- same approved comment into different languages at once would otherwise both
-- read the same stale metadata client-side, merge in JS, and race their whole-
-- column UPDATEs — the last writer silently dropping the other's cached
-- translation (which then re-hits the model + re-charges on the next request).
--
-- Merging inside a single UPDATE re-reads metadata_json under the row lock, so
-- concurrent writers serialize and each sees the prior committed translation.
-- The jsonb `||` deep-merges one level: it preserves every other metadata key
-- AND every previously cached language, only adding/replacing p_language.
--
-- SECURITY INVOKER: the service-role caller's privileges apply (the route has
-- already resolved + authorized the item); the WHERE re-asserts status='approved'
-- as defense-in-depth so only translatable items can ever be written this way.
CREATE OR REPLACE FUNCTION public.engagement_cache_item_translation(
  p_item_id uuid,
  p_language text,
  p_translation text
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  UPDATE engagement_items
  SET metadata_json =
        coalesce(metadata_json, '{}'::jsonb)
        || jsonb_build_object(
             'ai_translations',
             coalesce(metadata_json -> 'ai_translations', '{}'::jsonb)
               || jsonb_build_object(p_language, p_translation)
           )
  WHERE id = p_item_id
    AND status = 'approved';
$$;

COMMENT ON FUNCTION public.engagement_cache_item_translation(uuid, text, text) IS
  'E8: atomically merge one (language → translation) into engagement_items.metadata_json.ai_translations, preserving other keys and other languages (no read-modify-write race).';
