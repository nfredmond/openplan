import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelRunCeqaVmtScreen } from "@/components/models/model-run-ceqa-vmt-screen";
import { CEQA_SCREENING_CAVEAT } from "@/lib/models/ceqa-vmt-screen";

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_RUN_ID = "22222222-2222-4222-8222-222222222222";

function mockKpisFetch(kpis: Array<Record<string, unknown>>) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ kpis }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPanel() {
  return render(
    <ModelRunCeqaVmtScreen modelId={MODEL_ID} modelRunId={MODEL_RUN_ID} runTitle="Live worker run" />
  );
}

async function openScreen() {
  fireEvent.click(screen.getByRole("button", { name: /run ceqa screen/i }));
}

describe("ModelRunCeqaVmtScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("derives a determination from the worker-written VMT KPI set", async () => {
    // The exact keys the AequilibraE worker registers (category `general`).
    const fetchMock = mockKpisFetch([
      {
        kpi_name: "vmt_per_capita",
        kpi_label: "VMT per Capita",
        kpi_category: "general",
        value: 25.7,
        unit: "vehicle-miles/person/day",
        geometry_ref: null,
      },
      {
        kpi_name: "daily_vmt",
        kpi_label: "Daily VMT",
        kpi_category: "general",
        value: 2633000.6,
        unit: "vehicle-miles/day",
        geometry_ref: null,
      },
      {
        kpi_name: "population_total",
        kpi_label: "Population",
        kpi_category: "general",
        value: 102322,
        unit: "persons",
        geometry_ref: null,
      },
    ]);

    renderPanel();
    await openScreen();

    // Default reference 22.0 / threshold 15% → cut line 18.7; 25.7 is above.
    await waitFor(() =>
      expect(screen.getByTestId("ceqa-vmt-determination")).toBeInTheDocument()
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/models/${MODEL_ID}/runs/${MODEL_RUN_ID}/kpis`,
      { cache: "no-store" }
    );
    const determination = screen.getByTestId("ceqa-vmt-determination");
    expect(determination).toHaveTextContent("Screening determination: potentially significant");
    expect(determination).toHaveTextContent("25.7");
    expect(screen.getByTestId("ceqa-vmt-caveat")).toHaveTextContent(CEQA_SCREENING_CAVEAT);
    expect(screen.getByTestId("ceqa-vmt-caveat")).toHaveTextContent(
      "not a CEQA determination of record"
    );
    expect(screen.getByText("Screening-level — not a determination of record")).toBeInTheDocument();
  });

  it("renders the honest empty state when the run stores no VMT KPI", async () => {
    mockKpisFetch([
      { kpi_name: "total_trips", kpi_label: "Total Trips", value: 628262, unit: "trips/day", geometry_ref: null },
      { kpi_name: "rgap", kpi_label: "Relative Gap", value: 0.0095, unit: "ratio", geometry_ref: null },
    ]);

    renderPanel();
    await openScreen();

    await waitFor(() => expect(screen.getByTestId("ceqa-vmt-empty-state")).toBeInTheDocument());
    expect(screen.getByTestId("ceqa-vmt-empty-state")).toHaveTextContent(
      "No VMT-family KPI is stored for this run"
    );
    expect(screen.getByTestId("ceqa-vmt-empty-state")).toHaveTextContent(
      "OpenPlan never estimates VMT from trips or any other proxy"
    );
    expect(screen.queryByTestId("ceqa-vmt-determination")).not.toBeInTheDocument();
  });

  it("surfaces KPI fetch failures instead of rendering a screen", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({ error: "boom" }) }))
    );

    renderPanel();
    await openScreen();

    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
    expect(screen.queryByTestId("ceqa-vmt-determination")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ceqa-vmt-empty-state")).not.toBeInTheDocument();
  });

  it("does not fetch until the operator opens the screen", () => {
    const fetchMock = mockKpisFetch([]);
    renderPanel();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
