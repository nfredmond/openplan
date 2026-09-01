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
        projectAreaGeometry={{
          type: "Polygon",
          coordinates: [[[-83.1, 39.9], [-82.9, 39.9], [-82.9, 40.0], [-83.1, 39.9]]],
        }}
        latitude={39.9612}
        longitude={-82.9988}
        corridors={[{
          id: "55555555-5555-4555-8555-555555555555",
          workspaceId: "33333333-3333-4333-8333-333333333333",
          projectId,
          name: "Main Street",
          corridorType: "arterial",
          losGrade: null,
          geometry: { type: "LineString", coordinates: [[-83.1, 39.9], [-83.0, 40.0]] },
          createdAt: "2026-08-20T00:00:00.000Z",
          updatedAt: "2026-08-21T00:00:00.000Z",
        }]}
        corridorsPending={false}
        canWrite={false}
      />
    );

    const link = screen.getByRole("link", { name: "Download GeoPackage" });
    expect(link).toHaveAttribute("href", `/api/projects/${projectId}/export/geopackage`);
    expect(screen.getByText(/names any missing or invalid map shapes/i)).toBeVisible();
    expect(screen.getByText(/analysis evidence are not included yet/i)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Layers in this package" })).toBeVisible();
    expect(screen.getByText("project_area · Polygon or MultiPolygon · 1 feature included")).toBeVisible();
    expect(screen.getByText("project_location · Point · 1 feature included")).toBeVisible();
    expect(screen.getByText("project_corridors · LineString · 1 feature included")).toBeVisible();
    expect(screen.getByText("3 core layers · 3 features included · 0 unavailable · 0 rejected shapes")).toBeVisible();
  });

  it("shows unavailable and rejected core geometry before download", () => {
    render(
      <ProjectMapPresencePanel
        projectId="44444444-4444-4444-8444-444444444444"
        projectAreaGeometry={null}
        latitude={null}
        longitude={null}
        corridors={[{
          id: "66666666-6666-4666-8666-666666666666",
          workspaceId: "33333333-3333-4333-8333-333333333333",
          projectId: "44444444-4444-4444-8444-444444444444",
          name: "Broken line",
          corridorType: "other",
          losGrade: null,
          geometry: { type: "LineString", coordinates: [[-83, 95], [-82.9, 40]] },
          createdAt: "2026-08-20T00:00:00.000Z",
          updatedAt: "2026-08-21T00:00:00.000Z",
        }]}
        corridorsPending={false}
        canWrite={false}
      />,
    );

    expect(screen.getByText("3 core layers · 0 features included · 3 unavailable · 1 rejected shape")).toBeVisible();
  });
});
