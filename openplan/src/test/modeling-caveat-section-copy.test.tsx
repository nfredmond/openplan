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
import { describeScreeningGradeRefusal } from "@/lib/models/caveat-gate";
import { SCREENING_GRADE_HELP_HREF } from "@/lib/help/screening-grade";
import type { BehavioralOnrampKpiSnapshot } from "@/lib/models/behavioral-onramp-kpis";

const COUNTY_RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BASE_PATH = `/county-runs/${COUNTY_RUN_ID}`;

const FORECASTING_TERMS = ["forecast", "calibrated", "predicted", "production-ready", "production ready"] as const;

function makeKpi(overrides: Partial<BehavioralOnrampKpiSnapshot> = {}): BehavioralOnrampKpiSnapshot {
  return {
    kpi_name: "total_trips",
    kpi_label: "Total trips (behavioral)",
    kpi_category: "behavioral_onramp",
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

    const refusalLabel = screen.getByText(/^Held back$/i);
    expect(refusalLabel).toBeInTheDocument();

    const banner = refusalLabel.closest("div");
    expect(banner).not.toBeNull();
    const bannerText = banner?.textContent ?? "";
    expect(bannerText).toMatch(/held back/i);

    for (const term of FORECASTING_TERMS) {
      expect(bannerText.toLowerCase()).not.toContain(term);
    }

    const includeLink = screen.getByRole("link", { name: /Show them anyway/i });
    expect(includeLink).toHaveAttribute("href", `${BASE_PATH}?includeScreening=1`);

    expect(screen.getByText(/Screening-grade hidden/i)).toBeInTheDocument();
  });

  /**
   * THE BANNER STATES A TIER, NOT AN ABSENCE.
   *
   * A plain-language sweep rewrote this sentence to "This county run has not
   * been validated yet, so its results are screening-grade" — which reads as a
   * step not yet taken, and invites a planner to treat the numbers as
   * provisionally fine. Screening-grade is a grade OpenPlan AWARDS and defines:
   * it says what these results may be used for, and /help says what that is.
   * Losing the tier is losing the claim, so both the tier and the way to look
   * it up are asserted here.
   */
  it("names the tier and links to its explanation rather than reporting an unfinished step", () => {
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

    const banner = screen.getByText(/^Held back$/i).closest("div") as HTMLElement;
    const text = banner.textContent ?? "";
    expect(text).toMatch(/is at a screening-grade stage/i);
    // Not the weaker statement the sweep left behind.
    expect(text).not.toMatch(/has not been validated yet/i);

    // The tier has to be findable from where it is asserted.
    const explanation = banner.querySelector(`a[href="${SCREENING_GRADE_HELP_HREF}"]`);
    expect(explanation).not.toBeNull();
    expect(explanation?.textContent).toMatch(/screening-grade/i);

    // And the count line under it is written for a planner: `acceptScreeningGrade`
    // is a function parameter no screen exposes and no planner can pass.
    expect(text).toContain(describeScreeningGradeRefusal(2));
    expect(text).not.toMatch(/acceptScreeningGrade/);
    expect(text).not.toMatch(/:\s*true/);
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

    expect(screen.queryByText(/^Held back$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Showing screening-grade results/i)).toBeInTheDocument();

    const revertLink = screen.getByRole("link", { name: /Hide them again/i });
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

    expect(
      screen.getByText(/written when the run's output file is brought/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Held back$/i)).not.toBeInTheDocument();
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

    expect(screen.getByText(/could not be read, so this panel is not showing them/i)).toBeInTheDocument();
    expect(screen.getByText(/rls denied/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Held back$/i)).not.toBeInTheDocument();
  });
});
