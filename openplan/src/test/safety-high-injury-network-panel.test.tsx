/**
 * The high-injury network beside the Safety map: the table, the facts stated
 * next to it, the fatal-only label, and attaching countermeasures to a report.
 * Also the map layer, which must sit under the crash points and survive a
 * background switch.
 *
 * Blind category: jsdom has no WebGL or layout. Nothing here proves the purple
 * lines are visible on a real basemap; that needs the browser.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HighInjuryNetworkPanel, type HighInjuryNetworkReportTarget } from "@/components/safety/high-injury-network-panel";
import {
  HIGH_INJURY_NETWORK_PARAMETERS,
  highInjuryNetworkFeatureCollection,
  highInjuryNetworkMarkerCollection,
  type HighInjuryNetwork,
} from "@/lib/safety/high-injury-network";
import { resolvePublicBasemapConfig } from "@/lib/cartographic/basemaps";
import { lastFakeMap, resetFakeMaps } from "@/test/helpers/mapbox-gl-fake";

vi.mock("mapbox-gl", async () => {
  const { createMapboxGlModuleFake } = await import("@/test/helpers/mapbox-gl-fake");
  return createMapboxGlModuleFake();
});
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));

const INGEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function network(basis: "ksi" | "fatal_only" = "ksi"): HighInjuryNetwork {
  return {
    status: "computed",
    basis,
    method: "road_segments",
    years: [2022, 2023, 2024],
    segments: [
      {
        id: "road:0000abcd:0",
        rank: 1,
        tied: true,
        label: "Main Street",
        geometry: { type: "LineString", coordinates: [[-100, 40], [-99.99, 40]] },
        lengthMiles: 0.5,
        crashCount: 3,
        fatalCrashCount: 1,
        seriousInjuryCrashCount: basis === "ksi" ? 2 : null,
        crashesPerMile: 6,
        roadSource: "U.S. Census TIGER/Line roads 2025-01-01",
      },
      {
        id: "road:0000beef:1",
        rank: 1,
        tied: true,
        label: "Oak Avenue",
        geometry: { type: "LineString", coordinates: [[-100, 40.01], [-99.99, 40.01]] },
        lengthMiles: 0.5,
        crashCount: 3,
        fatalCrashCount: 0,
        seriousInjuryCrashCount: basis === "ksi" ? 3 : null,
        crashesPerMile: 6,
        roadSource: "U.S. Census TIGER/Line roads 2025-01-01",
      },
    ],
    crashesConsidered: 10,
    crashesPlaced: 8,
    segmentsWithCrashes: 5,
    roadMilesReviewed: 7.25,
    listedMiles: 1,
    listedCrashes: 6,
    roadSources: ["U.S. Census TIGER/Line roads 2025-01-01"],
    parameters: HIGH_INJURY_NETWORK_PARAMETERS,
  };
}

const REPORTS: HighInjuryNetworkReportTarget[] = [
  { id: "report-a", title: "Plan A", safetyActionPlan: null },
  {
    id: "report-b",
    title: "Plan B",
    safetyActionPlan: {
      ingestId: INGEST_ID,
      attachments: [{ segmentId: "road:0000beef:1", segmentLabel: "Oak Avenue", countermeasureIds: ["walkways"] }],
    },
  },
];

function renderPanel(overrides: Partial<Parameters<typeof HighInjuryNetworkPanel>[0]> = {}) {
  const props: Parameters<typeof HighInjuryNetworkPanel>[0] = {
    network: network(),
    sourceLabel: "Statewide crash file",
    showOnMap: true,
    onShowOnMapChange: vi.fn(),
    onFocusSegment: vi.fn(),
    ingestId: INGEST_ID,
    reports: REPORTS,
    saveRequest: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
  render(<HighInjuryNetworkPanel {...props} />);
  return props;
}

afterEach(() => cleanup());

describe("the ranked table", () => {
  it("opens a compatible report instead of the first unrelated report", () => {
    renderPanel({ reports: [
      { id: "analysis", title: "Analysis", safetyActionPlan: null, supportsSafetyComparison: false },
      { id: "status", title: "Project status", safetyActionPlan: null, supportsSafetyComparison: true },
    ] });
    expect(screen.getByRole("link", { name: "Review No Build, alternatives and applicability in this report" })).toHaveAttribute("href", `/reports/status?safetyComparison=1&safetyIngestId=${INGEST_ID}`);
  });

  it("offers Reports when no comparison-compatible target is known", () => {
    renderPanel();
    expect(screen.queryByRole("link", { name: "Review No Build, alternatives and applicability in this report" })).toBeNull();
    expect(screen.getByRole("link", { name: "Choose or create a project-status report for Safety comparison" })).toHaveAttribute("href", "/reports");
  });

  it("lists sparse requested years and keeps observation coverage unknown", () => {
    const sparse = network();
    if (sparse.status !== "computed") throw new Error("expected a network");
    sparse.years = [2020, 2022, 2024];
    renderPanel({ network: sparse });
    const facts = screen.getByTestId("safety-hin-facts").textContent ?? "";
    expect(facts).toContain("Requested crash years: 2020, 2022, 2024");
    expect(facts).not.toContain("2020–2024");
    expect(facts).toContain("do not establish complete observation coverage or an annual denominator");
  });

  it("states method, years, source and coverage beside the numbers", () => {
    renderPanel();
    expect(screen.getByTestId("safety-hin-measure").textContent).toBe("Fatal and serious-injury crashes per mile");
    const facts = screen.getByTestId("safety-hin-facts").textContent ?? "";
    expect(facts).toContain("Method");
    expect(facts).toContain("about 0.5 mile");
    expect(facts).toContain("2022–2024");
    expect(facts).toContain("Statewide crash file. Road lines: U.S. Census TIGER/Line roads 2025-01-01");
    expect(facts).toContain("8 of 10 fatal or serious-injury crashes");
    expect(facts).toContain("2 are not on this list");

    const rows = screen.getAllByTestId("safety-hin-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("1=");
    expect(rows[0].textContent).toContain("1 / 2");
    expect(rows[0].textContent).toContain("6.0");
  });

  it("labels a fatal-only network at the figure and shows no serious-injury column", () => {
    renderPanel({ network: network("fatal_only") });
    expect(screen.getByTestId("safety-hin-measure").textContent).toBe("Fatal crashes per mile (fatal crashes only)");
    const table = screen.getByTestId("safety-hin-table");
    expect(within(table).getByRole("columnheader", { name: "Fatal" })).toBeTruthy();
    expect(table.textContent).not.toMatch(/serious/i);
    expect(screen.getAllByTestId("safety-hin-row")[0].textContent).not.toContain("/");
  });

  it("says why no network was ranked, with no table", () => {
    renderPanel({ network: { status: "unavailable", reason: "road_read_failed", basis: "ksi" } });
    expect(screen.getByTestId("safety-hin-unavailable").textContent).toMatch(/failed read, not an absence of roads/);
    expect(screen.queryByTestId("safety-hin-table")).toBeNull();
  });

  it("keeps an empty network apart from an unavailable one", () => {
    const empty = network();
    if (empty.status !== "computed") throw new Error("fixture");
    renderPanel({ network: { ...empty, segments: [], crashesConsidered: 0, crashesPlaced: 0, listedCrashes: 0, listedMiles: 0 } });
    expect(screen.getByTestId("safety-hin-empty").textContent).toMatch(/not a finding that the roads are safe/);
    expect(screen.queryByTestId("safety-hin-unavailable")).toBeNull();
    expect(screen.queryByTestId("safety-hin-table")).toBeNull();
  });

  it("toggles the map layer and frames a segment", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByTestId("safety-hin-show-on-map"));
    expect(props.onShowOnMapChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Show Oak Avenue on map" }));
    expect(props.onFocusSegment).toHaveBeenCalledWith(expect.objectContaining({ id: "road:0000beef:1" }));
  });

  it("cites the countermeasure list and marks unverified CMF values", () => {
    renderPanel();
    const list = screen.getByTestId("safety-countermeasure-list");
    expect(list.textContent).toContain("Retrieved 2026-10-13");
    expect(list.textContent).toContain("[VERIFY]");
    expect(within(list).getByRole("link", { name: "Lighting" }).getAttribute("href")).toBe(
      "https://highways.dot.gov/safety/proven-safety-countermeasures/lighting",
    );
  });
});

describe("attaching countermeasures", () => {
  it("saves the chosen countermeasures and the acquisition into the chosen report", async () => {
    const props = renderPanel();
    fireEvent.change(screen.getByLabelText("Save to report"), { target: { value: "report-a" } });
    const row = screen.getAllByTestId("safety-hin-row")[0];
    fireEvent.click(within(row).getByRole("checkbox", { name: "Lighting" }));
    expect(within(row).getByText("Countermeasures (1)")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save 1 segment" }));
    });

    expect(props.saveRequest).toHaveBeenCalledWith("report-a", {
      safetyIngestSelections: [{ ingestId: INGEST_ID }],
      safetyActionPlan: {
        ingestId: INGEST_ID,
        attachments: [{ segmentId: "road:0000abcd:0", segmentLabel: "Main Street", countermeasureIds: ["lighting"] }],
      },
    });
    expect(screen.getByRole("status").textContent).toBe("Saved to Plan A.");
  });

  // KI-2026-11-14-113: REPORTS lists the newer, empty Plan A first, as the
  // Safety page does. The plan for this crash pull lives in Plan B.
  it("opens the report holding this crash pull's plan, not the newest empty one", () => {
    renderPanel();
    expect((screen.getByLabelText("Save to report") as HTMLSelectElement).value).toBe("report-b");
    expect(within(screen.getAllByTestId("safety-hin-row")[1]).getByText("Countermeasures (1)")).toBeTruthy();
    expect(screen.queryByTestId("safety-hin-plan-elsewhere")).toBeNull();
    fireEvent.change(screen.getByLabelText("Save to report"), { target: { value: "report-a" } });
    expect(screen.getByTestId("safety-hin-plan-elsewhere").textContent).toBe("The saved plan is in Plan B. Switch");
    fireEvent.click(within(screen.getByTestId("safety-hin-plan-elsewhere")).getByRole("button", { name: "Switch" }));
    expect((screen.getByLabelText("Save to report") as HTMLSelectElement).value).toBe("report-b");
    expect(within(screen.getAllByTestId("safety-hin-row")[1]).getByText("Countermeasures (1)")).toBeTruthy();
  });

  it("keeps the newest report when no report holds a plan for this crash pull", () => {
    renderPanel({ ingestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    expect((screen.getByLabelText("Save to report") as HTMLSelectElement).value).toBe("report-a");
    expect(screen.queryByTestId("safety-hin-plan-elsewhere")).toBeNull();
  });

  it("starts from the plan already saved in a report for the same acquisition", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Save to report"), { target: { value: "report-b" } });
    const oak = screen.getAllByTestId("safety-hin-row")[1];
    expect(within(oak).getByText("Countermeasures (1)")).toBeTruthy();
    expect((within(oak).getByRole("checkbox", { name: "Walkways" }) as HTMLInputElement).checked).toBe(true);
  });

  it("ignores a saved plan from a different acquisition", () => {
    renderPanel({ ingestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    fireEvent.change(screen.getByLabelText("Save to report"), { target: { value: "report-b" } });
    const oak = screen.getAllByTestId("safety-hin-row")[1];
    expect(within(oak).getByText("Countermeasures (0)")).toBeTruthy();
  });

  it("shows the failure the report route gave", async () => {
    renderPanel({ saveRequest: vi.fn().mockResolvedValue({ ok: false, error: "Workspace access denied" }) });
    fireEvent.change(screen.getByLabelText("Save to report"), { target: { value: "report-a" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save 0 segments" }));
    });
    expect(screen.getByRole("status").textContent).toBe("Workspace access denied");
  });

  it("still saves a plan when no segment is ranked", async () => {
    const empty = network();
    if (empty.status !== "computed") throw new Error("fixture");
    const props = renderPanel({ network: { ...empty, segments: [], crashesConsidered: 0, crashesPlaced: 0, listedCrashes: 0, listedMiles: 0 } });
    fireEvent.change(screen.getByLabelText("Save to report"), { target: { value: "report-a" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save plan with no ranked segments" }));
    });
    expect(props.saveRequest).toHaveBeenCalledWith("report-a", {
      safetyIngestSelections: [{ ingestId: INGEST_ID }],
      safetyActionPlan: { ingestId: INGEST_ID, attachments: [] },
    });
    expect(screen.getByRole("status").textContent).toBe("Saved to Plan A.");
  });

  it("says where to save from when no report is reachable", () => {
    renderPanel({ reports: [] });
    expect(screen.getByTestId("safety-hin-save-unavailable").textContent).toBe("To save countermeasures, open Safety from a project.");
    expect(screen.queryByTestId("safety-hin-save")).toBeNull();
  });

  it("offers to create the report when the project has none, instead of the generic Reports link", () => {
    renderPanel({ reports: [], projectId: "project-1" });
    expect(screen.getByRole("button", { name: "Create safety action plan report" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Choose or create a project-status report for Safety comparison" })).toBeNull();
    expect(screen.queryByTestId("safety-hin-save-unavailable")).toBeNull();
  });

  it("opens Reports for this project when its reports cannot hold the comparison", () => {
    renderPanel({ reports: [{ id: "analysis", title: "Analysis", safetyActionPlan: null, supportsSafetyComparison: false }], projectId: "project-1" });
    expect(screen.getByRole("link", { name: "Choose or create a project-status report for Safety comparison" })).toHaveAttribute("href", "/reports?projectId=project-1");
  });
});

describe("the map layer", () => {
  const BASEMAPS = resolvePublicBasemapConfig({ mapboxToken: "pk.test", env: {} });
  const styleUrl = (id: string) => BASEMAPS.choices.find((choice) => choice.id === id)?.styleUrl ?? "";

  beforeEach(() => {
    vi.resetModules();
    resetFakeMaps();
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-token-for-the-crash-map");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    resetFakeMaps();
  });

  async function renderMap(layer: ReturnType<typeof highInjuryNetworkFeatureCollection> | null) {
    const { SafetyCrashMap } = await import("@/components/safety/safety-crash-map");
    const view = render(
      <SafetyCrashMap collection={null} bbox={null} styleUrl={styleUrl("streets")} highInjuryNetwork={layer} />,
    );
    const map = lastFakeMap();
    act(() => map.loadStyle());
    return { view, map, SafetyCrashMap };
  }

  it("draws the listed segments under the crash points", async () => {
    const layer = highInjuryNetworkFeatureCollection(network());
    const { map } = await renderMap(layer);
    expect(map.sourceData("safety-high-injury-network")).toEqual(layer);
    const ids = map.layerIds();
    expect(ids.indexOf("safety-high-injury-network-line")).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf("safety-high-injury-network-line")).toBeLessThan(ids.indexOf("safety-crash-halo"));
    expect(ids.indexOf("safety-high-injury-network-fill")).toBeLessThan(ids.indexOf("safety-crash-halo"));
  });

  it("puts the segments back after a background switch, and clears them when hidden", async () => {
    const layer = highInjuryNetworkFeatureCollection(network());
    const { view, map, SafetyCrashMap } = await renderMap(layer);
    view.rerender(
      <SafetyCrashMap collection={null} bbox={null} styleUrl={styleUrl("satellite")} highInjuryNetwork={layer} />,
    );
    expect(map.sourceIds()).toEqual([]);
    act(() => map.loadStyle());
    expect(map.sourceData("safety-high-injury-network")).toEqual(layer);

    view.rerender(
      <SafetyCrashMap collection={null} bbox={null} styleUrl={styleUrl("satellite")} highInjuryNetwork={null} />,
    );
    expect(map.sourceData("safety-high-injury-network")).toEqual({ type: "FeatureCollection", features: [] });
  });
});

/** Three half-mile squares with one fatal crash each: every row ties. */
function tiedSquares(): HighInjuryNetwork {
  const square = (index: number) => {
    const west = -116.1 + index * 0.05;
    return {
      id: `grid:${index}:1`,
      rank: 1,
      tied: true,
      label: `Half-mile square, road name unavailable (41.99000, ${(west + 0.005).toFixed(5)})`,
      geometry: { type: "Polygon" as const, coordinates: [[[west, 41.985], [west + 0.01, 41.985], [west + 0.01, 41.995], [west, 41.995], [west, 41.985]]] as [number, number][][] },
      lengthMiles: null,
      crashCount: 1,
      fatalCrashCount: 1,
      seriousInjuryCrashCount: null,
      crashesPerMile: null,
      roadSource: null,
    };
  };
  return {
    status: "computed", basis: "fatal_only", method: "grid_cells", years: [2022, 2023],
    segments: [square(0), square(1), square(2)],
    crashesConsidered: 3, crashesPlaced: 3, segmentsWithCrashes: 3, roadMilesReviewed: null, listedMiles: null,
    listedCrashes: 3, roadSources: [], parameters: HIGH_INJURY_NETWORK_PARAMETERS,
  };
}

/** Two road pieces with different rates: an ordered list. */
function orderedRoads(): HighInjuryNetwork {
  const base = network("fatal_only");
  if (base.status !== "computed") throw new Error("fixture");
  return {
    ...base,
    segments: [
      { ...base.segments[0], rank: 1, tied: false, crashesPerMile: 6 },
      { ...base.segments[1], rank: 2, tied: false, crashCount: 2, crashesPerMile: 4 },
    ],
  };
}

describe("ties and grid squares (D20)", () => {
  it("says in one line that an all-tied list is not a ranking", () => {
    renderPanel({ network: tiedSquares(), reports: [REPORTS[0]] });
    expect(screen.getByTestId("safety-hin-tie").textContent).toBe("All 3 listed squares are tied at rank 1, so this list is not a ranking.");
  });

  it("prints no tie line when the list has an order", () => {
    renderPanel({ network: orderedRoads(), reports: [REPORTS[0]] });
    expect(screen.queryByTestId("safety-hin-tie")).toBeNull();
    expect(screen.getByRole("button", { name: "Save 0 segments" })).toBeInTheDocument();
  });

  it("counts squares, not segments, on the save button", () => {
    renderPanel({ network: tiedSquares(), reports: [REPORTS[0]] });
    expect(screen.getByRole("button", { name: "Save 0 squares" })).toBeInTheDocument();
    const firstRow = screen.getAllByTestId("safety-hin-row")[0];
    fireEvent.click(within(firstRow).getAllByRole("checkbox")[0]);
    expect(screen.getByRole("button", { name: "Save 1 square" })).toBeInTheDocument();
  });
});

describe("the network markers (D7)", () => {
  const BASEMAPS = resolvePublicBasemapConfig({ mapboxToken: "pk.test", env: {} });

  beforeEach(() => {
    vi.resetModules();
    resetFakeMaps();
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "pk.test-token-for-the-crash-map");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    resetFakeMaps();
  });

  it("marks every listed segment at county zoom, under the crash points", async () => {
    const layer = highInjuryNetworkFeatureCollection(tiedSquares());
    const { SafetyCrashMap } = await import("@/components/safety/safety-crash-map");
    render(<SafetyCrashMap collection={null} bbox={null} styleUrl={BASEMAPS.choices[0]?.styleUrl ?? ""} highInjuryNetwork={layer} />);
    const map = lastFakeMap();
    act(() => map.loadStyle());
    const markers = map.sourceData("safety-high-injury-network-marker") as ReturnType<typeof highInjuryNetworkMarkerCollection>;
    expect(markers.features).toHaveLength(3);
    const [lon, lat] = markers.features[0].geometry.coordinates;
    expect(markers.features[0].geometry.type).toBe("Point");
    expect(lon).toBeCloseTo(-116.095, 9);
    expect(lat).toBeCloseTo(41.99, 9);
    const ids = map.layerIds();
    expect(ids.indexOf("safety-high-injury-network-marker")).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf("safety-high-injury-network-marker")).toBeLessThan(ids.indexOf("safety-crash-halo"));
    // Drawn at the zooms a county opens on, before the lines are wide enough.
    const paint = (map.getLayer("safety-high-injury-network-marker") as { spec: { paint: Record<string, unknown> } }).spec.paint;
    expect(paint["circle-radius"]).toEqual(["interpolate", ["linear"], ["zoom"], 5, 8, 13, 6]);
    expect(paint["circle-opacity"]).toEqual(["interpolate", ["linear"], ["zoom"], 12, 0.85, 14, 0]);
  });

  it("puts a road piece's marker on the line itself", () => {
    const markers = highInjuryNetworkMarkerCollection(highInjuryNetworkFeatureCollection(network()));
    expect(markers.features.map((feature) => feature.geometry.coordinates)).toEqual([[-99.99, 40], [-99.99, 40.01]]);
  });
});
