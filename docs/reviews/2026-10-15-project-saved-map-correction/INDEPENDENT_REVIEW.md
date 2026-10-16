# Saved project map needs a wrap-aware camera

October 15, 2026. Independent source and retained-test review requests one
correction before candidate `92eaacf51bd111d3de37cf72943301aba0f7acde` is
accepted. A compact saved area spanning the antimeridian produces a world-wide
camera fit. I find no other established P1 or P2 defect in the reviewed changes.
This is not visual, browser, accessibility, database or release acceptance.

## P2: saved geography at the antimeridian gets the wrong frame

Candidate pointer: `openplan/src/components/projects/project-saved-map.tsx:67`,
especially the minimum/maximum longitude aggregation at lines 72 to 77.
`bboxOfGeometry` at `openplan/src/lib/geographies/place-of-record.ts:110`
computes ordinary minimum and maximum coordinates. Combining those extrema
cannot retain a wrapped interval. The new caller passes that result to
`fitInstructionFromExtent`, which deliberately accepts ordinary ordered bounds.
The existing comment at `openplan/src/lib/geo/wgs84-bounds.ts:56` expressly
requires a wrap-aware caller for a Pacific-crossing layer.

Minimal reproduction uses the two closed rectangular polygons in
[`probe-result.json`](probe-result.json), one from longitude 179.7 to 180 and
the other from -180 to -179.7, both at latitude 51 to 51.2. Add a saved site
at `[179.8, 51.1]` and a valid nearby corridor. The exact export inventory
accepts all three layers, with three features and no rejected shapes.
Executing the exact candidate camera statements calls:

```json
{"bbox":[[-180,51],[180,51.2]],"options":{"padding":64,"maxZoom":15,"duration":400}}
```

This requests a 360-degree longitude frame for a 0.6-degree area. Its
ordinary midpoint is Greenwich. The defect affects legitimate split
MultiPolygons near the Aleutians and other date-line places. A separate probe
with points at 179.8 and -179.8 similarly produces a 359.6-degree interval.
The submitted parameterized tests contain a single point at 179.8; they do
not challenge geometry on both sides of the date line.

The camera request is established by source execution. The resulting loss
of useful local framing follows from the requested interval; I did not inspect
rendered pixels. Mapbox documents that `fitBounds` takes southwest and northeast
corners and permits longitudes outside the usual range when needed.
[Mapbox fit-bounds example](https://docs.mapbox.com/mapbox-gl-js/example/fitbounds/).

Parent should add geometry-aware wrapped framing, preserving the saved
coordinates and export-validation rules. Do not merely relax the shared
ordinary-bounds validator. Cover a date-line split MultiPolygon, nearby saved
features on both sides, a legitimately broad area, ordinary local geometry,
and zero coordinates. Review the resulting exact candidate before acceptance.

## Source findings outside that defect

The panel uses `projectGeoPackageCoreInventory` for area and location
eligibility and the same `isCorridorLineGeoJson` predicate as the export
builder for corridors. The builder calls these validators at
`openplan/src/lib/projects/project-geopackage.ts:615`. The new panel unwraps
area Features and retains the coordinate arrays, including all MultiPolygon
parts and holes. It does not simplify, close, clip or round them. These are
structural WGS84 checks, not topology, survey or legal-boundary validation.
The inherited predicates allow positions with additional dimensions and do
not establish valid hole containment or non-self-intersection.

The fill and boundary filters use `geometry-type == Polygon`, which is
correct for MultiPolygon features. Mapbox's expression returns the singular
type for Multi geometries. The fake records filter arrays but does not
evaluate them; the primary specification supports this source conclusion.
[Mapbox geometry-type expression](https://docs.mapbox.com/style-spec/reference/expressions/#geometry-type).
Hole preservation is supported by the exact input comparison and retained
hole-dropping mutation. Actual tessellation and visible holes remain unproved.

The map receives saved server props, with no new write or editor-draft
connection. The unavailable-corridor-table branch leaves saved area and site
visible to the renderer. No shell, global backdrop, permission, action-registry,
schema or migration code changes. Geography is supplied by project records;
no new named-place default or country-specific core field appears.

The renderer keeps latest collection data in a ref, reuses the shared
`whenStyleAccepts` helper, repaints after style replacement and observes the
actual container. It withholds framing while the container has zero size.
Its collection-identity guard avoids another camera move for the same data
after style replacement. Retained tests challenge stale data, late mounting,
hidden-tab resizing, pending paint cancellation and listener teardown.
The unchanged `startMap` cancels a pending MapLibre load before construction
and retains a teardown after successful asynchronous construction.

Constructor throws are routed through `startMap`'s construction catch. Setup
throws after a constructed map, including the tested control failure, cancel
paint, disconnect sizing and remove the map. The synchronous setup catch
does not enclose a later event-driven `paint`; source or layer exceptions in
that later path are not established as cleaned up. The new tests do not
inject an `addSource`, `setData` or `addLayer` exception. I found no reachable
validated-input reproduction that makes this another product finding.

The error handler changes to the unavailable notice when the custom source
does not yet exist. It ignores errors after that source exists and does not
distinguish failed styles from recoverable tile errors. The tested initial
style failure is meaningful, but it does not establish partial-basemap
degradation, later source-load failure reporting or recovery from a transient
initial error. These remain explicit acceptance limits.

Engine `none` and startup failure retain the inventory and GeoPackage link.
The component adds navigation and attribution controls and leaves keyboard
handling at the library default. The fake does not create their DOM, execute
keyboard actions or render attribution. The map container uses `role="img"`
around library-created interactive descendants, which needs an actual
accessibility-tree check. I did not establish keyboard or screen-reader
usability, attribution visibility, contrast or responsive legibility.

## Retained tests support bounded wiring claims

I read the controller, final results and earlier campaigns under the original
read-only `.tmp/project-map-proof/`. The four final source bindings in
`controls.json` match exact candidate Git objects. The retained baseline,
harmless-comment and restored records each report 21 passing new cases.
All 19 final targeted mutations fail the selected tests with diagnostics
consistent with the intended missing geometry, wrong filter, stale data,
missing notice, framing or cleanup behavior. The final regression JSON
reports 118 passes across five scoped files. I did not rerun those tests.

The first campaign records `skip-style-recovery` surviving. Its renderer and
test hashes differ from the final candidate. The final test drives style
replacement without reissuing the initial `load` event. The same mutation
then fails because the saved source is absent. The before-visible-framing
campaign also binds an earlier renderer/test pair; it is not evidence for
the final resize behavior. These records remain separate in the original tree.

The controller requires a nonzero exit, a failed selected test with a nonempty
message, and no reported runtime-error suites. It does not compare an exact
diagnostic. A different failure in the same selected test could therefore be
misclassified. Manual review of the current diagnostics supports their
classification; the controller's structural blind category remains. The
retained summary in this directory captures counts, diagnostics, hashes and
binding comparisons without copying raw browser evidence or private records.

## Original discovery and source-aware retry are different evidence

The original private `02-project-end-to-end/findings.json` reports a partial
journey. Finding f4 records three export features but no saved geometry on
the project screen. The original downloaded GeoPackage retains the supplied
area and corridor coordinates. Its storage/report failures describe the
supplied copied installation, not an established general product cause.

The separate `retry-after-buckets-20261015/run.json` identifies the technical
lead's source-aware retry at main `1b2fefe0f`, build
`6P4ZsPcbPIwQ9NLkeV1g2`. After copied-fixture repairs it produces actual PDF,
HTML, ZIP and readiness downloads, while keeping the map and independent
jurisdiction findings open. The dated restart STATUS preserves that distinction.
Neither attempt runs this map candidate.

The retry's `capture-limits.json` reports DOM size 390 by 844, device pixel
ratio about 1.45, tool metadata 1280 by 800 and actual PNG size 928 by 580.
It describes duplicated narrow content in the wider capture. This does not
establish exact 390px screenshot acceptance. Separately, I read PNG headers
for the original discovery: desktop f4 is 1280 by 800; original map-mobile and
final-mobile are 566 by 1224. I did not render or visually reassess those images.
Do not transfer either attempt's mobile claim to this candidate.

## Provenance, execution and custody

- Assigned cwd: `/home/nathaniel/.t3/worktrees/openplan/t3-49d6c6f5`.
- Assigned branch: `t3/review-project-saved-map-renderer`.
- Initial clean head: `05dd3e8da4a4572437f06e771b0a2477873e681f`.
- Fetched origin, then fast-forwarded only this clean assigned branch to
  `1b2fefe0f0e98f99700fc77e99146fe697b43ee7`, the candidate's parent and
  observed current `origin/main`. No candidate implementation checkout.
- Exact reviewed head: `92eaacf51bd111d3de37cf72943301aba0f7acde` on
  `origin/t3/project-map-render-saved-geometry`. Source reads use `git show`
  in the assigned tree. Original implementation tree is clean on final read.
- Owned writes: this dated review directory only. Shared coordination,
  continuation, canonical untracked files and parent preview remain untouched.
- Read AGENTS, current shared coordination/restart continuation, contract,
  roadmap, relevant ledger/capability/architecture/known-issue sections and
  the October 6 direction review. Applied planner-writing, prove-it, any-place
  and Mapbox web-integration skills. No other model or nested delegation.
- Nested `npm run product:direction:check` passes. It reports older geography
  and capability review dates, version drift and subsequent substantive
  changes as reminders. No review dates or product grades changed.
- [`probe.mjs`](probe.mjs) reads exact Git objects, uses Node's in-memory type
  stripping and executes the candidate's extracted camera statements plus
  exact pure validators/helpers. No npm installation, borrowed dependencies,
  source mutation or test cache. Its transient resource wrapper limits memory
  to 1 GiB, additional swap to zero and CPU to one core.
- The first probe launch omits the wrapper's working directory and exits
  before source execution. Its failure log is retained. The corrected launch
  succeeds in 158 ms, reports 32 MB peak memory and zero swap, then exits.
- Probe controls: baseline, harmless comment and restored original survive.
  An in-memory forced center `[1, 0]` fails the exact assertion
  `zero-coordinate camera must easeTo center [0,0]`. No Git source changes
  require restoration. This narrow oracle cannot see DOM, React lifecycle,
  WebGL, projection or the outer visibility/style-readiness conditions.
- No full suite, build, live stack, database, browser, application service,
  GitHub mutation, PR, main merge, migration, branch deletion or hosted action.

T3 taskId:
`node:delegated-task:command%3Amcp%3A3f015e30-501a-44ae-80ba-38a5ed25d5ba%3Adelegate-task%3Asol-project-map-independent-review-20261015-round1`.
Parent thread: `1401bb6a-70e4-42eb-a1f1-98045485f8cc`.
Model configuration readback confirms `gpt-6.1-sol`, high reasoning.
Parent owns the correction, integration, expensive checks and identified-build
desktop/390px journey. This review preserves the P2 disagreement and leaves
practitioner, participant, scientific, legal and whole-product acceptance open.
