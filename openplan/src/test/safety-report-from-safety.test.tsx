import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SafetyWorkspace } from "@/components/safety/safety-workspace";
import type { SafetyIngestSummary } from "@/lib/safety/client-types";
import { CRASH_SEVERITY_BANDS } from "@/lib/safety/crash-filters";
import type { HighInjuryNetwork } from "@/lib/safety/high-injury-network";

// Rehearsal defects D5 and D3 on the real Safety workspace.
// D5: a project with no report could not save countermeasures, and the only
// way forward was the generic Reports page. Safety now creates the report for
// this project with this crash pull chosen, and stays on Safety.
// D3: Safety showed model-engine advice for a large study area.
// Blind category: jsdom has no layout, and the POST is a fake; the report
// route's own checks are covered in reports-route.test.ts.

const pickerProps: Array<Record<string, unknown>> = [];

vi.mock("@/components/safety/safety-crash-map", () => ({
  safetyWorkspaceGisAnchorLayerId: () => undefined,
  SafetyCrashMap: () => <div data-testid="safety-crash-map" />,
}));

vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: (props: Record<string, unknown>) => {
    pickerProps.push(props);
    return <div data-testid="study-area-picker" />;
  },
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

const INGEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function ingest(): SafetyIngestSummary {
  return {
    id: INGEST_ID,
    sourceId: "odot-or",
    sourceLabel: "Statewide crash file",
    attribution: null,
    coverageState: "ccrs_ca_statewide",
    severityCompleteness: "kabco_full",
    status: "ready",
    crashCount: 12,
    geocodedCount: 12,
    truncated: false,
    yearsRequested: [2022, 2023, 2024],
    fetchError: null,
    createdAt: "2026-10-23T00:00:00.000Z",
  };
}

const NETWORK: HighInjuryNetwork = {
  status: "computed",
  basis: "ksi",
  method: "grid_cells",
  years: [2022, 2023, 2024],
  segments: [],
  crashesConsidered: 0,
  crashesPlaced: 0,
  segmentsWithCrashes: 0,
  roadMilesReviewed: null,
  listedMiles: null,
  listedCrashes: 0,
  roadSources: [],
  parameters: { segmentLengthMiles: 0.5, minimumRateLengthMiles: 0.25, snapMeters: 50, gridSizeMiles: 0.5, listLimit: 20 },
};

function crashBody() {
  return {
    type: "FeatureCollection",
    features: [],
    returnedCount: 0,
    matchedCount: 0,
    matchedCountIsExact: true,
    undrawableCount: 0,
    severityTotals: Object.fromEntries(CRASH_SEVERITY_BANDS.map((band) => [band, 0])),
    ksiConcentrations: [],
    ksiEquityTracts: [],
    ksiEquityDemographicSource: { label: "U.S. Census ACS 5-year", vintage: "2023" },
    truncated: false,
    limit: 2000,
    highInjuryNetwork: NETWORK,
  };
}

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

afterEach(() => {
  pickerProps.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PROJECTS = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Sierra County roads", status: "active", reportTitle: "Sierra County roads safety action plan" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Downieville Main Street", status: "active", reportTitle: "Downieville Main Street safety action plan" },
  // A project already named for its plan keeps its name; the browser check found the words doubled.
  { id: "33333333-3333-4333-8333-333333333333", name: "Pyramid Lake Reservation Safety Action Plan", status: "active", reportTitle: "Pyramid Lake Reservation Safety Action Plan" },
];

describe("D5: Safety creates the report it needs", () => {
  it.each(PROJECTS)("creates a report for $name with this crash pull chosen, then saves the plan to it", async (project) => {
    const posts: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url === "/api/reports") {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return json({ reportId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, 201);
      }
      if (init?.method === "PATCH") {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return json({ success: true });
      }
      return json(crashBody());
    }));
    render(
      <SafetyWorkspace
        workspaceId="ws-1"
        latestIngest={ingest()}
        studyArea={STUDY_AREA}
        openedForProject={{ id: project.id, name: project.name }}
        projects={PROJECTS}
        projectReports={[]}
      />,
    );

    const create = await screen.findByRole("button", { name: "Create safety action plan report" });
    await act(async () => { fireEvent.click(create); });

    expect(posts[0]).toEqual({
      url: "/api/reports",
      body: {
        projectId: project.id,
        reportType: "project_status",
        title: project.reportTitle,
        safetyIngestSelections: [{ ingestId: INGEST_ID }],
      },
    });
    expect(screen.getByRole("status").textContent).toBe(`Created ${project.reportTitle}.`);
    expect((screen.getByLabelText("Save to report") as HTMLSelectElement).value).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save plan with no ranked segments" })); });
    expect(posts[1]).toEqual({
      url: "/api/reports/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      body: { safetyIngestSelections: [{ ingestId: INGEST_ID }], safetyActionPlan: { ingestId: INGEST_ID, attachments: [] } },
    });
  });

  it("shows the route's refusal and offers no save target", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === "POST" && url === "/api/reports" ? json({ error: "Workspace access denied" }, 403) : json(crashBody())));
    render(
      <SafetyWorkspace workspaceId="ws-1" latestIngest={ingest()} studyArea={STUDY_AREA}
        openedForProject={{ id: PROJECTS[0].id, name: PROJECTS[0].name }} projects={PROJECTS} projectReports={[]} />,
    );
    const create = await screen.findByRole("button", { name: "Create safety action plan report" });
    await act(async () => { fireEvent.click(create); });
    expect(screen.getByRole("status").textContent).toBe("Workspace access denied");
    expect(screen.queryByLabelText("Save to report")).toBeNull();
  });
});

describe("D3: Safety gives no model-run advice", () => {
  it("tells the study-area picker not to show the run-engine hint", () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(crashBody())));
    render(<SafetyWorkspace workspaceId="ws-1" latestIngest={null} />);
    expect(pickerProps.length).toBeGreaterThan(0);
    expect(pickerProps.every((props) => props.showRunEngineHint === false)).toBe(true);
  });
});
