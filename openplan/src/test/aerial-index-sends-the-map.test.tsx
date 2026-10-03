import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyFitInstruction, FIT_PADDING, type FitInstruction } from "@/lib/cartographic/geometry-bbox";
import { surfaceBesideTheMapInsets } from "@/components/cartographic/surface-beside-the-map";

/**
 * "Show on map" on the Aerial index, and the camera it moves.
 *
 * The button must switch the mission-areas layer on, because a camera sent to a
 * layer that is off lands on an empty map. On a narrow screen the page panel
 * covers the map, so the button also opens "Read the map". The camera pads its
 * left side by the sidebar's width so the area is not drawn under the panel.
 */

const setLayer = vi.fn();
const requestMapFocus = vi.fn();
const setMapReading = vi.fn();

vi.mock("@/components/cartographic/cartographic-context", () => ({
  useCartographicLayers: () => ({ layers: {}, toggleLayer: vi.fn(), setLayer }),
  useCartographicMapFocus: () => ({ mapFocus: null, requestMapFocus, clearMapFocus: vi.fn() }),
  useCartographicMapReading: () => ({ mapReading: false, setMapReading, toggleMapReading: vi.fn(), hasSelection: false }),
}));

import { AerialMissionShowOnMap } from "@/components/aerial/aerial-mission-show-on-map";

const FOCUS: FitInstruction = { kind: "bbox", bbox: [[-121, 39], [-120.9, 39.1]] };

function narrowScreen(isNarrow: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: isNarrow, media: query }));
}

describe("Show on map", () => {
  beforeEach(() => {
    setLayer.mockClear();
    requestMapFocus.mockClear();
    setMapReading.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("switches the mission layer on and sends the map to the mission's area", () => {
    narrowScreen(false);
    render(<AerialMissionShowOnMap title="Corridor overflight" focus={FOCUS} />);

    fireEvent.click(screen.getByRole("button", { name: "Show Corridor overflight on the map" }));

    expect(setLayer).toHaveBeenCalledWith("aerial", true);
    expect(requestMapFocus).toHaveBeenCalledWith(FOCUS);
    expect(setMapReading).not.toHaveBeenCalled();
  });

  it("opens Read the map on a screen where the page covers the map", () => {
    narrowScreen(true);
    render(<AerialMissionShowOnMap title="Corridor overflight" focus={FOCUS} />);

    fireEvent.click(screen.getByRole("button", { name: "Show Corridor overflight on the map" }));

    expect(setMapReading).toHaveBeenCalledWith(true);
  });
});

describe("the camera leaves room for a sidebar", () => {
  beforeEach(() => vi.stubGlobal("innerWidth", 1440));
  afterEach(() => {
    vi.unstubAllGlobals();
    delete document.body.dataset.surfaceBesideMap;
    document.body.innerHTML = "";
  });

  function place(className: string, rect: Partial<DOMRect>) {
    const element = document.createElement("div");
    element.className = className;
    element.getBoundingClientRect = () => rect as DOMRect;
    document.body.appendChild(element);
  }

  it("measures the panels only when the page sits beside the map", () => {
    place("op-cart-surface", { right: 762 });
    place("op-cart-mapdock", { left: 1184 });
    expect(surfaceBesideTheMapInsets()).toEqual({ left: 0, right: 0 });

    document.body.dataset.surfaceBesideMap = "true";
    expect(surfaceBesideTheMapInsets()).toEqual({ left: 762, right: 256 });
  });

  it("ignores a panel that spans the window, as it does below the breakpoint", () => {
    document.body.dataset.surfaceBesideMap = "true";
    place("op-cart-surface", { right: 1424 });
    place("op-cart-mapdock", { left: 1184 });
    expect(surfaceBesideTheMapInsets()).toEqual({ left: 0, right: 0 });
  });

  it("pads the camera by the panels on each side", () => {
    const map = { easeTo: vi.fn(), fitBounds: vi.fn() };

    applyFitInstruction(map, FOCUS, { left: 762, right: 256 });
    expect(map.fitBounds).toHaveBeenCalledWith(FOCUS.kind === "bbox" ? FOCUS.bbox : null, expect.objectContaining({
      padding: { top: FIT_PADDING, right: FIT_PADDING + 256, bottom: FIT_PADDING, left: FIT_PADDING + 762 },
    }));

    applyFitInstruction(map, { kind: "center", center: [-121, 39] }, { left: 762, right: 256 });
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({
      padding: { top: 0, right: 256, bottom: 0, left: 762 },
    }));
  });
});
