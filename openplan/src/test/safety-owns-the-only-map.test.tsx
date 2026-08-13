/**
 * SAFETY DRAWS ONE MAP, AND THE CONTROLS ON THE PAGE DRIVE THAT MAP.
 *
 * ═══ WHAT WAS WRONG ═══
 *
 * Measured in a real browser (Chrome, the dev server for THIS tree) on
 * 2026-08-13, before the change:
 *
 *   1600×900   2 Mapbox instances. Shell backdrop 1600×900 at (0,0), entirely
 *              behind the opaque route panel. Crash map 558×457 at (305,350) —
 *              17.7% of the window. Shell layers panel 240×458 and legend
 *              240×258 docked at x=1344, both driving the BACKDROP.
 *   390×844    2 Mapbox instances. Crash map 277×256 at (49,426) — 21.5%. The
 *              shell layers panel 240×49 sat at (134,120), over the phone
 *              screen, still driving the map nobody could see.
 *
 * So the layer controls a planner reached for pointed at a map they were not
 * looking at: the toggle stuck, the fetch succeeded, the layer painted, and
 * nothing changed on screen. The Data Hub meanwhile promised uploads "become
 * toggles on the Layers panel on Safety".
 *
 * After: ONE instance at both sizes. 1600×900 → crash map 877×797 (48.5% of the
 * window, up from 17.7%), sidebar 432×797 docked beside it, shell dock gone,
 * Safety's own layer panel inside the sidebar. 390×844 → crash map 340×256,
 * sidebar below it in one scroll, no shell panel over the content, no horizontal
 * overflow. Identical in light and dark at both sizes.
 *
 * ═══ WHAT THIS FILE CANNOT PROVE, AND NOTHING IN THIS REPO CAN ═══
 *
 * jsdom applies no stylesheet, has no box model — every `getBoundingClientRect`
 * is zero — and does not run Mapbox GL at all. So not one number above is
 * checkable here, and no test in this repository can check them. They were
 * measured by driving the real app in a real browser, and re-measuring is the
 * only way to confirm them again.
 *
 * What IS provable here is the wiring that produces them: which routes own the
 * map, that the shell's dock stands down on those routes, and that Safety
 * mounts the replacements. Those are the things an edit is likely to undo by
 * accident.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const pathnameMock = vi.fn<() => string>();

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
  useSearchParams: () => new URLSearchParams(),
}));

import { MapSurfaceOnly } from "@/components/cartographic/map-surface-only";
import {
  MAP_OWNING_ROUTES,
  MAP_SURFACE_ROUTES,
  isMapSurfaceRoute,
  routeOwnsMap,
  showsSharedMapControls,
} from "@/lib/navigation/map-surfaces";
import { safetyWorkspaceGisAnchorLayerId } from "@/components/safety/safety-crash-map";
import { stripSourceComments } from "./helpers/source-text";

const repoFile = (relative: string) =>
  stripSourceComments(readFileSync(path.join(process.cwd(), relative), "utf8"));

describe("safety owns the only map on its page", () => {
  it("declares /safety a map surface that draws its own map", () => {
    expect(isMapSurfaceRoute("/safety")).toBe(true);
    expect(routeOwnsMap("/safety")).toBe(true);
    // The conjunction is the whole fix: the shell's controls belong only where
    // the shell's map is both drawn AND read.
    expect(showsSharedMapControls("/safety")).toBe(false);
  });

  it("keeps the shell's dock off every route that owns its map", () => {
    for (const route of MAP_OWNING_ROUTES) {
      pathnameMock.mockReturnValue(route);
      const { unmount } = render(
        <MapSurfaceOnly>
          <div>shell map control</div>
        </MapSurfaceOnly>
      );
      expect(
        screen.queryByText("shell map control"),
        `${route} builds its own mapboxgl.Map, so a shell control mounted there drives a map the ` +
          `planner cannot see.`
      ).not.toBeInTheDocument();
      unmount();
    }
  });

  /**
   * THE BACKDROP MUST READ THE SHARED LIST RATHER THAN KEEPING ITS OWN.
   *
   * This is the defect in its original form: `MAP_OWNING_ROUTES` was a private
   * const inside `cartographic-map-backdrop.tsx` while `MAP_SURFACE_ROUTES`
   * lived in `lib/navigation`. Two halves of one rule, in two files that could
   * not see each other, and they drifted for months — `/safety` was on one list
   * and not the other, which is exactly the state that put two maps on the
   * screen. A second literal list reintroduces the drift, so this reads the
   * source and refuses one.
   */
  it("leaves the backdrop with no second copy of the ownership list", () => {
    const backdrop = repoFile("src/components/cartographic/cartographic-map-backdrop.tsx");

    expect(backdrop).toContain("routeOwnsMap");
    expect(
      /const\s+MAP_OWNING_ROUTES\s*=/.test(backdrop),
      "cartographic-map-backdrop.tsx declares its own MAP_OWNING_ROUTES again. Import routeOwnsMap " +
        "from lib/navigation/map-surfaces instead — the two lists drifted once and put a second " +
        "Mapbox instance on /safety."
    ).toBe(false);

    // Negative control: if the file could not be read, or comment-stripping ate
    // everything, both assertions above would pass while proving nothing.
    expect(backdrop.length).toBeGreaterThan(1000);
    expect(backdrop).toContain("CartographicMapBackdrop");
  });

  /**
   * THE REPLACEMENTS ARE ACTUALLY MOUNTED.
   *
   * Taking the shell's controls away is only half a fix; the recorded failure
   * mode in this repository is complete, tested capability that no planner can
   * reach. Safety has to carry its own background picker, its own workspace
   * layer panel, its own `?layer=` handler and its own full-bleed opt-in, or the
   * page simply loses four things and gains none.
   */
  it("mounts safety's own map controls in place of the shell's", () => {
    const workspace = repoFile("src/components/safety/safety-workspace.tsx");

    for (const control of [
      // Background picker — governs the crash map's style.
      "<PublicBasemapPicker",
      // The agency's uploaded layers, bound to the crash map below.
      "<SafetyWorkspaceLayersPanel",
      // "Show on the map" from the Data Hub. MAP_SURFACE_ROUTES[0] is /safety,
      // and the shell's own deep link no longer mounts here.
      "<SafetyLayerDeepLink",
      // Lets the map fill the route surface.
      "<SafetyMapFillsSurface",
      // The severity key for the dots this map paints.
      "<CrashSeverityKey",
    ]) {
      expect(workspace, `${control} is not rendered by safety-workspace.tsx`).toContain(control);
    }

    // The binding that puts workspace layers on THIS map — the third caller of
    // the shared hook, rather than a fourth copy of its bookkeeping.
    expect(workspace).toContain("useWorkspaceGisMapBinding");
    expect(workspace).toContain("onMapReady");

    expect(workspace.length).toBeGreaterThan(1000);
  });

  /**
   * THE AGENCY'S LAYERS GO UNDER THE COLLISIONS, NEVER OVER THEM.
   *
   * The page exists to show where people were hurt. A parcel fabric or a zoning
   * layer drawn on top of the crash dots hides the subject behind its context,
   * and the anchor is the only thing standing between the two — Mapbox reads a
   * missing anchor as "on top".
   */
  it("anchors workspace layers beneath the crash layers", () => {
    const withBoth = {
      getLayer: (id: string) =>
        id === "safety-crash-halo" || id === "safety-crash-core" ? { id } : undefined,
    };
    // The HALO is the lower of the two, so it is the correct anchor: inserting
    // beneath the core alone would leave workspace layers over the halo.
    expect(safetyWorkspaceGisAnchorLayerId(withBoth)).toBe("safety-crash-halo");

    const coreOnly = {
      getLayer: (id: string) => (id === "safety-crash-core" ? { id } : undefined),
    };
    expect(safetyWorkspaceGisAnchorLayerId(coreOnly)).toBe("safety-crash-core");

    // Nothing drawn yet: undefined, which Mapbox reads as "on top" — correct,
    // because there is nothing to sit beneath.
    expect(safetyWorkspaceGisAnchorLayerId({ getLayer: () => undefined })).toBeUndefined();
  });

  it("still sends the layer library's Show-on-the-map link to safety", () => {
    // The Data Hub builds that link from MAP_SURFACE_ROUTES[0]. Safety keeping
    // its place there is only safe because it answers `?layer=` itself now.
    expect(MAP_SURFACE_ROUTES[0]).toBe("/safety");
    expect(repoFile("src/components/safety/safety-layer-deep-link.tsx")).toContain(
      "MAP_LAYER_DEEP_LINK_PARAM"
    );
  });
});
