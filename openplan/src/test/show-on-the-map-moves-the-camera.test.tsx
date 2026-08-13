/**
 * "SHOW ON THE MAP" SHOWS YOU THE MAP OF YOUR LAYER.
 *
 * ═══ THE DEFECT, FOUND IN A BROWSER AND NOT BY A TEST ═══
 *
 * v0.20.0 shipped the Data Hub's "Show on the map" link and the component that
 * reads it back. Signed in against a local instance, with a three-line bike
 * network seeded near Grass Valley and its extent recorded on the version row,
 * `/safety?layer=<id>` did two of the three things it had to: the layer came
 * on, and the page stepped aside. Nothing moved the camera. The map sat at the
 * continental default, so a layer covering thirteen kilometres was drawn inside
 * a view spanning North America — present, correct, and invisible. Everything
 * needed to frame it was already in the product: the features served, the
 * extent recorded. Nothing consumed it.
 *
 * ═══ WHAT THIS FILE HOLDS, AND WHAT IT CANNOT ═══
 *
 * The BACKDROP's half of the contract: a focus request put on the cartographic
 * context reaches the real map object, becomes the right camera call, is put
 * down afterwards, and outranks the automatic framing that would otherwise
 * yank the planner back to the whole workspace a beat later.
 *
 * It does NOT prove a pixel moved. jsdom has no box model and Mapbox GL will
 * not initialise in it, so `mapboxgl` is mocked and what is asserted is the
 * INSTRUCTION the backdrop hands it — the arguments, on the real component,
 * through the real context. What stays unproven is only that Mapbox honours
 * `fitBounds`. The deep link's half — that the request carries the layer's
 * recorded extent — is in `reading-the-map-uncovers-it.test.tsx`.
 */

import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  THE TOKEN HAS TO BE SET BEFORE THE BACKDROP MODULE IS EVALUATED — it reads it
  once, at module scope, and a backdrop with no token draws the CSS fallback and
  never builds a map at all.

  `vi.hoisted` rather than the obvious `vi.resetModules()` + dynamic import,
  because that idiom quietly breaks this test in a way it still passes: a
  re-imported backdrop gets a re-imported `cartographic-context`, so the
  provider rendered here and the hook called in there are two different React
  contexts, the backdrop sees no provider, and every assertion about a focus
  request becomes an assertion about the hook's inert fallback. One module
  graph is the whole point.
*/
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.a-test-token";
  delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
});

import { CartographicMapBackdrop } from "@/components/cartographic/cartographic-map-backdrop";
import {
  CartographicProvider,
  useCartographicMapFocus,
} from "@/components/cartographic/cartographic-context";
import {
  FIT_DURATION_MS,
  FIT_MAX_ZOOM,
  FIT_PADDING,
  POINT_FIT_ZOOM,
  type FitInstruction,
} from "@/lib/cartographic/geometry-bbox";

let pathname = "/safety";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

/** Every camera call the backdrop made against its map, in order. */
type CameraCall = { method: "easeTo" | "fitBounds"; args: unknown[] };
let cameraCalls: CameraCall[] = [];

/**
 * A map that answers every question and records the two that matter.
 *
 * The unknown-property fallback is deliberate. The backdrop touches something
 * like twenty Mapbox methods across a dozen layer effects, and enumerating them
 * would make this fixture a maintenance tax on every future layer — and, worse,
 * a test that fails for reasons having nothing to do with the camera. The two
 * camera methods are implemented for real; everything else is inert.
 */
function createFakeMap() {
  const base: Record<string, unknown> = {
    on(event: string, ...rest: unknown[]) {
      const listener = rest[rest.length - 1];
      // The style is loaded the moment anybody asks, so `ready` flips and the
      // effects under test actually run.
      if (event === "load" && typeof listener === "function") {
        (listener as () => void)();
      }
      return base;
    },
    once(event: string, ...rest: unknown[]) {
      const listener = rest[rest.length - 1];
      if (typeof listener === "function") (listener as () => void)();
      return base;
    },
    isStyleLoaded: () => true,
    getLayer: () => undefined,
    getSource: () => undefined,
    queryRenderedFeatures: () => [],
    getCanvas: () => ({ style: {} }),
    getBounds: () => ({
      getWest: () => -121.2,
      getSouth: () => 39.1,
      getEast: () => -120.9,
      getNorth: () => 39.3,
    }),
    easeTo: (...args: unknown[]) => {
      cameraCalls.push({ method: "easeTo", args });
    },
    fitBounds: (...args: unknown[]) => {
      cameraCalls.push({ method: "fitBounds", args });
    },
  };
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      return () => undefined;
    },
  });
}

/*
  Everything the factory returns is DEFINED INSIDE IT. `vi.mock` is hoisted
  above the module's own top-level bindings, so a class declared out here is
  still in its temporal dead zone when the backdrop's `import mapbox-gl` runs
  the factory, and the whole suite dies before a single test starts.
  `createFakeMap` survives only because it is a hoisted function declaration
  that is not CALLED until the backdrop builds its map.
*/
vi.mock("mapbox-gl", () => {
  // A real constructor: `new mapboxgl.Map(...)` is how the backdrop builds it,
  // and a constructor returning an object hands that object back.
  function FakeMapConstructor() {
    return createFakeMap();
  }
  class FakeLngLatBounds {
    private extended = 0;
    extend() {
      this.extended += 1;
      return this;
    }
    isEmpty() {
      return this.extended === 0;
    }
  }
  // The transit layer builds one of these on mount. Nothing here reads it.
  function FakePopup() {
    const popup: Record<string, unknown> = {};
    return new Proxy(popup, {
      get(target, prop) {
        if (prop in target) return target[prop as string];
        return () => popup;
      },
    });
  }
  return {
    default: {
      Map: FakeMapConstructor,
      LngLatBounds: FakeLngLatBounds,
      Popup: FakePopup,
      accessToken: "",
    },
  };
});

/** Puts a focus request on the context once, the way the deep link does. */
function RequestFocusOnce({ instruction }: { instruction: FitInstruction }) {
  const { requestMapFocus } = useCartographicMapFocus();
  useEffect(() => {
    requestMapFocus(instruction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestMapFocus]);
  return null;
}

/** Reports whether the request is still standing, so "cleared" is observable. */
function FocusWitness({ onChange }: { onChange: (focus: FitInstruction | null) => void }) {
  const { mapFocus } = useCartographicMapFocus();
  useEffect(() => {
    onChange(mapFocus);
  }, [mapFocus, onChange]);
  return null;
}

describe("a focus request reaches the map", () => {
  const ORIGINAL_FETCH = global.fetch;

  beforeEach(() => {
    cameraCalls = [];
    pathname = "/safety";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ type: "FeatureCollection", features: [] }),
    }) as unknown as typeof fetch;
    window.localStorage.clear();
    return () => {
      global.fetch = ORIGINAL_FETCH;
    };
  });

  function renderWithRequest(instruction: FitInstruction) {
    const seen: Array<FitInstruction | null> = [];
    const view = render(
      <CartographicProvider>
        <CartographicMapBackdrop workspaceId="ws-1" />
        <RequestFocusOnce instruction={instruction} />
        <FocusWitness onChange={(focus) => seen.push(focus)} />
      </CartographicProvider>
    );
    return { view, seen };
  }

  it("fits the map to a requested extent, with the shared padding and ceiling", async () => {
    renderWithRequest({
      kind: "bbox",
      bbox: [
        [-121.1, 39.18],
        [-120.98, 39.26],
      ],
    });

    await waitFor(() => expect(cameraCalls).toHaveLength(1));
    expect(cameraCalls[0]).toEqual({
      method: "fitBounds",
      args: [
        [
          [-121.1, 39.18],
          [-120.98, 39.26],
        ],
        { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM, duration: FIT_DURATION_MS },
      ],
    });
  });

  it("eases to a requested point rather than fitting a rectangle of no size", async () => {
    renderWithRequest({ kind: "center", center: [-121.05, 39.22] });

    await waitFor(() => expect(cameraCalls).toHaveLength(1));
    expect(cameraCalls[0]).toEqual({
      method: "easeTo",
      args: [{ center: [-121.05, 39.22], zoom: POINT_FIT_ZOOM, duration: FIT_DURATION_MS }],
    });
  });

  /**
   * VARIED BINDING: a second extent must produce a second, different call. One
   * fixture cannot tell a backdrop that reads the request from one that flies
   * to a rectangle of its own.
   */
  it("flies where the request says, not where it went last time", async () => {
    renderWithRequest({
      kind: "bbox",
      bbox: [
        [-84.6, 39.05],
        [-84.4, 39.2],
      ],
    });

    await waitFor(() => expect(cameraCalls).toHaveLength(1));
    expect(cameraCalls[0].args[0]).toEqual([
      [-84.6, 39.05],
      [-84.4, 39.2],
    ]);
  });

  /**
   * THE REQUEST IS PUT DOWN AFTERWARDS. Left standing it would re-fly the
   * planner on the next effect pass — a theme swap, a payload arriving — which
   * is a map that will not let go of the wheel.
   */
  it("clears the request once it has acted, and does not fly twice", async () => {
    const { seen } = renderWithRequest({
      kind: "bbox",
      bbox: [
        [-121.1, 39.18],
        [-120.98, 39.26],
      ],
    });

    await waitFor(() => expect(cameraCalls).toHaveLength(1));
    await waitFor(() => expect(seen[seen.length - 1]).toBeNull());
    // A request was genuinely observed standing before it was cleared —
    // otherwise "ends up null" is what an unused context field looks like.
    expect(seen.some((focus) => focus !== null)).toBe(true);
    expect(cameraCalls).toHaveLength(1);
  });

  /**
   * A DELIBERATE DESTINATION OUTRANKS THE AUTOMATIC ONE.
   *
   * The backdrop frames the whole workspace once, on the first payload that
   * carries any geometry — and those payloads arrive a beat AFTER mount, which
   * is a beat after the deep link has taken the planner to their layer. Without
   * the focus effect marking that one-shot framing done, the planner would be
   * dropped at their bike network and then yanked out to the whole agency's
   * extent as the projects layer landed. Which would be worse than the original
   * defect, because it would look like the map deciding on its own.
   */
  it("keeps the planner where the request put them when the layer payloads land", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-84.5, 39.1] },
            properties: {},
          },
        ],
      }),
    }) as unknown as typeof fetch;

    renderWithRequest({
      kind: "bbox",
      bbox: [
        [-121.1, 39.18],
        [-120.98, 39.26],
      ],
    });

    await waitFor(() => expect(cameraCalls).toHaveLength(1));
    // Let every layer fetch resolve and its effect run — this is exactly when
    // the one-shot framing would fire.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(cameraCalls).toHaveLength(1);
    expect(cameraCalls[0].args[0]).toEqual([
      [-121.1, 39.18],
      [-120.98, 39.26],
    ]);
  });

  /**
   * ON A ROUTE THAT OWNS ITS OWN MAP THIS BACKDROP DRAWS NOTHING, so a request
   * arriving there cannot be carried out — and must expire rather than queue.
   * A held instruction would fire on some later navigation, long after it meant
   * anything, and take a planner somewhere they never asked to go.
   */
  it("drops a request it cannot carry out instead of hoarding it", async () => {
    pathname = "/explore";

    const { seen } = renderWithRequest({
      kind: "bbox",
      bbox: [
        [-121.1, 39.18],
        [-120.98, 39.26],
      ],
    });

    await waitFor(() => expect(seen[seen.length - 1]).toBeNull());
    expect(cameraCalls).toEqual([]);
  });
});
