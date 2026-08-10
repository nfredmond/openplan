/**
 * AN EMPTY MAP MUST SAY WHY IT IS EMPTY — the 2026-08-03 review's finding #6,
 * fixed 2026-08-10.
 *
 * Two surfaces rendered NOTHING when the deployment had no usable Mapbox
 * token: the participant map on the public engagement portal (`return null` —
 * a resident silently lost the map, and an unmapped campaign became
 * indistinguishable from a misconfigured deployment), and Explore's map stage
 * (the hook never created the map, leaving a permanently blank pane that
 * reads as broken software). Both now render a notice naming the cause and
 * saying what still works.
 *
 * The env var is read at MODULE scope in both components, so every case here
 * resets the module registry and imports fresh under the env it wants.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/explore",
}));

vi.mock("mapbox-gl", () => {
  const instance = {
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    remove: vi.fn(),
    resize: vi.fn(),
    addControl: vi.fn(),
    isStyleLoaded: vi.fn(() => false),
    getLayer: vi.fn(() => null),
    getSource: vi.fn(() => null),
    getStyle: vi.fn(() => ({ layers: [] })),
  };
  const Map = vi.fn(function MockMap() {
    return instance;
  });
  const ctl = vi.fn(function MockControl() {
    const self = {
      setLngLat: vi.fn(() => self),
      setPopup: vi.fn(() => self),
      setDOMContent: vi.fn(() => self),
      addTo: vi.fn(() => self),
      extend: vi.fn(() => self),
      isEmpty: vi.fn(() => false),
    };
    return self;
  });
  return {
    default: { Map, NavigationControl: ctl, FullscreenControl: ctl, ScaleControl: ctl, Popup: ctl, Marker: ctl, LngLatBounds: ctl, accessToken: "" },
    Map,
    NavigationControl: ctl,
    FullscreenControl: ctl,
    ScaleControl: ctl,
  };
});

const ORIGINAL_ACCESS_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
const ORIGINAL_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

beforeEach(() => {
  vi.resetModules();
  delete process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
});

afterEach(() => {
  cleanup();
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = ORIGINAL_ACCESS_TOKEN;
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN = ORIGINAL_TOKEN;
});

async function importLocationDisplayMap() {
  const componentModule = await import("@/components/engagement/location-display-map");
  return componentModule.LocationDisplayMap;
}

const LOCATED_ITEM = {
  id: "item-1",
  content: "The crossing here floods every winter.",
  latitude: 39.2,
  longitude: -121.1,
  geometry: null,
  support_count: 0,
} as never;

describe("the participant map without a usable token", () => {
  it("tells the resident the map exists and cannot be drawn, and names what still works", async () => {
    const LocationDisplayMap = await importLocationDisplayMap();
    render(<LocationDisplayMap items={[LOCATED_ITEM]} />);

    const notice = screen.getByTestId("engagement-map-unavailable");
    expect(notice).toHaveTextContent("can't be shown");
    expect(notice).toHaveTextContent("no map key configured");
    expect(notice).toHaveTextContent("Commenting and surveys work without it");
    // The operator line names the fix, because "contact your administrator"
    // with no detail is a dead end on a self-hosted product.
    expect(notice).toHaveTextContent("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN");
  });

  it("still renders NOTHING when there is genuinely nothing to map", async () => {
    // The deliberate branch, preserved: a campaign with no located input, no
    // context layers and no failed layer read has no map to be missing, so a
    // notice about one would be an invented claim.
    const LocationDisplayMap = await importLocationDisplayMap();
    const { container } = render(<LocationDisplayMap items={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the real map, not the notice, when a token exists", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.test-token";
    const LocationDisplayMap = await importLocationDisplayMap();
    render(<LocationDisplayMap items={[LOCATED_ITEM]} />);

    expect(screen.queryByTestId("engagement-map-unavailable")).toBeNull();
    expect(screen.getByText("Community Input Map")).toBeInTheDocument();
  });
});

describe("the Explore map stage without a usable token", () => {
  async function importHook() {
    const hookModule = await import("@/app/(app)/explore/_components/use-explore-map-instance");
    return hookModule.useExploreMapInstance;
  }

  it("reports no_token when nothing is configured", async () => {
    const { renderHook } = await import("@testing-library/react");
    const useExploreMapInstance = await importHook();
    const { result } = renderHook(() => useExploreMapInstance());
    expect(result.current.mapUnavailableReason).toBe("no_token");
  });

  it("distinguishes a configured-but-secret token from a missing one", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "sk.secret-token";
    const { renderHook } = await import("@testing-library/react");
    const useExploreMapInstance = await importHook();
    const { result } = renderHook(() => useExploreMapInstance());
    expect(result.current.mapUnavailableReason).toBe("unusable_token");
  });

  it("reports null with a public token, so the notice never covers a working map", async () => {
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.test-token";
    const { renderHook } = await import("@testing-library/react");
    const useExploreMapInstance = await importHook();
    const { result } = renderHook(() => useExploreMapInstance());
    expect(result.current.mapUnavailableReason).toBeNull();
  });

  it("is actually rendered by the workbench — the notice, not just the reason", async () => {
    const { ExploreWorkbench } = await import("@/app/(app)/explore/_components/explore-workbench");
    render(
      <ExploreWorkbench projectPlace={null} openedForProject={null} projectAreaNotice={null} />
    );

    const notice = screen.getByTestId("explore-map-unavailable");
    expect(notice).toHaveTextContent("No map key is configured on this deployment");
    expect(notice).toHaveTextContent("Analyses still run without the basemap");
  });
});
