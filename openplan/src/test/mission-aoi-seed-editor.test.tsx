import { fireEvent, waitFor } from "@testing-library/react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AoiSeedSource } from "@/lib/aerial/aoi-seed";
import { bufferCorridorLineToRing, DEFAULT_CORRIDOR_BUFFER_METERS } from "@/lib/aerial/aoi-seed";

/**
 * Lane E1 — the AOI editor's "Start from the project's area" affordance.
 *
 * What must hold:
 * 1. The affordance appears ONLY when the mission's project contributed seed
 *    shapes; a projectless / geometry-less mission renders the editor exactly
 *    as before.
 * 2. A loaded seed ring round-trips into the saved aoi_geojson (closed ring).
 * 3. The corridor-width field is a live binding: the value typed into it is
 *    the value the buffer runs with — not the default constant.
 */

type MockMap = { keyboard: { disable: ReturnType<typeof vi.fn> }; [k: string]: unknown };

const mapboxMocks = vi.hoisted(() => {
  const instances: MockMap[] = [];
  const Map = vi.fn(function MockMap() {
    const instance = {
      keyboard: { disable: vi.fn() },
      addControl: vi.fn(),
      on: vi.fn(),
      getCanvas: vi.fn(() => ({ setAttribute: vi.fn() })),
      getCenter: vi.fn(() => ({ lng: -100, lat: 40 })),
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

const BOUNDARY_RING: [number, number][] = [
  [-100.02, 40.0],
  [-100.0, 40.0],
  [-100.0, 40.02],
  [-100.02, 40.02],
];

const CORRIDOR_LINE: [number, number][] = [
  [-100.0, 40.0],
  [-99.98, 40.0],
];

const SEED_SOURCES: AoiSeedSource[] = [
  {
    kind: "project_boundary",
    key: "project-boundary",
    label: "Riverbend",
    ring: BOUNDARY_RING,
    notes: ["This boundary has 2 separate parts; the largest part was loaded because the AOI supports a single outer ring."],
  },
  {
    kind: "corridor",
    key: "corridor-c1",
    label: "Main Street",
    line: CORRIDOR_LINE,
  },
];

const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));

async function renderEditor(seedSources?: AoiSeedSource[]) {
  vi.resetModules();
  const { MissionAoiEditor } = await import("@/components/aerial/mission-aoi-editor");
  return render(
    <MissionAoiEditor missionId="mission-1" initialPolygon={null} seedSources={seedSources} />
  );
}

function savedAoiBody(): { aoiGeojson: { type: string; coordinates: [number, number][][] } } {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error("No fetch call recorded");
  const [, init] = call as unknown as [string, { body: string }];
  return JSON.parse(init.body);
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.test-token";
  mapboxMocks.instances.length = 0;
  mapboxMocks.Map.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = ORIGINAL_TOKEN;
  vi.unstubAllGlobals();
});

describe("MissionAoiEditor seeding from project geometry", () => {
  it("shows seed choices only when the project contributed shapes", async () => {
    const bare = await renderEditor(undefined);
    expect(bare.queryByText(/Start from the project's area/)).toBeNull();
    // The plain editor still works: the map widget and Save control render.
    expect(bare.getByRole("application")).toBeInTheDocument();
    expect(bare.getByRole("button", { name: /Save/ })).toBeInTheDocument();
    bare.unmount();

    const empty = await renderEditor([]);
    expect(empty.queryByText(/Start from the project's area/)).toBeNull();
    empty.unmount();

    const seeded = await renderEditor(SEED_SOURCES);
    expect(seeded.getByText(/Start from the project's area/)).toBeInTheDocument();
    expect(seeded.getByText("Project boundary — Riverbend")).toBeInTheDocument();
    expect(seeded.getByText("Corridor — Main Street")).toBeInTheDocument();
  });

  it("round-trips a loaded boundary ring into the saved aoi_geojson, and shows its disclosure", async () => {
    const { getByLabelText, getByRole, getByText } = await renderEditor(SEED_SOURCES);

    fireEvent.change(getByLabelText("Shape"), { target: { value: "project-boundary" } });
    fireEvent.click(getByRole("button", { name: "Load shape" }));

    expect(getByText(/Polygon closed \(4 vertices\)\./)).toBeInTheDocument();
    // The MultiPolygon reduction is disclosed, never silent.
    expect(getByText(/2 separate parts/)).toBeInTheDocument();

    fireEvent.click(getByRole("button", { name: "Save AOI" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(url).toBe("/api/aerial/missions/mission-1");
    expect(init.method).toBe("PATCH");
    expect(savedAoiBody().aoiGeojson).toEqual({
      type: "Polygon",
      coordinates: [[...BOUNDARY_RING, BOUNDARY_RING[0]]],
    });
  });

  it("threads the typed corridor width into the buffer — not the default", async () => {
    const { getByLabelText, getByRole } = await renderEditor(SEED_SOURCES);

    fireEvent.change(getByLabelText("Shape"), { target: { value: "corridor-c1" } });

    const widthField = getByLabelText(/Corridor width/) as HTMLInputElement;
    // The default is the STARTING value the field shows...
    expect(widthField.value).toBe(String(DEFAULT_CORRIDOR_BUFFER_METERS));
    // ...and the planner overrides it.
    fireEvent.change(widthField, { target: { value: "200" } });
    fireEvent.click(getByRole("button", { name: "Load shape" }));
    fireEvent.click(getByRole("button", { name: "Save AOI" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const expectedAt200 = bufferCorridorLineToRing(CORRIDOR_LINE, 200)!.ring;
    const expectedAtDefault = bufferCorridorLineToRing(
      CORRIDOR_LINE,
      DEFAULT_CORRIDOR_BUFFER_METERS
    )!.ring;
    // The two differ, so the next assertion can tell a live binding from a
    // hardcoded default.
    expect(expectedAt200).not.toEqual(expectedAtDefault);
    expect(savedAoiBody().aoiGeojson.coordinates[0]).toEqual([...expectedAt200, expectedAt200[0]]);
  });

  it("refuses a non-positive corridor width instead of guessing one", async () => {
    const { getByLabelText, getByRole, getByText } = await renderEditor(SEED_SOURCES);

    fireEvent.change(getByLabelText("Shape"), { target: { value: "corridor-c1" } });
    fireEvent.change(getByLabelText(/Corridor width/), { target: { value: "0" } });
    fireEvent.click(getByRole("button", { name: "Load shape" }));

    expect(getByText(/greater than zero/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
