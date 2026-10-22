# Wrapped designation queries need a separate viewport contract

October 16, 2026. Source and primary-documentation assessment only. Baseline is
`d264d69149ae2f9d589840e5a543b798ae4718ec`, application
`42fc0315070f31269325acb264f0260723dbd56b`. No application or migration changes
accompany this report. The original extent and publication reviews remain
unchanged.

`publicViewport` in `public-designation-map.tsx` lower-clips west at minus 180 and
upper-clips east at 180. `refresh` returns when west is at least east. For a
supplied unwrapped longitude interval 170 to 190, this source path retains only
170 to 180. For 190 to 210 it produces 190 to 180 and returns without fetching or
clearing earlier source data. These are manual source-path deductions, not
executed examples or observations of a current browser.

Mapbox documents longitude values outside the canonical interval when world
copies render. That supports investigating these inputs rather than treating
every such camera value as invalid. The current lockfile names Mapbox GL 3.20.0
and MapLibre GL 6.13.0. Current documentation does not establish exact installed
camera behavior, projections or returned bounds at those versions.
[Mapbox LngLatBounds](https://docs.mapbox.com/mapbox-gl-js/api/geography/#lnglatbounds).

The shared `readWgs84Bbox` and `readWgs84Viewport` deliberately describe strict,
nonwrapped canonical rectangles. Stored extent framing and viewport query
normalization need separate contracts. Loosening that shared reader would change
unrelated callers. The three designation routes and the shared loader need a
coherent query representation before a frontend-only change can be accepted.

The loader currently makes one bounded RPC, checks the frozen version's workspace,
ready status and feature hash, enforces the public-field allowlist, requires a
safe consistent full count, and refuses a misleading partial drawing. Preserve
those boundaries. Two limited queries followed by count summation or feature
deduplication cannot establish an exact union count when a half exceeds its cap.
Any correction must count each feature once across one atomic geographic query.

The sole current bbox RPC definition is in migration
`20260812000016_workspace_gis_features.sql`. It is SECURITY INVOKER with existing
table RLS and grants to authenticated/service_role. Its ordinary workspace-GIS
caller also uses the strict reader. A new dedicated RPC versus an additive
extension requires source review; neither choice is approved here. No migration
filename or ordinal is reserved, and no CLI runs.

An isolated GPT-6.1 Sol/high lane is preparing the source contract and exact
ownership before edits. It must address wrapped and shifted copies, full-world
and degenerate views, malformed query tokens, finite/range limits, exact counts,
duplicates, density refusal and stale-shape handling. Source-level controls,
native PostgreSQL/PostGIS/RLS and identified desktop/390px journeys remain
different evidence tiers. No test, SDK, map engine, WebGL, tile, server, database
or browser case runs in this assessment.

The unchanged direction check passes at the same application tree, with its
expired registry/matrix and version/age reminders retained. This bounded M1/KI-025
task uses the existing map and GIS owners. It creates no new module and does not
renew those reviews or reduce any nationwide, territory, tribal or overlapping
authority obligation. No native successor, main, hosted or release operation is
authorized. EVIDENCE.json binds the source assessment and direction receipt.
