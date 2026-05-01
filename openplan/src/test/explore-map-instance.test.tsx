import { render } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

type MockMapInstance = {
  resize: Mock;
  remove: Mock;
  on: Mock;
  addControl: Mock;
  getSource: Mock;
  getLayer: Mock;
  getStyle: Mock;
  addSource: Mock;
  addLayer: Mock;
};

const ORIGINAL_MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
const ORIGINAL_LEGACY_MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

const mapboxMocks = vi.hoisted(() => {
  const instances: MockMapInstance[] = [];
  const Map = vi.fn(function MockMapboxMap() {
    const instance: MockMapInstance = {
      resize: vi.fn(),
      remove: vi.fn(),
      on: vi.fn(),
      addControl: vi.fn(),
      getSource: vi.fn(() => null),
      getLayer: vi.fn(() => null),
      getStyle: vi.fn(() => ({ layers: [] })),
      addSource: vi.fn(),
      addLayer: vi.fn(),
    };
    instances.push(instance);
    return instance;
  });

  return {
    FullscreenControl: vi.fn(),
    Map,
    NavigationControl: vi.fn(),
    ScaleControl: vi.fn(),
    instances,
  };
});

vi.mock("mapbox-gl", () => ({
  default: {
    Map: mapboxMocks.Map,
    accessToken: "",
  },
  FullscreenControl: mapboxMocks.FullscreenControl,
  NavigationControl: mapboxMocks.NavigationControl,
  ScaleControl: mapboxMocks.ScaleControl,
}));

async function renderExploreMapInstance() {
  vi.resetModules();
  const { useExploreMapInstance } = await import(
    "@/app/(app)/explore/_components/use-explore-map-instance"
  );

  function TestExploreMapInstance() {
    const { mapContainerRef } = useExploreMapInstance();
    return <div data-testid="explore-map-container" ref={mapContainerRef} />;
  }

  return render(<TestExploreMapInstance />);
}

describe("useExploreMapInstance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mapboxMocks.instances.length = 0;
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.test-public-token";
    delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = ORIGINAL_MAPBOX_TOKEN;
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = ORIGINAL_LEGACY_MAPBOX_TOKEN;
    document.body.innerHTML = "";
  });

  it("cancels the delayed resize when the map unmounts before the timer fires", async () => {
    const { unmount } = await renderExploreMapInstance();

    expect(mapboxMocks.Map).toHaveBeenCalledTimes(1);
    const map = mapboxMocks.instances[0];

    unmount();

    act(() => {
      vi.advanceTimersByTime(181);
    });

    expect(map.remove).toHaveBeenCalledTimes(1);
    expect(map.resize).not.toHaveBeenCalled();
  });
});
