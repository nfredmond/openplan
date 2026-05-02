import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: PropsWithChildren<
    AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean }
  >) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { CountyRunBehavioralKpisSection } from "@/app/(app)/county-runs/[countyRunId]/_components/county-run-behavioral-kpis";
import type { BehavioralOnrampKpiSnapshot } from "@/lib/models/behavioral-onramp-kpis";

const COUNTY_RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BASE_PATH = `/county-runs/${COUNTY_RUN_ID}`;

const FORECASTING_TERMS = ["forecast", "calibrated", "predicted", "production-ready", "production ready"] as const;

function makeKpi(overrides: Partial<BehavioralOnrampKpiSnapshot> = {}): BehavioralOnrampKpiSnapshot {
  return {
    kpi_name: "total_trips",
    kpi_label: "Total trips (behavioral)",
    value: 231828.75,
    unit: "trips",
    breakdown_json: {},
    county_run_id: COUNTY_RUN_ID,
    run_id: null,
    ...overrides,
  };
}

describe("CountyRunBehavioralKpisSection — modeling caveat posture", () => {
  it("renders the screening-grade refusal banner when this run is rejected and consent is absent", () => {
    render(
      <CountyRunBehavioralKpisSection
        countyRunId={COUNTY_RUN_ID}
        kpis={[]}
        isThisRunRejected={true}
        rejectedTotalCount={2}
        acceptingScreeningGrade={false}
        basePathname={BASE_PATH}
        error={null}
      />
    );

    const refusalLabel = screen.getByText(/Screening-grade refusal/i);
    expect(refusalLabel).toBeInTheDocument();

    const banner = refusalLabel.closest("div");
    expect(banner).not.toBeNull();
    const bannerText = banner?.textContent ?? "";
    expect(bannerText).toMatch(/held back/i);

    for (const term of FORECASTING_TERMS) {
      expect(bannerText.toLowerCase()).not.toContain(term);
    }

    const includeLink = screen.getByRole("link", { name: /Include screening-grade KPIs/i });
    expect(includeLink).toHaveAttribute("href", `${BASE_PATH}?includeScreening=1`);

    expect(screen.getByText(/Production grade only/i)).toBeInTheDocument();
  });

  it("hides the warm banner and offers a revert link when screening-grade consent is accepted", () => {
    render(
      <CountyRunBehavioralKpisSection
        countyRunId={COUNTY_RUN_ID}
        kpis={[makeKpi()]}
        isThisRunRejected={false}
        rejectedTotalCount={0}
        acceptingScreeningGrade={true}
        basePathname={BASE_PATH}
        error={null}
      />
    );

    expect(screen.queryByText(/Screening-grade refusal/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Including screening grade/i)).toBeInTheDocument();

    const revertLink = screen.getByRole("link", { name: /Revert to production grade only/i });
    expect(revertLink).toHaveAttribute("href", BASE_PATH);

    expect(screen.getByText(/Total trips \(behavioral\)/i)).toBeInTheDocument();
    expect(screen.getByText("231,828.75")).toBeInTheDocument();
  });

  it("renders the empty-state message when no KPIs exist for this run and nothing is rejected", () => {
    render(
      <CountyRunBehavioralKpisSection
        countyRunId={COUNTY_RUN_ID}
        kpis={[]}
        isThisRunRejected={false}
        rejectedTotalCount={0}
        acceptingScreeningGrade={false}
        basePathname={BASE_PATH}
        error={null}
      />
    );

    expect(screen.getByText(/KPIs are written on manifest ingest/i)).toBeInTheDocument();
    expect(screen.queryByText(/Screening-grade refusal/i)).not.toBeInTheDocument();
  });

  it("renders the load-error banner when the loader returned an error", () => {
    render(
      <CountyRunBehavioralKpisSection
        countyRunId={COUNTY_RUN_ID}
        kpis={[]}
        isThisRunRejected={false}
        rejectedTotalCount={0}
        acceptingScreeningGrade={false}
        basePathname={BASE_PATH}
        error="rls denied"
      />
    );

    expect(screen.getByText(/KPI load failed/i)).toBeInTheDocument();
    expect(screen.getByText(/rls denied/i)).toBeInTheDocument();
    expect(screen.queryByText(/Screening-grade refusal/i)).not.toBeInTheDocument();
  });
});
