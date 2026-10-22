# Public designation viewport queries must preserve wrapped coverage

Source-only proposal, October 16, 2026. Owner: the T3 implementation lane on
`t3/public-designation-wrapped-viewport-design`. This is the requested first
return to ROOT. No application, consumer, test or migration is authored here.

## Source identity and limits

The assigned worktree is `/home/nathaniel/.t3/worktrees/openplan/t3-dd1f8bad`.
Its initial clean HEAD is `05dd3e8da4a4572437f06e771b0a2477873e681f`, with
app tree `1e0b6522002b2485d37086790808c0217ff77cfe`. An explicit ancestor
check succeeds. The authorized local fast-forward reaches exactly
`d264d69149ae2f9d589840e5a543b798ae4718ec`, with app tree
`42fc0315070f31269325acb264f0260723dbd56b` and 425 tracked migrations.
The worktree is clean immediately after that fast-forward. No network Git,
other checkout mutation, commit, branch join or ROOT branch change occurs.

T3 thread metadata binds this lane to that worktree, its named branch, provider
`codex`, and model `gpt-6.1-sol`. Injected runtime metadata states high reasoning.
The catalog reports a low composer default; it does not expose this run's effort.
The available thread read also omits effort. Independent app-run effort
attestation therefore remains unavailable. The private binding record preserves
that distinction rather than treating a catalog default as a run setting.

ROOT reports its previous direction check passed against the same app tree.
This lane does not repeat it under the runtime hold or inspect/copy ROOT's proof.
That report does not establish a new local check or lift any hold.

## The trigger is established in current source

`public-designation-map.tsx:28-37` clips west and east independently to ±180.
For a camera reporting west 170 and east 190, it queries only 170 through 180.
For west 190 and east 210, it constructs west 190 and east 180. The early return
in `refresh` then leaves earlier source data on screen. The request number
advances, so an older response is ignored, but the old source is not cleared.
These are deductions from the current statements, not executed probes.

Missing camera bounds currently substitute `[-180,-90,180,90]`. This asserts a
worldwide query despite an unreadable view. The bounded correction should clear
the shapes and disclose an unreadable view instead.

The published-plan and review-token routes split `bbox` and use `Number`.
Consequently `10,,12,35` and `10, ,12,35` become a south latitude of zero and
pass the strict rectangle reader. The report route already refuses blank parts
with a trim check. All three routes reject a canonical wrapped tuple today.
Their existing identifier, authentication, packet and frozen-version checks
remain separate from this parser correction.

## Keep stored extents separate from queried viewports

Keep `wgs84-bounds.ts`, its strict readers, camera framing, and the workspace GIS
route unchanged. A stored extent can be degenerate; the current stored-extent
reader intentionally rejects wrapped and out-of-range values. This proposal
does not reinterpret historical extents or reopen their framing campaign.

Add one pure module, proposed as `src/lib/geo/wgs84-query-viewport.ts`, with
three narrowly named operations and a distinct `Wgs84QueryViewport` tuple type:

1. A numeric wire reader accepts four finite canonical numbers. South and north
   remain within ±90, with south strictly below north. Ordinary west < east
   means one interval; west > east means a crossing interval. Equal endpoints
   mean zero width. `[-180,s,180,n]` alone denotes full longitude coverage.
2. A query-string parser requires exactly four trimmed, nonempty parts before
   `Number` conversion, then calls the numeric reader. Preserve existing full
   numeric conversion semantics, including exponent notation. Do not introduce
   `parseFloat` prefix acceptance or unrelated field grammar changes.
3. A camera adapter accepts four raw camera numbers, including ordered
   unwrapped world copies. It checks latitude and numeric safety before
   normalization. For east > west, measure width before modulo. Width ≥360
   becomes the full-world tuple, retaining the actual latitude band. Width
   strictly between zero and 360 normalizes the endpoints. For west > east,
   accept only already canonical endpoints as an explicit crossing. Refuse
   reversed out-of-canonical endpoints rather than guessing their direction.

Canonicalize a west of +180 to -180 and an east of -180 to +180 for a
positive-width seam-touching interval. Refuse `[180,s,-180,n]`, which has zero
circular width. Accept `[-180,s,180,n]` as a full world. Recheck positive width
after normalization and use no epsilon that widens a view. Leave ordinary
canonical values unchanged, apart from these seam aliases and signed zero.

Examples below are prospective expected values, not evaluated results. Latitude
is the same valid positive-height band in each example.

- `[170,190]` becomes `[170,-170]` and selects both seam intervals.
- `[190,210]` becomes `[-170,-150]`; `[-210,-190]` becomes `[150,170]`.
- `[170,-170]` remains an explicit crossing; `[180,190]` becomes `[-180,-170]`.
- `[170,180]` remains seam-touching; `[170,-180]` canonicalizes to the same view.
- `[0,360]`, `[-540,540]` and `[-180,180]` become full longitude coverage.
- Missing bounds, nonfinite numbers, unsafe magnitudes, bad latitude, zero
  height/width and reversed noncanonical bounds return unavailable, never zero.

Recommended numeric guard: refuse absolute raw longitude or computed width
above `Number.MAX_SAFE_INTEGER`, and refuse nonfinite or collapsed results.
This is an arithmetic guard, not proof of fractional precision at extreme
magnitudes. ROOT should settle whether a substantially smaller explicit camera
magnitude ceiling is preferable before authoring. The server and SQL accept
canonical coordinates only, so they need no world-copy arithmetic.

In the component, acquire the source before handling unavailable bounds. Keep
the request-generation increment before normalization. On unavailable bounds,
clear the source, set a specific retry notice, and send no request. An older
response must not redraw it. Use the canonical tuple in the existing single
fetch. Keep map-engine selection, extent fallback disclosure, layers and frozen
map fields unchanged. A proposed notice is: "The map view could not be read.
Move or zoom the map to retry."

## Use one atomic database read

Recommend a dedicated function, tentatively
`workspace_gis_features_in_query_viewport`, for the designation loader. It takes
the same typed version, four canonical coordinates and draw limit as today's
function and returns the same row shape. The old RPC and all its callers retain
their current behavior, signature and permissions.

An additive replacement of the old function could retain ordinary behavior,
but changes the direct-call contract for every existing consumer. An optional
argument or overload adds function resolution and grant obligations. Neither
benefits this bounded fix. A dedicated function makes the new contract explicit
without requiring a workspace GIS rollout. This is a recommendation, not an
approved migration choice.

The dedicated function must validate nonnull arguments, canonical finite
coordinates, ordered positive-height latitude, nonzero circular width and a
nonnull nonnegative limit before constructing envelopes. Range checks must also
reject PostgreSQL NaN and infinities, not rely on JavaScript validation. Reject
invalid arguments with an error, rather than returning a zero-count sentinel.
SQL applies the same seam canonicalization as the numeric reader.

Use one statement snapshot and one matched relation over the feature table,
filtered by the exact version ID. Its spatial condition is an OR over the
ordinary envelope or the two crossing envelopes, as appropriate. Each crossing
envelope has canonical ordered corners: west to +180, and -180 to east.
Count that matched relation once. Each feature table row can enter once because
OR does not duplicate rows, even if its envelope meets both intervals. Keep
stable feature-index draw order. Return all matched geometry only when the
union count is within the draw cap, otherwise the existing count-only sentinel.
The same sentinel represents a verified zero count. Do not sum two old RPC
counts, deduplicate capped replies, page partial unions or use UNION ALL.

Retain today's `&&` envelope-overlap selection semantics. The count is exact for
that predicate's distinct feature rows. It is not a new exact-shape intersection
claim. A wide multipart feature envelope can match a gap between its parts;
changing that behavior or rewriting geometry is outside this correction.

Recommended seam policy: a view touching either physical representation of the
antimeridian includes rows stored on either ±180 edge. For an ordinary interval
starting at -180, add an OR term for a zero-width +180 seam envelope. For one
ending at +180, add the corresponding -180 seam term. A crossing already
includes both edges. Full-world coverage uses one ordinary world envelope.
These seam-only terms are internal predicates, not accepted zero-area viewports.
ROOT should confirm this policy before implementation; omitting it would make
physically equivalent seam-edge data behave differently.

Keep `STABLE`, `SECURITY INVOKER` and a pinned search path, following the
existing qualified table/geometry usage. Revoke default function execution
from PUBLIC and anon. Grant only authenticated and service_role. No feature-table
grant, RLS, ingest constraint, stored value or index change is proposed.

## Preserve frozen access and honest responses

Change all three designation routes to the same query parser and keep their
existing status mappings. Invalid queries return 400 before packet/auth reads,
as each route currently does. Wrapped queries follow the same published packet,
review-token or historical report access path as ordinary queries.

The loader validates the numeric query contract again, then calls the dedicated
RPC once. Preserve exact retained designation ID, ready version, feature hash,
workspace checks, field projection, public-field allowlist, draw limit, safe
integer count parsing and incomplete-response refusal. Also refuse repeated
feature IDs rather than hiding a broken response with client-side deduplication.
This narrow defense protects the new each-ID-once contract below the cap.

Public routes intentionally use a service-role client after frozen packet
authorization. Their safety depends on those checks and output filtering, not
on member RLS. The report path supplies the session client and workspace scope;
its version projection and filters must remain exact. Source migrations enable
feature-table RLS, read membership through `workspace_members`, revoke anon
table access and grant authenticated read. `SECURITY INVOKER` preserves that
boundary for session callers. These source facts do not demonstrate native
permissions, installed grants, schema-cache behavior or successful SQL execution.

## Scope and proposed ownership

This remains M1 and KI-2026-10-12-025. The current roadmap keeps M1 partial and
names cross-state, MPO and tribal cases. The matrix keeps land-use/GIS partial,
all fifty states/DC required, territories explicitly assessed and tribal
authority independent. The architecture separates geometry, place, workspace,
authority and legal applicability. Its dated source inventory is not a current
acceptance result. This fix adds no module, geography selector, legal inference,
scientific claim or narrowing of full v1. Preserve all joined M1 context and
publication corrections. ROOT alone may amend the known-issues register.

Current ownership is only NEW files in this review directory and the NEW
private directory named in `SOURCES.md`. Proposed later ownership, requiring
ROOT's separate implementation grant, is exactly:

- NEW `openplan/src/lib/geo/wgs84-query-viewport.ts`.
- `openplan/src/components/land-use-plans/public-designation-map.tsx`.
- `openplan/src/lib/land-use-plans/public-map.ts`.
- The published-plan, review-token and report designation map `route.ts` files
  listed in `SOURCES.md`.
- NEW focused viewport/parser/public-route/migration tests listed in `TEST_PLAN.md`,
  plus the changed RPC expectation and former wrapped-refusal case in
  `openplan/src/test/land-use-plan-report-map.test.tsx`.
- ONE prospective additive migration under `openplan/supabase/migrations/`,
  whose actual path does not exist yet. ROOT must first grant a finite CLI
  window. Discover the installed CLI help and generate the file through the
  actual migration CLI. Record its returned path, then separately author/review
  SQL within the grant. No timestamp, slot, filename or SQL is prewritten here.

ROOT must resolve the RPC choice, seam-edge policy and camera numeric ceiling
before application authoring. Native permission/SQL checks, identified-build
desktop/390px journeys, provider checks and release decisions remain separately
authorized evidence tiers. Full v1 remains open.
