# Phase 3 Slice H — Escape-to-clear selection

**Date:** 2026-04-22
**Parent:** Phase 3 cartographic shell (Slices A–G shipped 2026-04-21 → 2026-04-22)
**Status:** shipped locally, tests 945/196 → 952/197 (+7 tests / +1 file), `pnpm qa:gate` clean.

## Goal

Add the keyboard-parity path to Slice G's background-click-to-clear: pressing **Escape** clears the current cartographic selection. Closes the a11y gap that background-click-to-clear left open (mouse/pointer only).

## What shipped

### 1. `useEscapeToClearSelection` hook

New file `src/components/cartographic/use-escape-to-clear-selection.ts` (38 LOC). Takes `{ enabled: boolean, onClear: () => void }` and, while `enabled`, registers a `window` `keydown` handler that calls `onClear()` on Escape — unless focus is inside an editable surface, in which case Escape retains its native meaning (closing a native dropdown, cancelling IME composition, etc.).

**Editable-target bail-out** covers three cases:
- `INPUT` / `TEXTAREA` / `SELECT` tags (the overwhelming majority of in-app text entry paths).
- `isContentEditable` getter — the spec-correct check for contenteditable regions.
- `closest('[contenteditable="true"]')` fallback — `isContentEditable` is unreliable in layout-free environments (JSDOM), and this walk matches self + ancestors, so a nested editable block also bails.

The hook is listener-scoped: the cleanup function in its effect removes the listener when `enabled` flips to false or when the owning component unmounts. No listener leaks across selection toggles.

### 2. Wired into the inspector dock

`src/components/cartographic/cartographic-inspector-dock-connected.tsx` (9 → 11 LOC) calls the hook with `enabled: selection !== null` and `onClear: clearSelection`. So:

- When nothing is selected, no listener is registered — zero event-loop cost for the base case.
- When a selection exists, the listener mounts; pressing Escape outside any editable surface clears the selection, which unmounts the listener on the same tick.

Mounting the hook in `CartographicInspectorDockConnected` (rather than in `CartographicProvider`) keeps the escape behavior co-located with the UI that visually disappears. Every page that uses the cartographic shell already mounts the dock, so coverage is identical to mounting at the provider level, but the lifecycle is tighter.

### 3. Tests

7 new tests in `src/test/use-escape-to-clear-selection.test.tsx`:

- Escape on `document.body` fires `onClear`.
- `enabled: false` never fires `onClear` (no selection → no listener registered).
- Escape inside an `INPUT` is ignored.
- Escape inside a `TEXTAREA` is ignored.
- Escape inside a `contenteditable="true"` node is ignored.
- Non-Escape keys (Enter) are ignored.
- After `unmount()`, Escape on `document.body` is ignored (listener detached).

Uses `@testing-library/react`'s `renderHook` + `KeyboardEvent` dispatch with `bubbles: true`, so events propagate from the dispatched target up to the `window` listener.

## Why this slice

Called out as candidate #3 in the Slice G proof's "Next" section:

> 3. **Keyboard escape-to-clear** — press Escape to clear the current selection. Low-stakes a11y polish; naturally pairs with background-click-to-clear.

The mouse-only gap mattered more than I initially estimated — list-row hover selects features, but once a feature is selected, there was no keyboard path to dismiss it without tabbing to the dock's X button (which requires the dock to render in a reachable focus order and requires the user to know that's the dismiss path). Escape is the universally expected gesture.

Keeping this a standalone slice (not folded into Slice G) was deliberate: Slice G was already a two-item bundle (pan/fit + background-click), and adding a third would've muddied the commit boundary + proof doc. Escape-to-clear is also a natural spot to exercise the hook-extraction pattern — future keyboard hooks (Escape to exit draw mode, when corridor authoring lands; Tab through the inspector; etc.) can follow the same shape.

## Known minor issues / scope boundaries

- **No focus return.** After Escape clears a selection, focus stays where it was. If the user had pressed Escape from a list row, they're still on that row — which is the right default. If they pressed it from the map canvas, they're still on the map, which is also fine. No explicit focus re-targeting is attempted.
- **No "are you sure?" for unsaved state.** If corridor authoring lands later with an editable inspector (drawing a new LineString, say), Escape would unceremoniously clear both the selection *and* the in-progress draw. That's a concern for the authoring slice, not this one — the dock is read-only today.
- **Only one Escape-consumer at a time per tree.** If a downstream consumer (modal, drawer, deeply-nested autocomplete) wants to handle Escape first, it needs to call `stopPropagation()` on the keydown event in its capture-phase listener, or the hook will still fire. This is the same constraint every `window`-level shortcut has. Acceptable for now; revisit if a conflict emerges.
- **No Cmd+. equivalent on mac.** macOS natively binds `Cmd+.` to "cancel" in many contexts. We don't listen for it. Escape is universal enough that adding a second chord seemed like noise.

## Gates

- Lint: clean
- `pnpm audit --prod --audit-level=moderate`: 0 advisories
- `pnpm test`: 197 files / 952 tests passing (was 196 / 945)
- `pnpm build`: 64 routes (no new routes; pure client-side), compile success

## Files shipped

### Added
- `src/components/cartographic/use-escape-to-clear-selection.ts` (38 LOC — hook + editable-target helper)
- `src/test/use-escape-to-clear-selection.test.tsx` (7 tests)

### Modified
- `src/components/cartographic/cartographic-inspector-dock-connected.tsx` (9 → 11 LOC — calls the hook with selection-gated `enabled`)

## Pointers

- Phase 3 Slice G proof (prior, background-click-to-clear): `docs/ops/2026-04-22-phase-3-slice-g-fit-and-background-click-proof.md`
- Phase 3 Slice F proof (layers-panel live counts, where Slice G + H were both called out as candidates): `docs/ops/2026-04-22-phase-3-slice-f-layers-panel-live-counts-proof.md`

## Next

Recommendations carry forward from Slice G's "Next" section (now with #3 closed):

1. **Corridor authoring UI** — first editable surface for the cartographic system. Inspector-dock "Edit corridor" → draw mode on the backdrop → persist via `POST /api/map-features/corridors`. Bigger slice; would want its own plan document.
2. **RTP cycle "pin on map" layer** — wire the `rtp` chip to a data source. Requires an editor call on how to geolocate an RTP cycle (anchor to primary project's coords, or add nullable `rtp_cycles.anchor_lat/lng` column). Mild schema slice.
3. **Revalidate counts on create.** Phase 3 Slice F's only known gap — the layers-panel chips don't live-update when a new mission/corridor is created elsewhere in the app. Once authoring lands (#1), a `revalidate` event would close this.

Recommendation: **pick between #1 and #2 next.** #1 is the first editable surface in the cartographic system and unlocks #3 as a natural follow-up. #2 is smaller, unblocks the `rtp` chip in the layers panel, but hinges on a schema decision. I'd lean toward #2 as the faster next ship (and the schema decision is small: nullable anchor columns on `rtp_cycles` is a one-migration addition), but #1 has more long-term value.

No user-owned follow-ups — Slice H ships pure client-side additions, no migration, no seed change, no new routes.
