import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { PlaceOfRecord } from "@/lib/geographies/place-of-record";

/**
 * A CORRIDOR RUN CARRIES ITS PLACE IDENTITY, OR NONE.
 *
 * The analysis route chooses the crash source by the corridor's state, and it
 * can learn the state only from a place identity it re-resolves. This mounts
 * the real `ExploreWorkbench`, opens it on a project's study area and presses
 * Run, then reads the request body. A searched county must send its kind and
 * GEOID; a drawn project area must send nothing, so the route treats its state
 * as unknown. Neither may send a state.
 *
 * Blind category: the picker's own search path is covered by
 * study-area-picker.test.tsx; this covers the inherited area and the hand-off
 * to the request. The server-side check is in analysis-route-grounding.test.ts.
 */

type MockMapInstance = { handlers: Map<string, Array<(...args: unknown[]) => void>> } & Record<string, Mock>;

const mapboxMocks = vi.hoisted(() => {
  const instances: unknown[] = [];
  const MapCtor = vi.fn(function MockMapboxMap() {
    const handlers = new globalThis.Map<string, Array<(...args: unknown[]) => void>>();
    const instance: Record<string, unknown> = { handlers };
    const chain = () => instance;
    Object.assign(instance, {
      resize: vi.fn(),
      remove: vi.fn(),
      on: vi.fn((type: string, ...rest: unknown[]) => {
        const listener = rest.at(-1) as (...args: unknown[]) => void;
        if (typeof listener === "function") handlers.set(type, [...(handlers.get(type) ?? []), listener]);
        return instance;
      }),
      off: vi.fn(chain),
      once: vi.fn((_type: string, listener: (...args: unknown[]) => void) => {
        listener();
        return instance;
      }),
      addControl: vi.fn(),
      getSource: vi.fn(() => undefined),
      getLayer: vi.fn(() => undefined),
      getStyle: vi.fn(() => ({ layers: [] })),
      addSource: vi.fn(),
      addLayer: vi.fn(chain),
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
      moveLayer: vi.fn(),
      setPaintProperty: vi.fn(),
      setLayoutProperty: vi.fn(),
      setFilter: vi.fn(),
      isStyleLoaded: vi.fn(() => true),
      getBounds: vi.fn(() => ({ getWest: () => -120, getSouth: () => 39, getEast: () => -119, getNorth: () => 40 })),
      getCanvas: vi.fn(() => ({ style: {} })),
      queryRenderedFeatures: vi.fn(() => []),
      fitBounds: vi.fn(),
      easeTo: vi.fn(),
      flyTo: vi.fn(),
    });
    instances.push(instance);
    return instance;
  });
  return { Map: MapCtor, instances };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/explore",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("mapbox-gl", () => ({
  default: {
    AttributionControl: class {},
    Map: mapboxMocks.Map,
    FullscreenControl: vi.fn(),
    NavigationControl: vi.fn(),
    ScaleControl: vi.fn(),
    accessToken: "",
  },
  FullscreenControl: vi.fn(),
  NavigationControl: vi.fn(),
  ScaleControl: vi.fn(),
}));

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

const BOUNDARY = {
  type: "Polygon" as const,
  coordinates: [[[-120, 39], [-119, 39], [-119, 40], [-120, 40], [-120, 39]]],
};
const BOUNDARY_BBOX = { minLon: -120, minLat: 39, maxLon: -119, maxLat: 40 };

/** Synthetic places of record. Only their shape matters to the code. */
const SEARCHED_COUNTY: PlaceOfRecord = {
  source: "tigerweb",
  kind: "county",
  ref: "32031",
  label: "Fixture County",
  countryCode: "US",
  subdivisionCode: "NV",
  bbox: BOUNDARY_BBOX,
  geometry: BOUNDARY,
};
const DRAWN_AREA: PlaceOfRecord = {
  ...SEARCHED_COUNTY,
  source: "drawn",
  kind: null,
  ref: null,
  countryCode: null,
  subdivisionCode: null,
};

let analysisBodies: Array<Record<string, unknown>> = [];

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function installFetch() {
  analysisBodies = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("/api/workspaces/current")) {
      return jsonResponse({ workspaceId: "11111111-1111-4111-8111-111111111111", name: "Test RTPA", role: "admin" });
    }
    if (url === "/api/analysis") {
      analysisBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      // The body is the finding; the response only has to end the run.
      return jsonResponse({ error: "stopped by test" }, 500);
    }
    return jsonResponse({}, 404);
  }) as unknown as typeof global.fetch;
}

async function runFrom(projectPlace: PlaceOfRecord): Promise<Record<string, unknown>> {
  vi.resetModules();
  installFetch();
  const { CartographicProvider } = await import("@/components/cartographic/cartographic-context");
  const { ExploreWorkbench } = await import("@/app/(app)/explore/_components/explore-workbench");

  render(
    <CartographicProvider>
      <ExploreWorkbench projectPlace={projectPlace} openedForProject={null} projectAreaNotice={null} />
    </CartographicProvider>,
  );
  const instance = mapboxMocks.instances.at(-1) as MockMapInstance | undefined;
  await act(async () => {
    for (const listener of instance?.handlers.get("load") ?? []) listener();
  });

  fireEvent.click(await screen.findByRole("button", { name: /Set up the analysis/ }));
  fireEvent.change(await screen.findByPlaceholderText(/Example: Evaluate transit accessibility/), {
    target: { value: "Where are the safety problems on this corridor?" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  fireEvent.click(await screen.findByRole("button", { name: "Run the analysis" }));

  await waitFor(() => expect(analysisBodies).toHaveLength(1));
  return analysisBodies[0];
}

describe("an Explore run hands the route its place identity", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.test-token-for-place-identity";
    mapboxMocks.instances.length = 0;
    mapboxMocks.Map.mockClear();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_TOKEN === undefined) delete process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    else process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = ORIGINAL_TOKEN;
    vi.clearAllMocks();
  });

  it("sends a searched county's kind and GEOID with the corridor, and no state", async () => {
    const body = await runFrom(SEARCHED_COUNTY);
    expect(body.corridorGeojson).toEqual(BOUNDARY);
    expect(body.place).toEqual({ kind: "county", geoid: "32031" });
    expect(JSON.stringify(body)).not.toMatch(/stateFips|subdivision/);
  });

  it("sends no place for a drawn area, so the route treats its state as unknown", async () => {
    const body = await runFrom(DRAWN_AREA);
    expect(body.corridorGeojson).toEqual(BOUNDARY);
    expect(body).not.toHaveProperty("place");
  });
});
