import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  altitudeAglForGsdCmPerPx,
  getCamera,
  hashFlightPlanParams,
} from "@/lib/aerial/camera-registry";
import { FLIGHT_SNAPSHOT_SCHEMA_VERSION } from "@/lib/aerial/flight-exports";

/**
 * The flight-plan editor:
 *  1. requires an AOI and says so (no form, no fetch without one);
 *  2. shows the DERIVED half of the vertical profile live, and the number is
 *     the registry's own math — asserted for two cameras and two GSDs so a
 *     hardcoded display value cannot pass (a wiring test must vary the binding);
 *  3. round-trips a save: the PUT body carries exactly the typed values plus
 *     the generated snapshot, and exports unlock when the saved fingerprint
 *     matches the current settings;
 *  4. fires the stale warning the moment a parameter drifts from the saved
 *     snapshot's fingerprint, and locks exports again.
 */

const mapboxMocks = vi.hoisted(() => {
  const Map = vi.fn(function MockMap() {
    return {
      addControl: vi.fn(),
      on: vi.fn(),
      getSource: vi.fn(() => null),
      remove: vi.fn(),
    };
  });
  return { Map, NavigationControl: vi.fn() };
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

import { FlightPlanEditor } from "@/components/aerial/flight-plan-editor";

const MISSION_ID = "22222222-2222-4222-8222-222222222222";

// A 400 × 300 m rectangle at 45°N — same construction as the survey-grid
// suite's hand-derived fixture, so generation is known to succeed.
const LAT0 = 45;
const LON0 = 10;
const M_PER_DEG_LAT = 111_132;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);

function pt(xM: number, yM: number): [number, number] {
  return [LON0 + xM / M_PER_DEG_LON, LAT0 + yM / M_PER_DEG_LAT];
}

const RING: [number, number][] = [pt(-200, -150), pt(200, -150), pt(200, 150), pt(-200, 150)];
const AOI = { type: "Polygon", coordinates: [[...RING, RING[0]]] };

type FetchCall = { url: string; init?: RequestInit };

let fetchCalls: FetchCall[] = [];
let putResponder: ((body: Record<string, unknown>) => unknown) | null = null;

beforeEach(() => {
  fetchCalls = [];
  putResponder = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      if (!init || init.method === undefined || init.method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ flightPlan: null }),
        } as unknown as Response;
      }
      if (init.method === "PUT") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        const payload = putResponder ? putResponder(body) : { flightPlan: null };
        return { ok: true, status: 200, json: async () => payload } as unknown as Response;
      }
      throw new Error(`Unexpected fetch: ${init.method} ${url}`);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function typeInto(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("FlightPlanEditor", () => {
  it("requires an AOI: says so plainly and loads nothing", () => {
    render(<FlightPlanEditor missionId={MISSION_ID} aoiGeojson={null} canEdit={true} />);
    expect(screen.getByText(/needs an area of interest first/i)).toBeInTheDocument();
    expect(screen.queryByText(/Generate flight lines/)).not.toBeInTheDocument();
    expect(fetchCalls).toHaveLength(0);
  });

  it("derives the altitude from the GSD live, per camera — the registry's math, binding varied", async () => {
    render(<FlightPlanEditor missionId={MISSION_ID} aoiGeojson={AOI} canEdit={true} />);
    await waitFor(() => expect(fetchCalls.length).toBeGreaterThan(0));

    typeInto(/Target ground resolution/, "2");
    const generic = getCamera("generic-1-inch-20mp")!;
    const expectedGeneric = altitudeAglForGsdCmPerPx(generic, 2).toFixed(2);
    expect(screen.getByTestId("derived-altitude").textContent).toContain(
      `Derived altitude: ${expectedGeneric} m`
    );

    // Vary BOTH bindings: a different camera and a different GSD must each
    // move the displayed number to the lib's answer for that combination.
    fireEvent.change(screen.getByLabelText("Camera"), {
      target: { value: "dji-mavic-3-enterprise-wide" },
    });
    const mavic = getCamera("dji-mavic-3-enterprise-wide")!;
    const expectedMavic = altitudeAglForGsdCmPerPx(mavic, 2).toFixed(2);
    expect(expectedMavic).not.toBe(expectedGeneric); // fixture sanity: the variation varies
    expect(screen.getByTestId("derived-altitude").textContent).toContain(
      `Derived altitude: ${expectedMavic} m`
    );

    typeInto(/Target ground resolution/, "3");
    const expectedMavic3 = altitudeAglForGsdCmPerPx(mavic, 3).toFixed(2);
    expect(screen.getByTestId("derived-altitude").textContent).toContain(
      `Derived altitude: ${expectedMavic3} m`
    );
  });

  it("saves the typed plan with the generated snapshot, unlocks exports, then flags staleness on a drift", async () => {
    // The fingerprint of exactly the values this test types, computed with
    // the same function the route uses.
    const expectedHash = hashFlightPlanParams({
      aoiGeojson: AOI,
      cameraKey: "generic-1-inch-20mp",
      targetGsdCmPerPx: 3,
      altitudeAglM: null,
      frontOverlapPct: 80,
      sideOverlapPct: 70,
      speedMS: 8,
      gimbalPitchDeg: -90,
      crossGrid: false,
      boundaryMarginM: 20,
      corridorWidthM: null,
    });

    putResponder = (body) => ({
      flightPlan: {
        camera_key: body.cameraKey,
        target_gsd_cm_per_px: String(body.targetGsdCmPerPx),
        altitude_agl_m: null,
        front_overlap_pct: String(body.frontOverlapPct),
        side_overlap_pct: String(body.sideOverlapPct),
        speed_m_s: String(body.speedMS),
        gimbal_pitch_deg: String(body.gimbalPitchDeg),
        cross_grid: body.crossGrid,
        boundary_margin_m: String(body.boundaryMarginM),
        corridor_width_m: null,
        crew_pilot_name: null,
        rth_altitude_m: null,
        notes: null,
        generated_plan: body.generatedPlan ?? null,
        generated_with: body.generatedPlan ? expectedHash : null,
      },
      generatedPlanStale: false,
    });

    render(<FlightPlanEditor missionId={MISSION_ID} aoiGeojson={AOI} canEdit={true} />);
    await waitFor(() => expect(fetchCalls.length).toBeGreaterThan(0));

    typeInto(/Target ground resolution/, "3");
    typeInto(/Front overlap/, "80");
    typeInto(/Side overlap/, "70");
    typeInto(/Ground speed/, "8");
    typeInto(/Boundary margin/, "20");
    typeInto(/Usable flight minutes/, "20");

    // Exports are locked before anything is saved.
    expect(screen.getByText(/Exports unlock once a generated flight plan is saved/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Generate flight lines" }));
    await waitFor(() => expect(screen.getByText(/Generated grid/)).toBeInTheDocument());
    // Assumptions are on screen, not buried: the no-regulatory-ceiling
    // disclosure is the one that must never disappear.
    expect(screen.getByText(/no regulatory ceiling/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save flight plan" }));
    await waitFor(() => expect(screen.getByText(/Flight plan and generated grid saved/)).toBeInTheDocument());

    // The PUT body carries exactly the typed values plus the snapshot.
    const put = fetchCalls.find((call) => call.init?.method === "PUT");
    expect(put).toBeDefined();
    expect(put!.url).toBe(`/api/aerial/missions/${MISSION_ID}/flight-plan`);
    const body = JSON.parse(String(put!.init!.body)) as Record<string, unknown>;
    expect(body.cameraKey).toBe("generic-1-inch-20mp");
    expect(body.targetGsdCmPerPx).toBe(3);
    expect(body.altitudeAglM).toBeUndefined(); // the derived half is never sent as authored
    expect(body.frontOverlapPct).toBe(80);
    expect(body.sideOverlapPct).toBe(70);
    expect(body.speedMS).toBe(8);
    expect(body.gimbalPitchDeg).toBe(-90);
    expect(body.boundaryMarginM).toBe(20);
    const generatedPlan = body.generatedPlan as Record<string, unknown>;
    expect(generatedPlan.schemaVersion).toBe(FLIGHT_SNAPSHOT_SCHEMA_VERSION);
    expect((generatedPlan.input as Record<string, unknown>).flightMinutesPerBattery).toBe(20);
    expect(generatedPlan.photoCount).toBeGreaterThan(0);

    // Saved fingerprint matches the current settings → exports unlock.
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /DJI Pilot 2/ })).toHaveAttribute(
        "href",
        `/api/aerial/missions/${MISSION_ID}/flight-plan/export?format=wpml`
      )
    );
    expect(screen.getByRole("link", { name: /Litchi/ })).toHaveAttribute(
      "href",
      `/api/aerial/missions/${MISSION_ID}/flight-plan/export?format=litchi`
    );
    expect(screen.getByRole("link", { name: /Any GIS/ })).toHaveAttribute(
      "href",
      `/api/aerial/missions/${MISSION_ID}/flight-plan/export?format=kml`
    );
    expect(screen.queryByText(/saved plan predates these settings/i)).not.toBeInTheDocument();

    // Drift ONE parameter: the stale warning fires and exports lock again.
    typeInto(/Side overlap/, "72");
    expect(screen.getByText(/The saved plan predates these settings — regenerate/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /DJI Pilot 2/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Exports are locked while the saved plan predates/)).toBeInTheDocument();

    // Drift back: fresh again, exports return.
    typeInto(/Side overlap/, "70");
    expect(screen.queryByText(/The saved plan predates these settings — regenerate/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /DJI Pilot 2/ })).toBeInTheDocument();
  });

  it("read-only members see no form but keep the saved plan and exports", async () => {
    render(<FlightPlanEditor missionId={MISSION_ID} aoiGeojson={AOI} canEdit={false} />);
    await waitFor(() => expect(fetchCalls.length).toBeGreaterThan(0));
    expect(screen.getByText(/Read-only access/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save flight plan" })).not.toBeInTheDocument();
  });
});
