# Project boundary input correction

The complete first-week run on `f80c2cbd` was interrupted during project handoff.
Both setup jobs completed with explicit yes outcomes and no console errors.
All four exact-commit CI workflows passed: CI 33985347183, RLS 33985347181,
upgrade 33985369210, and browser 33985370732. These do not verify this correction
or establish the remaining ten journey outcomes. No v0.44 tag was created.

## Confirmed defect

In project `126d79c1-7670-48cf-84ed-6431d5bcb64f`, the planner selected a county
and then uploaded the supplied smaller `study-area.geojson`. The 19:10:38 UTC
browser snapshot displays both the county selection and the loaded filename.
Save recorded the county boundary at 19:10:46, silently ignoring the upload.
The database retained `place_source=tigerweb`, `place_ref=06045`, and the county
polygon. The editor kept both candidate inputs and always preferred the county.

The agent's broader finding, that nothing saved, is not supported by its own
screenshot and snapshot. Those show Change area and the selected county.
An earlier upload-only snapshot showed Uploaded area. This is an input
precedence defect, not proof that every upload disappears. Raw reports and
interrupted execution remain unchanged under local run
`2026-09-05T18-53-06-340Z`.

## Correction and focused evidence

The existing editor now clears the older candidate when a successful search,
draw, clear, or file upload replaces it. An upload updates the displayed shape
and source label too. A later picker input stops calling the old file loaded.
The server still resolves searched references itself. Uploaded shapes retain
uploaded provenance and do not acquire a county identity from a prior search.
No route, write path, migration, stored record, or scientific artifact changed.

Five new editor regressions failed before correction. They include the actual
wrong county PATCH, a stale uploaded polygon overriding a newer drawing, and
a clear operation still saving an older upload. With the correction, the editor,
real picker and file-reader suites pass 34 tests. TypeScript passes after
removing an unsupported Testing Library option mistakenly used in the new tests.

A comment-only mutation survived all 18 editor tests. Five semantic mutations
were rejected and restored:

- Retain the old county after upload: wrong place-reference PATCH, one failure.
- Retain the upload after picker changes: wrong drawn payload, ineffective
  clear, and stale Loaded file claim, three failures.
- Omit the upload from displayed geometry: wrong coordinates, two failures.
- Borrow the old display label: missing Uploaded area label, two failures.
- Always call the file current: stale Loaded file claim, three failures.

The editor tests use a real file reader but simulate the picker's documented
callback order. They do not prove real-browser behavior, saved database bytes,
map appearance, or the truth of a jurisdiction boundary. Rebuilt desktop/390px
proof, independent stored-geometry comparison, full QA, current CI, and a new
complete twelve-job gate remain required.

The scientific candidate remains retired and inconclusive. This correction
changes no model demand, default, acceptance rule, frozen study, or holdout.
