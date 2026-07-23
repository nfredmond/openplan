import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SafetyWorkspace } from "@/components/safety/safety-workspace";
import type { SafetyIngestSummary } from "@/lib/safety/client-types";

// The map is Mapbox-backed; this suite is about the honesty copy around it.
vi.mock("@/components/safety/safety-crash-map", () => ({
  SafetyCrashMap: () => <div data-testid="safety-crash-map" />,
}));

// Stand in for the shared any-US-place picker so a test can choose a study area
// without driving the TIGERweb search. Buttons mirror the three cases that
// matter: a CA county (lossless county filter), a CA city (bbox only), and an
// out-of-state county (bbox only).
vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: ({
    onCorridorChange,
    onPlaceResolved,
  }: {
    onCorridorChange: (t: string) => void;
    onPlaceResolved?: (p: unknown) => void;
  }) => {
    const poly = JSON.stringify({
      type: "Polygon",
      coordinates: [[[-121.3, 39.1], [-120.0, 39.1], [-120.0, 39.6], [-121.3, 39.6], [-121.3, 39.1]]],
    });
    const pick = (kind: string, geoid: string) => () => {
      onCorridorChange(poly);
      onPlaceResolved?.({ kind, geoid, label: geoid, geojson: JSON.parse(poly), bbox: {} });
    };
    return (
      <div>
        <button onClick={pick("county", "06057")}>pick-ca-county</button>
        <button onClick={pick("city", "0618100")}>pick-ca-city</button>
        <button onClick={pick("county", "48201")}>pick-tx-county</button>
      </div>
    );
  },
}));

/** Choose a study area, since nothing loads until the user picks one. */
function selectStudyArea(which: "ca-county" | "ca-city" | "tx-county" = "ca-county") {
  fireEvent.click(screen.getByText(`pick-${which}`));
}

function ingest(over: Partial<SafetyIngestSummary> = {}): SafetyIngestSummary {
  return {
    id: "ingest-1",
    sourceLabel: "California Crash Reporting System (CCRS)",
    attribution: "California Highway Patrol, CCRS (public domain).",
    coverageState: "ccrs_ca_statewide",
    severityCompleteness: "fatal_injury_only",
    status: "ready",
    crashCount: 1180,
    geocodedCount: 1089,
    truncated: false,
    yearsRequested: [2025],
    fetchError: null,
    createdAt: "2026-07-23T00:00:00.000Z",
    ...over,
  };
}

/** A realistic POST /ingest response. */
function mockIngestResponse(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    json: async () => ({
      ingestId: "ingest-9",
      status: "ready",
      sourceId: "ccrs-ca",
      sourceLabel: "California Crash Reporting System (CCRS)",
      coverageState: "ccrs_ca_statewide",
      severityCompleteness: "kabco_full",
      crashCount: 1180,
      geocodedCount: 1089,
      storedCount: 1089,
      truncated: false,
      yearsCovered: [2025],
      seriousInjuryUpgrades: 33,
      error: null,
      ...over,
    }),
  } as Response;
}

/** Route GETs to the crash list and POSTs to the ingest endpoint. */
function routedFetch(crash = mockCrashResponse(), ingestRes = mockIngestResponse()) {
  return vi.fn(async (url: unknown, init?: RequestInit) =>
    init?.method === "POST" || String(url).includes("/ingest") ? ingestRes : crash
  );
}

function mockCrashResponse(features: unknown[] = [], matchedCount = features.length) {
  return {
    ok: true,
    json: async () => ({
      type: "FeatureCollection",
      features,
      returnedCount: features.length,
      matchedCount,
      truncated: features.length < matchedCount,
      limit: 2000,
    }),
  } as Response;
}

describe("SafetyWorkspace coverage disclosure", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => mockCrashResponse()) as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows reported AND mappable counts, never just the smaller one", async () => {
    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={ingest()} />);
    selectStudyArea();

    await waitFor(() => {
      expect(screen.getByText(/1,180 reported/)).toBeInTheDocument();
    });
    expect(screen.getByText(/1,089 mappable/)).toBeInTheDocument();
  });

  it("explains the ungeocoded crashes that are counted but not plotted", async () => {
    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={ingest()} />);

    await waitFor(() => {
      // 1180 - 1089 = 91 crashes that exist but cannot be mapped.
      expect(screen.getByText(/91 reported crashes have no coordinates/)).toBeInTheDocument();
    });
    expect(screen.getByText(/do not appear on the map/i)).toBeInTheDocument();
  });

  it("discloses that a KSI total cannot be derived from this source", async () => {
    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={ingest()} />);

    await waitFor(() => {
      expect(screen.getByText(/cannot be derived from it/i)).toBeInTheDocument();
    });
  });

  it("states that an empty map is not evidence that no crashes occurred", async () => {
    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={null} />);
    selectStudyArea();

    await waitFor(() => {
      expect(
        screen.getByText(/not evidence that no crashes occurred/i)
      ).toBeInTheDocument();
    });
  });

  it("asks for a study area instead of assuming one, and fetches nothing until then", async () => {
    // Regression guard: this page previously defaulted to a hardcoded Nevada
    // County bbox, which made it useless to every other agency in the country.
    const fetchMock = vi.fn(async () => mockCrashResponse());
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={null} />);

    expect(await screen.findByText(/Choose a study area above/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("discloses that crash coverage is California-only rather than implying nationwide data", async () => {
    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={null} />);
    expect(await screen.findByText(/California-only/i)).toBeInTheDocument();
  });

  it("sends the derived CCRS county code for a California county selection", async () => {
    const fetchMock = routedFetch();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={null} />);
    selectStudyArea("ca-county"); // GEOID 06057 -> Nevada County -> CCRS 29
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    fireEvent.click(screen.getByText(/Retrieve crash data/i));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (c) => String(c[0]).includes("/ingest")
      );
      expect(post).toBeDefined();
      const body = JSON.parse(String((post![1] as RequestInit).body));
      expect(body.countyCode).toBe(29);
      expect(body.bbox.minLon).toBeCloseTo(-121.3);
    });
  });

  it("omits the county code for a city selection, falling back to bbox-only", async () => {
    // A city has no CCRS county code; sending a wrong one would silently filter
    // out real crashes.
    const fetchMock = routedFetch();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={null} />);
    selectStudyArea("ca-city");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    fireEvent.click(screen.getByText(/Retrieve crash data/i));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).includes("/ingest"));
      expect(post).toBeDefined();
      expect(JSON.parse(String((post![1] as RequestInit).body)).countyCode).toBeUndefined();
    });
  });

  it("omits the county code for an out-of-state county", async () => {
    const fetchMock = routedFetch();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={null} />);
    selectStudyArea("tx-county"); // Harris County, TX
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    fireEvent.click(screen.getByText(/Retrieve crash data/i));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).includes("/ingest"));
      expect(post).toBeDefined();
      expect(JSON.parse(String((post![1] as RequestInit).body)).countyCode).toBeUndefined();
    });
  });

  it("explains an out-of-coverage study area rather than showing a bare empty map", async () => {
    render(
      <SafetyWorkspace
        workspaceId="ws-1"
        latestIngest={ingest({ coverageState: "out_of_coverage", status: "no_coverage", crashCount: 0, geocodedCount: 0 })}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/No registered crash source covers this study area/i)).toBeInTheDocument();
    });
  });

  it("surfaces a source outage instead of silently showing nothing", async () => {
    render(
      <SafetyWorkspace
        workspaceId="ws-1"
        latestIngest={ingest({
          status: "failed",
          coverageState: "source_unavailable",
          fetchError: "data.ca.gov unreachable",
          crashCount: 0,
          geocodedCount: 0,
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/data.ca.gov unreachable/)).toBeInTheDocument();
    });
  });

  it("shows a KSI total only when the source could separate serious injury", async () => {
    const features = [
      { type: "Feature", geometry: { type: "Point", coordinates: [-121, 39.2] }, properties: { severity: "fatal" } },
      { type: "Feature", geometry: { type: "Point", coordinates: [-121, 39.2] }, properties: { severity: "severe_injury" } },
      { type: "Feature", geometry: { type: "Point", coordinates: [-121, 39.2] }, properties: { severity: "injury" } },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockCrashResponse(features)) as unknown as typeof fetch
    );

    render(
      <SafetyWorkspace
        workspaceId="ws-1"
        latestIngest={ingest({ severityCompleteness: "kabco_full" })}
      />
    );
    selectStudyArea();

    await waitFor(() => {
      // fatal (1) + serious injury (1) = 2; the plain injury crash is excluded.
      expect(screen.getByText(/2 killed or seriously injured/)).toBeInTheDocument();
    });
  });

  it("shows no KSI figure — not a zero — when serious injury is not separable", async () => {
    // A "0 KSI" here would read as "no serious injuries occurred", which the
    // source cannot support.
    render(
      <SafetyWorkspace
        workspaceId="ws-1"
        latestIngest={ingest({ severityCompleteness: "fatal_injury_only" })}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/cannot be derived from it/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/killed or seriously injured/i)).not.toBeInTheDocument();
  });

  it("survives a malformed ingest response instead of white-screening", async () => {
    // The banner renders these counts directly; an absent field previously threw
    // on .toLocaleString() and took the whole page down.
    vi.stubGlobal(
      "fetch",
      routedFetch(mockCrashResponse(), { ok: true, json: async () => ({}) } as Response) as unknown as typeof fetch
    );

    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={null} />);
    selectStudyArea();
    await waitFor(() => expect(screen.getByText(/Retrieve crash data/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Retrieve crash data/i));

    await waitFor(() => {
      expect(screen.getByText(/0 reported/)).toBeInTheDocument();
    });
  });

  it("uses the severity completeness the ingest actually reported", async () => {
    // Previously hardcoded to fatal_injury_only, so a successful KSI enrichment
    // stayed invisible until a page reload.
    const features = [
      { type: "Feature", geometry: { type: "Point", coordinates: [-121, 39.2] }, properties: { severity: "fatal" } },
      { type: "Feature", geometry: { type: "Point", coordinates: [-121, 39.2] }, properties: { severity: "severe_injury" } },
    ];
    vi.stubGlobal("fetch", routedFetch(mockCrashResponse(features)) as unknown as typeof fetch);

    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={null} />);
    selectStudyArea();
    await waitFor(() => expect(screen.getByText(/Retrieve crash data/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Retrieve crash data/i));

    await waitFor(() => {
      expect(screen.getByText(/2 killed or seriously injured/)).toBeInTheDocument();
    });
  });

  it("reports how many of the matching crashes are actually in view", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockCrashResponse([], 4213)) as unknown as typeof fetch
    );

    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={ingest()} />);
    selectStudyArea();

    await waitFor(() => {
      expect(screen.getByText(/Showing 0 of 4,213 crashes/)).toBeInTheDocument();
    });
  });
});
