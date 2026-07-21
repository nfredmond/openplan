import { act, render, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AoiPolygon } from "@/components/aerial/mission-aoi-editor";

type MockMap = { keyboard: { disable: ReturnType<typeof vi.fn> }; [k: string]: unknown };

const mapboxMocks = vi.hoisted(() => {
  const instances: MockMap[] = [];
  const Map = vi.fn(function MockMap() {
    const instance = {
      keyboard: { disable: vi.fn() },
      addControl: vi.fn(),
      on: vi.fn(),
      getCanvas: vi.fn(() => ({ setAttribute: vi.fn() })),
      getCenter: vi.fn(() => ({ lng: -121.5, lat: 39.25 })),
      panBy: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      isStyleLoaded: vi.fn(() => false),
      getSource: vi.fn(() => null),
      fitBounds: vi.fn(),
      addSource: vi.fn(),
      addLayer: vi.fn(),
      remove: vi.fn(),
    };
    instances.push(instance);
    return instance;
  });
  return { Map, NavigationControl: vi.fn(), instances };
});

vi.mock("mapbox-gl", () => ({
  default: {
    Map: mapboxMocks.Map,
    NavigationControl: mapboxMocks.NavigationControl,
    accessToken: "",
  },
  Map: mapboxMocks.Map,
  NavigationControl: mapboxMocks.NavigationControl,
}));

const ORIGINAL_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

const CLOSED_TRIANGLE: AoiPolygon = {
  type: "Polygon",
  coordinates: [
    [
      [-121.0, 39.0],
      [-121.1, 39.0],
      [-121.05, 39.1],
      [-121.0, 39.0],
    ],
  ],
};

async function renderEditor(initialPolygon: AoiPolygon | null = null) {
  vi.resetModules();
  const { MissionAoiEditor } = await import("@/components/aerial/mission-aoi-editor");
  return render(<MissionAoiEditor missionId="mission-1" initialPolygon={initialPolygon} />);
}

/** The registered map event handler (handlers are bound once at mount). */
function mapHandler(event: string): (payload: unknown) => void {
  const instance = mapboxMocks.instances[0];
  const call = (instance.on as ReturnType<typeof vi.fn>).mock.calls.find(
    ([name]) => name === event
  );
  if (!call) throw new Error(`No ${event} handler registered`);
  return call[1] as (payload: unknown) => void;
}

function liveRegion(): HTMLElement {
  const region = document.querySelector('[aria-live="polite"]');
  if (!region) throw new Error("No polite live region rendered");
  return region as HTMLElement;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.test-token";
  mapboxMocks.instances.length = 0;
  mapboxMocks.Map.mockClear();
});

afterEach(() => {
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = ORIGINAL_TOKEN;
});

describe("MissionAoiEditor keyboard accessibility (WCAG 2.1.1)", () => {
  it("exposes the map as a single focusable application widget with instructions", async () => {
    const { getByRole } = await renderEditor();
    const app = getByRole("application");
    expect(app).toHaveAttribute("tabindex", "0");
    expect(app).toHaveAttribute("aria-roledescription", "Interactive AOI drawing map");
    expect(app).toHaveAttribute("aria-describedby");
    expect(mapboxMocks.instances[0].keyboard.disable).toHaveBeenCalled();
  });

  it("adds vertices at the map center on Enter and closes the polygon with C", async () => {
    const { getByRole, getByText } = await renderEditor();
    const app = getByRole("application");

    fireEvent.keyDown(app, { key: "Enter" });
    expect(getByText(/1 vertex · double-click or press C to close/)).toBeInTheDocument();

    fireEvent.keyDown(app, { key: "Enter" });
    fireEvent.keyDown(app, { key: "Enter" });
    fireEvent.keyDown(app, { key: "c" });
    expect(getByText(/Polygon closed \(3 vertices\)\./)).toBeInTheDocument();
    expect(liveRegion().textContent).toMatch(/closed with 3 vertices/i);
  });

  it("refuses to close with fewer than 3 vertices and announces why", async () => {
    const { getByRole, getByText } = await renderEditor();
    const app = getByRole("application");
    fireEvent.keyDown(app, { key: "Enter" });
    fireEvent.keyDown(app, { key: "C" });
    expect(getByText(/Draw at least 3 vertices/)).toBeInTheDocument();
    expect(liveRegion().textContent).toMatch(/at least 3 vertices/i);
  });

  it("pans with arrow keys, zooms with +/-, undoes with Backspace, clears with Escape", async () => {
    const { getByRole, getByText } = await renderEditor();
    const app = getByRole("application");
    const map = mapboxMocks.instances[0];

    fireEvent.keyDown(app, { key: "ArrowDown" });
    fireEvent.keyDown(app, { key: "ArrowLeft" });
    fireEvent.keyDown(app, { key: "-" });
    expect(map.panBy).toHaveBeenCalledWith([0, 64]);
    expect(map.panBy).toHaveBeenCalledWith([-64, 0]);
    expect(map.zoomOut).toHaveBeenCalled();

    fireEvent.keyDown(app, { key: "Enter" });
    fireEvent.keyDown(app, { key: "Enter" });
    fireEvent.keyDown(app, { key: "Backspace" });
    expect(getByText(/1 vertex · /)).toBeInTheDocument();

    fireEvent.keyDown(app, { key: "Escape" });
    expect(getByText(/Click the map or press Enter to add vertices\./)).toBeInTheDocument();
    expect(liveRegion().textContent).toMatch(/cleared/i);
  });

  it("locks a closed polygon against stray commits until cleared", async () => {
    const { getByRole, getByText } = await renderEditor();
    const app = getByRole("application");
    fireEvent.keyDown(app, { key: "Enter" });
    fireEvent.keyDown(app, { key: "Enter" });
    fireEvent.keyDown(app, { key: "Enter" });
    fireEvent.keyDown(app, { key: "c" });

    fireEvent.keyDown(app, { key: "Enter" });
    expect(getByText(/Polygon is closed\. Clear it/)).toBeInTheDocument();
    expect(getByText(/Polygon closed \(3 vertices\)\./)).toBeInTheDocument();
  });

  it("ignores keydowns bubbling from nested controls (e.g. Mapbox zoom buttons)", async () => {
    const { getByRole, getByText } = await renderEditor();
    const app = getByRole("application");
    const nestedButton = document.createElement("button");
    app.appendChild(nestedButton);
    fireEvent.keyDown(nestedButton, { key: "Enter", bubbles: true });
    expect(getByText(/Click the map or press Enter to add vertices\./)).toBeInTheDocument();
  });

  // Regression: the pre-a11y version registered pointer handlers that closed
  // over `status` from the FIRST render. Editing an existing AOI mounted as
  // "closed", so the stale guard swallowed every later click — even after
  // Clear, the editor was dead to pointer input.
  it("accepts pointer clicks again after clearing an initial polygon (stale-closure regression)", async () => {
    const { getByRole, getByText } = await renderEditor(CLOSED_TRIANGLE);
    expect(getByText(/Polygon closed \(3 vertices\)\./)).toBeInTheDocument();

    const click = mapHandler("click");

    // Closed lock applies to pointer commits too, with an explanation.
    act(() => click({ lngLat: { lng: -121.2, lat: 39.2 } }));
    expect(getByText(/Polygon is closed\. Clear it/)).toBeInTheDocument();

    fireEvent.click(getByRole("button", { name: "Clear" }));
    act(() => click({ lngLat: { lng: -121.2, lat: 39.2 } }));
    expect(getByText(/1 vertex · double-click or press C to close/)).toBeInTheDocument();
  });
});
