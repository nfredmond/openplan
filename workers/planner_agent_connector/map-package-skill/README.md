# transportation-gis skill

Nathaniel Redmond's map and GIS package skill, version of 2026-10-02, added to
OpenPlan on 2026-10-10. A map package run copies `transportation-gis/` into
its run folder and gives it to Claude Fable 5.1.

Changes from the original: the examples in `references/spec.md`, two notes in
`references/data-sources.md`, two example strings in `scripts/tgis.py` and
`scripts/tgis/tools.py`, and the eval prompts now use generic names instead of
specific projects. `references/data-sources.md` still records the area where
each endpoint was tested, because that is where the tests ran.

Third-party files keep their licences: Leaflet (BSD 2-Clause,
`assets/vendor/LEAFLET_LICENSE`) and the Inter typeface (SIL Open Font
Licence, `assets/fonts/*/LICENSE_OFL.txt`).

After any change to the skill, run `node ../map-package-skill.mjs write` from
this folder's parent and commit `MANIFEST.json` with the change. The app's
expected tree hash lives in `openplan/src/lib/map-packages/skill.ts`; a test
fails until both agree.
