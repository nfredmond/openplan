-- The optional self-reported primary_language on engagement_item_demographics
-- carries a CHECK listing the language vocabulary, and that list was the
-- original eleven (20260719000094). The portal now offers twenty-two.
--
-- WHY THIS IS NOT COSMETIC. The CHECK is the last thing a resident's submission
-- passes through. Adding a language to the TypeScript taxonomy without widening
-- it here means the portal offers a Hmong speaker their own language, they pick
-- it, and the INSERT is rejected by the database — the failure lands on the
-- resident, at the end of a form they have already filled in, in a language the
-- error will not be written in. A vocabulary CHECK duplicated in SQL and in
-- TypeScript is exactly the pair that drifts, so
-- src/test/demographics-language-vocabulary-matches-the-database.test.ts now
-- parses this file and fails the build when the two disagree.
--
-- The two non-language sentinels ('other', 'prefer_not_to_say') stay: they are
-- answers a resident may give, not languages, which is why the TypeScript side
-- keeps them out of TRANSLATION_LANGUAGES and only demographics carries them.
--
-- Existing rows are unaffected: this widens an allowed set and removes nothing,
-- so every value already stored still satisfies the constraint.

ALTER TABLE engagement_item_demographics
  DROP CONSTRAINT IF EXISTS engagement_item_demographics_primary_language_check;

ALTER TABLE engagement_item_demographics
  ADD CONSTRAINT engagement_item_demographics_primary_language_check
  CHECK (primary_language IN (
    'en','es','zh','vi','tl','ko','ar','hy','fa','ru','pa',
    'hmn','km','ht','pt','so','am','fr','ur','bn','pl','nv',
    'other','prefer_not_to_say'
  ));
