import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/projects/project-funding-profile-editor", () => ({
  ProjectFundingProfileEditor: (props: { projectId: string }) => (
    <div data-testid="funding-profile-editor" data-project-id={props.projectId} />
  ),
}));

import { GrantsFundingNeedEditorSection } from "@/components/grants/grants-funding-need-editor-section";

const baseProject = {
  project: { id: "project-1", name: "Grass Valley Corridor" },
  opportunityCount: 3,
  localMatchNeedAmount: 25000,
  notes: "Add anchor next cycle",
};

describe("GrantsFundingNeedEditorSection", () => {
  it("renders section header, anchor badge, and underlying profile editor", () => {
    render(
      <GrantsFundingNeedEditorSection
        fundingNeedEditorProject={baseProject}
        fundingNeedAnchorProjectsCount={4}
        activeFocusedProjectId={null}
      />
    );

    expect(screen.getByText("Funding need anchor")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /Anchor funding need for Grass Valley Corridor/,
      })
    ).toBeInTheDocument();
    expect(screen.getByText("4 missing anchors")).toBeInTheDocument();
    expect(screen.getByTestId("funding-profile-editor")).toHaveAttribute(
      "data-project-id",
      "project-1"
    );
  });

  it("uses singular label when only one project missing an anchor", () => {
    render(
      <GrantsFundingNeedEditorSection
        fundingNeedEditorProject={baseProject}
        fundingNeedAnchorProjectsCount={1}
        activeFocusedProjectId={null}
      />
    );

    expect(screen.getByText("1 missing anchor")).toBeInTheDocument();
  });

  it("omits the focused callout when the project is not the focused one", () => {
    render(
      <GrantsFundingNeedEditorSection
        fundingNeedEditorProject={baseProject}
        fundingNeedAnchorProjectsCount={4}
        activeFocusedProjectId="project-other"
      />
    );

    expect(screen.queryByText("Focused from workspace queue")).not.toBeInTheDocument();
  });

  it("renders the focused callout with opportunity count and local match when focused", () => {
    render(
      <GrantsFundingNeedEditorSection
        fundingNeedEditorProject={baseProject}
        fundingNeedAnchorProjectsCount={4}
        activeFocusedProjectId="project-1"
      />
    );

    expect(screen.getByText("Focused from workspace queue")).toBeInTheDocument();
    expect(
      screen.getByText(/3 linked opportunities/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Local match \$25,000/)).toBeInTheDocument();
  });

  it("uses singular opportunity wording when there is a single linked opportunity", () => {
    render(
      <GrantsFundingNeedEditorSection
        fundingNeedEditorProject={{ ...baseProject, opportunityCount: 1, localMatchNeedAmount: 0 }}
        fundingNeedAnchorProjectsCount={1}
        activeFocusedProjectId="project-1"
      />
    );

    expect(screen.getByText(/1 linked opportunity/)).toBeInTheDocument();
    expect(screen.queryByText(/Local match/)).not.toBeInTheDocument();
  });
});
