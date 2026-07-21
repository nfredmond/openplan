import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelRunTripGenScreen } from "@/components/models/model-run-trip-gen-screen";
import { ITE_TRIP_GEN_SCREENING_CAVEAT } from "@/lib/models/ite-trip-generation";

const MODEL_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_RUN_ID = "22222222-2222-4222-8222-222222222222";

// Mirrors what buildIteTripGenerationKpiRows stores: the per-line-item table
// rides on the headline `project_daily_trip_ends` row's breakdown_json.
const LINE_ITEMS = [
  {
    landUse: "Single-family detached home",
    unitBasis: "dwelling_unit",
    quantity: 120,
    dailyTripsPerUnit: 10,
    internalCaptureShare: 0.05,
    passByShare: 0,
    grossDailyTrips: 1200,
    netDailyTrips: 1140,
    amPeakTrips: 91.2,
    amInboundTrips: 18.24,
    amOutboundTrips: 72.96,
    pmPeakTrips: 114,
    pmInboundTrips: 79.8,
    pmOutboundTrips: 34.2,
    dailyVmt: 6726,
  },
  {
    landUse: "Neighborhood shopping center",
    unitBasis: "ksf",
    quantity: 40,
    dailyTripsPerUnit: 120,
    internalCaptureShare: 0.05,
    passByShare: 0.2,
    grossDailyTrips: 4800,
    netDailyTrips: 3648,
    amPeakTrips: 145.92,
    amInboundTrips: 87.55,
    amOutboundTrips: 58.37,
    pmPeakTrips: 401.28,
    pmInboundTrips: 200.64,
    pmOutboundTrips: 200.64,
    dailyVmt: 21523.2,
  },
];

const SHARED_BREAKDOWN = {
  provenance: "City of San Diego Trip Generation Manual (Rev. May 2003), Table 1",
  caveat: ITE_TRIP_GEN_SCREENING_CAVEAT,
  comparisonBasis: "no_build_zero",
  avgTripLengthMiles: 5.9,
};

const TRIP_GEN_KPIS: Array<Record<string, unknown>> = [
  {
    kpi_name: "project_daily_trip_ends",
    kpi_label: "Daily vehicle trip ends (net external)",
    kpi_category: "ite_trip_generation",
    value: 4788,
    unit: "trip ends/day",
    breakdown_json: { ...SHARED_BREAKDOWN, lineItems: LINE_ITEMS },
  },
  {
    kpi_name: "project_am_peak_hour_trip_ends",
    kpi_label: "AM peak-hour vehicle trip ends",
    kpi_category: "ite_trip_generation",
    value: 237.12,
    unit: "trip ends/hour",
    breakdown_json: SHARED_BREAKDOWN,
  },
  {
    kpi_name: "project_pm_peak_hour_trip_ends",
    kpi_label: "PM peak-hour vehicle trip ends",
    kpi_category: "ite_trip_generation",
    value: 515.28,
    unit: "trip ends/hour",
    breakdown_json: SHARED_BREAKDOWN,
  },
  {
    kpi_name: "project_daily_vmt_screen",
    kpi_label: "Daily VMT (rate-based screening)",
    kpi_category: "ite_trip_generation",
    value: 28249.2,
    unit: "vehicle-miles/day",
    breakdown_json: SHARED_BREAKDOWN,
  },
  {
    kpi_name: "project_program_units",
    kpi_label: "Land-use program size (summed units)",
    kpi_category: "ite_trip_generation",
    value: 160,
    unit: "units (mixed bases)",
    breakdown_json: SHARED_BREAKDOWN,
  },
];

// A network-derived KPI in a different category — must be filtered out.
const GENERAL_KPI: Record<string, unknown> = {
  kpi_name: "daily_vmt",
  kpi_label: "Daily VMT (network assignment)",
  kpi_category: "general",
  value: 2633000.6,
  unit: "vehicle-miles/day",
  breakdown_json: null,
};

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
    <ModelRunTripGenScreen modelId={MODEL_ID} modelRunId={MODEL_RUN_ID} runTitle="Sketch program run" />
  );
}

async function openWorksheet() {
  fireEvent.click(screen.getByRole("button", { name: /open worksheet/i }));
}

/** All rendered text minus the two negated disclaimers (badge + caveat), which
 * are the only places "determination" may legitimately appear — in the negative. */
function textOutsideDisclaimers(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelector('[data-testid="trip-gen-caveat"]')?.remove();
  clone.querySelector('[data-testid="trip-gen-screening-badge"]')?.remove();
  return clone.textContent ?? "";
}

describe("ModelRunTripGenScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the permanent caveat and warning badge before any fetch", () => {
    const fetchMock = mockKpisFetch(TRIP_GEN_KPIS);
    renderPanel();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("model-run-trip-gen-screen")).toBeInTheDocument();
    expect(screen.getByTestId("trip-gen-caveat")).toHaveTextContent(ITE_TRIP_GEN_SCREENING_CAVEAT);
    expect(screen.getByTestId("trip-gen-screening-badge")).toHaveTextContent(
      "Screening worksheet — not a study or determination"
    );
    expect(screen.getByText("Trip generation screening worksheet")).toBeInTheDocument();
  });

  it("fetches KPIs on expand and renders the stored totals and line-item table", async () => {
    const fetchMock = mockKpisFetch([...TRIP_GEN_KPIS, GENERAL_KPI]);
    renderPanel();
    await openWorksheet();

    await waitFor(() =>
      expect(screen.getByText("Daily vehicle trip ends (net external)")).toBeInTheDocument()
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/models/${MODEL_ID}/runs/${MODEL_RUN_ID}/kpis`,
      { cache: "no-store" }
    );

    // Totals list — labels and units come from the stored rows.
    expect(screen.getByText("4,788")).toBeInTheDocument();
    expect(screen.getByText("237.12")).toBeInTheDocument();
    expect(screen.getByText("515.28")).toBeInTheDocument();
    expect(screen.getByText("28,249.2")).toBeInTheDocument();
    expect(screen.getByText("Land-use program size (summed units)")).toBeInTheDocument();
    expect(screen.getByText("Daily VMT (rate-based screening)")).toBeInTheDocument();

    // Line-item table from the headline row's breakdown_json.
    const table = screen.getByTestId("trip-gen-line-items");
    expect(table).toHaveTextContent("Single-family detached home");
    expect(table).toHaveTextContent("Neighborhood shopping center");
    expect(table).toHaveTextContent("dwelling units");
    expect(table).toHaveTextContent("1,000 sq ft (gross)");
    expect(table).toHaveTextContent("1,200");
    expect(table).toHaveTextContent("1,140");
    expect(table).toHaveTextContent("3,648");
    expect(table).toHaveTextContent("21,523.2");

    // Assumptions line from breakdown_json.
    const assumptions = screen.getByTestId("trip-gen-assumptions");
    expect(assumptions).toHaveTextContent("5.9 miles");
    expect(assumptions).toHaveTextContent("no-build baseline");

    // The `general`-category network KPI must be filtered out.
    expect(screen.queryByText("Daily VMT (network assignment)")).not.toBeInTheDocument();
  });

  it("shows the empty state when no trip-gen KPIs are stored, with the caveat still visible", async () => {
    // Only non-trip-gen rows come back — the category filter must empty them out.
    mockKpisFetch([GENERAL_KPI]);
    renderPanel();
    await openWorksheet();

    await waitFor(() => expect(screen.getByTestId("trip-gen-empty-state")).toBeInTheDocument());
    expect(screen.getByTestId("trip-gen-empty-state")).toHaveTextContent(
      "No trip-generation KPIs are stored for this run"
    );
    expect(screen.queryByTestId("trip-gen-line-items")).not.toBeInTheDocument();
    expect(screen.getByTestId("trip-gen-caveat")).toHaveTextContent(ITE_TRIP_GEN_SCREENING_CAVEAT);
  });

  it("surfaces KPI fetch failures and keeps the caveat", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({ error: "boom" }) }))
    );

    renderPanel();
    await openWorksheet();

    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
    expect(screen.queryByTestId("trip-gen-empty-state")).not.toBeInTheDocument();
    expect(screen.getByTestId("trip-gen-caveat")).toHaveTextContent(ITE_TRIP_GEN_SCREENING_CAVEAT);
  });

  it("never renders significance or determination UI in any state", async () => {
    const banned = /significan|determination|threshold/i;

    // Collapsed state.
    mockKpisFetch(TRIP_GEN_KPIS);
    const collapsed = renderPanel();
    expect(textOutsideDisclaimers(collapsed.container)).not.toMatch(banned);
    // The disclaimers themselves speak only in the negative and never say "significant".
    expect(collapsed.container.textContent).not.toMatch(/significan/i);
    collapsed.unmount();

    // Expanded with a full KPI set.
    mockKpisFetch(TRIP_GEN_KPIS);
    const expanded = renderPanel();
    await openWorksheet();
    await waitFor(() =>
      expect(screen.getByText("Daily vehicle trip ends (net external)")).toBeInTheDocument()
    );
    expect(textOutsideDisclaimers(expanded.container)).not.toMatch(banned);
    expect(expanded.container.textContent).not.toMatch(/significan/i);
    expanded.unmount();

    // Empty state.
    mockKpisFetch([]);
    const empty = renderPanel();
    await openWorksheet();
    await waitFor(() => expect(screen.getByTestId("trip-gen-empty-state")).toBeInTheDocument());
    expect(textOutsideDisclaimers(empty.container)).not.toMatch(banned);
    expect(empty.container.textContent).not.toMatch(/significan/i);
  });
});
