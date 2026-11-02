/**
 * The three open rows that blocked a clean Safety journey for the first proven
 * job (a safety action plan plus an SS4A application):
 *
 *   KI-2026-09-05-027  a failed crash-location ranking can be retried alone;
 *   KI-2026-08-31-015  a retrieval with no project is warned about first;
 *   KI-2026-08-31-014  each fatal-or-serious total names its own scope, and
 *                      one line reconciles them where both appear.
 *
 * Blind category: jsdom applies no stylesheet and runs no Mapbox, so nothing
 * here proves the lines are visible or where they sit on a real screen. The
 * route half of the retry is `safety-ksi-ranking-part-route.test.ts`.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SafetyWorkspace } from "@/components/safety/safety-workspace";
import type { SafetyIngestSummary } from "@/lib/safety/client-types";
import { CRASH_SEVERITY_BANDS } from "@/lib/safety/crash-filters";
import type { HighInjuryNetwork } from "@/lib/safety/high-injury-network";
import { seriousInjuryAvailabilityForRecord } from "@/lib/safety/serious-injury-availability";

vi.mock("@/components/safety/safety-crash-map", () => ({
  safetyWorkspaceGisAnchorLayerId: () => undefined,
  SafetyCrashMap: () => <div data-testid="safety-crash-map" />,
}));

vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: ({ onCorridorChange }: { onCorridorChange: (text: string) => void }) => (
    <button
      onClick={() =>
        onCorridorChange(
          JSON.stringify({
            type: "Polygon",
            coordinates: [[[-83.2, 39.8], [-82.2, 39.8], [-82.2, 40.3], [-83.2, 40.3], [-83.2, 39.8]]],
          })
        )
      }
    >
      pick-other-area
    </button>
  ),
}));

const STUDY_AREA = {
  corridorText: JSON.stringify({
    type: "Polygon",
    coordinates: [[[-121.3, 39.1], [-120.3, 39.1], [-120.3, 39.6], [-121.3, 39.6], [-121.3, 39.1]]],
  }),
  place: null,
  label: null,
  origin: "project" as const,
  originLabel: "the saved test area",
};

function ingest(over: Partial<SafetyIngestSummary> = {}): SafetyIngestSummary {
  return {
    id: "ingest-1",
    sourceId: "odot-or",
    sourceLabel: "Statewide crash file",
    attribution: null,
    coverageState: "ccrs_ca_statewide",
    severityCompleteness: "kabco_full",
    status: "ready",
    crashCount: 120,
    geocodedCount: 120,
    truncated: false,
    yearsRequested: [2022, 2023, 2024],
    fetchError: null,
    createdAt: "2026-10-23T00:00:00.000Z",
    studyArea: {
      basis: "place_boundary",
      boundarySource: "project_place",
      outsideBoundaryCount: 4,
      boundaryUnreadable: false,
      rectangleReportedCount: 124,
      rectangleMappableCount: 124,
      countsAreLowerBound: false,
    },
    ...over,
  };
}

function totals(fatal: number, severe: number): Record<string, number> {
  const counts = Object.fromEntries(CRASH_SEVERITY_BANDS.map((band) => [band, 0]));
  return { ...counts, fatal, severe_injury: severe };
}

function crashBody(over: Record<string, unknown> = {}) {
  return {
    type: "FeatureCollection",
    features: [],
    returnedCount: 0,
    matchedCount: 12,
    matchedCountIsExact: true,
    undrawableCount: 0,
    severityTotals: totals(3, 9),
    ksiConcentrations: [],
    ksiEquityTracts: [],
    ksiEquityDemographicSource: { label: "U.S. Census ACS 5-year", vintage: "2023" },
    truncated: false,
    limit: 2000,
    ...over,
  };
}

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const CONCENTRATION = {
  rank: 1,
  longitude: -120.9,
  latitude: 39.3,
  crashCount: 4,
  fatalCrashCount: 1,
  seriousInjuryCrashCount: 3,
  radiusMeters: 150,
  roadIdentity: { status: "unavailable", reason: "no_registered_road_evidence" },
};

const NO_RANKING_TEXT = /No pair of stored fatal or serious-injury crashes/;
const FAILED_RANKING_TEXT = /could not rank severe-crash concentrations/;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("KI-2026-09-05-027: the crash-location ranking can be retried alone", () => {
  it("re-requests only the ranking for the same acquisition and keeps the failure until it arrives", async () => {
    const urls: string[] = [];
    let releaseSecondRetry: (response: Response) => void = () => {
      throw new Error("second retry not started");
    };
    let retries = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: unknown, init?: RequestInit) => {
        const url = String(input);
        urls.push(url);
        if (init?.method === "POST") throw new Error("a retry must not start another acquisition");
        if (!url.includes("part=ksi_concentrations")) {
          return Promise.resolve(json(crashBody({ ksiConcentrations: null })));
        }
        retries += 1;
        if (retries === 1) return Promise.resolve(json({ error: "unavailable", ksiConcentrations: null }, 503));
        return new Promise<Response>((resolve) => {
          releaseSecondRetry = resolve;
        });
      })
    );
    render(
      <SafetyWorkspace
        workspaceId="ws-1"
        latestIngest={ingest()}
        studyArea={STUDY_AREA}
        openedForProject={{ id: "project-1", name: "Rural Roads" }}
        projects={[{ id: "project-1", name: "Rural Roads", status: "active" }]}
      />
    );

    expect(await screen.findByText(FAILED_RANKING_TEXT)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try the ranking again" }));

    // A failed retry keeps the failure and says so. It never reads as "none".
    expect(await screen.findByText("Still unavailable.")).toBeInTheDocument();
    expect(screen.getByText(FAILED_RANKING_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(NO_RANKING_TEXT)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try the ranking again" }));
    // In flight: still the failure, the control busy, and no empty ranking.
    expect(await screen.findByRole("button", { name: "Trying again…" })).toBeDisabled();
    expect(screen.getByText(FAILED_RANKING_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(NO_RANKING_TEXT)).toBeNull();

    await act(async () => {
      releaseSecondRetry(json({ part: "ksi_concentrations", ksiConcentrations: [CONCENTRATION] }));
    });
    expect(await screen.findByRole("heading", { name: /Highest observed KSI concentrations/ })).toBeInTheDocument();
    expect(screen.getByText(/4 KSI crashes/)).toBeInTheDocument();
    expect(screen.queryByText(FAILED_RANKING_TEXT)).toBeNull();
    // The totals loaded once and were not re-requested.
    expect(screen.getByTestId("safety-ksi-headline")).toHaveTextContent("12 fatal or serious-injury crashes");

    const full = urls.filter((url) => url.startsWith("/api/safety/crashes?") && !url.includes("part="));
    const ranking = urls.filter((url) => url.includes("part=ksi_concentrations"));
    expect(full).toHaveLength(1);
    expect(ranking).toHaveLength(2);
    // Same acquisition, area and project as the totals on screen.
    const retryParams = new URL(ranking[1], "http://localhost").searchParams;
    const fullParams = new URL(full[0], "http://localhost").searchParams;
    expect(retryParams.get("ingestId")).toBe("ingest-1");
    expect(retryParams.get("projectId")).toBe("project-1");
    expect(retryParams.get("workspaceId")).toBe("ws-1");
    for (const key of ["minLon", "minLat", "maxLon", "maxLat"]) {
      expect(retryParams.get(key)).toBe(fullParams.get(key));
    }
  });

  it.each([
    ["a body with no ranking", {}],
    ["a ranking that is not a list", { ksiConcentrations: "none" }],
  ])("treats %s as a failure, never as an empty ranking", async (_label, retryBody) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) =>
        String(input).includes("part=ksi_concentrations")
          ? json(retryBody)
          : json(crashBody({ ksiConcentrations: null }))
      )
    );
    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={ingest()} studyArea={STUDY_AREA} />);
    fireEvent.click(await screen.findByRole("button", { name: "Try the ranking again" }));

    expect(await screen.findByText("Still unavailable.")).toBeInTheDocument();
    expect(screen.getByText(FAILED_RANKING_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(NO_RANKING_TEXT)).toBeNull();
  });

  it("drops a late ranking once the planner has moved to another area", async () => {
    let release: (response: Response) => void = () => {
      throw new Error("retry not started");
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: unknown) =>
        String(input).includes("part=ksi_concentrations")
          ? new Promise<Response>((resolve) => {
              release = resolve;
            })
          : Promise.resolve(json(crashBody({ ksiConcentrations: null })))
      )
    );
    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={ingest()} studyArea={STUDY_AREA} />);
    fireEvent.click(await screen.findByRole("button", { name: "Try the ranking again" }));
    fireEvent.click(screen.getByText("pick-other-area"));
    await act(async () => {
      release(json({ ksiConcentrations: [CONCENTRATION] }));
    });

    expect(screen.queryByRole("heading", { name: /Highest observed KSI concentrations/ })).toBeNull();
  });

  it("offers no retry when the acquisition itself is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(crashBody({ ksiConcentrations: null, custodyWarning: "Acquisition custody is incomplete." })))
    );
    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={ingest()} studyArea={STUDY_AREA} />);
    expect(await screen.findByText(FAILED_RANKING_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try the ranking again" })).toBeNull();
  });
});

describe("KI-2026-08-31-015: a retrieval with no project is warned about first", () => {
  const WARNING = "Without a project, these crashes cannot go into a report.";

  it("warns beside the retrieve control before anything is retrieved", async () => {
    const fetchMock = vi.fn(async () => json(crashBody()));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SafetyWorkspace
        workspaceId="ws-1"
        latestIngest={null}
        projects={[{ id: "project-1", name: "Rural Roads", status: "active" }]}
      />
    );

    const warning = screen.getByTestId("safety-no-project-warning");
    expect(warning).toHaveTextContent(WARNING);
    // In the header, with the button it qualifies.
    expect(warning.closest("header")).toContainElement(screen.getByRole("button", { name: "Retrieve crash data" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("warns a workspace that has no project to choose", () => {
    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={null} />);
    expect(screen.getByTestId("safety-no-project-warning")).toHaveTextContent(WARNING);
  });

  it("does not warn once a project is chosen", () => {
    render(
      <SafetyWorkspace
        workspaceId="ws-1"
        latestIngest={null}
        openedForProject={{ id: "project-1", name: "Rural Roads" }}
        projects={[{ id: "project-1", name: "Rural Roads", status: "active" }]}
      />
    );
    expect(screen.queryByTestId("safety-no-project-warning")).toBeNull();
  });
});

describe("KI-2026-08-31-014: each fatal-or-serious total names its own scope", () => {
  function hin(crashesConsidered: number): HighInjuryNetwork {
    return {
      status: "computed",
      basis: "ksi",
      method: "grid_cells",
      years: [2022, 2023, 2024],
      segments: [],
      crashesConsidered,
      crashesPlaced: crashesConsidered,
      segmentsWithCrashes: 0,
      roadMilesReviewed: null,
      listedMiles: null,
      listedCrashes: 0,
      roadSources: [],
      parameters: { segmentLengthMiles: 0.5, minimumRateLengthMiles: 0.25, snapMeters: 50, gridSizeMiles: 0.5, listLimit: 20 },
    };
  }

  function renderWith(network: HighInjuryNetwork, over: Partial<SafetyIngestSummary> = {}) {
    vi.stubGlobal("fetch", vi.fn(async () => json(crashBody({ highInjuryNetwork: network }))));
    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={ingest(over)} studyArea={STUDY_AREA} />);
  }

  it("labels both totals with their scope and reconciles them in one line", async () => {
    renderWith(hin(15));

    expect(await screen.findByTestId("safety-ksi-headline-label")).toHaveTextContent(
      "12 fatal or serious-injury crashes (place boundary · all your filters)"
    );
    expect(screen.getByTestId("safety-hin-total")).toHaveTextContent(
      "15 fatal or serious-injury crashes considered (place boundary · years below · other filters not applied)"
    );
    const statement = seriousInjuryAvailabilityForRecord({ sourceId: "odot-or", severityCompleteness: "kabco_full" }).statement;
    expect(screen.getByTestId("safety-hin-reconciliation")).toHaveTextContent(
      `The total above (12) applies all your filters; this one (15) applies only the year filter. ${statement}`
    );
  });

  it("says the totals agree when they count the same crashes", async () => {
    renderWith(hin(12));
    expect(await screen.findByTestId("safety-hin-reconciliation")).toHaveTextContent(
      "The total above counts the same 12 crashes."
    );
  });

  it("names a rectangle-only acquisition as a rectangle in both labels", async () => {
    renderWith(hin(15), { studyArea: undefined });
    expect(await screen.findByTestId("safety-ksi-headline-label")).toHaveTextContent(
      "(bounding rectangle, not the place boundary · all your filters)"
    );
    expect(screen.getByTestId("safety-hin-total")).toHaveTextContent(
      "(bounding rectangle, not the place boundary · years below · other filters not applied)"
    );
  });

  it("gives no reconciliation when only one total is on screen", async () => {
    // CCRS without the serious-injury join: no headline, a fatal-only network.
    renderWith({ ...hin(5), basis: "fatal_only" }, { sourceId: "ccrs-ca", severityCompleteness: "fatal_injury_only" });
    expect(await screen.findByTestId("safety-hin-total")).toHaveTextContent("5 fatal crashes considered");
    expect(screen.queryByTestId("safety-ksi-headline")).toBeNull();
    expect(screen.queryByTestId("safety-hin-reconciliation")).toBeNull();
  });
});
