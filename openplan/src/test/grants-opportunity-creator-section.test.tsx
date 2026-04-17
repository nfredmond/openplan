import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/programs/funding-opportunity-creator", () => ({
  FundingOpportunityCreator: (props: {
    title: string;
    description: string;
    defaultProjectId: string | null;
  }) => (
    <div data-testid="opportunity-creator" data-default-project-id={props.defaultProjectId ?? "none"}>
      <div data-testid="creator-title">{props.title}</div>
      <div data-testid="creator-description">{props.description}</div>
    </div>
  ),
}));

import { GrantsOpportunityCreatorSection } from "@/components/grants/grants-opportunity-creator-section";

const baseProject = { id: "project-1", name: "Grass Valley Corridor" };
const emptyOptions = { programs: [], projects: [] };

describe("GrantsOpportunityCreatorSection", () => {
  it("renders the default title and description when no project is focused", () => {
    render(
      <GrantsOpportunityCreatorSection
        fundingOpportunityCreatorProject={null}
        fundingOpportunityCreatorMode="default"
        focusedFundingGapProject={null}
        focusedFundingSourcingProject={null}
        activeFocusedProjectId={null}
        programOptions={emptyOptions.programs}
        projectOptions={emptyOptions.projects}
      />
    );

    expect(screen.getByTestId("creator-title")).toHaveTextContent("Log a funding opportunity");
    expect(screen.getByTestId("creator-description")).toHaveTextContent(
      /Create a shared grant record/
    );
    expect(screen.queryByText("Focused from workspace queue")).not.toBeInTheDocument();
  });

  it("uses sourcing-mode title when focused on a sourcing project", () => {
    render(
      <GrantsOpportunityCreatorSection
        fundingOpportunityCreatorProject={baseProject}
        fundingOpportunityCreatorMode="sourcing"
        focusedFundingGapProject={null}
        focusedFundingSourcingProject={{ fundingNeedAmount: 300000, localMatchNeedAmount: 50000 }}
        activeFocusedProjectId="project-1"
        programOptions={emptyOptions.programs}
        projectOptions={emptyOptions.projects}
      />
    );

    expect(screen.getByTestId("creator-title")).toHaveTextContent(
      "Source a funding opportunity for Grass Valley Corridor"
    );
    expect(screen.getByText("Focused from workspace queue")).toBeInTheDocument();
    expect(screen.getByText(/Funding need \$300,000/)).toBeInTheDocument();
    expect(screen.getByText(/Local match \$50,000/)).toBeInTheDocument();
  });

  it("uses gap-mode title and remaining-gap callout when focused on a gap project", () => {
    render(
      <GrantsOpportunityCreatorSection
        fundingOpportunityCreatorProject={baseProject}
        fundingOpportunityCreatorMode="gap"
        focusedFundingGapProject={{
          summary: {
            unfundedAfterLikelyAmount: 120000,
            likelyFundingAmount: 80000,
            fundingNeedAmount: 200000,
          },
        }}
        focusedFundingSourcingProject={null}
        activeFocusedProjectId="project-1"
        programOptions={emptyOptions.programs}
        projectOptions={emptyOptions.projects}
      />
    );

    expect(screen.getByTestId("creator-title")).toHaveTextContent(
      "Close funding gap for Grass Valley Corridor"
    );
    expect(screen.getByText(/Remaining gap \$120,000/)).toBeInTheDocument();
    expect(screen.getByText(/Pursued \$80,000/)).toBeInTheDocument();
    expect(screen.getByText(/Need \$200,000/)).toBeInTheDocument();
  });

  it("does not show focused callout when creator project is not the active focused project", () => {
    render(
      <GrantsOpportunityCreatorSection
        fundingOpportunityCreatorProject={baseProject}
        fundingOpportunityCreatorMode="sourcing"
        focusedFundingGapProject={null}
        focusedFundingSourcingProject={{ fundingNeedAmount: 100000, localMatchNeedAmount: 0 }}
        activeFocusedProjectId="project-other"
        programOptions={emptyOptions.programs}
        projectOptions={emptyOptions.projects}
      />
    );

    expect(screen.queryByText("Focused from workspace queue")).not.toBeInTheDocument();
  });
});
