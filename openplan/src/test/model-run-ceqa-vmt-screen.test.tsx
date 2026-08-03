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

function renderPanel(overrides?: { runStatus?: string | null; engineKey?: string | null }) {
  return render(
    <ModelRunCeqaVmtScreen
      modelId={MODEL_ID}
      modelRunId={MODEL_RUN_ID}
      runTitle="Live worker run"
      runStatus={overrides?.runStatus === undefined ? "succeeded" : overrides.runStatus}
      engineKey={overrides?.engineKey === undefined ? "aequilibrae" : overrides.engineKey}
    />
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

  it("surfaces the count-calibration confidence note (without recalculating VMT) on a calibrated run", async () => {
    mockKpisFetch([
      { kpi_name: "vmt_per_capita", kpi_label: "VMT per Capita", value: 25.7, unit: "vehicle-miles/person/day", geometry_ref: null },
      { kpi_name: "daily_vmt", kpi_label: "Daily VMT", value: 2633000.6, unit: "vehicle-miles/day", geometry_ref: null },
      { kpi_name: "population_total", kpi_label: "Population", value: 102322, unit: "persons", geometry_ref: null },
      { kpi_name: "validation_median_ape_calibrated", kpi_label: "Calibrated Holdout Median APE", value: 16.25, unit: "percent", geometry_ref: null },
    ]);
    renderPanel();
    await openScreen();
    await waitFor(() => expect(screen.getByTestId("ceqa-vmt-determination")).toBeInTheDocument());
    const note = screen.getByTestId("ceqa-vmt-calibration-confidence");
    expect(note).toHaveTextContent("Count-validated in this study area");
    expect(note).toHaveTextContent("16.3"); // formatNumber(16.25, 1)
    expect(note).toHaveTextContent("does not recalculate VMT");
    // The determination itself still uses the screening VMT (25.7), unchanged.
    expect(screen.getByTestId("ceqa-vmt-determination")).toHaveTextContent("25.7");
  });

  it("offers an opt-in calibrated-input determination distinct from screening", async () => {
    mockKpisFetch([
      { kpi_name: "resident_vmt_per_capita", kpi_label: "Resident VMT per Capita", value: 25.7, unit: "vehicle-miles/person/day", geometry_ref: null },
      { kpi_name: "resident_vmt", kpi_label: "Resident VMT", value: 2633000, unit: "vehicle-miles/day", geometry_ref: null },
      { kpi_name: "population_total", kpi_label: "Population", value: 102322, unit: "persons", geometry_ref: null },
      { kpi_name: "resident_vmt_per_capita_calibrated", kpi_label: "Resident VMT per Capita (calibrated)", value: 18.0, unit: "vehicle-miles/person/day", geometry_ref: null },
      { kpi_name: "validation_median_ape_calibrated", kpi_label: "Calibrated Holdout Median APE", value: 16.25, unit: "percent", geometry_ref: null },
    ]);
    renderPanel();
    await openScreen();
    // Default: screening determination on the screening VMT (25.7).
    await waitFor(() => expect(screen.getByTestId("ceqa-vmt-determination")).toBeInTheDocument());
    let det = screen.getByTestId("ceqa-vmt-determination");
    expect(det).toHaveTextContent("Screening determination");
    expect(det).toHaveTextContent("25.7");
    // Opt in: calibrated-input determination on the calibrated VMT (18.0).
    fireEvent.click(screen.getByTestId("ceqa-vmt-calibrated-toggle").querySelector("input")!);
    det = screen.getByTestId("ceqa-vmt-determination");
    expect(det).toHaveTextContent("Calibrated-input determination");
    expect(det).toHaveTextContent("18");
    expect(det).toHaveTextContent("calibrated (count-tuned) VMT");
  });

  it("offers no calibrated determination the server would refuse to store", async () => {
    // A geometry-scoped calibrated KPI is one corridor's slice, not the run
    // total, and the save route refuses it with 422. The panel used to accept
    // any row with the calibrated name, so a planner could sit reading a
    // "Calibrated-input determination" that the product would never keep. Both
    // sides now select through `selectCalibratedVmtPerCapita`.
    mockKpisFetch([
      { kpi_name: "resident_vmt_per_capita", kpi_label: "Resident VMT per Capita", value: 25.7, unit: "", geometry_ref: null },
      { kpi_name: "population_total", kpi_label: "Population", value: 102322, unit: "", geometry_ref: null },
      { kpi_name: "resident_vmt_per_capita_calibrated", kpi_label: "Resident VMT per Capita (calibrated)", value: 18.0, unit: "", geometry_ref: "corridor-1" },
    ]);
    renderPanel();
    await openScreen();

    await waitFor(() => expect(screen.getByTestId("ceqa-vmt-determination")).toBeInTheDocument());
    expect(screen.queryByTestId("ceqa-vmt-calibrated-toggle")).not.toBeInTheDocument();
    expect(screen.getByTestId("ceqa-vmt-determination")).toHaveTextContent("Screening determination");
  });

  it("offers no calibrated determination from a calibrated KPI of zero", async () => {
    // The route requires a positive value; a 0 VMT per capita is a broken row,
    // not a spectacularly efficient study area.
    mockKpisFetch([
      { kpi_name: "resident_vmt_per_capita", kpi_label: "Resident VMT per Capita", value: 25.7, unit: "", geometry_ref: null },
      { kpi_name: "resident_vmt_per_capita_calibrated", kpi_label: "Resident VMT per Capita (calibrated)", value: 0, unit: "", geometry_ref: null },
    ]);
    renderPanel();
    await openScreen();

    await waitFor(() => expect(screen.getByTestId("ceqa-vmt-determination")).toBeInTheDocument());
    expect(screen.queryByTestId("ceqa-vmt-calibrated-toggle")).not.toBeInTheDocument();
  });

  it("does not describe a corridor's calibration fit as the study area's", async () => {
    mockKpisFetch([
      { kpi_name: "resident_vmt_per_capita", kpi_label: "Resident VMT per Capita", value: 25.7, unit: "", geometry_ref: null },
      { kpi_name: "validation_median_ape_calibrated", kpi_label: "Calibrated Holdout Median APE", value: 16.25, unit: "percent", geometry_ref: "corridor-1" },
    ]);
    renderPanel();
    await openScreen();

    await waitFor(() => expect(screen.getByTestId("ceqa-vmt-determination")).toBeInTheDocument());
    expect(screen.queryByTestId("ceqa-vmt-calibration-confidence")).not.toBeInTheDocument();
  });

  it("shows no calibration toggle when there is no calibrated resident VMT", async () => {
    mockKpisFetch([
      { kpi_name: "vmt_per_capita", kpi_label: "VMT per Capita", value: 25.7, unit: "vehicle-miles/person/day", geometry_ref: null },
      { kpi_name: "daily_vmt", kpi_label: "Daily VMT", value: 2633000.6, unit: "vehicle-miles/day", geometry_ref: null },
      { kpi_name: "population_total", kpi_label: "Population", value: 102322, unit: "persons", geometry_ref: null },
    ]);
    renderPanel();
    await openScreen();
    await waitFor(() => expect(screen.getByTestId("ceqa-vmt-determination")).toBeInTheDocument());
    expect(screen.queryByTestId("ceqa-vmt-calibrated-toggle")).not.toBeInTheDocument();
  });

  it("shows no calibration note on an uncalibrated (default) run", async () => {
    mockKpisFetch([
      { kpi_name: "vmt_per_capita", kpi_label: "VMT per Capita", value: 25.7, unit: "vehicle-miles/person/day", geometry_ref: null },
      { kpi_name: "daily_vmt", kpi_label: "Daily VMT", value: 2633000.6, unit: "vehicle-miles/day", geometry_ref: null },
      { kpi_name: "population_total", kpi_label: "Population", value: 102322, unit: "persons", geometry_ref: null },
    ]);
    renderPanel();
    await openScreen();
    await waitFor(() => expect(screen.getByTestId("ceqa-vmt-determination")).toBeInTheDocument());
    expect(screen.queryByTestId("ceqa-vmt-calibration-confidence")).not.toBeInTheDocument();
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

  /**
   * THE PANEL-SIDE ENGINE GATE. The save route refuses an ineligible run, but
   * the on-screen determination and memo download are client-only — and a
   * sketch run's KPI names (`daily_vmt`, `vmt_per_capita`, `population_total`)
   * pass the CEQA name filter, so if this panel trusted its mount site, a
   * drifted mount condition would render a determination from VMT documented
   * ~56% low. The panel enforces the shared rule itself.
   */
  it("refuses a sketch_abm run with the engine reason instead of any screen", () => {
    const fetchMock = mockKpisFetch([]);
    renderPanel({ engineKey: "sketch_abm" });

    expect(screen.getByTestId("model-run-ceqa-vmt-ineligible")).toHaveTextContent(
      /not accepted as the basis for a VMT significance determination/i
    );
    expect(screen.queryByRole("button", { name: /run ceqa screen/i })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an unfinished run as unfinished, not as a wrong engine", () => {
    renderPanel({ runStatus: "running" });

    expect(screen.getByTestId("model-run-ceqa-vmt-ineligible")).toHaveTextContent(
      /has not finished successfully/i
    );
    expect(screen.getByTestId("model-run-ceqa-vmt-ineligible")).not.toHaveTextContent(
      /not accepted as the basis/i
    );
    expect(screen.queryByRole("button", { name: /run ceqa screen/i })).toBeNull();
  });

  it("refuses a run whose engine was never recorded rather than assuming one", () => {
    renderPanel({ engineKey: null });

    expect(screen.getByTestId("model-run-ceqa-vmt-ineligible")).toHaveTextContent(
      /no engine is recorded for this run/i
    );
    expect(screen.queryByRole("button", { name: /run ceqa screen/i })).toBeNull();
  });
});

/**
 * A determination is only safe once it travels with the two facts that make it
 * interpretable: WHOSE law makes VMT the significance metric here, and HOW GOOD
 * the model behind the number is. These cover both, plus the persistence gate.
 */

const CALIFORNIA_FRAMEWORK = {
  kind: "covered",
  basis: "workspace_home_geography",
  jurisdiction: { country: "US", subdivision: "CA", label: "A county" },
  framework: {
    frameworkId: "us_ca_ceqa_15064_3_v1",
    frameworkName: "CEQA §15064.3 VMT significance screening",
    version: "1.0.0",
    jurisdiction: { country: "US", subdivision: "CA", label: "California, United States" },
    scopeStatement:
      "CEQA §15064.3 applies to projects subject to review under the California Environmental Quality Act.",
    statutoryCitation: "California Public Resources Code §21099; CEQA Guidelines §15064.3.",
    screeningCaveat: "Determinations in this memo are screening-level.",
    defaultThresholdPct: 0.15,
    defaultThresholdRationale: "OPR Technical Advisory (December 2018) recommends 15 percent below.",
    defaultReferenceVmtPerCapita: 22,
    defaultReferenceRationale: "California statewide average total VMT per capita.",
  },
};

const UNCOVERED_FRAMEWORK = {
  kind: "not_covered",
  jurisdiction: { country: "US", subdivision: "OH", label: "An Ohio county" },
  registered: [],
  reason:
    "No VMT significance framework is registered for An Ohio county (US-OH), so OpenPlan will not issue a significance determination there.",
};

const SCREENING_KPIS = [
  { kpi_name: "resident_vmt_per_capita", kpi_label: "Resident VMT per Capita", value: 25.7, unit: "", geometry_ref: null },
  { kpi_name: "population_total", kpi_label: "Population", value: 102322, unit: "", geometry_ref: null },
];

/** Routes each call by URL + method, the way the component actually splits them. */
function mockScreenEndpoints(options: {
  kpis?: Array<Record<string, unknown>>;
  significance?: Record<string, unknown>;
  significanceOk?: boolean;
  onPost?: (body: unknown) => { ok: boolean; payload: Record<string, unknown> };
}) {
  const fetchMock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (url.endsWith("/kpis")) {
      return { ok: true, json: async () => ({ kpis: options.kpis ?? SCREENING_KPIS }) };
    }
    if (init?.method === "POST") {
      const result = options.onPost?.(JSON.parse(init.body ?? "{}")) ?? {
        ok: true,
        payload: { created: true, screening: null },
      };
      return { ok: result.ok, json: async () => result.payload };
    }
    return {
      ok: options.significanceOk ?? true,
      json: async () => options.significance ?? { framework: null },
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const SAVED_DETERMINATION = {
  id: "screening-1",
  workspace_id: "33333333-3333-4333-8333-333333333333",
  model_run_id: MODEL_RUN_ID,
  county_run_id: null,
  framework_id: "us_ca_ceqa_15064_3_v1",
  framework_name: "CEQA §15064.3 VMT significance screening",
  framework_version: "1.0.0",
  jurisdiction_country: "US",
  jurisdiction_subdivision: "CA",
  jurisdiction_label: "California, United States",
  jurisdiction_basis: "workspace_home_geography",
  claim_status: "screening_grade",
  claim_status_source: "recorded_claim_decision",
  input_basis: "screening",
  vmt_kpi_name: "resident_vmt_per_capita",
  population_kpi_name: null,
  scenario_id: "Live worker run",
  determination: "potentially_significant",
  mitigation_required: true,
  vmt_per_capita: 25.7,
  threshold_vmt_per_capita: 18.7,
  reference_vmt_per_capita: 22,
  threshold_pct: 0.15,
  reference_label: "regional",
  project_type: "residential",
  engine_version: "openplan-planner-pack-ts",
  created_at: "2026-07-28T10:00:00.000Z",
};

describe("ModelRunCeqaVmtScreen — jurisdiction basis, claim tier, and persistence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("states the framework and jurisdiction alongside a determination it may issue", async () => {
    mockScreenEndpoints({
      significance: {
        framework: CALIFORNIA_FRAMEWORK,
        claimTier: { claimStatus: "screening_grade", claimStatusSource: "recorded_claim_decision" },
        screenings: [],
      },
    });
    renderPanel();
    await openScreen();

    await waitFor(() => expect(screen.getByTestId("ceqa-vmt-determination")).toBeInTheDocument());
    const basis = screen.getByTestId("ceqa-vmt-jurisdiction-basis");
    expect(basis).toHaveTextContent("CEQA §15064.3 VMT significance screening");
    expect(basis).toHaveTextContent("California, United States");
    expect(basis).toHaveTextContent("home geography");
    expect(screen.getByTestId("ceqa-vmt-claim-tier")).toHaveTextContent("Screening-grade");
    // Under a framework that governs here, the statute is the AUTHORITY, printed
    // plainly rather than hedged as a method reference.
    expect(screen.getByTestId("ceqa-vmt-citation")).not.toHaveTextContent("Method reference");
    expect(screen.getByTestId("ceqa-vmt-save-determination")).toBeEnabled();
  });

  it("tells a planner outside the framework that no determination applies there, and why", async () => {
    mockScreenEndpoints({
      significance: {
        framework: UNCOVERED_FRAMEWORK,
        claimTier: { claimStatus: null, claimStatusSource: "not_recorded" },
        screenings: [],
      },
    });
    renderPanel();
    await openScreen();

    await waitFor(() => expect(screen.getByTestId("ceqa-vmt-jurisdiction-basis")).toBeInTheDocument());
    const basis = screen.getByTestId("ceqa-vmt-jurisdiction-basis");
    expect(basis).toHaveTextContent("not a significance determination for your area");
    expect(basis).toHaveTextContent("An Ohio county (US-OH)");
    // The statute is still cited, because the arithmetic came from it — but as a
    // METHOD reference, not as authority over a project in Ohio.
    const citation = screen.getByTestId("ceqa-vmt-citation");
    expect(citation).toHaveTextContent("Method reference");
    expect(citation).toHaveTextContent("not as authority over a project in your area");
    // …and the determination may not be recorded for them at all.
    expect(screen.getByTestId("ceqa-vmt-save-determination")).toBeDisabled();
    expect(screen.getByTestId("ceqa-vmt-save-blocked")).toHaveTextContent(
      /whose rules it was issued under/i
    );
  });

  it("exports the memo with the jurisdiction basis and claim tier the screen established", async () => {
    // The memo is the artifact that leaves the tool; this proves the panel
    // actually WIRES its framework and tier into the download, rather than the
    // renderer merely being capable of carrying them.
    let capturedBlob: Blob | null = null;
    const createObjectURL = vi.fn((blob: Blob) => {
      capturedBlob = blob;
      return "blob:mock-memo";
    });
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true, writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true, writable: true });

    try {
      mockScreenEndpoints({
        significance: {
          framework: CALIFORNIA_FRAMEWORK,
          claimTier: { claimStatus: "screening_grade", claimStatusSource: "recorded_claim_decision" },
          screenings: [],
        },
      });
      renderPanel();
      await openScreen();
      await waitFor(() => expect(screen.getByTestId("ceqa-vmt-determination")).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: /download memo/i }));

      expect(capturedBlob).not.toBeNull();
      const memo = await (capturedBlob as unknown as Blob).text();
      expect(memo).toContain(
        "- **Jurisdiction basis:** CEQA §15064.3 VMT significance screening, California, United States."
      );
      expect(memo).toContain("**Modeling claim tier:** Screening-grade — recorded for this run.");
      expect(memo).not.toContain("none established");
    } finally {
      delete (URL as unknown as Record<string, unknown>).createObjectURL;
      delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
    }
  });

  it("says the claim tier is not recorded rather than assuming one", async () => {
    mockScreenEndpoints({
      significance: {
        framework: CALIFORNIA_FRAMEWORK,
        claimTier: { claimStatus: null, claimStatusSource: "not_recorded" },
        screenings: [],
      },
    });
    renderPanel();
    await openScreen();

    await waitFor(() => expect(screen.getByTestId("ceqa-vmt-claim-tier")).toBeInTheDocument());
    expect(screen.getByTestId("ceqa-vmt-claim-tier")).toHaveTextContent("not recorded for this run");
    expect(screen.getByTestId("ceqa-vmt-claim-tier")).not.toHaveTextContent("Screening-grade");
  });

  it("reports a failed jurisdiction lookup as a failure, not as an uncovered area", async () => {
    mockScreenEndpoints({
      significanceOk: false,
      significance: { error: "boom", details: "The workspace geography query failed: connection reset." },
    });
    renderPanel();
    await openScreen();

    await waitFor(() => expect(screen.getByTestId("ceqa-vmt-jurisdiction-basis")).toBeInTheDocument());
    expect(screen.getByTestId("ceqa-vmt-jurisdiction-basis")).toHaveTextContent("connection reset");
  });

  it("carries the tier and the jurisdiction into the collapsed summary and the saved list", async () => {
    mockScreenEndpoints({
      significance: {
        framework: CALIFORNIA_FRAMEWORK,
        claimTier: { claimStatus: "screening_grade", claimStatusSource: "recorded_claim_decision" },
        screenings: [SAVED_DETERMINATION],
      },
    });
    renderPanel();
    await openScreen();

    await waitFor(() =>
      expect(screen.getByTestId("model-run-ceqa-vmt-latest-summary")).toBeInTheDocument()
    );
    // The collapsed line is the one most likely to be read at a glance and
    // quoted, so it carries all four facts.
    const summary = screen.getByTestId("model-run-ceqa-vmt-latest-summary");
    expect(summary).toHaveTextContent("Potentially significant");
    expect(summary).toHaveTextContent("California, United States");
    expect(summary).toHaveTextContent("screening-grade");
    expect(summary).toHaveTextContent("screening VMT");

    const history = screen.getByTestId("model-run-ceqa-vmt-history");
    expect(history).toHaveTextContent("Potentially significant");
    expect(history).toHaveTextContent("Screening-grade");
  });

  it("posts only policy inputs — never a VMT figure — and shows the saved determination", async () => {
    let posted: unknown = null;
    mockScreenEndpoints({
      significance: {
        framework: CALIFORNIA_FRAMEWORK,
        claimTier: { claimStatus: "screening_grade", claimStatusSource: "recorded_claim_decision" },
        screenings: [],
      },
      onPost: (body) => {
        posted = body;
        return { ok: true, payload: { created: true, screening: SAVED_DETERMINATION } };
      },
    });
    renderPanel();
    await openScreen();

    await waitFor(() => expect(screen.getByTestId("ceqa-vmt-save-determination")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("ceqa-vmt-save-determination"));

    await waitFor(() => expect(screen.getByTestId("ceqa-vmt-save-notice")).toBeInTheDocument());
    expect(posted).toEqual({
      referenceVmtPerCapita: 22,
      thresholdPct: 0.15,
      projectType: "residential",
      referenceLabel: "regional",
      inputBasis: "screening",
    });
    expect(screen.getByTestId("ceqa-vmt-save-notice")).toHaveTextContent("Potentially significant");
    expect(screen.getByTestId("model-run-ceqa-vmt-latest-summary")).toHaveTextContent(
      "California, United States"
    );
  });

  it("shows the server's own refusal reason when a save is declined", async () => {
    mockScreenEndpoints({
      significance: {
        framework: CALIFORNIA_FRAMEWORK,
        claimTier: { claimStatus: null, claimStatusSource: "not_recorded" },
        screenings: [],
      },
      onPost: () => ({
        ok: false,
        payload: {
          error: "No VMT significance framework governs this workspace's jurisdiction",
          reason: "No VMT significance framework is registered for An Ohio county (US-OH).",
        },
      }),
    });
    renderPanel();
    await openScreen();

    await waitFor(() => expect(screen.getByTestId("ceqa-vmt-save-determination")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("ceqa-vmt-save-determination"));

    await waitFor(() => expect(screen.getByTestId("ceqa-vmt-save-error")).toBeInTheDocument());
    expect(screen.getByTestId("ceqa-vmt-save-error")).toHaveTextContent("An Ohio county (US-OH)");
  });

  it("does not report a saved-but-unreadable determination as a failed save", async () => {
    mockScreenEndpoints({
      significance: {
        framework: CALIFORNIA_FRAMEWORK,
        claimTier: { claimStatus: null, claimStatusSource: "not_recorded" },
        screenings: [],
      },
      onPost: () => ({
        ok: true,
        payload: {
          created: true,
          screening: null,
          details: "The determination was saved, but it could not be read back. Do not retry.",
        },
      }),
    });
    renderPanel();
    await openScreen();

    await waitFor(() => expect(screen.getByTestId("ceqa-vmt-save-determination")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("ceqa-vmt-save-determination"));

    await waitFor(() => expect(screen.getByTestId("ceqa-vmt-save-notice")).toBeInTheDocument());
    expect(screen.getByTestId("ceqa-vmt-save-notice")).toHaveTextContent("Do not retry");
    expect(screen.queryByTestId("ceqa-vmt-save-error")).not.toBeInTheDocument();
  });

  it("fetches neither the KPIs nor the determinations until the screen is opened", () => {
    const fetchMock = mockScreenEndpoints({});
    renderPanel();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * The route does NOT put the database row on the wire — it puts the parsed
   * record on the wire, and that is camelCase. A fixture in the row's snake_case
   * spelling therefore proves nothing about what a planner sees, so this pair
   * uses the payload the route actually produces. Before the parser accepted
   * both spellings the saved history rendered as empty with no message, and
   * every successful save announced "saved but could not be read back".
   */
  const SAVED_DETERMINATION_ON_THE_WIRE = {
    id: "screening-1",
    workspaceId: "33333333-3333-4333-8333-333333333333",
    modelRunId: MODEL_RUN_ID,
    countyRunId: null,
    frameworkId: "us_ca_ceqa_15064_3_v1",
    frameworkName: "CEQA §15064.3 VMT significance screening",
    frameworkVersion: "1.0.0",
    jurisdictionCountry: "US",
    jurisdictionSubdivision: "CA",
    jurisdictionLabel: "California, United States",
    jurisdictionBasis: "workspace_home_geography",
    claimStatus: "screening_grade",
    claimStatusSource: "recorded_claim_decision",
    inputBasis: "screening",
    vmtKpiName: "resident_vmt_per_capita",
    populationKpiName: null,
    scenarioId: "Live worker run",
    determination: "potentially_significant",
    mitigationRequired: true,
    vmtPerCapita: 25.7,
    thresholdVmtPerCapita: 18.7,
    referenceVmtPerCapita: 22,
    thresholdPct: 0.15,
    referenceLabel: "regional",
    projectType: "residential",
    engineVersion: "openplan-planner-pack-ts",
    createdAt: "2026-07-28T10:00:00.000Z",
  };

  it("renders the history the route really returns, rather than dropping it silently", async () => {
    mockScreenEndpoints({
      significance: {
        framework: CALIFORNIA_FRAMEWORK,
        claimTier: { claimStatus: "screening_grade", claimStatusSource: "recorded_claim_decision" },
        screenings: [SAVED_DETERMINATION_ON_THE_WIRE],
      },
    });
    renderPanel();
    await openScreen();

    await waitFor(() =>
      expect(screen.getByTestId("model-run-ceqa-vmt-latest-summary")).toBeInTheDocument()
    );
    expect(screen.getByTestId("model-run-ceqa-vmt-history")).toHaveTextContent(
      "California, United States"
    );
  });

  it("names unreadable determinations even when NONE of them could be read", async () => {
    // The worst case for a silent degrade: the run has stored determinations and
    // this build can parse none of them. Showing an empty panel would read as
    // "nothing has been determined for this run", which is a confident false.
    mockScreenEndpoints({
      significance: {
        framework: CALIFORNIA_FRAMEWORK,
        claimTier: { claimStatus: "screening_grade", claimStatusSource: "recorded_claim_decision" },
        screenings: [],
        unreadable_screening_count: 3,
      },
    });
    renderPanel();
    await openScreen();

    await waitFor(() =>
      expect(screen.getByTestId("model-run-ceqa-vmt-unreadable")).toBeInTheDocument()
    );
    expect(screen.getByTestId("model-run-ceqa-vmt-unreadable")).toHaveTextContent("3 saved");
    expect(screen.queryByTestId("model-run-ceqa-vmt-history")).not.toBeInTheDocument();
  });

  it("does not call a successful save unreadable when the route returned the determination", async () => {
    mockScreenEndpoints({
      significance: {
        framework: CALIFORNIA_FRAMEWORK,
        claimTier: { claimStatus: "screening_grade", claimStatusSource: "recorded_claim_decision" },
        screenings: [],
      },
      onPost: () => ({
        ok: true,
        payload: { created: true, screening: SAVED_DETERMINATION_ON_THE_WIRE },
      }),
    });
    renderPanel();
    await openScreen();

    await waitFor(() => expect(screen.getByTestId("ceqa-vmt-save-determination")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("ceqa-vmt-save-determination"));

    await waitFor(() => expect(screen.getByTestId("ceqa-vmt-save-notice")).toBeInTheDocument());
    const notice = screen.getByTestId("ceqa-vmt-save-notice");
    expect(notice).toHaveTextContent("Determination saved");
    expect(notice).not.toHaveTextContent(/could not be read back/i);
    expect(screen.getByTestId("model-run-ceqa-vmt-history")).toHaveTextContent(
      "Potentially significant"
    );
  });
});
