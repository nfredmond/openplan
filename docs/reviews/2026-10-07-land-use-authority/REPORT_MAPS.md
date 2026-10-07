# Report maps retain the published edition

October 7, 2026. Source `5cdecf79` adds map reads to signed-in adopted reports.
Combined source `416def7b` includes the plain-language correction from PR #127.
This continues the [retained decision work](REPORT_ADOPTION.md).

## Changed behavior

The report shows each retained designation's label, map note and GIS feature
hash. Its map endpoint uses this report's saved plan version. It does not use
the plan's current adopted-version endpoint, which could substitute a later
edition. The shared reader verifies report, plan, workspace, version, state,
report pointer, frozen identity and content hash before reading any map features.

The signed-in route checks the authenticated user's report permission and passes
that client through the GIS version and viewport reads. It does not use the
public route's service client. The GIS version must be ready, match the retained
feature hash and belong to the report workspace. Feature properties follow the
retained public-field list. Existing public consumers retain their separate
public-access path.

An unknown designation returns not found. Missing source identifiers or hashes,
unreadable sources and incomplete counts remain unavailable. The viewport RPC
must supply a valid count row even for an empty view. A partial result never
becomes an apparently complete map. Dense views keep the existing draw limit and
show no misleading subset. Failed HTTP, transport and JSON reads clear previously
drawn features. An older failed request cannot overwrite a newer successful view.

## Automated checks and their limits

At `5cdecf79`, [167 tests in 11 suites](report-map/focused-final.log), TypeScript,
changed-file ESLint and a production build pass. After merging the copy fix,
[102 tests in five affected suites](report-map/merged-focused.log) pass. A test
command issued before the branch switch exercised only 47 parent tests; that
run is not the map integration check.

The first count-case table accidentally spread array rows into test arguments.
It now wraps each RPC result in an object so the intended input reaches the
reader. The [first fault run](report-map/report-map-controls/report.json) also
leaves the skipped frozen-hash check alive: its changed GIS identifier triggers
a later identity guard, so the test does not prove the intended hash boundary.
That incomplete run remains preserved.

The corrected case changes the retained public-field list to expose a private
owner field while keeping valid GIS identity. Skipping the frozen hash then
returns that private field. The [stronger disclosure assertion](report-map/report-map-disclosure-controls/report.json)
fails on the exposed value before checking the status code. Across the corrected
[main](report-map/report-map-controls-v2/report.json),
[absence](report-map/report-map-absence-controls/report.json) and disclosure
controls, baselines and harmless comments pass; 62 targeted fault runs fail.
One repeats the hash fault with the stronger privacy assertion. Original source
bytes restore after each case.

These tests use projected database mocks and a mocked map renderer. They verify
query fields and filters, reader logic and request recovery. They do not prove
native cross-workspace isolation, WebGL drawing, nonempty geography, print output
or practitioner understanding.

## Parent copy correction and shutdown finding

The [parent build](report-map/parent-copy-build-status.json) identifies
`eef8c13d`. T3 follows the real list card and workbench link to the report.
[Desktop](report-map/parent-copy-desktop.png) and
[390px](report-map/parent-copy-mobile.png) views show "Saved adoption decision"
and the legal-validity caveat. Both widths have no measured horizontal overflow.
The bounded console record has no new errors during this read-only follow-up.
The earlier seven startup and observer errors remain distinct.

The [owned parent server](report-map/parent-copy-server-status.json) peaks at
272,433,152 bytes and closes port 3498 on stop. It does not exit within 90 seconds,
so systemd kills it and reports `timeout`. A zero exit from `systemctl stop` does
not establish graceful process shutdown. This remains an operational finding,
separate from the stopped BCA service's earlier 5 GiB memory kill. Protected
BCA, engagement and demo processes remain untouched.

## T3 map and native follow-up

The [production build](report-map/build-status.json) completes successfully with
unchanged source at `416def7b`. The owned process and `/api/health` identify that
commit and isolated checkout. T3 uses the actual plan-list card and workbench
report link. The [desktop](report-map/map-desktop.png) and
[390px](report-map/map-mobile.png) views show the retained synthetic designation,
its policy-not-zoning caveat, GIS hash and provider-unavailable message. Neither
width has measured horizontal overflow.

No Mapbox token is configured on this stack. These images do not prove map
drawing. Four read-only requests through T3's native fetch return the expected
results: the signed-in empty layer returns 200, anonymous access returns 401,
an unknown designation returns 404, and a blank coordinate returns 400. The
successful response names the retained report, version and plan hash, returns
zero features and carries `private, no-store`. The three negative requests add
expected 401/404/400 console entries. No new console error precedes those probes.
The bounded [browser record](report-map/browser-summary.json) preserves the
older errors and omitted diagnostic categories.

A [fresh SQL comparison](report-map/native-comparison.json) on isolated DB29822
finds the report, two versions, decision and artifact unchanged. The ready GIS
version has zero features and matches the displayed hash. No adoption,
publication or other producer command runs again. The browser downloads a fresh
13,777-byte report source file. Its
[comparison](report-map/download-verification.json) matches the native artifact,
canonical frozen hash, map response and displayed designation. Harmless object
reordering passes. Altered area, decision, relationship, five map response fields
and displayed GIS hashes fail their comparisons. Raw native records and downloads
stay outside git.

After T3 leaves the report for `/api/health`, the second owned server exits
normally and leaves port 3498 clear. It peaks at 261,177,344 bytes. This narrower
successful stop does not erase the earlier active-report timeout or establish
its cause. Investigate active connections and shutdown separately before claiming
reliable drain during active use.

## Integration and remaining evidence

PR #127's corrected head `eef8c13d` has four passing checks while QA, shuffle,
live RLS and archive restore continue. Its preceding `c9236ffa` checkpoint now
passes RLS and archive restore; its copy failure remains preserved. This map
branch includes #127 and targets main. Exact-head GitHub checks remain required.
No release tag or version bump is declared by this checkpoint.

Actual WebGL drawing, nonempty maps, real historical-edition map reads,
foreign-workspace browser refusal, populated related-plan browser cases, print/PDF,
implementation-report custody, publication concurrency/recovery, remaining M1
geography cases and practitioner/counsel acceptance remain open. The broader
scientific and V1 contract also remain open. [Artifact hashes](report-map/sha256.json)
retain this step's evidence.
