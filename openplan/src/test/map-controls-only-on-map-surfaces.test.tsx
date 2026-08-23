import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const pathnameMock = vi.fn<() => string>();

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
}));

import { MapSurfaceOnly } from "@/components/cartographic/map-surface-only";
import {
  isMapSurfaceRoute,
  MAP_SURFACE_ROUTES,
  routeOwnsMap,
  showsSharedMapControls,
} from "@/lib/navigation/map-surfaces";
import { stripSourceComments } from "./helpers/source-text";

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

  it("renders on a map surface that reads the SHELL's map", () => {
    pathnameMock.mockReturnValue("/aerial");

    render(
      <MapSurfaceOnly>
        <div>layers panel</div>
      </MapSurfaceOnly>
    );

    expect(screen.getByText("layers panel")).toBeInTheDocument();
  });

  /**
   * ═══ /safety USED TO BE THE EXAMPLE IN THE TEST ABOVE (until 2026-08-13) ═══
   *
   * It is still a map surface — a planner opens it to read where the collisions
   * are — and it also builds its OWN `mapboxgl.Map` in
   * `components/safety/safety-crash-map.tsx`. Being a map surface was the whole
   * test, so the shell's dock mounted, and measured in a real browser at
   * 1600×900 that produced:
   *
   *   - two Mapbox instances on one screen: a 1600×900 backdrop at (0,0) behind
   *     the opaque page panel, and the 558×457 crash map at (305,350) in front;
   *   - a layers panel 240×458 and a legend 240×258 docked at x=1344, both
   *     driving the BACKDROP — the map the planner cannot see;
   *   - at 390×844 it was worse: the panel sat at x=134, over the phone screen,
   *     still controlling the hidden map.
   *
   * A control that reports success and changes nothing visible is worse than a
   * missing control. Safety mounts its own background picker, workspace-layer
   * panel and severity key against the map it actually draws.
   *
   * Do not re-add `/safety` to make a layers panel appear here: that panel
   * cannot reach Safety's map, and the one that can is already in its sidebar.
   */
  it("renders nothing on a map surface that owns its own map", () => {
    for (const route of ["/safety", "/explore", "/aerial/missions/mission-id"]) {
      pathnameMock.mockReturnValue(route);
      const { unmount } = render(
        <MapSurfaceOnly>
          <div>layers panel</div>
        </MapSurfaceOnly>
      );
      expect(
        screen.queryByText("layers panel"),
        `The shell's map dock mounted on ${route}, which draws its own Mapbox instance — so every ` +
          `control in it would drive a map the planner cannot see.`
      ).not.toBeInTheDocument();
      unmount();
    }
  });

  it("keeps ownership and surface-hood as one decision", () => {
    // `/safety` is BOTH: the map is read there, and the route draws it itself.
    // The pair is what `showsSharedMapControls` exists to resolve, and asserting
    // both halves is what stops a future edit "fixing" this by quietly dropping
    // `/safety` from MAP_SURFACE_ROUTES — which would send the Data Hub's "Show
    // on the map" link (MAP_SURFACE_ROUTES[0]) somewhere else.
    expect(isMapSurfaceRoute("/safety")).toBe(true);
    expect(routeOwnsMap("/safety")).toBe(true);
    expect(showsSharedMapControls("/safety")).toBe(false);
    expect(MAP_SURFACE_ROUTES[0]).toBe("/safety");

    // Prefix leakage, on the ownership list too.
    expect(routeOwnsMap("/safety-plans")).toBe(false);
    expect(routeOwnsMap("/safety/corridors")).toBe(true);
    expect(routeOwnsMap(null)).toBe(false);
  });

  /** A mission stays geographic but owns its own map and controls. */
  it("keeps the shell map dock off an Aerial mission's evidence sidebar", () => {
    const missionPath = "/aerial/missions/9a7c1f22-0000-4000-8000-000000000001";
    expect(isMapSurfaceRoute(missionPath)).toBe(true);
    expect(routeOwnsMap(missionPath)).toBe(true);
    expect(showsSharedMapControls(missionPath)).toBe(false);
    expect(routeOwnsMap("/aerial")).toBe(false);
    expect(isMapSurfaceRoute("/safety/corridors")).toBe(true);
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

  /**
   * The dashboard was listed here at first and should not have been.
   *
   * The argument for it was that the overview draws projects and pins, so the
   * map is its canvas. Watching it at half a widescreen settled it the other
   * way: the dashboard is a column of setup, team and integration cards, and
   * the layers box plus legend took the right ~340px and squeezed the header to
   * 916px — which is what made the search pill wrap. The map is decoration
   * there, exactly as it is on the records pages.
   *
   * The test for this list is not "does the map show anything" but "would a
   * planner open this page in order to READ the map".
   */
  it("does not treat the workspace overview as a map surface", () => {
    expect(isMapSurfaceRoute("/dashboard")).toBe(false);
  });

  it("answers false rather than throwing when there is no pathname", () => {
    expect(isMapSurfaceRoute(null)).toBe(false);
    expect(isMapSurfaceRoute(undefined)).toBe(false);
  });

  it("declares the surfaces the map is actually worked on", () => {
    expect(MAP_SURFACE_ROUTES).toEqual(expect.arrayContaining(["/safety", "/aerial"]));
  });

  /**
   * `/explore` IS NOT ONE OF THEM, AND THAT IS THE COUNTERINTUITIVE PART.
   *
   * It is the page where a map fills the working area, so it reads like the
   * strongest member of this list. But the map it fills the area with is its
   * OWN `mapboxgl.Map`, built in `explore/_components/use-explore-map-instance`,
   * and the shared backdrop suppresses itself on that route entirely. The
   * shared controls therefore control nothing a planner can see.
   *
   * Listing it here was not merely useless. The panel mounted, CSS hid it, and
   * the hidden-but-present element still satisfied the `:has(.op-cart-layers)`
   * rule that reserves the 272px right gutter — so the studio was squeezed by
   * ~256px to make room for a control that rendered nothing, and paid for its
   * `/api/map-features/counts` fetch on every visit.
   *
   * This comes back only when workspace layers actually draw on Explore's own
   * instance. Do not re-add it to make a layers panel appear there.
   */
  it("does not treat corridor analysis as a shared-map surface", () => {
    expect(isMapSurfaceRoute("/explore")).toBe(false);
    expect(MAP_SURFACE_ROUTES).not.toContain("/explore");
  });

  /**
   * EVERY MAP CONTROL IS ACTUALLY WRAPPED — which is the part the tests above
   * cannot see.
   *
   * Everything before this point exercises `MapSurfaceOnly` and
   * `isMapSurfaceRoute` on their own. Both were correct on the day they landed
   * (2026-08-08) and the product still shipped ＋/− zoom buttons in the
   * bottom-right corner of every records page: the layers panel and the legend
   * were moved inside `MapSurfaceOnly` and `CartographicZoomControls` was left
   * one line below the closing tag. Every test above passed, on both days. A
   * rule can be right and its wiring incomplete, and a test that renders the
   * rule in isolation proves only the rule.
   *
   * So this reads the shell and asserts the JSX placement. Reported from the
   * browser on 2026-08-09, the second control to be found this way.
   */
  it("wraps every map control inside MapSurfaceOnly in the shell", () => {
    const shell = stripSourceComments(
      readFileSync(
        path.join(process.cwd(), "src/components/cartographic/cartographic-shell.tsx"),
        "utf8"
      )
    );

    // Comments are stripped first because the shell explains this very rule in
    // prose directly above the wrapper, and a guard that reads its own
    // explanation as evidence proves nothing.
    const wrapped = [...shell.matchAll(/<MapSurfaceOnly>([\s\S]*?)<\/MapSurfaceOnly>/g)]
      .map((match) => match[1])
      .join("\n");

    const MAP_CONTROLS = [
      "CartographicLayersPanel",
      "CartographicMapLegend",
      "CartographicZoomControls",
      /*
        THE MAP-READING TOGGLE IS THE ONE THIS RULE MATTERS MOST FOR (added
        2026-08-12). It takes the route-content panel off the screen, and the
        ONLY thing that ends that mode is the control unmounting — which happens
        because it lives inside `MapSurfaceOnly` and nowhere else. Rendered
        outside the wrapper it would appear on the RTP registry, the Projects
        table and every form in the product, offering to hide the page a planner
        came to read; and having hidden it, nothing would restore it on
        navigation. Two of the three controls above shipped outside this wrapper
        at some point; this one must never.
      */
      "CartographicMapReadingToggle",
      // Renders nothing, but reads `?layer=` and switches a layer on. Off a map
      // surface there is no panel to show the result in.
      "CartographicLayerDeepLink",
    ];

    const unwrapped = MAP_CONTROLS.filter((control) => {
      const rendered = new RegExp(`<${control}\\b`).test(shell);
      const insideWrapper = new RegExp(`<${control}\\b`).test(wrapped);
      return rendered && !insideWrapper;
    });

    expect(
      unwrapped,
      `These map controls are rendered in cartographic-shell.tsx outside <MapSurfaceOnly>, so they appear on ` +
        `every signed-in page — over the surface a planner is actually reading. Move them inside the wrapper:\n` +
        unwrapped.map((c) => `  - <${c} />`).join("\n")
    ).toEqual([]);

    // Negative control: if the wrapper block were ever emptied or the regex
    // stopped matching, every control above would count as "not rendered" and
    // this test would pass while proving nothing.
    expect(wrapped.length).toBeGreaterThan(0);
    expect(MAP_CONTROLS.some((control) => new RegExp(`<${control}\\b`).test(shell))).toBe(true);
  });
});
