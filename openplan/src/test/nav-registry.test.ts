import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CARTOGRAPHIC_RAIL_ICON_NAMES } from "@/components/cartographic/cartographic-rail";
import {
  APP_NAV_ENTRIES,
  buildPaletteCommands,
  buildRailGroups,
  navLabel,
  protectedRoutePrefixes,
} from "@/components/nav/nav-registry";

const APP_ROUTE_DIR = path.resolve(__dirname, "../app/(app)");

/**
 * Route directories that intentionally have no nav entry. Each one must still
 * exist on disk — when a stub is finally deleted, this list fails so the
 * exemption cannot outlive the thing it exempts.
 */
const NAV_EXEMPT_ROUTE_DIRS = [
  // /billing survives only as a redirect stub into /invoicing, kept so old
  // bookmarks and deep links keep working. It is protected (the redirect
  // target is workspace-scoped) but never navigated to.
  "billing",
];

describe("nav registry — the single source for every nav and the auth proxy", () => {
  it("registers every (app) route surface, with a live allowlist for intentional omissions", () => {
    const routeDirs = readdirSync(APP_ROUTE_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const registeredHrefs = new Set(APP_NAV_ENTRIES.map((entry) => entry.href));

    for (const exempt of NAV_EXEMPT_ROUTE_DIRS) {
      expect(
        routeDirs,
        `allowlisted route dir "${exempt}" no longer exists — remove it from NAV_EXEMPT_ROUTE_DIRS`,
      ).toContain(exempt);
      expect(
        registeredHrefs.has(`/${exempt}`),
        `"${exempt}" is allowlisted as nav-exempt but also has a registry entry — it cannot be both`,
      ).toBe(false);
    }

    for (const dir of routeDirs) {
      if (NAV_EXEMPT_ROUTE_DIRS.includes(dir)) continue;
      expect(
        registeredHrefs.has(`/${dir}`),
        `route dir "(app)/${dir}" has no nav-registry entry — add it to APP_NAV_ENTRIES or, if it is intentionally unlisted, to NAV_EXEMPT_ROUTE_DIRS`,
      ).toBe(true);
    }
  });

  it("keeps the rail's canonical groups, order, and labels", () => {
    const groups = buildRailGroups();
    expect(groups.map((group) => group.title)).toEqual(["Operate", "Analyze"]);
    expect(groups[0]?.items.map((item) => `${item.href}·${item.label}`)).toEqual([
      "/dashboard·Overview",
      "/command-center·Command Center",
      "/projects·Projects",
      "/rtp·RTP Cycles",
      "/plans·Plans",
      "/programs·Programs",
      "/grants·Grants",
      "/reports·Reports",
      "/invoicing·Invoicing",
    ]);
    expect(groups[1]?.items.map((item) => `${item.href}·${item.label}`)).toEqual([
      "/engagement·Engagement",
      "/safety·Safety",
      "/explore·Analysis Studio",
      "/scenarios·Scenarios",
      "/models·Models",
      "/county-runs·County Validation",
      "/data-hub·Data Hub",
      "/knowledge-base·Knowledge Base",
      "/aerial·Aerial Ops",
    ]);
  });

  it("puts every registered surface in the command palette, including Safety, Knowledge Base, and County Validation", () => {
    const commands = buildPaletteCommands();
    const hrefs = commands.map((command) => command.href);

    expect(hrefs).toContain("/safety");
    expect(hrefs).toContain("/knowledge-base");
    expect(hrefs).toContain("/county-runs");
    // Rail-hidden surfaces stay findable from the palette.
    expect(hrefs).toContain("/assistant-activity");
    expect(new Set(hrefs).size).toBe(APP_NAV_ENTRIES.length);

    // The old "billing" habit still finds the LAPM invoice register.
    const invoicing = commands.find((command) => command.href === "/invoicing");
    expect(invoicing?.keywords).toContain("billing");
  });

  it("covers every registry href with a protected route prefix", () => {
    const prefixes = protectedRoutePrefixes();
    for (const entry of APP_NAV_ENTRIES) {
      expect(
        prefixes.some((prefix) => entry.href.startsWith(prefix)),
        `${entry.href} is navigable but not behind the auth proxy`,
      ).toBe(true);
    }
    // The two routable-but-unlisted prefixes the proxy also guards.
    expect(prefixes).toContain("/workspace");
    expect(prefixes).toContain("/billing");
  });

  it("carries no operator-only /admin surface anywhere", () => {
    const everywhere = [
      ...APP_NAV_ENTRIES.map((entry) => entry.href),
      ...protectedRoutePrefixes(),
      ...buildPaletteCommands().map((command) => command.href),
    ];
    for (const href of everywhere) {
      expect(href).not.toMatch(/^\/admin/);
    }
  });

  it("uses only icon names the cartographic rail can render", () => {
    for (const entry of APP_NAV_ENTRIES) {
      expect(
        CARTOGRAPHIC_RAIL_ICON_NAMES,
        `icon "${entry.icon}" for ${entry.href} is not in the rail's ICONS map`,
      ).toContain(entry.icon);
    }
  });

  it("resolves canonical labels and falls back to the href for unregistered surfaces", () => {
    expect(navLabel("/explore")).toBe("Analysis Studio");
    expect(navLabel("/dashboard")).toBe("Overview");
    expect(navLabel("/not-a-registered-surface")).toBe("/not-a-registered-surface");
  });
});
