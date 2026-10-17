# Retained designation extents receive the shared Earth-coordinate check

October 16, 2026. Source and focused unit boundary only. Browser acceptance is open.

The public designation map previously accepted any four JavaScript numbers. NaN,
infinity, invalid longitude or latitude, and reversed bounds could reach its camera
and fit operation. The component now uses the existing readWgs84Bbox reader. It
retains the existing default display camera when the recorded extent is invalid or
missing and adds an extent-unavailable disclosure. This camera is not analysis
geography or a substitute for a recorded place. No new geographic selector exists.

The shared reader and its ordinary rectangle contract remain unchanged. Valid
point and line extents remain accepted. A point is centred without fitting a
zero-size rectangle. Other valid extents retain the original fit parameters.
useMemo keeps the validated extent stable through notice-state updates.

Ownership is one production component and one new focused test file. Root starts
from ec0fd7f49c9db24a4516c3c60f4d1b5201357b6a. Existing recovery and shared-reader
tests run unchanged. Production helpers, routes, query logic, RPCs, migrations,
map-engine selection, retained data and legal/jurisdiction assertions do not change.

## Checks preserve both failed harness trials

Trial01 exits 1 before tests. The private configuration imports a donor React
plugin that requests a Vite export absent from that donor. The application,
tests and dependency installation remain unchanged. Trial02 removes that plugin
from its separate private config and uses Vite's JSX transform. It runs a harmless
comment first and then the baseline. Both pass 40 tests across three files.

Trial02 then exits 1 before any broken mutation. Its NaN oracle lookup matches a
component test and an existing helper test. Trial03 restricts the lookup to the
exact component test group. It reuses the sealed baseline/harmless results only
after source, test, mutation, configuration and prior-file hash comparisons. It
does not rerun those accepted rounds. All source/assertion/fixture bytes stay
unchanged. Original preparation/configuration and failed-trial records remain.

Trial03 runs three private Vite source transforms, then restored 40 tests, scoped
types, focused lint and nested product direction. Every stage succeeds for its
declared outcome. Actual unit 320d08ceb62643a88c7735a19e48f855 exits0 after 30.089
seconds, with CPU 14.978 seconds and rounded peak 322.4M, zero swap. Its actual
limits are 1 GiB memory, zero swap, CPU 50 and Tasks 64. Source hashes match finally.
The cgroup resource sample and raw mount/network records remain private.

| Broken variant | Named intended assertion | Result |
| --- | --- | --- |
| Restore old number-type-only extent parser | NaN extent must use the fallback camera | AssertionError, nine component cases fail |
| Hide the unavailable-extent disclosure | Disclosure persists after an empty viewport response | AssertionError, 15 component cases fail |
| Discard every valid extent | Replacing invalid data with a valid recorded extent changes the camera | AssertionError, eight component cases fail |

The harmless comment survives. Restored selected tests pass 40. The selection is
23 new component cases, six existing recovery cases and 11 shared-reader cases.
Mutations apply only to in-memory module transforms and their receipts; they never
write production source. Exact names, original errors, transformed-file receipts,
JSON reports, stdout/stderr, command PIDs and finally readbacks remain retained.
No failed unit is converted into a passing unit.

## What these checks cannot establish

Tests exercise the actual component and shared reader. The map-engine interface,
fetch and container sizing are supplied. They cannot prove WebGL, map rendering,
real navigation, visual layout, desktop or 390px usability, console state or usable
artifacts. This work is a source candidate pending independent review, not a
completed visible workflow. An identified-build browser journey remains required.

The existing viewport clamp and server rectangle query still do not implement
antimeridian or world-copy queries. A wrapped retained extent is disclosed as
unavailable, rather than sent to an invalid camera. This change does not split
requests, alter matched counts or claim wrapped selection. Publication-pointer
races, TIGERweb dependence, native saved-context proof and the rest of KI-025
remain separate open work. No complete KI-025, M1, geography or V1 acceptance
follows. No database, HTTP service, browser, provider or hosted operation runs.
