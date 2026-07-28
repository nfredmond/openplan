import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { FirstRunChecklist } from "@/components/onboarding/first-run-checklist";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/**
 * The branches the dashboard page test cannot reach, because the page always
 * supplies the same combination: a geography whose source recorded no display
 * name, an outstanding geography step with the picker mounted elsewhere, and a
 * workspace that already has runs.
 */
describe("FirstRunChecklist", () => {
  it("treats a geography with no recorded place name as set, without inventing one", () => {
    render(
      <FirstRunChecklist
        homeGeographyIsSet
        homeGeographyLabel={null}
        hasRuns={false}
        canManageWorkspace
      />
    );

    expect(screen.getByText("Set. The source recorded no place name for it.")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.queryByText("Start here")).not.toBeInTheDocument();
  });

  it("points at the geography panel elsewhere on the page when the picker is not mounted here", () => {
    render(
      <FirstRunChecklist
        homeGeographyIsSet={false}
        homeGeographyLabel={null}
        hasRuns={false}
        canManageWorkspace
      />
    );

    expect(
      screen.getByText("Not set. Choose it in the workspace geography panel on this page.")
    ).toBeInTheDocument();
  });

  it("mounts the supplied geography setter under the step that asks for it", () => {
    render(
      <FirstRunChecklist
        homeGeographyIsSet={false}
        homeGeographyLabel={null}
        hasRuns={false}
        canManageWorkspace
      >
        <div data-testid="geography-setter" />
      </FirstRunChecklist>
    );

    const step = screen.getByText("Tell OpenPlan where you work").closest("li");
    expect(step).not.toBeNull();
    expect(step).toContainElement(screen.getByTestId("geography-setter"));
  });

  it("marks the screening step done and drops its call to action once runs exist", () => {
    render(
      <FirstRunChecklist
        homeGeographyIsSet
        homeGeographyLabel="Example County, Example State"
        hasRuns
        canManageWorkspace={false}
      />
    );

    expect(screen.getByText("This workspace has saved analysis runs.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Open Analysis Studio/ })).not.toBeInTheDocument();
    // Two done steps, and no invite step for a non-manager.
    expect(screen.getAllByText("Done")).toHaveLength(2);
    expect(screen.queryByText("Invite your team")).not.toBeInTheDocument();
  });

  it("keeps the screening claim screening-grade", () => {
    render(
      <FirstRunChecklist
        homeGeographyIsSet={false}
        homeGeographyLabel={null}
        hasRuns={false}
        canManageWorkspace
      />
    );

    expect(
      screen.getByText(/Results are screening-grade — they support prioritization and narrative, not final engineering\./)
    ).toBeInTheDocument();
  });
});
