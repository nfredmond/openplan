# Focused checks proposed for the viewport correction

No check below runs in this preparation turn. No test or executable guard is
authored. The cases are prospective assertions, not measured outcomes. ROOT
must grant implementation and finite test windows separately. Do not rerun the
old extent or broad report-map campaigns as a substitute for these checks.

## Existing tests protect different boundaries

- `public-designation-map-extent.test.tsx` supplies a fixed ordinary mocked
  camera view. It checks invalid/missing stored extents, ordinary and sliver
  framing, point centering, persistent extent disclosure and rerender teardown.
  It cannot reveal world-copy query clipping with that fixed mock.
- `wgs84-bounds.test.ts` checks strict canonical stored bounds, degenerate
  extents, range/finite/order refusal and strict positive-area viewports. It
  intentionally refuses wrapped bounds. Keep it and its helper unchanged.
- `land-use-plan-report-map.test.tsx` tests historical report identity and
  scoped permission, exact projections/filters, field suppression, missing or
  inconsistent counts, incomplete replies, zero sentinel, density refusal and
  retained presentation. It mocks Supabase/RPC and the map component. Its
  existing wrapped-query refusal must become an acceptance case for this new
  query contract; its RPC name expectation also needs a bounded update.
- `a-dense-layer-refuses-to-draw-rather-than-draw-half.test.ts` tests the
  separate workspace GIS endpoint and old RPC call, cap/response limits,
  density disclosure, invalid inputs and required projections. Its whole
  module is not a new public-viewport acceptance check.
- `workspace-gis-migration.test.ts` reads the original migration text and
  parsed policy/grant statements. It checks RLS, CRS/ingest/data constraints,
  invoker/search-path text, cap/sentinel structure and permissions. It does not
  apply SQL or inspect the new migration unless explicitly extended.
- `land-use-plan-public-identity.test.ts` exercises the actual frozen packet
  loaders with fake queries, including changed live context, exact hash and
  saved identity. `land-use-plan-review-reporting.test.ts` has source checks
  excluding private consultation fields from anonymous readers. Neither proves
  all three actual viewport route parsers or native RLS.

## New focused behavior cases

Proposed NEW `openplan/src/test/wgs84-query-viewport.test.ts` directly imports
the pure helper without loading either map SDK. Exercise camera raw bounds,
numeric wire input and string query input as distinct inputs. Assert exact
output tuples and refusal, including ordinary values, both world-copy sides,
canonical wrapped views, whole-world widths before modulo, 360 and >360 widths,
seam aliases, reversed noncanonical bounds, negative zero, zero width/height,
bad latitude in either position, missing/extra parts, blank and whitespace parts,
non-number entries, NaN, both infinities and unsafe magnitudes. Include tiny
positive widths on either side of the seam so rounding cannot silently widen
them. Do not merely assert that a helper returns something truthy.

Proposed NEW `openplan/src/test/public-designation-map-viewport.test.tsx` uses
the real component with a controllable engine mock. Inspect the complete fetch
URL for `[170,190]`, `[190,210]`, negative copies, explicit wrapped views and
full-world width. Count fetch calls. Start with visible synthetic features,
then return missing/invalid bounds: require no new fetch, empty source data and
the unavailable-view notice. Resolve an older pending response after the invalid
move and require that it cannot redraw. Restore valid bounds and require a new
request and cleared notice. This test must not mock the viewport helper itself.

Proposed NEW `openplan/src/test/land-use-plan-map-viewport-routes.test.ts`
invokes all three real GET handlers. Mock their boundary dependencies, not the
parser or handler. Valid ordinary/wrapped/full-world/seam values must reach the
loader as the exact canonical tuple. Missing, blank, whitespace, extra, zero,
nonfinite and out-of-range input must return 400 before packet/auth/loader work.
Keep identifier failures, absent/withdrawn review token, unavailable published
packet, denied report access and failed frozen identity distinct. This layer
proves wiring, not the internals of a mocked packet or permission loader.

Use focused named cases in `land-use-plan-report-map.test.tsx` for the actual
loader and report handler. Assert exactly ONE call to the new RPC with the
exact version, canonical bounds and shared limit. Retain version selection and
workspace/ready/hash projections. Exercise zero, count=cap, count=cap+1,
inconsistent/unsafe counts, missing rows, duplicate IDs, incomplete replies,
wrong hash/workspace and public attribute suppression. Preserve the default
public service client and the session-scoped report client. Select relevant
cases explicitly rather than rerunning its full historical campaign.

Proposed NEW `openplan/src/test/public-designation-viewport-migration.test.ts`
binds to the actual later CLI-generated migration path. Inspect executable
function bodies and statements with comments removed. Check input validation,
one matched relation over version-filtered rows, both longitude intervals,
seam-edge terms, one count before draw limiting, sentinel, invoker/search path
and grants. It must catch a targeted missing interval and changed ACL. A source
scanner cannot establish PostgreSQL interpretation or RLS execution.

## Small controls for every changed test or guard

For each changed test/guard, retain its exact selected command, bytes and
assertion coverage. Run the harmless survivor first. Change a comment or an
irrelevant local identifier without behavior change. Require the selected check
to stay green and the control recorder to label it a survivor. Then apply each
named wrong behavior below one at a time. Require the specific assertion and
reason to fail. Restore the original bytes in a `finally` path, verify restored
hashes and run the final selected check. Do not use destructive Git restoration.

- `clip-east-at-180`: truncate camera east before normalization. The seam test
  must fail on missing western coverage. `modulo-before-width`: normalize a
  360-degree view to equal endpoints. The full-world test must fail.
- `keep-old-shapes-on-invalid-view`: restore the current invalid early return.
  The component test must fail on retained features. `ignore-request-generation`:
  accept an older response after invalidation. Its deferred-response assertion
  must fail on redraw.
- `blank-coordinate-is-zero`: restore direct `Number` conversion in each public
  route in turn. Each route's blank-part case must fail before packet access.
  `route-keeps-strict-reader`: leave one route on the old reader. Its wrapped
  acceptance case must fail.
- `call-two-single-window-rpcs`: replace the one union RPC path with independent
  reads. The loader's call count/name contract must fail. `accept-duplicate-id`
  and `accept-short-counted-reply`: remove the respective incomplete-response
  refusal. Each named loader assertion must fail.
- `drop-western-interval`: remove the -180-to-east predicate. The migration
  structure assertion must fail. Later native tests must fail on the missing
  west feature. `count-after-limit`: cap before counting. The cap+1 native
  assertion must fail. `grant-anon-execute`: expose the new RPC to anon. The
  parsed ACL assertion must fail; native denial is a separate later control.

These are implementation-specific named mutations to prepare later. A source
mutation killed by syntax/import/setup failure is not the intended result.
Document any survivor and blind category rather than relabeling it a pass.

## Native SQL and permission evidence needs its own window

On an isolated authorized stack only, apply the actual additive migration and
check direct calls with null, NaN, infinities, range violations, zero/equivalent
seam width, valid seam aliases and full-world input. Verify invalid input raises
instead of producing a false zero. Use synthetic rows east/west of the seam,
both ±180 edges, outside the latitude band, in the excluded longitude gap and
in a different version/workspace. A multipart row whose envelope meets both
windows must appear once. Equal geometry stored under two different IDs must
remain two rows. Check exact distinct IDs and counts at zero, cap and cap+1;
above cap require no geometry. Keep the old RPC and ordinary caller behavior.

Run as authorized authenticated members, a nonmember and anon, plus the
intentional service-role path. Inspect function privileges and invoker behavior;
do not infer permission from a mocked route. Include revoked membership and
other-workspace/version reads. Native tests must verify the same input matrix
as the TypeScript reader. Observe statement count/draw coherence and available
index plans separately; syntax text does not prove performance or SQL semantics.

## Evidence tiers stay separate

Pure tests cannot prove SDK camera output. Component mocks cannot prove WebGL,
projection, repeated-world placement or readable labels. Route tests cannot
prove installed grants, RLS, PostgREST limits or schema caches. Source migration
checks cannot prove SQL execution. Native SQL cannot prove browser reachability.

Later identified-build navigation must cover desktop and 390px across published,
review-token and historical-report pages, with both configured engines where
claimed. Pan across the seam and beyond one world copy, return to an ordinary
view, inspect actual requests/console, compare shown features with seeded IDs,
and observe the dense and unavailable states. Keep frozen report hash/note and
private-field suppression visible. Record candidate source and build identity.
Those journeys, native checks and practicing-planner usefulness are pending.
