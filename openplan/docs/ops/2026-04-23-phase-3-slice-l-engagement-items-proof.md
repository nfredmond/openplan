# Phase 3 Slice L — Engagement items layer (proof)

**Shipped:** 2026-04-23 Pacific
**Scope:** Sixth data-driven layer on the cartographic backdrop. Closes the live `engagement` chip by painting approved community-input items from workspace-scoped engagement campaigns.

## What shipped

The cartographic backdrop now fetches `/api/map-features/engagement`, paints approved engagement items as rose point features, and routes clicks into the inspector dock with an `Open campaign` primary action.

This is:

1. **The sixth data-driven layer.** Pattern is now AOI polygons, project points, corridor lines, RTP cycle points, census-tract MultiPolygons, and engagement item points.
2. **The first moderation-aware map layer.** Only `engagement_items.status = 'approved'` rows render. Pending, rejected, and flagged items remain out of the backdrop.
3. **The first layer scoped through an embedded parent.** `engagement_items` has no `workspace_id`, so the route joins through `engagement_campaigns!inner` and filters `engagement_campaigns.workspace_id = membership.workspace_id`.
4. **A production typecheck repair.** Supabase infers embedded `engagement_campaigns` / `engagement_categories` selections as arrays in the generated type surface. The route now normalizes embedded resources from object-or-array form before feature mapping, so `pnpm exec tsc --noEmit` and production build no longer fail on the cast.

## Design choices

- **No migration.** Engagement tables already exist in prod. This slice only adds a read route, client wiring, and NCTC demo seed rows.
- **Approved-only by construction.** The route filters `status = 'approved'` and non-null lat/lng. This keeps moderation posture intact and avoids rendering unreviewed public comments.
- **Campaign join is required.** The `!inner` campaign embed plus `.eq("engagement_campaigns.workspace_id", workspaceId)` gives a true workspace-scoped read without adding a redundant `workspace_id` to child items.
- **Rose/plum paint `#c24a7f`.** Distinct from project green, AOI orange, RTP plum, corridor LOS ramp, and equity teal. Base radius/stroke is `5 / 1.25`; selected radius/stroke is `8 / 2.25`.
- **Default-on layer.** Unlike equity choropleth, engagement points are low visual weight. `DEFAULT_LAYERS.engagement = true`, and the legend includes "Community input" by default.
- **Z-order under primary pins.** Engagement circles paint above census tracts but below existing project/RTP point layers when those layers are present, so project/RTP anchors remain dominant.
- **NCTC demo seed is realistic but authored.** Four approved comments land in the Grass Valley / Nevada City area, covering unsafe crossing, bike parking, SR-20 speeding, and late bus service. These are illustrative demo comments, not live public submissions.

## Files shipped

### New files

- `openplan/src/app/api/map-features/engagement/route.ts` — auth-gated workspace route. Reads approved, geocoded engagement items through `engagement_campaigns!inner`, normalizes embedded resources, defensively coerces lat/lng, emits GeoJSON Point features, audits loaded/query-failed/unhandled paths.
- `openplan/src/lib/cartographic/engagement-item-feature-to-selection.ts` — type guard + selection factory. Produces `kind: "engagement"`, kicker "Community input", meta rows for status/source/category/excerpt, `Open campaign` action, optional `featureRef`.
- `openplan/src/test/engagement-item-feature-to-selection.test.ts` — 19 helper tests.
- `openplan/src/test/map-features-engagement-route.test.ts` — 6 route tests, including auth gate, workspace/status filter call order, array/object embed normalization, join-miss defensive drop, excerpt truncation, and query-failure path.
- `openplan/src/test/nctc-demo-engagement-items.test.ts` — 4 seed tests covering count, coordinate envelope, campaign linkage, and deterministic UUIDs.

### Modified files

- `openplan/src/components/cartographic/cartographic-map-backdrop.tsx` — sixth source/layer constants, fetch effect, paint effect, visibility effect, click/hover handlers, background-click feature layer inclusion, and highlight source tuple extension.
- `openplan/src/components/cartographic/cartographic-context.tsx` — `engagement` defaults to `true`.
- `openplan/src/components/cartographic/cartographic-inspector-dock.tsx` — kind union includes `"engagement"`.
- `openplan/src/app/api/map-features/counts/route.ts` — counts `engagement_items` joined to workspace campaigns, with the same partial-failure posture as the other layers.
- `openplan/src/components/cartographic/cartographic-layers-panel.tsx` — engagement chip wired to live counts.
- `openplan/src/components/cartographic/cartographic-map-legend.tsx` — adds rose swatch entry labeled "Community input".
- `openplan/scripts/seed-nctc-demo.ts` — adds one deterministic NCTC engagement campaign and four approved, geocoded engagement items.
- `openplan/src/test/map-features-counts-route.test.ts`, `openplan/src/test/cartographic-layers-panel.test.tsx`, `openplan/src/test/cartographic-map-legend.test.tsx` — extended for the sixth layer.

## Gates

- Focused Slice L tests: 45 tests passing across engagement route/helper/counts/panel/legend before seed, then 30 focused tests after seed additions.
- `pnpm exec tsc --noEmit`: clean.
- `pnpm qa:gate`: clean.
  - Lint: clean.
  - `pnpm test`: **206 files / 1043 tests passing**.
  - `pnpm audit --prod --audit-level=moderate`: 0 advisories.
  - `pnpm build`: production build clean; `/api/map-features/engagement` appears in the route table.

## Production posture

No production migration is needed. The post-commit close-out step is:

```
pnpm seed:nctc -- --env-file .env.production.local
```

Then verify with service-role REST:

```
SELECT id, title, status, latitude, longitude
FROM engagement_items
WHERE status = 'approved'
LIMIT 10;
```

Expected seeded titles:

- `Unsafe crossing at Neal + Mill`
- `Needs better bike parking at library`
- `Speeding on SR-20 near Alta Sierra`
- `Later bus service for evening shifts`

## User-owned smoke

The browser smoke test remains user-owned because it needs a demo-owner browser session. Updated checklist: open the prod backdrop as `nctc-demo@openplan-demo.natford.example`, confirm the engagement chip shows a live count, rose community-input circles render by default, hover shows a pointer cursor, click opens the inspector with `kind: "engagement"` / kicker "Community input" / `Open campaign`, selected circle lifts to radius 8 and stroke 2.25, and background click or Escape clears the selection.

## Next

Write the cartographic shell close-out doc. The implementation pattern from `directions/02-cartographic.html` is now fully implemented; deferred work should be grouped by customer pull rather than by remaining shell mechanics.
