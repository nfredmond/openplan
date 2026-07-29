import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DemographicsPanel } from "@/components/engagement/demographics-panel";
import { JointRepresentativenessPanel } from "@/components/engagement/joint-representativeness-panel";
import { shapeDemographicsSummary, type DemographicsSummaryRow } from "@/lib/engagement/demographics";
import { buildJointRepresentativeness } from "@/lib/engagement/joint-representativeness";
import {
  REPRESENTATIVENESS_SCREENING_CAVEAT,
  type CampaignRepresentativeness,
} from "@/lib/engagement/representativeness";

const ROWS: DemographicsSummaryRow[] = [
  { dimension: "__meta__", band: "respondents_with_demographics", respondent_count: 20 },
  { dimension: "race_ethnicity", band: "white", respondent_count: 8 },
  { dimension: "race_ethnicity", band: "hispanic", respondent_count: 7 },
];

function ecological(baselinePct: number | null, status: "under" | "balanced"): CampaignRepresentativeness {
  return {
    metrics: [
      {
        key: "minority",
        label: "Residents of color (ACS)",
        baselinePct,
        respondentPct: 12,
        representationRatio: 0.4,
        status,
      },
    ],
    respondentCount: 24,
    tractCount: 6,
    underRepresented: status === "under" ? ["minority"] : [],
    caveat: REPRESENTATIVENESS_SCREENING_CAVEAT,
    computedAt: "2026-07-20T18:00:00.000Z",
    locatedRespondentCount: 31,
    studyAreaSource: "project_place",
  };
}

describe("DemographicsPanel", () => {
  it("says the aggregate could not be read instead of saying nobody answered", () => {
    render(<DemographicsPanel source={{ state: "unreadable", message: "permission denied for function" }} />);

    expect(screen.getByText(/could not be read/i)).toBeInTheDocument();
    expect(screen.getByText(/permission denied for function/)).toBeInTheDocument();
    expect(screen.queryByText(/No respondents have shared optional demographics yet/i)).not.toBeInTheDocument();
  });

  it("distinguishes a campaign that never asked from one nobody answered", () => {
    const { unmount } = render(<DemographicsPanel source={{ state: "not_collected" }} />);
    expect(screen.getByText(/not collecting optional demographics/i)).toBeInTheDocument();
    unmount();

    render(<DemographicsPanel source={{ state: "loaded", summary: shapeDemographicsSummary([]) }} />);
    expect(screen.getByText(/No respondents have shared optional demographics yet/i)).toBeInTheDocument();
  });
});

describe("JointRepresentativenessPanel", () => {
  it("shows the self-reported floor beside the area share with both denominators", () => {
    render(
      <JointRepresentativenessPanel
        joint={buildJointRepresentativeness({
          ecological: ecological(30, "under"),
          selfReported: { state: "loaded", summary: shapeDemographicsSummary(ROWS) },
        })}
        spatialScreeningAvailable
      />
    );

    expect(screen.getByText(/Self-reported floor at or above the area share/)).toBeInTheDocument();
    expect(screen.getByText(/30% of study-area residents/)).toBeInTheDocument();
    expect(screen.getByText(/≥ 35% \(7 of 20 respondents\)/)).toBeInTheDocument();
    expect(screen.getByText(/24 of 31 located respondents across 6 tracts/)).toBeInTheDocument();
    expect(screen.getByText(/What this cannot say/)).toBeInTheDocument();
  });

  it("never renders a campaign without self-reported demographics as unrepresentative", () => {
    const { container } = render(
      <JointRepresentativenessPanel
        joint={buildJointRepresentativeness({
          ecological: ecological(30, "under"),
          selfReported: { state: "not_collected" },
        })}
        spatialScreeningAvailable
      />
    );

    expect(screen.getAllByText(/Area-based screening only/).length).toBeGreaterThan(0);
    expect(container.textContent).toContain("nothing here describes the people who actually responded");
    expect(container.textContent).toContain("the respondents themselves are not described here");
    expect(container.textContent).not.toMatch(/unrepresentative/i);
  });

  it("never renders a campaign without an ACS baseline as representative", () => {
    const { container } = render(
      <JointRepresentativenessPanel
        joint={buildJointRepresentativeness({
          ecological: null,
          selfReported: { state: "loaded", summary: shapeDemographicsSummary(ROWS) },
        })}
        spatialScreeningAvailable={false}
      />
    );

    expect(screen.getByText(/Self-reported only — no area baseline/)).toBeInTheDocument();
    expect(container.textContent).toContain("does not establish that the campaign reached the community");
    // The campaign has no map-located comments, so the spatial screening panel is
    // not on the page — and this panel must not tell the planner to run it.
    expect(container.textContent).toContain("needs approved comments carrying a map location");
    expect(container.textContent).not.toContain("Run the spatial screening below");
  });

  it("tells the planner to run the spatial screening only when that panel is actually on the page", () => {
    const { container } = render(
      <JointRepresentativenessPanel
        joint={buildJointRepresentativeness({
          ecological: null,
          selfReported: { state: "loaded", summary: shapeDemographicsSummary(ROWS) },
        })}
        spatialScreeningAvailable
      />
    );

    expect(container.textContent).toContain("Run the spatial screening below");
  });

  it("marks the self-reported side unknown, not empty, when its read failed", () => {
    render(
      <JointRepresentativenessPanel
        joint={buildJointRepresentativeness({
          ecological: ecological(30, "under"),
          selfReported: { state: "unreadable", message: "permission denied for function" },
        })}
        spatialScreeningAvailable
      />
    );

    expect(screen.getByText(/Self-reported side could not be read/)).toBeInTheDocument();
    expect(screen.getByText(/This is unknown, not empty/)).toBeInTheDocument();
    // The half that did load is still shown rather than blanked.
    expect(screen.getByText(/30% of study-area residents/)).toBeInTheDocument();
  });
});
