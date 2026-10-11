# Participant pages in 21 languages, 2026-10-11

Nathaniel approved translating the participant interface into the languages the
portal already offered. Before this, only Spanish had a catalog; the other 20
languages showed English with a notice.

## What was done

- Four agents machine-translated the 259-string English catalog into 19
  languages: zh (Simplified), ko, vi, tl, km, ar, fa, ur, pa (Gurmukhi), bn, ru,
  hy, pl, pt, fr, ht, so, am, hmn (White Hmong). One file each under
  `openplan/src/lib/engagement/portal-i18n/catalogs/`.
- Diné Bizaad has no catalog: OpenPlan does not machine-translate it.
- A page in a machine-translated language shows a "Machine translation" label,
  in that language, beside the language name, with the full sentence for screen
  readers. Spanish keeps its previous behavior; how it was written is not
  recorded.
- Tests hold every catalog to the English keys, no empty values and identical
  placeholders, and check the label appears only where it should.

## What a reader should check first

The translators were least sure of these. A fluent reviewer should start here:

- **Hmong (lowest confidence)**, then Somali, Khmer and Tagalog.
- Terms without a settled public-service equivalent in several languages:
  "You said / We did", "support" for endorsing a comment, "draft", "receipt",
  "translation allowance", "race or ethnicity", "campaign", and the map
  background names ("Plain and pale", "Plain and dark").
- Armenian is Eastern reformed spelling; Western Armenian readers in California
  will notice. Portuguese leans Brazilian; Chinese is Simplified only.

When a fluent reviewer has checked a file, add its catalog to
`CATALOGS_WITHOUT_MACHINE_NOTICE` in `portal-i18n/messages.ts` so the label
goes away.

## Checked

- Browser: Korean desktop, Arabic at 390 px (right-to-left, sheet open),
  Vietnamese label. No console errors.
- Protected claims read correctly in French, Portuguese, Russian, Chinese and
  Polish (reviewed by the lead agent): machine translation is for convenience
  and the original is official; untranslated parts show in English; comments
  are reviewed before they appear; only three ZIP digits are stored; a name is
  shown publicly.
- 8,721 related tests pass; mutation checks on the label rule, the catalog
  registry and catalog structure.

## Follow-ups

- A campaign whose agency text is untranslated still shows a notice box and a
  per-field note under both its title and description. That repeats itself;
  trimming it touches a protected disclosure and is left for a decision.
- The plain-words guard pairs double quotes across lines, so a short quoted
  literal can turn code into a phantom "string" (it counted `Record<...>` as the
  banned word "record"). Worked around here; the guard itself should parse
  strings properly.
