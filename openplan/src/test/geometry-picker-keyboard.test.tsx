import { render, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      project: vi.fn(() => ({ x: 0, y: 0 })),
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

async function renderPicker(onChange: (g: unknown) => void) {
  vi.resetModules();
  const { GeometryPickerMap } = await import("@/components/engagement/geometry-picker-map");
  const utils = render(<GeometryPickerMap onGeometryChange={onChange} />);
  return utils;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.test-token";
  mapboxMocks.instances.length = 0;
  mapboxMocks.Map.mockClear();
});

afterEach(() => {
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = ORIGINAL_TOKEN;
});

describe("GeometryPickerMap keyboard accessibility (WCAG 2.1.1)", () => {
  it("exposes the map as a single focusable application widget with instructions", async () => {
    const { getByRole } = await renderPicker(() => {});
    const app = getByRole("application");
    expect(app).toHaveAttribute("tabindex", "0");
    expect(app).toHaveAttribute("aria-roledescription", "Interactive drawing map");
    expect(app.getAttribute("aria-label")).toMatch(/point mode/i);
    expect(app).toHaveAttribute("aria-describedby");
    // Mapbox's own keyboard handler is disabled so the widget owns key handling.
    expect(mapboxMocks.instances[0].keyboard.disable).toHaveBeenCalled();
  });

  it("places a point at the map center on Enter", async () => {
    const onChange = vi.fn();
    const { getByRole } = await renderPicker(onChange);
    fireEvent.keyDown(getByRole("application"), { key: "Enter" });
    expect(mapboxMocks.instances[0].getCenter).toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith({ type: "Point", coordinates: [-121.5, 39.25] });
  });

  it("pans with arrow keys and zooms with +/-", async () => {
    const { getByRole } = await renderPicker(() => {});
    const app = getByRole("application");
    const map = mapboxMocks.instances[0];
    fireEvent.keyDown(app, { key: "ArrowUp" });
    fireEvent.keyDown(app, { key: "ArrowRight" });
    fireEvent.keyDown(app, { key: "+" });
    expect(map.panBy).toHaveBeenCalledWith([0, -64]);
    expect(map.panBy).toHaveBeenCalledWith([64, 0]);
    expect(map.zoomIn).toHaveBeenCalled();
  });

  it("builds a line over successive Enters and removes the last vertex on Backspace", async () => {
    const onChange = vi.fn();
    const { getByRole } = await renderPicker(onChange);
    fireEvent.click(getByRole("button", { name: "Line" }));
    const app = getByRole("application");
    fireEvent.keyDown(app, { key: "Enter" });
    fireEvent.keyDown(app, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith({
      type: "LineString",
      coordinates: [
        [-121.5, 39.25],
        [-121.5, 39.25],
      ],
    });
    fireEvent.keyDown(app, { key: "Backspace" });
    // one vertex left → not a valid line → null geometry
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("announces changes through a polite live region", async () => {
    const { getByRole } = await renderPicker(() => {});
    fireEvent.keyDown(getByRole("application"), { key: "Enter" });
    const status = getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status.textContent).toMatch(/placed/i);
  });

  it("re-announces repeat actions with identical wording (live region still mutates)", async () => {
    const { getByRole } = await renderPicker(() => {});
    const app = getByRole("application");
    const status = getByRole("status");
    fireEvent.keyDown(app, { key: "Enter" });
    const first = status.textContent;
    fireEvent.keyDown(app, { key: "Enter" }); // same "Point placed" wording
    const second = status.textContent;
    expect(first).toMatch(/placed/i);
    expect(second).toMatch(/placed/i);
    expect(second).not.toBe(first); // zero-width nonce toggles → DOM changes → SR re-reads
  });

  it("ignores keydowns bubbling from nested controls (e.g. Mapbox zoom buttons)", async () => {
    const onChange = vi.fn();
    const { getByRole } = await renderPicker(onChange);
    const app = getByRole("application");
    const nestedButton = document.createElement("button");
    app.appendChild(nestedButton);
    fireEvent.keyDown(nestedButton, { key: "Enter", bubbles: true });
    // guard: target !== currentTarget → no stray vertex committed
    expect(onChange).not.toHaveBeenCalled();
  });
});
