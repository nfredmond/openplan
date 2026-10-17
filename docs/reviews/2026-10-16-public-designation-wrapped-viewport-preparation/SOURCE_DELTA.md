# Wrapped viewport source candidate, with runtime work still held

The candidate stays on HEAD `d264d69149ae2f9d589840e5a543b798ae4718ec` and
`t3/public-designation-wrapped-viewport-design` in the assigned worktree. Its
base app tree remains `42fc0315070f31269325acb264f0260723dbd56b`; the working
application now has the source changes below. This is not a new commit or a
built app identity. The migration tree still has 425 tracked paths. No migration
file, guessed timestamp or slot is created. The three original design files
retain their original SHA-256 values.

## Exactly six application files and four test files change

New `openplan/src/lib/geo/wgs84-query-viewport.ts` owns the canonical query tuple,
its numeric reader, complete-token string parser and camera world-copy adapter.
It checks every array slot, finite numbers, both latitude ranges, positive
height, zero/equivalent seam width, unsafe raw magnitude and unsafe computed
width. Ordered widths at least 360 become full longitude coverage before
normalization. Narrow views preserve already canonical values and use modulo
only outside ±180. Reversed noncanonical endpoints are refused. Canonical
crossings and seam aliases stay distinct from stored extents. No epsilon or
full-world fallback for unreadable bounds is introduced.

`openplan/src/components/land-use-plans/public-designation-map.tsx` uses that
adapter, catches unavailable bounds/getters, clears earlier source data, and
sets the specific retry notice. Each refresh increments the existing generation
before reading the view. The existing response-generation checks prevent an
older response from redrawing an invalidated view. Valid queries still use one
fetch. Stored extent parsing, camera framing, engine choice, layers and other
notices retain their existing source.

The three existing designation map routes use the same complete-token parser:

- `openplan/src/app/api/public/land-use-plans/[planId]/map/[designationId]/route.ts`.
- `openplan/src/app/api/public/land-use-plan-reviews/[shareToken]/map/[designationId]/route.ts`.
- `openplan/src/app/api/reports/[reportId]/land-use-map/[designationId]/route.ts`.

Their identifier, packet, authentication, permission, frozen snapshot and status
paths remain unchanged. Blank coordinates no longer coerce to zero on the two
public paths. Out-of-canonical world-copy coordinates belong to the camera
adapter and remain invalid wire input.

`openplan/src/lib/land-use-plans/public-map.ts` validates direct caller bounds
before client creation and calls `workspace_gis_features_in_query_viewport`
once. It retains the version/workspace/ready/hash projection and guards, the
fixed shared cap, public field allowlist, exact safe counts and incomplete-list
refusal. It also refuses repeated feature IDs below the cap. ROOT's additional
wording clarification changes the dense count to "feature bounds overlap this
view", matching the retained `&&` predicate. It does not claim exact geometry
intersection or change the workspace GIS caller's wording.

The four test files are:

- NEW `openplan/src/test/wgs84-query-viewport.test.ts`, for numeric/wire/camera
  contracts, seam/full-world distinctions, tiny canonical values and unsafe
  narrow world copies whose width alone would pass the safety check.
- NEW `openplan/src/test/public-designation-map-viewport.test.tsx`, for exact
  single request URLs, stale source clearing, unavailable initial bounds,
  deferred old responses and subsequent recovery. The helper and component
  remain real subjects; the map SDK and fetch are synthetic boundaries.
- NEW `openplan/src/test/land-use-plan-map-viewport-routes.test.ts`, for all three
  real GET handlers, a real parser, exact tuple forwarding and access/status
  wiring. Packet/snapshot/data dependencies are mocked and prove no native access.
- `openplan/src/test/land-use-plan-report-map.test.tsx`, with the historical
  RPC expectation updated to exact one-call semantics and the old wrapped
  refusal replaced by equivalent-seam zero-width refusal. A separately named
  `designation query viewport loader contract` group adds union-call, scoped
  projection, duplicate/count/cap, field allowlist and complete density-copy
  assertions. No old extent/context/publication campaign runs here.

`wgs84-bounds.ts`, the original RPC/migrations, workspace GIS route, existing
extent tests, frozen packet/snapshot loaders and all other callers remain
unmodified. The code is prepared, not syntax-checked, compiled or executed.

## The SQL file is review data and has no migration identity

`QUERY_VIEWPORT_RPC.sql.txt` is a source-reviewed intent template outside the
migration directory. It is not installed SQL. It uses a separate `CREATE
FUNCTION`, rejects bad/null/zero/noncanonical input and negative/null limits,
and canonicalizes the same seam aliases as the TypeScript reader. Canonical
range checks are intended to reject PostgreSQL NaN and infinities; native
validation of that intention is pending.

The template constructs only ordered envelopes through CASE expressions. One
ordinary window, two crossing windows or seam-only terms feed a single OR
predicate over the exact version's feature rows. The windows CTE has one row;
there is no multi-window row expansion. The matched relation counts each
feature row once, even if its envelope touches several windows. A full-world
query constructs only its ordinary world envelope. The count precedes drawing
and a lateral left join retains the count sentinel when zero or above cap.
Equal geometry in different feature rows remains distinct. Multipart envelope
overlap remains the selection rule, including possible matches between parts.

The template preserves invoker security, a pinned search path, authenticated
and service-role execution, PUBLIC/anon refusal and existing table RLS. It
does not change stored geometry, the old RPC, table grants or indexes. Current
source config specifies PostgreSQL major version 17; no server version is queried.
Actual parsing, zero-width seam envelope behavior, grants/RLS, query plans,
PostgREST truncation and one-statement count/draw behavior need later native proof.
The source guard that binds an actual migration remains deferred until that
actual CLI-generated path exists. No test points at an invented migration file.

## CLI generation has its own prepared request

`CLI_GENERATION_REQUEST.json` pins exact proposed argv, the assigned app cwd,
read-only donor package roots, one-generation limit and resource ceilings. It
requests a later finite window; it is not a grant. It requires ROOT to supply
network denial and explicitly cover any inspected CLI-only Node wrapper and
native child. It performs no npm, install, Auth, DB, Docker or application work.

The source lockfile resolves Supabase 2.111.0 and declares a JavaScript launcher,
`dist/supabase.js`, plus optional platform-native packages. An initial request
draft assumed an ELF launcher. The corrected request records this source fact
and requires plaintext donor inspection before invocation. No donor existence,
installed version, wrapper behavior, exact native child path or offline execution
is established. An unresolved dependency, unexpected version/path, download need,
help mismatch or absent execution boundary stops generation without a retry.

The proposed final argv is the inspected donor's `.bin/supabase migration new
public_designation_query_viewport`, from this assigned app cwd, once only after
its actual help agrees. Record the actual returned path and bytes. Do not put
this SQL template into the generated file in that CLI-only window.

## Source custody and remaining claims

NEW private `source-candidate-01-binding.json` records the second live T3 run.
NEW `source-candidate-01-working.sha256` binds the ten candidate source/test
files and additive review files. NEW `source-candidate-01-tracked.patch` records
tracked changes only; the new files remain directly reviewable in this checkout.
NEW CLI-request and SQL-template hash records bind those two distinct proposals.
The first return's private records and original design hashes are not replaced.

No behavioral test, mutation, import, compile, direction check, CLI invocation,
SQL/RLS probe, browser/service/HTTP/Auth operation or release work runs. Native
permission, envelope, identified-build desktop/390px and human acceptance remain
separate. No full-v1, M1, runtime or release status is promoted.
