import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SafetyWorkspace } from "@/components/safety/safety-workspace";
import { ingestCrashesForStudyArea } from "@/lib/safety/ingest";
import type { SafetyIngestSummary } from "@/lib/safety/client-types";
import type { CrashRecord } from "@/lib/safety/sources/types";
import { findReadOnlyOnlyStudyArea } from "./helpers/crash-coverage-probe";

// The map is Mapbox-backed; this suite is about the honesty copy around it.
vi.mock("@/components/safety/safety-crash-map", () => ({
  // The real module also exports the z-order anchor the workspace hands to
  // `useWorkspaceGisMapBinding`. A factory mock replaces the WHOLE module, so
  // omitting it makes the import `undefined` and the render throws — which is
  // how a stub silently becomes the thing under test.
  safetyWorkspaceGisAnchorLayerId: () => undefined,
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
    const ring = (west: number, south: number) =>
      JSON.stringify({
        type: "Polygon",
        coordinates: [
          [
            [west, south],
            [west + 1, south],
            [west + 1, south + 0.5],
            [west, south + 0.5],
            [west, south],
          ],
        ],
      });
    const poly = ring(-121.3, 39.1);
    const pick = (kind: string, geoid: string, shape = poly) => () => {
      onCorridorChange(shape);
      onPlaceResolved?.({ kind, geoid, label: geoid, geojson: JSON.parse(shape), bbox: {} });
    };
    return (
      <div>
        <button onClick={pick("county", "06057")}>pick-ca-county</button>
        <button onClick={pick("city", "0618100")}>pick-ca-city</button>
        <button onClick={pick("county", "48201")}>pick-tx-county</button>
        {/* A DIFFERENT boundary, for proving that changing the study area
            discards a live read rather than replotting it on new ground. */}
        <button onClick={pick("county", "39049", ring(-83.2, 39.8))}>pick-far-county</button>
      </div>
    );
  },
}));

/** Choose a study area, since nothing loads until the user picks one. */
function selectStudyArea(
  which: "ca-county" | "ca-city" | "tx-county" | "far-county" = "ca-county"
) {
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

function mockCrashResponse(
  features: unknown[] = [],
  matchedCount = features.length,
  undrawableCount = 0
) {
  return {
    ok: true,
    json: async () => ({
      type: "FeatureCollection",
      features,
      returnedCount: features.length,
      matchedCount,
      undrawableCount,
      truncated: features.length + undrawableCount < matchedCount,
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
      // Scoped to the header pairing. The geocoding disclosure below also names
      // the reported total, and a bare /1,180 reported/ would now match both.
      expect(screen.getByText(/1,180 reported ·/)).toBeInTheDocument();
    });
    expect(screen.getByText(/1,089 mappable/)).toBeInTheDocument();
  });

  it("computes the geocoded share from THIS extract, not from a constant", async () => {
    // The geocoded share is wildly local — 77.7% statewide and 99.6% in one
    // rural county of the same state, probed the same day — so a constant in
    // the caveat would describe almost no real acquisition correctly. Both
    // counts are already on the acquisition row; the sentence is computed.
    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={ingest()} />);

    await waitFor(() => {
      // 1180 - 1089 = 91 crashes that exist but cannot be mapped, 92.3% mapped.
      expect(
        screen.getByText(/91 of the 1,180 reported crashes in this retrieval carry no coordinates/)
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/92\.3% were mapped/)).toBeInTheDocument();
    expect(screen.getByText(/do not appear on the map/i)).toBeInTheDocument();
  });

  it("says nothing about geocoding when nothing was dropped", async () => {
    // A disclosure that fires on every acquisition trains a reader to skip it.
    render(
      <SafetyWorkspace
        workspaceId="ws-1"
        latestIngest={ingest({ crashCount: 1180, geocodedCount: 1180 })}
      />
    );
    await waitFor(() => expect(screen.getByText(/1,180 reported ·/)).toBeInTheDocument());
    expect(screen.queryByText(/carry no coordinates/i)).toBeNull();
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

  it("promises to name the source or the gap, without naming a jurisdiction up front", async () => {
    // This sentence used to read "crash coverage is currently California-only",
    // which was a hardcoded jurisdiction in UI copy AND — once the national
    // read-only adapter became reachable from this page — false. Which sources
    // cover a place is the registry's answer, given per study area.
    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={null} />);
    const intro = await screen.findByText(/Choose a study area above/i);
    expect(intro).toHaveTextContent(/names the source that covers your study area/i);
    expect(intro).toHaveTextContent(/tells you plainly when nothing covers it/i);
    expect(intro.textContent ?? "").not.toMatch(/California/i);
  });

  it("sends the derived CCRS county code for a California county selection", async () => {
    const fetchMock = routedFetch();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={null} />);
    selectStudyArea("ca-county"); // GEOID 06057 -> Nevada County -> CCRS 29
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /Retrieve crash data/i }));
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

    fireEvent.click(screen.getByRole("button", { name: /Retrieve crash data/i }));
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

    fireEvent.click(screen.getByRole("button", { name: /Retrieve crash data/i }));
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
        latestIngest={ingest({
          coverageState: "out_of_coverage",
          status: "no_coverage",
          crashCount: 0,
          geocodedCount: 0,
          checkedSourceLabels: ["Source A", "Source B"],
        })}
      />
    );

    await waitFor(() => {
      // Scoped to what was CHECKED. The old sentence claimed no *registered*
      // source covered the area, which the read-only registry routinely refuted.
      expect(
        screen.getByText(/none of the crash sources checked for this study area covers it/i)
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/Sources checked for this study area: Source A, Source B/i)).toBeInTheDocument();
    expect(screen.getByText(/not evidence that no crashes occurred/i)).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByRole("button", { name: /Retrieve crash data/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Retrieve crash data/i }));

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
    await waitFor(() => expect(screen.getByRole("button", { name: /Retrieve crash data/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Retrieve crash data/i }));

    await waitFor(() => {
      expect(screen.getByText(/2 killed or seriously injured/)).toBeInTheDocument();
    });
  });

  /**
   * THE PATH TO THE UNIT.
   *
   * The response driving these tests is NOT hand-written. It is produced by
   * calling the real `ingestCrashesForStudyArea` against a study area SEARCHED
   * for with the registry's own `covers()` predicates — a place a registered
   * adapter serves but `safety_crashes.source_id` will not admit. A described
   * fixture would only prove the renderer; this proves the shape the server
   * actually emits arrives on screen.
   */
  async function realReadOnlyResponse(records: CrashRecord[]) {
    const probe = findReadOnlyOnlyStudyArea();
    expect(probe, "no read-only crash source covers anywhere — the lane is unreachable").not.toBeNull();

    const spy = vi.spyOn(probe!.adapter, "fetch").mockResolvedValue({
      records,
      matchedTotal: records.length + 3, // some reported crashes are ungeocoded
      geocodedTotal: records.length,
      yearsCovered: [2024],
      truncated: false,
    });

    const service = {
      from: () => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: "i" }, error: null }) }) }),
        update: () => ({ eq: async () => ({ error: null }) }),
        upsert: async () => ({ error: null }),
      }),
    };

    const result = await ingestCrashesForStudyArea({
      service: service as never,
      workspaceId: "ws-1",
      bbox: probe!.bbox,
      years: [2024, 2023],
    });
    spy.mockRestore();

    expect(result.status, "the lane did not produce a read-only result to render").toBe("read_only");
    return { ok: true, json: async () => result } as Response;
  }

  function liveRecord(over: Partial<CrashRecord> = {}): CrashRecord {
    return {
      externalId: "case-1",
      collisionDate: "2024-05-06",
      collisionYear: 2024,
      severity: "fatal",
      killedCount: 1,
      injuredCount: 0,
      pedestrianInvolved: false,
      bicyclistInvolved: false,
      motorcyclistInvolved: false,
      collisionType: "rear_end",
      lighting: "daylight",
      weather: "clear",
      sourceAttributes: {},
      latitude: 1,
      longitude: 2,
      ...over,
    };
  }

  it("renders live crashes for an area no storable source covers, and says they were not saved", async () => {
    const response = await realReadOnlyResponse([liveRecord({ externalId: "a" }), liveRecord({ externalId: "b" })]);
    const fetchMock = routedFetch(mockCrashResponse(), response);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={null} />);
    selectStudyArea("tx-county");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Retrieve crash data/i }));

    // The counts the source reported, both of them.
    await waitFor(() => expect(screen.getByText(/5 reported/)).toBeInTheDocument());
    // Reported AND mappable, both, in the coverage banner — three of the five
    // crashes the source reported carry no coordinates and cannot be plotted.
    expect(screen.getByText(/5 reported/)).toHaveTextContent(/2 mappable/);
    // The points are on screen…
    expect(screen.getByText(/Showing 2 of 2 mappable crashes from this live read/i)).toBeInTheDocument();
    // …and the page says what they are NOT.
    expect(screen.getByText(/Live read — not saved/i)).toBeInTheDocument();
    expect(screen.getByText(/were not saved into this workspace/i)).toBeInTheDocument();
  });

  it("does not claim an acquisition happened when nothing was stored", async () => {
    // A live read writes no `safety_crash_ingests` row, so an entry in the
    // acquisition history would send a planner looking for data no table holds.
    const response = await realReadOnlyResponse([liveRecord()]);
    vi.stubGlobal("fetch", routedFetch(mockCrashResponse(), response) as unknown as typeof fetch);

    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={null} />);
    selectStudyArea("tx-county");
    await waitFor(() => expect(screen.getByRole("button", { name: /Retrieve crash data/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Retrieve crash data/i }));

    await waitFor(() => expect(screen.getByText(/Live read — not saved/i)).toBeInTheDocument());
    expect(screen.queryByLabelText(/Acquisition history/i)).not.toBeInTheDocument();
  });

  it("shows no KSI figure for a fatality census, and says why", async () => {
    // Every record from a fatality census is fatal, so a naive KSI would equal
    // the fatal count and read as "no serious injuries occurred" — from a source
    // that never recorded an injury.
    //
    // WHAT THIS TEST PROVES, precisely: the fatality-census caveat renders and
    // no KSI figure appears. Deleting the caveat fails it. It does NOT isolate
    // the `activeCompleteness` expression — mutating that to read the stale
    // acquisition's `kabco_full` left this green, because the KSI block lives
    // inside the acquisition branch of the banner and a live read renders the
    // other branch. The protection there is structural, not conditional.
    const response = await realReadOnlyResponse([liveRecord({ externalId: "a" })]);
    vi.stubGlobal("fetch", routedFetch(mockCrashResponse(), response) as unknown as typeof fetch);

    render(
      // A stale CCRS acquisition is deliberately present, so a regression that
      // let it describe the live points would have something to describe.
      <SafetyWorkspace workspaceId="ws-1" latestIngest={ingest({ severityCompleteness: "kabco_full" })} />
    );
    selectStudyArea("tx-county");
    await waitFor(() => expect(screen.getByRole("button", { name: /Retrieve crash data/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Retrieve crash data/i }));

    await waitFor(() => expect(screen.getByText(/fatality census/i)).toBeInTheDocument());
    expect(screen.queryByText(/killed or seriously injured/i)).not.toBeInTheDocument();
  });

  it("keeps the severity and mode filters live for crashes that never touched the database", async () => {
    const response = await realReadOnlyResponse([
      liveRecord({ externalId: "a", pedestrianInvolved: true }),
      liveRecord({ externalId: "b" }),
    ]);
    vi.stubGlobal("fetch", routedFetch(mockCrashResponse(), response) as unknown as typeof fetch);

    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={null} />);
    selectStudyArea("tx-county");
    await waitFor(() => expect(screen.getByRole("button", { name: /Retrieve crash data/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Retrieve crash data/i }));

    await waitFor(() => expect(screen.getByText(/Showing 2 of 2 mappable/i)).toBeInTheDocument());

    // The generated filter panel, driven the way a planner drives it. The
    // control is the one `CRASH_FILTER_FACETS` produced — nothing in this test
    // names a facet the component invented locally, because the component no
    // longer has any local facets to invent.
    fireEvent.click(screen.getByRole("button", { name: /^Pedestrian/ }));

    await waitFor(() => expect(screen.getByText(/Showing 1 of 2 mappable/i)).toBeInTheDocument());
  });

  it("disables a facet the covering source has no field for, and says why", async () => {
    // NOT A DESCRIBED FIXTURE. The coverage declaration here comes from the REAL
    // adapter the real registry resolves for an area only a read-only source
    // covers — a fatality census, which records no lighting at all. Left
    // enabled, the control would return nothing, and nothing on a safety screen
    // reads as "no crash in this corridor happened after dark". That is a claim
    // about a road built on a missing column.
    const response = await realReadOnlyResponse([
      liveRecord({ externalId: "a", severity: "fatal" }),
      liveRecord({ externalId: "b", severity: "injury" }),
    ]);
    vi.stubGlobal("fetch", routedFetch(mockCrashResponse(), response) as unknown as typeof fetch);

    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={null} />);
    selectStudyArea("tx-county");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Retrieve crash data/i })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole("button", { name: /Retrieve crash data/i }));

    await waitFor(() => expect(screen.getByText(/Showing 2 of 2 mappable/i)).toBeInTheDocument());

    const lighting = screen.getByRole("group", { name: /Lighting/i });
    expect(lighting).toHaveTextContent(/does not record lighting/i);
    expect(lighting).toHaveTextContent(/not a finding/i);
    expect(screen.getByRole("button", { name: /^Dark — no street lights/ })).toBeDisabled();

    // A facet the source CAN answer stays live on the same screen, so the
    // disabled state above is a statement about that dimension and not an
    // outage of the whole panel.
    fireEvent.click(screen.getByRole("button", { name: /^Injury/ }));
    await waitFor(() => expect(screen.getByText(/Showing 1 of 2 mappable/i)).toBeInTheDocument());
  });

  it("drops a live read when the study area changes, so one place's fatalities never plot on another", async () => {
    const response = await realReadOnlyResponse([liveRecord()]);
    vi.stubGlobal("fetch", routedFetch(mockCrashResponse(), response) as unknown as typeof fetch);

    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={null} />);
    selectStudyArea("tx-county");
    await waitFor(() => expect(screen.getByRole("button", { name: /Retrieve crash data/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Retrieve crash data/i }));
    await waitFor(() => expect(screen.getByText(/Live read — not saved/i)).toBeInTheDocument());

    // The mocked picker emits a different polygon for a different pick.
    selectStudyArea("far-county");

    await waitFor(() => expect(screen.queryByText(/Live read — not saved/i)).not.toBeInTheDocument());
  });

  it("names the sources it checked when a real coverage gap comes back from the lane", async () => {
    // The gap disclosure, end to end and NOT from a described fixture: the
    // response is what `ingestCrashesForStudyArea` really emits for a study area
    // no registered adapter covers, so the `checkedSources` → banner mapping is
    // exercised rather than assumed.
    const { findUncoveredStudyArea } = await import("./helpers/crash-coverage-probe");
    const { CRASH_SOURCE_ADAPTERS } = await import("@/lib/safety/sources/registry");
    const bbox = findUncoveredStudyArea();
    expect(bbox).not.toBeNull();

    const service = {
      from: () => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: "i" }, error: null }) }) }),
        update: () => ({ eq: async () => ({ error: null }) }),
        upsert: async () => ({ error: null }),
      }),
    };
    const result = await ingestCrashesForStudyArea({
      service: service as never,
      workspaceId: "ws-1",
      bbox: bbox!,
      years: [2024],
    });
    expect(result.status).toBe("no_coverage");

    vi.stubGlobal(
      "fetch",
      routedFetch(mockCrashResponse(), { ok: true, json: async () => result } as Response) as unknown as typeof fetch
    );

    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={null} />);
    selectStudyArea("tx-county");
    await waitFor(() => expect(screen.getByRole("button", { name: /Retrieve crash data/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Retrieve crash data/i }));

    await waitFor(() =>
      expect(screen.getByText(/Sources checked for this study area:/i)).toBeInTheDocument()
    );
    const checked = screen.getByText(/Sources checked for this study area:/i);
    for (const adapter of CRASH_SOURCE_ADAPTERS) {
      expect(checked).toHaveTextContent(adapter.label);
    }
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

/**
 * A row the query matched and the response could not render is a THIRD thing,
 * distinct from "beyond the display cap" and from "not in the record".
 *
 * Without its own sentence, `returnedCount` silently falls below `matchedCount`
 * and the page reports truncation — sending a planner to widen the view looking
 * for records that are already in the table and undrawable.
 */
describe("crashes the response could not draw", () => {
  it("names them separately from the display cap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockCrashResponse([], 10, 3)) as unknown as typeof fetch
    );

    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={ingest()} />);
    selectStudyArea();

    await waitFor(() =>
      expect(screen.getByText(/3 matching crashes could not be drawn/)).toBeInTheDocument()
    );
    expect(screen.getByText(/missing from the map rather than absent from the record/)).toBeInTheDocument();
  });

  it("says nothing when every matching crash was drawn", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockCrashResponse([], 10, 0)) as unknown as typeof fetch
    );

    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={ingest()} />);
    selectStudyArea();

    await waitFor(() => expect(screen.getByText(/Showing 0 of 10 crashes/)).toBeInTheDocument());
    expect(screen.queryByText(/could not be drawn/)).toBeNull();
  });
});
