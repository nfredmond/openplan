import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectEvidenceAndActivity } from "@/app/(app)/projects/[projectId]/_components/project-evidence-activity";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Client-side creators/editors are not what these tests are about; the panel
// under test is the empty-runs prompt and the link it hands the planner.
vi.mock("@/components/aerial/aerial-evidence-package-creator", () => ({
  AerialEvidencePackageCreator: () => null,
}));
vi.mock("@/components/aerial/aerial-mission-creator", () => ({
  AerialMissionCreator: () => null,
}));
vi.mock("@/components/aerial/aerial-mission-status-editor", () => ({
  AerialMissionStatusEditor: () => null,
}));

afterEach(() => {
  cleanup();
});

function baseProps(projectId: string) {
  return {
    dataHubMigrationPending: false,
    linkedDatasets: [],
    recentRuns: [],
    aerialProjectPosture: {
      missionCount: 0,
      activeMissionCount: 0,
      completeMissionCount: 0,
      readyPackageCount: 0,
      verificationReadiness: "none" as const,
    },
    aerialProjectPostureDetail: null,
    aerialMissions: [],
    aerialPackages: [],
    projectId,
    projectPlaceLabel: null,
    timelineItems: [],
  };
}

/**
 * The empty-runs prompt told a planner to open Corridor Analysis and then
 * linked a bare "/explore" — from a page that KNOWS which project it is on.
 * /explore reads `?projectId=` and inherits the project's study area, so the
 * first run created from this prompt must start scoped to this project.
 */
describe("ProjectEvidenceAndActivity", () => {
  it("sends the first-run prompt to Corridor Analysis carrying this project", () => {
    render(<ProjectEvidenceAndActivity {...baseProps("proj-a")} />);

    const link = screen.getByText("Corridor Analysis").closest("a");
    expect(link?.getAttribute("href")).toBe("/explore?projectId=proj-a");
  });

  it("threads whichever project the page is on, rather than hardcoding one", () => {
    // Varied binding: one fixture cannot tell "threads the id" from
    // "hardcodes its value".
    render(<ProjectEvidenceAndActivity {...baseProps("proj-b")} />);

    const link = screen.getByText("Corridor Analysis").closest("a");
    expect(link?.getAttribute("href")).toBe("/explore?projectId=proj-b");
  });
});
