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

## Rebuilt evidence on c1052851

Full local QA exited zero: 12,946 app tests, 135 live isolation tests, production
dependency audit with zero advisories, and production build. The full development
dependency audit's previously recorded advisories are not cleared by this result.
Exact-commit RLS 33986720366 and upgrade 33986750531 passed. Main CI 33986720381
and browser CI 33986751871 were still running at this checkpoint.

The identified rebuilt app was reached through the public landing page, sign-in,
Projects, and Start a project. The new record is explicitly named QA boundary
replacement verification, `bfdc3fa3-37e1-4689-a834-4359d8fc4237`. The interrupted
project was not changed. The check selected Franklin County, Ohio, then uploaded
the original handover boundary. The actual PATCH and independently read database
geometry match that file exactly, with uploaded provenance and null jurisdiction
identity. The display says Uploaded area before Save and after reload.

The reverse sequence selected Franklin County after the upload. The file card
then said Not the area in use, and Save recorded the server-resolved county
reference and polygon. A subsequent upload followed by Clear produced the
visible validation error without a PATCH. A final independent read confirms that
this refusal and Cancel left the last saved county and its timestamp unchanged.

All ten desktop/390px captures were inspected, with no horizontal overflow or
console errors. The surviving no-op geometry copy and rejected altered/missing
coordinate controls establish that the comparison can fail. A wrong-build
control refused to start before navigation. These checks establish exact input
retention and visible provenance, not geographic truth or legal applicability.

The geometry hashes below identify `JSON.stringify` of the stored GeoJSON,
not the original file's serialization:

- Uploaded geometry: `3a2d9d63e7799e98d93108fdb6075dd887267d049b1eede25379267e0109fe44`.
- Resolved county geometry: `a46c73d304e878ebfc49d2365213e9b10822b01f4914bf78b1d277351f958d0e`.

Two helper failures are retained. The first used the wrong wizard dialog name
and created nothing. The second completed the upload save but matched a hidden
duplicate editor after reload. The helper was scoped to the visible editor and
resumed only unfinished checks on the same QA record. Raw outputs are in
`project-boundary-after`, `project-boundary-after-corrected`, and
`project-boundary-after-corrected-resumed` under the local v044 release-checks
directory. No failed report was rewritten or counted as a completed run.

The correction is verified; the fresh complete twelve-job release gate remains
required. This supplemental proof is not a substitute for that outcome gate.
