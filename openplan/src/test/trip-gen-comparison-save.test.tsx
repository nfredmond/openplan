import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ITE_TRIP_GEN_SCREENING_CAVEAT } from "@/lib/models/ite-trip-generation";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

import { TripGenComparisonSaveButton } from "@/components/scenarios/trip-gen-comparison-save";

const BASELINE_KPI_URL = "/api/models/model-1/runs/run-baseline/kpis";
const CANDIDATE_KPI_URL = "/api/models/model-2/runs/run-candidate/kpis";
const SNAPSHOT_URL = "/api/scenarios/set-1/spine/comparison-snapshots";

function kpiRow(name: string, value: number, category = "ite_trip_generation") {
  return {
    kpi_name: name,
    kpi_label: `${name} label`,
    kpi_category: category,
    value,
    unit: "trip ends/day",
  };
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

const fetchMock = vi.fn();

function renderButton() {
  render(
    <TripGenComparisonSaveButton
      scenarioSetId="set-1"
      baselineEntryId="8a3b0f8e-8f4a-4d3e-9a2b-1c5d6e7f8a9b"
      baselineEntryLabel="Existing conditions"
      candidateEntryId="b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e"
      candidateEntryLabel="Infill housing package"
      baselineRun={{ modelId: "model-1", modelRunId: "run-baseline" }}
      candidateRun={{ modelId: "model-2", modelRunId: "run-candidate" }}
    />
  );
}

describe("TripGenComparisonSaveButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("fetches both runs' KPIs, posts a spine comparison snapshot, and refreshes", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === BASELINE_KPI_URL) {
        return jsonResponse({
          kpis: [
            kpiRow("project_daily_trip_ends", 100),
            kpiRow("project_daily_vmt_screen", 500),
            kpiRow("corridor_daily_vmt", 999, "deterministic"),
          ],
        });
      }
      if (url === CANDIDATE_KPI_URL) {
        return jsonResponse({
          kpis: [kpiRow("project_daily_trip_ends", 160), kpiRow("project_daily_vmt_screen", 800)],
        });
      }
      if (url === SNAPSHOT_URL && init?.method === "POST") {
        return jsonResponse({ comparisonSnapshotId: "snapshot-1" }, true, 201);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /save trip-gen comparison/i }));

    await waitFor(() => {
      expect(screen.getByText(/comparison snapshot saved/i)).toBeInTheDocument();
    });

    const postCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "POST");
    expect(postCall).toBeDefined();
    expect(String(postCall?.[0])).toBe(SNAPSHOT_URL);

    const body = JSON.parse((postCall?.[1] as RequestInit).body as string);
    expect(body.baselineEntryId).toBe("8a3b0f8e-8f4a-4d3e-9a2b-1c5d6e7f8a9b");
    expect(body.candidateEntryId).toBe("b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e");
    expect(body.label).toBe("Trip generation — Infill housing package vs Existing conditions");
    expect(body.indicatorDeltas).toHaveLength(2);
    expect(body.indicatorDeltas[0]).toMatchObject({
      indicatorKey: "project_daily_trip_ends",
      delta: { baseline: 100, candidate: 160, delta: 60 },
      sortOrder: 0,
    });
    // The non-ITE category row never leaks into the snapshot.
    expect(
      body.indicatorDeltas.some(
        (delta: { indicatorKey: string }) => delta.indicatorKey === "corridor_daily_vmt"
      )
    ).toBe(false);
    // Full screening caveat rides along, split under the spine's 400-char cap.
    expect(Array.isArray(body.caveats)).toBe(true);
    for (const caveat of body.caveats as string[]) {
      expect(caveat.length).toBeLessThanOrEqual(400);
    }
    expect((body.caveats as string[]).join(" ")).toBe(ITE_TRIP_GEN_SCREENING_CAVEAT);

    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces an inline error and skips the POST when the runs share no trip-gen KPIs", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === BASELINE_KPI_URL) {
        return jsonResponse({ kpis: [kpiRow("project_daily_trip_ends", 100)] });
      }
      if (url === CANDIDATE_KPI_URL) {
        return jsonResponse({ kpis: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /save trip-gen comparison/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/both runs need registered trip-generation kpis/i)
      ).toBeInTheDocument();
    });
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === "POST")
    ).toBe(false);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("surfaces the API error when the snapshot POST fails and does not refresh", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === BASELINE_KPI_URL || url === CANDIDATE_KPI_URL) {
        return jsonResponse({ kpis: [kpiRow("project_daily_trip_ends", 100)] });
      }
      if (url === SNAPSHOT_URL && init?.method === "POST") {
        return jsonResponse({ error: "Baseline entry must be a baseline in this scenario set" }, false, 400);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /save trip-gen comparison/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/baseline entry must be a baseline in this scenario set/i)
      ).toBeInTheDocument();
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("surfaces KPI-load failures without posting", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === BASELINE_KPI_URL) {
        return jsonResponse({ error: "Model run not found" }, false, 404);
      }
      if (url === CANDIDATE_KPI_URL) {
        return jsonResponse({ kpis: [kpiRow("project_daily_trip_ends", 100)] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /save trip-gen comparison/i }));

    await waitFor(() => {
      expect(screen.getByText(/model run not found/i)).toBeInTheDocument();
    });
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === "POST")
    ).toBe(false);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
