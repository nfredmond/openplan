/**
 * AN AGENCY'S LAYER THAT ARRIVES BEFORE THE STYLE IS READY STILL GETS DRAWN.
 *
 * ═══ THE DEFECT, MEASURED IN A REAL BROWSER ═══
 *
 * `useWorkspaceGisMapBinding` deferred its paint with
 * `map.once("style.load", paint)` whenever `isStyleLoaded()` was false.
 * `style.load` fires ONCE per style and fires EARLY — `isStyleLoaded()` goes on
 * returning false for a while after it, while sources and sprites settle. So a
 * layer whose geometry arrived inside that window was handed to an event that
 * had already fired and would never fire again, and it never drew at all for
 * the life of that page — behind a ticked checkbox reading "1 of 1 on".
 *
 * Chrome, this tree's dev server, /safety with one uploaded GeoJSON switched on,
 * five consecutive loads of the same URL: 2 of 5 never added the source. A
 * 40×40 pixel patch screenshotted with the layer on and off was byte-identical
 * on the failing loads. After the fix, 5 of 5 painted, and the live style put
 * the four workspace-gis layers at indices 134–137 directly beneath
 * `safety-crash-halo` at 138 — the agency's context under the collisions, which
 * is the rule the panel states to the planner.
 *
 * ═══ WHAT THIS TEST CAN AND CANNOT DO ═══
 *
 * jsdom applies no stylesheet, has no box model and does not run Mapbox GL, so
 * nothing here can prove a pixel, a colour or a z-order on screen. What it can
 * prove is the thing that actually broke: WHEN the hook decides to draw. The
 * fake map below is a real subject for that question — it reports its own style
 * state and emits its own events, exactly as the failing sequence did.
 */
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useCallback, useRef } from "react";

const paintSpy = vi.fn();

vi.mock("@/lib/cartographic/workspace-gis-map-layers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/cartographic/workspace-gis-map-layers")>(
    "@/lib/cartographic/workspace-gis-map-layers"
  );
  return {
    ...actual,
    paintWorkspaceGisLayers: (...args: unknown[]) => paintSpy(...args),
    applyWorkspaceGisVisibility: () => undefined,
    applyWorkspaceGisEmphasis: () => undefined,
  };
});

const LAYER_ID = "11111111-1111-4111-8111-111111111111";

/**
 * A latch on the geometry read, because the ORDER is the whole subject.
 *
 * The defect only appears when the agency's geometry lands while the style is
 * still settling. Settling the fake style before the read completes tests the
 * easy path — the hook simply finds `isStyleLoaded()` true on its next run — and
 * the broken version passes it. So the test waits for the read to happen and
 * only then settles the style.
 */
function makeLatch() {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve: () => resolve() };
}
let featuresRequested = makeLatch();

vi.mock("@/lib/workspace-gis/client", () => ({
  fetchWorkspaceGisLayers: async () => [
    {
      layer: {
        id: LAYER_ID,
        workspaceId: "ws",
        projectId: null,
        name: "Bike network",
        description: null,
        style: { color: "#d55e00", opacity: 0.8, lineWidth: 2.5, labelField: null },
        defaultVisible: true,
        sortOrder: 0,
        archivedAt: null,
        createdAt: "2026-08-13T00:00:00Z",
        currentVersion: { id: "v1", layerId: LAYER_ID, versionNumber: 1 },
      },
    },
  ],
  fetchWorkspaceGisFeatures: async () => {
    featuresRequested.resolve();
    return { type: "FeatureCollection", features: [], coverageNotes: [] };
  },
}));

import { CartographicProvider } from "@/components/cartographic/cartographic-context";
import { useWorkspaceGisMapBinding } from "@/components/cartographic/use-workspace-gis-map-binding";

/**
 * A map whose style is NOT ready, which later settles — the exact sequence the
 * browser produced. `style.load` is fired once up front and never again,
 * because that is what a real map does when the hook mounts after it.
 */
function makeFakeMap() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  let styleLoaded = false;
  const emit = (event: string) => {
    for (const handler of [...(handlers.get(event) ?? [])]) handler();
  };
  return {
    map: {
      isStyleLoaded: () => styleLoaded,
      on(event: string, handler: (...args: unknown[]) => void) {
        if (!handlers.has(event)) handlers.set(event, new Set());
        handlers.get(event)!.add(handler);
      },
      off(event: string, handler: (...args: unknown[]) => void) {
        handlers.get(event)?.delete(handler);
      },
      once(event: string, handler: (...args: unknown[]) => void) {
        const wrapped = () => {
          handlers.get(event)?.delete(wrapped);
          handler();
        };
        this.on(event, wrapped);
      },
      getBounds: () => ({
        getWest: () => -121.6,
        getSouth: () => 38.5,
        getEast: () => -121.4,
        getNorth: () => 38.7,
      }),
    },
    /** The style finishes settling; Mapbox emits `styledata`, never a second `style.load`. */
    settle() {
      styleLoaded = true;
      emit("styledata");
    },
    /** A style that stops emitting `styledata` before it reports loaded. */
    settleQuietlyThenIdle() {
      styleLoaded = true;
      emit("idle");
    },
    listenerCount: (event: string) => handlers.get(event)?.size ?? 0,
    fireStyleLoad: () => emit("style.load"),
  };
}

/**
 * `useRef`, and it matters: the hook takes the ref OBJECT as an effect
 * dependency, so a fresh `{ current: map }` literal per render makes every
 * effect re-run on every render, and the state each effect writes causes the
 * next render. The first draft of this file did exactly that and exhausted the
 * heap instead of failing — a harness that cannot finish proves nothing either
 * way.
 */
function Harness({ map }: { map: ReturnType<typeof makeFakeMap>["map"] }) {
  const mapRef = useRef(map as never);
  const anchor = useCallback(() => "safety-crash-halo", []);
  useWorkspaceGisMapBinding({
    mapRef,
    ready: true,
    enabled: true,
    workspaceId: "ws",
    theme: "light",
    resolveAnchorLayerId: anchor,
  });
  return null;
}

describe("workspace layers paint once the style will accept them", () => {
  beforeEach(() => {
    paintSpy.mockClear();
    featuresRequested = makeLatch();
  });

  it("draws after the style settles, even though style.load already fired", async () => {
    const fake = makeFakeMap();
    // The map's own `style.load` goes off BEFORE the hook is watching, which is
    // the real ordering on /safety: the map is built by the child component and
    // this binding mounts against it afterwards.
    fake.fireStyleLoad();

    render(
      <CartographicProvider>
        <Harness map={fake.map} />
      </CartographicProvider>
    );

    // Nothing yet: the style cannot take layers.
    expect(paintSpy).not.toHaveBeenCalled();

    // Let the catalog and geometry reads land, then settle the style. Under the
    // `once("style.load")` version this emits an event nothing is listening for
    // and the layer is never drawn — which is what the browser did on 2 of 5
    // loads, and what this assertion is here to catch.
    await featuresRequested.promise;
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    fake.settle();
    await waitFor(() =>
      expect(
        paintSpy,
        "the workspace layer was never painted after the style settled — a paint deferred to " +
          "`style.load` is deferred to an event that has already fired"
      ).toHaveBeenCalled()
    );

    // And it stops listening once it has drawn — the handler closes over the
    // whole binding, so a map torn down while still loading must not keep it.
    expect(fake.listenerCount("styledata")).toBe(0);
    expect(fake.listenerCount("idle")).toBe(0);
  });

  it("still draws when the style only ever reports itself idle", async () => {
    const fake = makeFakeMap();
    fake.fireStyleLoad();

    render(
      <CartographicProvider>
        <Harness map={fake.map} />
      </CartographicProvider>
    );

    await waitFor(() => expect(fake.listenerCount("idle")).toBeGreaterThan(0));
    expect(paintSpy).not.toHaveBeenCalled();

    fake.settleQuietlyThenIdle();
    await waitFor(() => expect(paintSpy).toHaveBeenCalled());
  });

  it("unhooks its handlers when the binding goes away mid-load", async () => {
    const fake = makeFakeMap();
    fake.fireStyleLoad();

    const { unmount } = render(
      <CartographicProvider>
        <Harness map={fake.map} />
      </CartographicProvider>
    );
    await waitFor(() => expect(fake.listenerCount("styledata")).toBeGreaterThan(0));

    unmount();
    expect(fake.listenerCount("styledata")).toBe(0);
    expect(fake.listenerCount("idle")).toBe(0);
  });
});
