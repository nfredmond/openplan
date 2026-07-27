/**
 * The single source of truth for the authenticated (app) navigation surface.
 *
 * Four navs and the auth proxy all consume this registry — the cartographic
 * rail, the command palette, the contextual secondary nav, and the top nav —
 * so a module cannot appear in one and drift out of another, and a routable
 * surface cannot exist without a sign-in gate in front of it.
 *
 * Pure data and pure functions only: `src/proxy.ts` imports this module in the
 * middleware runtime, so it must never carry "use client", React, component
 * imports, or side effects. Icons are therefore NAMES here; the rail resolves
 * them to components against its own ICONS map.
 *
 * Operator-only surfaces do not exist in this registry — there are none left
 * in the product (the /admin console is deleted), and the nav is for everyone.
 */

export type AppNavRailGroup = "operate" | "analyze";

export type AppNavEntry = {
  /** Route prefix of the surface — also its auth-protection prefix. */
  href: string;
  /** Canonical human label, used verbatim by every nav that shows one. */
  label: string;
  /** Which rail group the surface belongs to. */
  railGroup: AppNavRailGroup;
  /** Icon NAME, resolved against the ICONS map in cartographic-rail.tsx. */
  icon: string;
  /** Extra command-palette search terms beyond the label and group. */
  paletteKeywords?: string;
  /**
   * A surface deliberately kept off the compact rail. It stays in the command
   * palette and behind the auth proxy — hidden from one nav, never unlisted.
   */
  railHidden?: boolean;
};

const RAIL_GROUP_TITLES: Record<AppNavRailGroup, string> = {
  operate: "Operate",
  analyze: "Analyze",
};

/**
 * Entries are in rail order: the "operate" group top to bottom, then the
 * "analyze" group top to bottom. buildRailGroups() preserves this order, so
 * reordering here reorders the rail.
 */
export const APP_NAV_ENTRIES: AppNavEntry[] = [
  {
    href: "/dashboard",
    label: "Overview",
    railGroup: "operate",
    icon: "overview",
    paletteKeywords: "home dashboard overview",
  },
  {
    href: "/command-center",
    label: "Command Center",
    railGroup: "operate",
    icon: "command",
    paletteKeywords: "operations cross-domain",
  },
  {
    href: "/projects",
    label: "Projects",
    railGroup: "operate",
    icon: "projects",
    paletteKeywords: "delivery control room milestones",
  },
  {
    href: "/rtp",
    label: "RTP Cycles",
    railGroup: "operate",
    icon: "rtp",
    paletteKeywords: "regional transportation plan cycle",
  },
  { href: "/plans", label: "Plans", railGroup: "operate", icon: "plans" },
  {
    href: "/programs",
    label: "Programs",
    railGroup: "operate",
    icon: "programs",
    paletteKeywords: "rtip stip funding windows",
  },
  {
    href: "/grants",
    label: "Grants",
    railGroup: "operate",
    icon: "grants",
    paletteKeywords: "funding opportunities narrative bca",
  },
  {
    href: "/reports",
    label: "Reports",
    railGroup: "operate",
    icon: "reports",
    paletteKeywords: "packets exports provenance",
  },
  {
    // "Billing" is not a concept in OpenPlan — it is free, with no plan and no
    // checkout. What is real here is the Caltrans LAPM grant-reimbursement
    // invoice register: an agency invoicing ITS FUNDER. The "billing" keyword
    // is kept so a saved habit still finds the right surface, and "govern" so
    // the palette group the entry used to sit under still matches a search.
    href: "/invoicing",
    label: "Invoicing",
    railGroup: "operate",
    icon: "billing",
    paletteKeywords: "invoice reimbursement LAPM billing govern",
  },
  {
    // In the palette and the secondary nav, but deliberately off the compact
    // rail: the audit ledger is a governance surface planners visit on
    // purpose, not a daily working module.
    href: "/assistant-activity",
    label: "Agent Activity",
    railGroup: "operate",
    icon: "activity",
    paletteKeywords: "planner agent audit ledger govern",
    railHidden: true,
  },
  {
    href: "/engagement",
    label: "Engagement",
    railGroup: "analyze",
    icon: "engagement",
    paletteKeywords: "community public map comments",
  },
  {
    href: "/safety",
    label: "Safety",
    railGroup: "analyze",
    icon: "safety",
    paletteKeywords: "crash collision injury screening",
  },
  {
    href: "/explore",
    label: "Analysis Studio",
    railGroup: "analyze",
    icon: "analysis",
    paletteKeywords: "corridor analysis explore",
  },
  {
    href: "/scenarios",
    label: "Scenarios",
    railGroup: "analyze",
    icon: "scenarios",
    paletteKeywords: "baseline comparison",
  },
  {
    href: "/models",
    label: "Models",
    railGroup: "analyze",
    icon: "models",
    paletteKeywords: "travel demand model run any place",
  },
  {
    href: "/county-runs",
    label: "County Validation",
    railGroup: "analyze",
    icon: "county",
    paletteKeywords: "onboarding screening",
  },
  {
    href: "/data-hub",
    label: "Data Hub",
    railGroup: "analyze",
    icon: "data",
    paletteKeywords: "datasets geometry",
  },
  {
    href: "/knowledge-base",
    label: "Knowledge Base",
    railGroup: "analyze",
    icon: "knowledge",
    paletteKeywords: "documents plans studies grounding citations",
  },
  {
    href: "/aerial",
    label: "Aerial Ops",
    railGroup: "analyze",
    icon: "aerial",
    paletteKeywords: "drone mission imagery",
  },
];

export type AppNavRailGroupDefinition = {
  title: string;
  items: Array<{ href: string; label: string; icon: string }>;
};

/** The rail's groups, in registry order, without rail-hidden surfaces. */
export function buildRailGroups(): AppNavRailGroupDefinition[] {
  return (Object.keys(RAIL_GROUP_TITLES) as AppNavRailGroup[]).map((group) => ({
    title: RAIL_GROUP_TITLES[group],
    items: APP_NAV_ENTRIES.filter(
      (entry) => entry.railGroup === group && !entry.railHidden,
    ).map(({ href, label, icon }) => ({ href, label, icon })),
  }));
}

export type AppNavPaletteCommand = {
  label: string;
  href: string;
  group: string;
  keywords?: string;
};

/** Every registered surface as a command, grouped like the rail. */
export function buildPaletteCommands(): AppNavPaletteCommand[] {
  return APP_NAV_ENTRIES.map((entry) => ({
    label: entry.label,
    href: entry.href,
    group: RAIL_GROUP_TITLES[entry.railGroup],
    ...(entry.paletteKeywords ? { keywords: entry.paletteKeywords } : {}),
  }));
}

/**
 * Route prefixes the auth proxy puts behind sign-in: every registered surface,
 * plus two carried-forward prefixes — "/workspace" (no page route exists under
 * it today; kept from the old proxy list so any future workspace-scoped page
 * is born protected) and "/billing" (survives only as a redirect stub into
 * /invoicing, so the stub redirects through sign-in like its target).
 */
export function protectedRoutePrefixes(): string[] {
  return [...APP_NAV_ENTRIES.map((entry) => entry.href), "/workspace", "/billing"];
}

/**
 * The canonical label for a registered href. Falls back to the href itself so
 * an unregistered surface renders as its path instead of crashing a nav.
 */
export function navLabel(href: string): string {
  return APP_NAV_ENTRIES.find((entry) => entry.href === href)?.label ?? href;
}
