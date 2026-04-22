# Phase 3 Slice B — Click-to-select mission AOIs from the backdrop (2026-04-21)

## What shipped

Slice A rendered mission AOIs on the shell backdrop but left them inert: clicking a polygon did nothing, and the inspector dock only opened on hover-over-list-row. Slice B closes the reverse direction of the Phase 2 feedback loop — **map → inspector** now mirrors **list → inspector**.

### New helper

`src/lib/cartographic/mission-feature-to-selection.ts` — 60 LOC. Two exports:

- `isAerialMissionFeatureProperties(value: unknown): value is AerialMissionFeatureProperties` — defensive type guard against the `Record<string, unknown>` shape of incoming GeoJSON feature properties. Rejects null/undefined, non-objects, wrong `kind`, missing/empty `missionId`, non-string `title`/`status`/`missionType`, and non-null non-string `projectId`.
- `aerialMissionFeatureToSelection(properties: unknown, { navigate }): CartographicInspectorSelection | null` — the pure transform. Runs the guard; returns `null` on failure. Maps properties → inspector payload with `kind: "mission"`, `kicker: "Aerial mission"`, `avatarChar: "A"`, two meta chips (`status`, `type`), a primary `"Open mission"` action that calls `navigate("/aerial/missions/:missionId")`, and a conditional secondary `"Open project"` action when `projectId` is present.

Title falls back to `"Untitled mission"` when the incoming value is whitespace-only. `navigate` is injected (not a hard `next/navigation` dep) so the transform is unit-testable without mounting a router.

### Backdrop wiring

`src/components/cartographic/cartographic-map-backdrop.tsx` — **+42 LOC** (264 → 306).

Three additions:

1. **Imports** — `useRouter` from `next/navigation`, `useCartographicSelection` from the context, `aerialMissionFeatureToSelection` from the new helper.
2. **Stable navigate ref** — `navigateRef = useRef((path) => router.push(path))` kept in sync via a cheap effect. The click-handler effect closes over the ref so it does *not* re-subscribe every time `router` identity changes.
3. **Click + hover handler effect** — runs on `[ready, setSelection]`. Three Mapbox subscriptions on `AOI_FILL_LAYER_ID`:

```ts
map.on("click", AOI_FILL_LAYER_ID, (e) => {
  const feature = e.features?.[0];
  if (!feature) return;
  const selection = aerialMissionFeatureToSelection(feature.properties, {
    navigate: (path) => navigateRef.current(path),
  });
  if (selection) setSelection(selection);
});
map.on("mouseenter", AOI_FILL_LAYER_ID, () => { map.getCanvas().style.cursor = "pointer"; });
map.on("mouseleave", AOI_FILL_LAYER_ID, () => { map.getCanvas().style.cursor = ""; });
```

Cleanup calls `map.off(…)` on each subscription. Handlers survive theme-swap re-paints because they're layer-id-scoped, not source-scoped — the same id is re-created in the paint effect.

### New tests

`src/test/mission-feature-to-selection.test.ts` — **11 cases** across the type guard and the transform:

| Case | Assertion |
|---|---|
| well-formed payload | guard returns true |
| missing `missionId` | guard returns false |
| wrong `kind` | guard returns false |
| `projectId: null` | guard accepts |
| non-object input (null / string / undefined) | guard rejects all three |
| transform on invalid payload | returns `null`, `navigate` never fires |
| transform on valid payload | shape matches (kind/title/kicker/meta) |
| primary action | invokes `navigate("/aerial/missions/:id")` |
| secondary action when projectId present | invokes `navigate("/projects/:id")` |
| secondary action when projectId null | `undefined` (action omitted) |
| blank title | falls back to `"Untitled mission"` |

Deliberately **no Mapbox integration test** — Mapbox GL + JSDOM is brittle, and the pure helper plus the three-line Mapbox handler shim cover the interesting surface.

## Why this slice

Slice A was a one-way loop: the backdrop reflected workspace state but the user couldn't act on it. Click-to-select is the smallest move that makes the map participate in the same inspector loop that list rows already drive — completing Phase 2's feedback contract in both directions (list → inspector **and** map → inspector) and unlocking future slices (e.g. clicking a project marker or corridor segment re-uses the same pattern).

## Known minor issues (non-blocking)

- **Keyboard-inaccessible.** Map clicks are mouse/pointer only. The accessible path to the inspector is list-row hover/focus from the Phase 2 selection-link sweep. A future slice could add a numbered-index overlay or tab-cycling through visible features.
- **No background-click-to-clear.** The inspector's X button is still the dismiss surface. Adding `map.on("click", …)` at the map level (not layer-scoped) would work but adds ordering complexity because layer-scoped handlers fire *before* the top-level one — deferring.
- **No focused-feature highlight.** The clicked polygon doesn't visually lift — selection state lives in the inspector dock only. A follow-up could add a feature-state `selected` flag and a paint expression.
- **Pointer cursor bleeds through.** `map.getCanvas().style.cursor = ""` resets cleanly on layer exit, but a fast pointer exit during style swap (rare) could leave the cursor set; cosmetic.

## Not this slice

- **Project markers.** Still requires a `lat/lng` column on `projects` or a geocode-on-read step.
- **Corridor / engagement / crash / equity layers.** None render live data yet — same click pattern will apply when they do.
- **Shift-click / cmd-click multi-select.** Inspector dock shows single selection by contract.
- **Refetch-on-focus.** Carries forward from Slice A — still a `useEffect` fetch on mount.

## Gates

```bash
pnpm test --run src/test/mission-feature-to-selection.test.ts
# → 11/11 pass

pnpm qa:gate
# → lint clean · 879 tests / 187 files pass (up from 868/186 post-Slice A) · 0 advisories · Next build succeeds
```

## Files

### New
- `src/lib/cartographic/mission-feature-to-selection.ts` (60 LOC)
- `src/test/mission-feature-to-selection.test.ts` (11 tests)
- `docs/ops/2026-04-21-phase-3-slice-b-click-to-select-proof.md` (this file)

### Modified
- `src/components/cartographic/cartographic-map-backdrop.tsx` (264 → 306 LOC)

## Next

Slice C candidates, prioritized:

1. **Feature-state highlight on selection** — small visual polish; builds on Slice B paint expressions.
2. **Project markers** — unlocks click-to-select on a second layer; needs schema work.
3. **Corridor layer rendering** — bigger payload surface.
4. **Background-click-to-clear** — UX polish; low stakes.

Recommendation: **Slice C = feature-state highlight**, since it turns the inspector-dock selection into a visible map affordance without new schema work and sets the pattern for the next layer.

## Pointers

- Phase 3 Slice A proof: `docs/ops/2026-04-21-phase-3-slice-a-live-aoi-proof.md`
- Phase 2 proof (selection link + AOI seed): `docs/ops/2026-04-21-phase-2-cartographic-selection-aoi-proof.md`
- Helper under test: `src/lib/cartographic/mission-feature-to-selection.ts`
- Inspector dock contract: `src/components/cartographic/cartographic-inspector-dock.tsx`
