import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const pathnameMock = vi.fn<() => string>();

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
}));

import { MapSurfaceOnly } from "@/components/cartographic/map-surface-only";
import { isMapSurfaceRoute, MAP_SURFACE_ROUTES } from "@/lib/navigation/map-surfaces";

/**
 * THE MAP IS EVERYWHERE. ITS CONTROLS ARE NOT.
 *
 * `cartographic-shell` rendered the layers panel and the map legend on every
 * signed-in page. On the RTP registry that put a floating box of checkboxes —
 * project pins, engagement pins, aerial missions — plus two paragraphs of
 * census-tract and crash-coverage disclosure directly over the Planning System
 * menu card, for a map the planner was not reading. Reported from the browser
 * on 2026-08-08.
 *
 * The background map itself STAYS on every page; that is a deliberate
 * aesthetic. What this guards is the narrower claim: controls appear only where
 * the map is a working surface, and controls for an unread map may not cover
 * the surface somebody IS working on.
 */
describe("map controls appear only on map surfaces", () => {
  it("renders nothing on a records page", () => {
    pathnameMock.mockReturnValue("/rtp");

    render(
      <MapSurfaceOnly>
        <div>layers panel</div>
      </MapSurfaceOnly>
    );

    expect(screen.queryByText("layers panel")).not.toBeInTheDocument();
  });

  it("renders on a map surface", () => {
    pathnameMock.mockReturnValue("/explore");

    render(
      <MapSurfaceOnly>
        <div>layers panel</div>
      </MapSurfaceOnly>
    );

    expect(screen.getByText("layers panel")).toBeInTheDocument();
  });

  /**
   * Nested routes are the same surface as their index — `/aerial/<missionId>`
   * is still the aerial map. A test that only checked the index would pass
   * against an equality check and ship a detail page with no layer controls.
   */
  it("treats a nested route as the same surface", () => {
    expect(isMapSurfaceRoute("/aerial/9a7c1f22-0000-4000-8000-000000000001")).toBe(true);
    expect(isMapSurfaceRoute("/explore")).toBe(true);
  });

  /**
   * ...and a prefix must not leak across route names. `/reports` starts with
   * neither, but a naive `startsWith` on a shorter route would match a page
   * that merely begins with the same letters.
   */
  it("does not match a route that merely shares a prefix", () => {
    expect(isMapSurfaceRoute("/safety-plans")).toBe(false);
    expect(isMapSurfaceRoute("/explorer")).toBe(false);
    expect(isMapSurfaceRoute("/dashboards-archive")).toBe(false);
  });

  it("keeps the records pages that reported the problem free of controls", () => {
    for (const route of ["/rtp", "/grants", "/projects", "/reports", "/knowledge-base", "/plans"]) {
      expect(isMapSurfaceRoute(route)).toBe(false);
    }
  });

  it("answers false rather than throwing when there is no pathname", () => {
    expect(isMapSurfaceRoute(null)).toBe(false);
    expect(isMapSurfaceRoute(undefined)).toBe(false);
  });

  it("declares at least the four surfaces the map is worked on", () => {
    expect(MAP_SURFACE_ROUTES).toEqual(
      expect.arrayContaining(["/explore", "/safety", "/aerial", "/dashboard"])
    );
  });
});
