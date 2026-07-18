import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CountyRunCeqaVmtScreen } from "@/components/county-runs/county-run-ceqa-vmt-screen";
import {
  CEQA_SCREENING_CAVEAT,
  deriveCeqaVmtScreeningInputs,
} from "@/lib/models/ceqa-vmt-screen";

const COUNTY_RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function kpi(kpi_name: string, value: number | null, extra: Record<string, unknown> = {}) {
  return { kpi_name, kpi_label: kpi_name, value, unit: "", ...extra };
}

function renderScreen(kpis: ReturnType<typeof kpi>[], heldBack = false) {
  return render(
    <CountyRunCeqaVmtScreen
      countyRunId={COUNTY_RUN_ID}
      runName="nevada-run"
      kpis={kpis}
      heldBackByScreeningGate={heldBack}
      includeScreeningHref={`/county-runs/${COUNTY_RUN_ID}?includeScreening=1`}
    />
  );
}

describe("deriveCeqaVmtScreeningInputs", () => {
  it("prefers an explicit per-capita VMT KPI", () => {
    expect(
      deriveCeqaVmtScreeningInputs([kpi("daily_vmt", 500000), kpi("vmt_per_capita", 17.2)])
    ).toEqual({ status: "per-capita", vmtPerCapita: 17.2, vmtKpiName: "vmt_per_capita" });
  });

  it("combines a total daily VMT KPI with a population KPI", () => {
    expect(
      deriveCeqaVmtScreeningInputs([kpi("total_vmt", 2046440), kpi("population_total", 102322)])
    ).toEqual({
      status: "total-with-population",
      dailyVmt: 2046440,
      population: 102322,
      vmtKpiName: "total_vmt",
      populationKpiName: "population_total",
    });
  });

  it("reports a VMT KPI without population as missing-population", () => {
    expect(deriveCeqaVmtScreeningInputs([kpi("daily_vmt", 500000)])).toEqual({
      status: "missing-population",
      vmtKpiName: "daily_vmt",
    });
  });

  it("reports the seeded behavioral-onramp KPI set as no-vmt-kpi", () => {
    // Exactly the kpi_names persisted for county runs today
    // (src/lib/models/behavioral-onramp-kpis.ts).
    const derived = deriveCeqaVmtScreeningInputs([
      kpi("total_trips", 628262.2),
      kpi("loaded_links", 4829),
      kpi("final_gap", 0.0095),
      kpi("zone_count", 26),
      kpi("population_total", 102322),
      kpi("jobs_total", 48252),
    ]);

    expect(derived.status).toBe("no-vmt-kpi");
  });

  it("ignores geometry-scoped VMT slices and null/non-positive values", () => {
    expect(
      deriveCeqaVmtScreeningInputs([
        kpi("vmt_per_capita", 12.4, { geometry_ref: "corridor-1" }),
        kpi("daily_vmt", null),
        kpi("total_vmt", 0),
      ])
    ).toEqual({
      status: "no-vmt-kpi",
      availableKpiNames: ["vmt_per_capita", "daily_vmt", "total_vmt"],
    });
  });
});

describe("CountyRunCeqaVmtScreen", () => {
  it("renders a less-than-significant determination for a per-capita KPI below the cut line", () => {
    // Default reference 22.0, threshold 15% → cut line 18.7. 17.2 is below.
    renderScreen([kpi("vmt_per_capita", 17.2)]);

    const determination = screen.getByTestId("ceqa-vmt-determination");
    expect(determination).toHaveTextContent("Screening determination: less than significant");
    expect(determination).toHaveTextContent("17.2");
    expect(determination).toHaveTextContent("18.7");
    expect(determination).toHaveTextContent("CEQA Guidelines §15064.3");
    expect(determination).toHaveTextContent("California Public Resources Code §21099");
    expect(screen.getByRole("button", { name: /download memo \(markdown\)/i })).toBeInTheDocument();
  });

  it("renders a potentially-significant determination and mitigation language above the cut line", () => {
    renderScreen([kpi("vmt_per_capita", 21.5)]);

    const determination = screen.getByTestId("ceqa-vmt-determination");
    expect(determination).toHaveTextContent("Screening determination: potentially significant");
    expect(determination).toHaveTextContent("VMT mitigation or a substantial-evidence finding is required");
  });

  it("recomputes when the operator supplies a different reference baseline", () => {
    renderScreen([kpi("vmt_per_capita", 17.2)]);

    // Reference 19 → cut line 16.15; 17.2 is now above it.
    fireEvent.change(screen.getByLabelText("Reference VMT per capita"), {
      target: { value: "19" },
    });

    expect(screen.getByTestId("ceqa-vmt-determination")).toHaveTextContent(
      "Screening determination: potentially significant"
    );
  });

  it("derives per-capita VMT from a total VMT KPI plus a population KPI", () => {
    // 2,046,440 / 102,322 = 20.0 VMT/capita → above the default 18.7 cut line.
    renderScreen([kpi("total_vmt", 2046440), kpi("population_total", 102322)]);

    const determination = screen.getByTestId("ceqa-vmt-determination");
    expect(determination).toHaveTextContent("Screening determination: potentially significant");
    expect(screen.getByText(/Daily VMT from/)).toBeInTheDocument();
  });

  it("always carries the verbatim screening-level caveat and never a determination-of-record framing", () => {
    renderScreen([kpi("vmt_per_capita", 17.2)]);

    expect(screen.getByTestId("ceqa-vmt-caveat")).toHaveTextContent(CEQA_SCREENING_CAVEAT);
    expect(screen.getByTestId("ceqa-vmt-caveat")).toHaveTextContent(
      "not a CEQA determination of record"
    );
    expect(screen.getByText("Screening-level — not a determination of record")).toBeInTheDocument();
  });

  it("renders the explanatory empty state for the seeded behavioral-onramp KPI set", () => {
    renderScreen([
      kpi("total_trips", 628262.2),
      kpi("population_total", 102322),
      kpi("jobs_total", 48252),
    ]);

    const emptyState = screen.getByTestId("ceqa-vmt-empty-state");
    expect(emptyState).toHaveTextContent("No VMT-family KPI is stored for this run");
    expect(emptyState).toHaveTextContent("OpenPlan never estimates VMT from trips or any other proxy");
    expect(emptyState).toHaveTextContent("total_trips, population_total, jobs_total");
    expect(screen.queryByTestId("ceqa-vmt-determination")).not.toBeInTheDocument();
  });

  it("explains a missing population KPI instead of estimating", () => {
    renderScreen([kpi("daily_vmt", 500000)]);

    const emptyState = screen.getByTestId("ceqa-vmt-empty-state");
    expect(emptyState).toHaveTextContent("no population KPI");
    expect(emptyState).toHaveTextContent("OpenPlan will not estimate it");
    expect(screen.queryByTestId("ceqa-vmt-determination")).not.toBeInTheDocument();
  });

  it("shows the screening-grade consent gate hold instead of a false empty state", () => {
    renderScreen([], true);

    expect(screen.getByText(/held back by the screening-grade consent gate/)).toBeInTheDocument();
    expect(screen.queryByTestId("ceqa-vmt-empty-state")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ceqa-vmt-determination")).not.toBeInTheDocument();
  });
});
