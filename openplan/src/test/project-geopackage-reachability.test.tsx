/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/projects/project-map-presence", () => ({
  ProjectMapPresence: () => <div>Project map presence</div>,
}));

import { ProjectMapPresencePanel } from "@/app/(app)/projects/[projectId]/_components/project-map-presence-panel";

describe("project GeoPackage reachability", () => {
  it("offers the project-scoped GIS handoff from the visible evidence tab", () => {
    const projectId = "44444444-4444-4444-8444-444444444444";
    render(
      <ProjectMapPresencePanel
        projectId={projectId}
        latitude={null}
        longitude={null}
        corridors={[]}
        corridorsPending={false}
        canWrite={false}
      />
    );

    const link = screen.getByRole("link", { name: "Download GeoPackage" });
    expect(link).toHaveAttribute("href", `/api/projects/${projectId}/export/geopackage`);
    expect(screen.getByText(/names any missing or invalid map shapes/i)).toBeVisible();
    expect(screen.getByText(/analysis evidence are not included yet/i)).toBeVisible();
  });
});
