# OpenPlan SWITRS VRU Filter Pass

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — pedestrian / bicyclist crash filtering pass

## Summary
Extended the new SWITRS collision lane with vulnerable-road-user filters so operators can quickly isolate:
- pedestrian-involved collisions
- bicyclist-involved collisions
- either pedestrian or bicyclist involved collisions

This builds directly on the earlier SWITRS point layer and keeps the same honesty rule: filtering only applies when a run actually has local SWITRS point geometry.

## What changed
### Analysis Studio map controls
Updated `src/app/(app)/explore/page.tsx` to add:
- crash user filter state (`all`, `pedestrian`, `bicycle`, `vru`)
- combined filter stack across severity + user type
- filtered point counts in the map chrome
- clearer inspector/status language around vulnerable-road-user slices

### UX posture
The crash lane now distinguishes:
- severity filtering
- user-type filtering
- total drawable crash points vs filtered subset

That gives planners a fast way to focus on VRU safety patterns without pretending broader collision typologies are already fully modeled.

## Validation
- `npm run lint` ✅
- `npm test` ✅ (`27` files / `140` tests)
- `npm run build` ✅

## Recommended next step
1. Add report/export binding for current crash filters
2. Add project/run persistence for active map filter state
3. Move project-linked datasets from coverage footprints toward true thematic overlays via geometry attachment
