import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The mission map, tested where it becomes something a planner sees.
 *
 * The stakes: this is the first surface in the aerial lane that DRAWS held
 * imagery, and a raster painted at the wrong place is a confidently wrong
 * exhibit. So the assertions pin, in order: the loader's refusal sentence
 * reaches the screen verbatim; a bounds rectangle is re-validated at the layer
 * and a hostile one never mounts; a failed photo fetch renders as a failure
 * and never as "no photos"; photos without EXIF GPS are counted out loud; and
 * a deployment with no Mapbox key is told so.
 */

// ── Mapbox double (the rtp-cycle-project-map arrangement) ────────────────────

type Handler = (...args: unknown[]) => void;

const mapboxMocks = vi.hoisted(() => {
  type Instance = {
    handlers: Map<string, Handler[]>;
    layers: Array<{ id: string; type?: string; source?: string }>;
    sources: Record<string, unknown>;
    addSource: ReturnType<typeof vi.fn>;
    addLayer: ReturnType<typeof vi.fn>;
    fitBounds: ReturnType<typeof vi.fn>;
    fire: (event: string, payload?: unknown) => void;
  };
  const instances: Instance[] = [];

  // NOT named `Map`: that would shadow the global Map used for `handlers`
  // below and make every construction recurse into itself.
  const MapCtor = vi.fn(function MockMap() {
    const handlers = new Map<string, Handler[]>();
    const layers: Array<{ id: string; type?: string; source?: string }> = [];
    const sources: Record<string, unknown> = {};
    const instance: Instance & Record<string, unknown> = {
      handlers,
      layers,
      sources,
      on: vi.fn((...args: unknown[]) => {
        const event = args[0] as string;
        const handler = (typeof args[1] === "function" ? args[1] : args[2]) as Handler | undefined;
        if (!handler) return;
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      }),
      addControl: vi.fn(),
      addSource: vi.fn((id: string, spec: unknown) => {
        sources[id] = spec;
      }),
      getSource: vi.fn((id: string) => (id in sources ? { setData: vi.fn() } : undefined)),
      addLayer: vi.fn((layer: { id: string }) => {
        layers.push(layer);
      }),
      getLayer: vi.fn((id: string) => layers.find((layer) => layer.id === id) ?? undefined),
      setLayoutProperty: vi.fn(),
      fitBounds: vi.fn(),
      getCanvas: vi.fn(() => ({ style: {} })),
      remove: vi.fn(),
      fire(event: string, payload?: unknown) {
        for (const handler of handlers.get(event) ?? []) handler(payload);
      },
    };
    instances.push(instance);
    return instance;
  });

  class LngLatBounds {
    private points: Array<[number, number]> = [];
    extend(point: [number, number]) {
      this.points.push(point);
      return this;
    }
    isEmpty() {
      return this.points.length === 0;
    }
  }

  return {
    Map: MapCtor,
    NavigationControl: vi.fn(),
    AttributionControl: vi.fn(),
    LngLatBounds,
    instances,
  };
});

vi.mock("mapbox-gl", () => ({
  default: {
    Map: mapboxMocks.Map,
    NavigationControl: mapboxMocks.NavigationControl,
    AttributionControl: mapboxMocks.AttributionControl,
    LngLatBounds: mapboxMocks.LngLatBounds,
    accessToken: "",
  },
}));

const MISSION_ID = "22222222-2222-4222-8222-222222222222";
const ORIGINAL_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
const ORIGINAL_LEGACY_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const ORIGINAL_FETCH = global.fetch;

const VALID_PREVIEW = {
  url: "https://signed.example/preview.png?token=t",
  bounds: [-120.51, 39.2, -120.49, 39.22] as [number, number, number, number],
  crs: "EPSG:32610",
  pixelSizeM: 0.021,
};

function imageryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "im-1",
    original_filename: "DJI_0001.JPG",
    gps_lat: 39.21,
    gps_lon: -120.5,
    ...overrides,
  };
}

function mockImageryFetch(body: unknown, status = 200) {
  global.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

async function importMap() {
  vi.resetModules();
  return import("@/components/aerial/aerial-mission-map");
}

beforeEach(() => {
  vi.clearAllMocks();
  mapboxMocks.instances.length = 0;
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.test-token";
  delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
});

afterEach(() => {
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = ORIGINAL_TOKEN;
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN = ORIGINAL_LEGACY_TOKEN;
  global.fetch = ORIGINAL_FETCH;
});

describe("photoPointsFromImageryPayload", () => {
  it("reads the imagery route's shape and counts rows without GPS instead of dropping them silently", async () => {
    const { photoPointsFromImageryPayload } = await importMap();
    const { points, withoutLocation } = photoPointsFromImageryPayload({
      imagery: [
        imageryRow(),
        imageryRow({ id: "im-2", gps_lat: null, gps_lon: null }),
        imageryRow({ id: "im-3", gps_lat: 91, gps_lon: 0 }),
      ],
    });
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ id: "im-1", lat: 39.21, lon: -120.5, filename: "DJI_0001.JPG" });
    expect(withoutLocation).toBe(2);
  });

  it("answers empty for a shape it does not recognise rather than throwing", async () => {
    const { photoPointsFromImageryPayload } = await importMap();
    expect(photoPointsFromImageryPayload("nonsense")).toEqual({ points: [], withoutLocation: 0 });
  });
});

describe("validatedPreviewBounds", () => {
  it("passes a plausible rectangle and refuses one no flight could produce", async () => {
    const { validatedPreviewBounds } = await importMap();
    expect(validatedPreviewBounds(VALID_PREVIEW)).toEqual(VALID_PREVIEW.bounds);
    expect(
      validatedPreviewBounds({ ...VALID_PREVIEW, bounds: [-179, -80, 179, 80] })
    ).toBeNull();
    expect(
      validatedPreviewBounds({ ...VALID_PREVIEW, bounds: [-120.49, 39.2, -120.51, 39.22] })
    ).toBeNull();
    expect(validatedPreviewBounds(null)).toBeNull();
  });
});

describe("AerialMissionMap", () => {
  it("mounts the image source at the validated bounds, with the photo dots beside it", async () => {
    mockImageryFetch({ imagery: [imageryRow()] });
    const { AerialMissionMap } = await importMap();

    render(<AerialMissionMap missionId={MISSION_ID} preview={VALID_PREVIEW} previewNotice={null} />);

    await waitFor(() => expect(mapboxMocks.Map).toHaveBeenCalledTimes(1));
    const map = mapboxMocks.instances[0];
    map.fire("load");

    const orthoSpec = map.sources["aerial-mission-ortho-preview"] as {
      type: string;
      url: string;
      coordinates: number[][];
    };
    expect(orthoSpec.type).toBe("image");
    expect(orthoSpec.url).toBe(VALID_PREVIEW.url);
    // Corner order is Mapbox's contract: TL, TR, BR, BL.
    expect(orthoSpec.coordinates).toEqual([
      [-120.51, 39.22],
      [-120.49, 39.22],
      [-120.49, 39.2],
      [-120.51, 39.2],
    ]);
    expect(map.layers.some((layer) => layer.id === "aerial-mission-ortho-preview-layer")).toBe(true);
    expect(map.layers.some((layer) => layer.id === "aerial-mission-photo-points-layer")).toBe(true);
    expect(map.fitBounds).toHaveBeenCalled();
  });

  it("asks the imagery route for THIS mission — and follows the prop", async () => {
    const OTHER_MISSION = "77777777-7777-4777-8777-777777777777";
    mockImageryFetch({ imagery: [] });
    const { AerialMissionMap } = await importMap();

    const first = render(
      <AerialMissionMap missionId={MISSION_ID} preview={null} previewNotice="no preview" />
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<AerialMissionMap missionId={OTHER_MISSION} preview={null} previewNotice="no preview" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

    const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe(`/api/aerial/missions/${MISSION_ID}/imagery`);
    expect(calls[1][0]).toBe(`/api/aerial/missions/${OTHER_MISSION}/imagery`);
  });

  it("refuses to mount a preview whose bounds fail validation, and says so", async () => {
    mockImageryFetch({ imagery: [imageryRow()] });
    const { AerialMissionMap } = await importMap();

    render(
      <AerialMissionMap
        missionId={MISSION_ID}
        preview={{ ...VALID_PREVIEW, bounds: [-179, -80, 179, 80] }}
        previewNotice={null}
      />
    );

    expect(
      await screen.findByText(/reported georeference failed validation/i)
    ).toBeTruthy();

    // The photo dot still earns a map; the hostile rectangle never reaches it.
    await waitFor(() => expect(mapboxMocks.Map).toHaveBeenCalledTimes(1));
    const map = mapboxMocks.instances[0];
    map.fire("load");
    expect(map.sources["aerial-mission-ortho-preview"]).toBeUndefined();
    expect(map.layers.some((layer) => layer.id === "aerial-mission-ortho-preview-layer")).toBe(false);
  });

  it("renders the loader's refusal sentence verbatim", async () => {
    mockImageryFetch({ imagery: [] });
    const { AerialMissionMap } = await importMap();

    render(
      <AerialMissionMap
        missionId={MISSION_ID}
        preview={null}
        previewNotice="An orthomosaic preview is held, but its georeferencing was not reported by the processing worker, so the map cannot place it."
      />
    );

    expect(
      await screen.findByText(/its georeferencing was not reported by the processing worker/i)
    ).toBeTruthy();
    // Nothing to draw: no map instance, and an honest empty state instead.
    expect(await screen.findByText(/Nothing to place on a map yet/i)).toBeTruthy();
    expect(mapboxMocks.Map).not.toHaveBeenCalled();
  });

  it("renders a failed photo read as a failure, never as no photos", async () => {
    mockImageryFetch({ error: "boom" }, 500);
    const { AerialMissionMap } = await importMap();

    render(<AerialMissionMap missionId={MISSION_ID} preview={VALID_PREVIEW} previewNotice={null} />);

    expect(await screen.findByText(/photo locations could not be read/i)).toBeTruthy();
    expect(screen.getByText(/not a finding that this mission has no photos/i)).toBeTruthy();
  });

  it("counts photos with no EXIF location out loud", async () => {
    mockImageryFetch({
      imagery: [imageryRow(), imageryRow({ id: "im-2", gps_lat: null, gps_lon: null })],
    });
    const { AerialMissionMap } = await importMap();

    render(<AerialMissionMap missionId={MISSION_ID} preview={null} previewNotice="np" />);

    expect(await screen.findByText(/no location recorded in the file/i)).toBeTruthy();
  });

  it("tells a deployment with no map key what is missing instead of a blank box", async () => {
    delete process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    mockImageryFetch({ imagery: [imageryRow()] });
    const { AerialMissionMap } = await importMap();

    render(<AerialMissionMap missionId={MISSION_ID} preview={VALID_PREVIEW} previewNotice={null} />);

    expect(await screen.findByText(/No map key is configured on this deployment/i)).toBeTruthy();
    expect(screen.getByText(/NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN/)).toBeTruthy();
    expect(mapboxMocks.Map).not.toHaveBeenCalled();
  });

  it("says where measurement lives, where a user would look for it", async () => {
    mockImageryFetch({ imagery: [] });
    const { AerialMissionMap } = await importMap();

    render(<AerialMissionMap missionId={MISSION_ID} preview={null} previewNotice="np" />);

    expect(
      await screen.findByText(/Measurement is not available on this map yet/i)
    ).toBeTruthy();
  });
});

describe("mission page wiring", () => {
  it("mounts the map and the imagery panel from the mission page (comments stripped first)", async () => {
    // A component nothing mounts is the shipped-invisible defect class. The
    // page is a server component a unit test cannot render cheaply, so this
    // pins the JSX itself — with comments BLANKED so a mount that only exists
    // in prose cannot satisfy it.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { stripSourceComments } = await import("@/test/helpers/source-text");
    const source = stripSourceComments(
      readFileSync(
        join(process.cwd(), "src/app/(app)/aerial/missions/[missionId]/page.tsx"),
        "utf8"
      )
    );

    expect(source).toMatch(/<AerialMissionMap\b/);
    expect(source).toMatch(/<AerialImageryPanel\b/);
    expect(source).toMatch(/loadAerialOrthoPreview\(/);
  });
});
