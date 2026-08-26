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
  // /command-center survives only as a redirect stub into /dashboard — the
  // Overview page absorbed it in the 2026-08-10 navigation overhaul. Same
  // deal: protected, bookmark-safe, never navigated to.
  "command-center",
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
    expect(groups.map((group) => group.title)).toEqual([
      "Workspace",
      "Plans & Programming",
      "Funding",
      "Analysis & Modeling",
      "Community",
      "Library",
    ]);
    const items = groups.map((group) =>
      group.items.map((item) => `${item.href}·${item.label}`),
    );
    expect(items[0]).toEqual([
      "/dashboard·Overview",
      "/workspace·Workspace setup & health",
      // Position 2 in the Workspace group, above Projects: the personal work
      // queue is the one surface that comes to the planner rather than being
      // gone into (design memo 2026-08-11).
      "/my-work·My Work",
      "/projects·Projects",
      "/reports·Reports",
      "/assistant-activity·Planner Agent Activity",
    ]);
    expect(items[1]).toEqual([
      "/rtp·Regional Plan (RTP)",
      "/land-use-plans·Land Use Plans",
      "/plans·Plans",
      "/programs·Programming Cycles",
    ]);
    expect(items[2]).toEqual([
      "/grants·Grants",
      "/invoicing·Invoices & Reimbursements",
    ]);
    expect(items[3]).toEqual([
      "/models·Travel modeling",
      "/explore·Corridor Analysis",
      "/safety·Safety",
    ]);
    expect(items[4]).toEqual(["/engagement·Engagement"]);
    expect(items[5]).toEqual([
      "/data-hub·Data Hub",
      "/knowledge-base·Documents",
      "/aerial·Aerial Imagery",
      "/help·Help",
    ]);
  });

  it("shows the Planner Agent Activity ledger on the rail — it is not hidden", () => {
    const railHrefs = buildRailGroups().flatMap((group) =>
      group.items.map((item) => item.href),
    );
    expect(railHrefs).toContain("/assistant-activity");
  });

  it("puts every registered surface in the command palette, and answers retired names", () => {
    const commands = buildPaletteCommands();
    const hrefs = commands.map((command) => command.href);

    expect(hrefs).toContain("/safety");
    expect(hrefs).toContain("/knowledge-base");
    expect(hrefs).toContain("/county-runs");
    expect(hrefs).toContain("/assistant-activity");
    expect(new Set(hrefs).size).toBe(APP_NAV_ENTRIES.length);

    // The old "billing" habit still finds the LAPM invoice register.
    const invoicing = commands.find((command) => command.href === "/invoicing");
    expect(invoicing?.keywords).toContain("billing");
    // The retired "Command Center" name still lands on Overview…
    const overview = commands.find((command) => command.href === "/dashboard");
    expect(overview?.keywords).toContain("command center");
    // …and the retired "Analysis Studio" name still lands on Corridor Analysis.
    const explore = commands.find((command) => command.href === "/explore");
    expect(explore?.keywords).toContain("analysis studio");
    // The retired "Knowledge Base" name still finds the Documents library, and
    // the widened library is findable by what it now indexes.
    const documents = commands.find((command) => command.href === "/knowledge-base");
    expect(documents?.keywords).toContain("knowledge base");
    expect(documents?.keywords).toContain("reports");
    expect(documents?.keywords).toContain("imagery");
  });

  it("covers every registry href with a protected route prefix", () => {
    const prefixes = protectedRoutePrefixes();
    for (const entry of APP_NAV_ENTRIES) {
      expect(
        prefixes.some((prefix) => entry.href.startsWith(prefix)),
        `${entry.href} is navigable but not behind the auth proxy`,
      ).toBe(true);
    }
    // The routable-but-unlisted prefixes the proxy also guards.
    expect(prefixes).toContain("/workspace");
    expect(prefixes).toContain("/billing");
    expect(prefixes).toContain("/command-center");
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
    expect(navLabel("/explore")).toBe("Corridor Analysis");
    expect(navLabel("/dashboard")).toBe("Overview");
    expect(navLabel("/knowledge-base")).toBe("Documents");
    expect(navLabel("/invoicing")).toBe("Invoices & Reimbursements");
    expect(navLabel("/not-a-registered-surface")).toBe("/not-a-registered-surface");
  });

  it("keeps specialist modeling pages in the palette but off the compact rail", () => {
    const railHrefs = buildRailGroups().flatMap((group) => group.items.map((item) => item.href));
    const paletteHrefs = buildPaletteCommands().map((command) => command.href);

    expect(railHrefs).toContain("/models");
    expect(railHrefs).not.toContain("/scenarios");
    expect(railHrefs).not.toContain("/county-runs");
    expect(paletteHrefs).toContain("/scenarios");
    expect(paletteHrefs).toContain("/county-runs");
  });
});
