# Saved-map framing correction receives bounded source approval

October 15, 2026 UTC, October 14 Pacific. Independent review of exact commit
`ffd21964f38fb9a391e26e89a4cb705d409af6f8` finds no established new P1 or P2
defect. The original antimeridian P2 is corrected at the camera-instruction
boundary. The replacement classifier addresses the earlier nonempty-message
weakness. This approves the bounded source correction for parent integration
work. It does not grant build, browser, accessibility, export-download or release
acceptance.

## Original finding and response remain separate

The original request requires saved area, point and corridor geometry on the
project screen, with export eligibility, source precision and operational map
lifecycle preserved. The first review of
`92eaacf51bd111d3de37cf72943301aba0f7acde`, committed as
`17a25d077482dc5b12a9753402fe0a9edc50517e`, establishes the compact split
MultiPolygon's 360-degree frame. It also identifies the old classifier's
nonempty-message blind category. Parent accepts that P2 and requests occupied
geometry framing without cropping broad or full-world areas.

I read the correction RESPONSE, unchanged INDEPENDENT_REVIEW, original probe,
retained failed campaigns and final controls from exact Git objects. The
correction directly follows `92eaacf51`. Its implementation diff changes the
renderer, adds the adjacent helper and updates two focused test files. It does
not change the export inventory, ordered extent validator, shared camera options,
map engine, sizing helper or style-readiness helper. The original independent
report and both original probe files match their `17a25d077` bytes. All 49
preserved history files match their recorded hashes. The original finding is
retained as historical evidence, not rewritten as a successful correction run.

## The camera retains occupied geography

At this exact head, `saved-geometry-frame.ts:20–38` builds one longitude span
per connected line or polygon, including its rings. MultiPolygon parts remain
separate. Lines and unsplit polygons retain their Cartesian span. Lines 43–60
merge overlapping spans before removing the largest unoccupied circular gap.
The strict comparison at line 55 preserves ordinary bounds when an internal gap
ties the ordinary outside gap. Full longitude occupancy leaves no removable gap.
Neither sorting nor merging writes into the supplied collection.

This design follows the supplied geometry's semantics. RFC 7946 defines
Cartesian segments and recommends splitting antimeridian-crossing geometry.
A compact intended crossing represented as an unsplit broad segment retains its
supplied span; this helper does not reinterpret it. Camera corners may exceed
180 degrees without altering stored coordinates. Mapbox documents this bounds
representation. These primary sources support the design, not rendered-pixel
acceptance. [RFC 7946 sections 3.1.1 and 3.1.9](https://datatracker.ietf.org/doc/html/rfc7946),
[Mapbox fitBounds](https://docs.mapbox.com/mapbox-gl-js/example/fitbounds/).

The independent [probe](probe.mjs) reads exact Git bytes and executes stripped
TypeScript in memory. Its [result](probe-result.json) records 28 explicit geometry
cases. These include the original split area plus nearby saved point and
corridor, points on opposite sides, three polygon parts, holes, reordered and
overlapping parts, 340-degree areas and lines, full-world occupancy with nested
parts, touching spans, ordinary ties, zero, negative zero, seam-equivalent
points, latitude boundaries, high precision and an additional coordinate
dimension. Deeply frozen inputs and strict source comparisons challenge writes,
rounding and lost coordinates. These assertions pass.

The original repro now produces `[[179.7, 51], [180.3, 51.2]]`, a 0.6-degree
camera width. The broad-area case remains `[[-170, 51], [170, 51.2]]`, and the
full-world case remains `[[-180, 51], [180, 51.2]]`. An independent oracle
enumerates permissible cuts for 300 deterministic integer-span inventories.
Each result retains every occupied span, has minimum permissible width and
retains ordinary framing when it ties. This is mathematical interval evidence,
not a sampling claim about every possible geographic dataset.

Ten invalid or unsupported input cases remain excluded by the exact export
inventory, with a rejected-shape count. They cover incomplete rings, empty area,
null Feature geometry, unsupported geometry types, nonfinite coordinates and
out-of-range points. The ordinary validator still rejects both reversed bounds
and camera east values above 180; it accepts the complete WGS84 boundary. The
new helper assumes validated input. It is not a replacement geometry validator,
and calling it directly with arbitrary malformed GeoJSON is outside this caller's
contract. Existing structural checks do not establish topology, valid hole
containment, legal boundaries or meaning for additional dimensions.

## Integration and lifecycle retain their bounded evidence

`project-saved-map.tsx:66–69` passes the helper's instruction directly to the
unchanged `applyFitInstruction`. The original hidden-container and collection
identity conditions remain around that call. The independent probe executes
the component's complete paint closure with a recording map. It observes no
camera call while hidden, then an exact latest-data fit of
`[[179.7, 51], [180.5, 51.2]]` with padding 64, maximum zoom 15 and duration
400. Clearing the fake style restores four layers and the same data without
another camera move. A zero point calls `easeTo` at `[0, 0]`, zoom 14 and
duration 400. This executes the source/layer and camera statements, not React
scheduling, ResizeObserver delivery or the real engine.

Source inspection retains the first review's lifecycle conclusion. The data
ref supplies the latest collection through asynchronous startup and style
readiness. `startMap` cancels late construction after unmount; `whenStyleAccepts`
detaches pending readiness listeners. Setup failure and normal cleanup remove
the map and sizing observer. The correction's new retained lifecycle test drives
async MapLibre startup, data replacement, hidden dimensions, tile settlement,
visible resize and style replacement in sequence. Its framing assertions carry
explicit labels and targeted faults. I did not rerun the React/Vitest suite.

The first review's error limits remain open. The unavailable notice covers
startup and errors before the custom source exists. Later tile/source failures,
transient initial errors and asynchronous paint exceptions are not proved as
fully diagnosed or recoverable. No validated-input counterexample establishes
a new correction defect here. Engine selection, configured style handling and
control insertion remain source and simulated-test claims until browser work.

## Classifier and retained results have specific boundaries

The exact controller requires exit 1, failed-report status, the entire declared
failed-test set and exact first-line diagnostics. It rejects runtime suites,
unhandled runner errors, import/compiler errors, unattributed failed suites,
wrong failure counts and multiple or absent diagnostics. The test names and
diagnostics must match together. Generic nonzero exits do not qualify.

The independent [classifier probe](classifier_probe.py) executes this controller
in memory. All 14 fixtures produce their expected acceptance or refusal. A
harmless classifier comment edit survives all fixtures. Each of nine faulty
classifier variants fails the exact `classifier-reject:<fixture>` assertion.
The original classifier then survives again. [Results](classifier-result.json)
also compare every final application-fault name and diagnostic with the manifest:
28 behavior faults produce 48 declared failed assertions. All 13 current
campaign source bindings and all eight regression test-file bindings match
the reviewed head. Every current mutation anchor exists exactly once.

The retained baseline, harmless edit and restored cohorts each report 33 passes.
The retained regression reports 157 cases across eight scoped files, with
focused TypeScript and strict ESLint success recorded separately. These are
retained implementation results whose bindings I checked, not an independent
application-campaign rerun. The records' parent-head metadata names `92eaacf51`
because the correction was then uncommitted; the checked source hashes bind the
tested bytes to `ffd21964`. They do not imply GitHub CI or build acceptance.

All four unsuccessful correction trials retain exact-restoration records.
Missing selectors and diagnostic formatting mismatches remain failed/refused
campaigns. The final campaign is a separate run. The first review's weaker
historical classifier remains historical and does not acquire stronger claims.
The new classifier matches first lines, not complete object diffs or stack
locations. A different cause producing the identical named first line is its
remaining diagnostic blind category. Finite selected mutations do not prove
every possible assertion or runtime failure.

My camera probe also has baseline, harmless edit, targeted failure and restored
controls. Removing wrapped-gap selection fails the exact assertion
`original-date-line: exact camera instruction`. Only in-memory strings change.
No implementation source needs restoration. My first classifier audit stops
at an incorrect prior-report filename lookup after its earlier checks. The
retained `classifier-attempt-01.log` records `StopIteration`; its empty result
file is not a pass. Correcting that lookup to the actual `REVIEW.md` enables
the separately recorded successful audit. The Node warning only identifies
experimental type stripping.

## Provenance and remaining acceptance

- Assigned review checkout:
  `/home/nathaniel/.t3/worktrees/openplan/t3-5ec0f982`.
- Assigned branch: `t3/review-saved-map-dateline-framing-correction`.
- Initial clean head: `05dd3e8da4a4572437f06e771b0a2477873e681f`.
  Fetch and clean fast-forward update only this branch to observed
  `origin/main` at `1b2fefe0f0e98f99700fc77e99146fe697b43ee7`.
- Exact source branch ref is
  `t3/saved-map-dateline-wrapped-framing` at `ffd21964`. The implementation
  checkout `/home/nathaniel/.t3/worktrees/openplan/t3-1ff437d5` remains untouched.
  Source reads use shared Git objects from the review checkout.
- Owned writes are this dated review directory only. No shared coordination,
  continuation, source, test, fixture or other checkout changes occur.
- Read current AGENTS, state-folder coordination/restart continuation, contract,
  roadmap, relevant ledger/capability/architecture/known-issue sections and the
  October 6 direction review. The production merge hold remains respected.
- Applied planner-writing, prove-it, any-place and Mapbox integration guidance.
  Read look guidance; the explicit parent-owned browser assignment keeps visual
  acceptance pending. Nested product direction passes with existing review-date,
  package-version and subsequent-change reminders. No product grade changes.
- T3 model configuration confirms `gpt-6.1-sol`, high reasoning. No other model
  or nested delegation. Both independent probes run in transient 1 GiB,
  zero-additional-swap, one-core scopes. No application service starts.
- No full suite, build, browser, demo target, live database, migration application,
  reset, process killing, hosted action, infrastructure, GitHub mutation, PR,
  push, main merge or branch deletion occurs. Parent owns integration and
  expensive checks.

Parent still needs identified-build desktop and exact 390px journeys from real
project navigation, console inspection and actual downloaded export parity.
Neither earlier discovery nor the source-aware retry runs this correction.
The previous retry's DOM/device/screenshot dimension mismatch remains open.
No screenshot here establishes exact 390px output. Browser work must establish
WebGL projection and tessellation, visible holes, polar behavior, style/tile
availability, real sizing, navigation controls, attribution visibility and
legibility. The interactive map's `role="img"` still needs an accessibility-tree,
keyboard and screen-reader assessment. Practicing-planner usefulness, native
GIS artifact use, scientific accuracy, legal/survey validity and whole-product
acceptance remain separate and unproved.

T3 taskId:
`node:delegated-task:command%3Amcp%3A3f015e30-501a-44ae-80ba-38a5ed25d5ba%3Adelegate-task%3Asol-project-map-correction-review-20261015-round2`.
Parent thread: `1401bb6a-70e4-42eb-a1f1-98045485f8cc`.
T3-owned completion returns this report-only checkpoint to the parent.
