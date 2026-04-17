import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/programs/funding-opportunity-decision-controls", () => ({
  FundingOpportunityDecisionControls: (props: { opportunityId: string }) => (
    <div data-testid="decision-controls" data-opportunity-id={props.opportunityId} />
  ),
}));

import { GrantsOpportunityRegistryCard } from "@/components/grants/grants-opportunity-registry-card";
import type { FundingOpportunityRow } from "@/lib/grants/page-helpers";

type Opportunity = Parameters<typeof GrantsOpportunityRegistryCard>[0]["opportunity"];

const baseOpportunity = {
  id: "op-1",
  workspace_id: "ws-1",
  program_id: null,
  project_id: "project-1",
  title: "Bridge Replacement HBP",
  opportunity_status: "open" as FundingOpportunityRow["opportunity_status"],
  decision_state: "pursuing" as FundingOpportunityRow["decision_state"],
  agency_name: "Caltrans",
  owner_label: "Program lead",
  cadence_label: "Annual",
  expected_award_amount: 500000,
  opens_at: "2026-02-01T00:00:00Z",
  closes_at: "2027-06-30T00:00:00Z",
  decision_due_at: "2026-07-01T00:00:00Z",
  fit_notes: "Strong fit",
  readiness_notes: "NEPA cleared",
  decision_rationale: "Board approved pursue",
  decided_at: null,
  summary: "Replace aging bridge.",
  updated_at: "2026-03-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  programs: null,
  projects: null,
  program: null,
  project: { id: "project-1", name: "Main St Bridge" },
} as unknown as Opportunity;

describe("GrantsOpportunityRegistryCard", () => {
  it("renders the opportunity title, status badges, and chips", () => {
    render(
      <GrantsOpportunityRegistryCard
        opportunity={baseOpportunity}
        activeFocusedOpportunityId={null}
        projectGrantModelingEvidence={null}
      />
    );

    expect(
      screen.getByRole("heading", { name: "Bridge Replacement HBP" })
    ).toBeInTheDocument();
    expect(screen.getByText(/Agency Caltrans/)).toBeInTheDocument();
    expect(screen.getByText(/Owner Program lead/)).toBeInTheDocument();
    expect(screen.getByText(/Project Main St Bridge/)).toBeInTheDocument();
    expect(screen.getByTestId("decision-controls")).toHaveAttribute(
      "data-opportunity-id",
      "op-1"
    );
    expect(screen.queryByText("Focused from workspace queue")).not.toBeInTheDocument();
    expect(screen.queryByText("Modeling-backed")).not.toBeInTheDocument();
  });

  it("shows focus ring + badge when the opportunity is the focused one and not awarded", () => {
    const { container } = render(
      <GrantsOpportunityRegistryCard
        opportunity={baseOpportunity}
        activeFocusedOpportunityId="op-1"
        projectGrantModelingEvidence={null}
      />
    );

    expect(screen.getByText("Focused from workspace queue")).toBeInTheDocument();
    expect(container.querySelector(".ring-2")).not.toBeNull();
  });

  it("does not focus-ring awarded opportunities even when focused", () => {
    const awarded = { ...baseOpportunity, opportunity_status: "awarded" } as Opportunity;
    const { container } = render(
      <GrantsOpportunityRegistryCard
        opportunity={awarded}
        activeFocusedOpportunityId="op-1"
        projectGrantModelingEvidence={null}
      />
    );

    expect(screen.queryByText("Focused from workspace queue")).not.toBeInTheDocument();
    expect(container.querySelector(".ring-2")).toBeNull();
  });

  it("renders project-link and program-link when present", () => {
    const withProgram = {
      ...baseOpportunity,
      program: { id: "prog-1", title: "HBP", funding_classification: null },
    } as Opportunity;
    render(
      <GrantsOpportunityRegistryCard
        opportunity={withProgram}
        activeFocusedOpportunityId={null}
        projectGrantModelingEvidence={null}
      />
    );

    const projectLink = screen.getByRole("link", { name: /Open project funding lane/ });
    expect(projectLink).toHaveAttribute(
      "href",
      "/projects/project-1#project-funding-opportunities"
    );
    const programLink = screen.getByRole("link", { name: /Open program funding lane/ });
    expect(programLink).toHaveAttribute(
      "href",
      "/programs/prog-1#program-funding-opportunities"
    );
  });

  it("reads 'Not linked' when there is no project", () => {
    const noProject = { ...baseOpportunity, project: null } as Opportunity;
    render(
      <GrantsOpportunityRegistryCard
        opportunity={noProject}
        activeFocusedOpportunityId={null}
        projectGrantModelingEvidence={null}
      />
    );
    expect(screen.getByText(/Project Not linked/)).toBeInTheDocument();
  });
});
