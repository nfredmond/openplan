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
 * Group order is deliberate: daily operating context first (Workspace), then
 * the documents planners maintain (Plans & Programming), the money that
 * delivers them (Funding), the evidence that justifies them (Analysis &
 * Modeling), the public that reviews them (Community), and the reference
 * material under it all (Library).
 *
 * Operator-only surfaces do not exist in this registry — there are none left
 * in the product (the /admin console is deleted), and the nav is for everyone.
 */

export type AppNavRailGroup =
  | "workspace"
  | "plans"
  | "funding"
  | "analysis"
  | "community"
  | "library";

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
  workspace: "Workspace",
  plans: "Plans & Programming",
  funding: "Funding",
  analysis: "Analysis & Modeling",
  community: "Community",
  library: "Library",
};

/**
 * Entries are in rail order, group by group. buildRailGroups() preserves this
 * order, so reordering here reorders the rail.
 */
export const APP_NAV_ENTRIES: AppNavEntry[] = [
  {
    href: "/dashboard",
    label: "Overview",
    railGroup: "workspace",
    icon: "overview",
    // "command center" kept so the old name for the dashboard's cross-domain
    // queue still lands here from the palette.
    paletteKeywords: "home dashboard overview command center operations cross-domain",
  },
  {
    href: "/projects",
    label: "Projects",
    railGroup: "workspace",
    icon: "projects",
    paletteKeywords: "delivery control room milestones",
  },
  {
    href: "/reports",
    label: "Reports",
    railGroup: "workspace",
    icon: "reports",
    // "packets" is a never-rendered search term only — an old habit for what
    // reports were once called, kept so the palette still answers it.
    paletteKeywords: "packets exports provenance",
  },
  {
    href: "/assistant-activity",
    label: "Planner Agent Activity",
    railGroup: "workspace",
    icon: "activity",
    paletteKeywords: "agent activity audit ledger govern",
  },
  {
    href: "/rtp",
    label: "Regional Plan (RTP)",
    railGroup: "plans",
    icon: "rtp",
    paletteKeywords: "regional transportation plan rtp cycles",
  },
  { href: "/plans", label: "Plans", railGroup: "plans", icon: "plans" },
  {
    href: "/programs",
    label: "Programming Cycles",
    railGroup: "plans",
    icon: "programs",
    paletteKeywords: "rtip stip funding windows programs",
  },
  {
    href: "/grants",
    label: "Grants",
    railGroup: "funding",
    icon: "grants",
    paletteKeywords: "funding opportunities narrative bca",
  },
  {
    // "Billing" is not a concept in OpenPlan — it is free, with no plan and no
    // checkout. What is real here is the Caltrans LAPM grant-reimbursement
    // invoice register: an agency invoicing ITS FUNDER — which is why the
    // label says "Invoices & Reimbursements", never anything that could be
    // read as OpenPlan charging the user. The "billing" keyword is kept so a
    // saved habit still finds the right page, and "govern" so the palette
    // group the entry used to sit under still matches a search.
    href: "/invoicing",
    label: "Invoices & Reimbursements",
    railGroup: "funding",
    icon: "invoicing",
    paletteKeywords: "billing invoicing LAPM reimbursement govern",
  },
  {
    href: "/models",
    label: "Models",
    railGroup: "analysis",
    icon: "models",
    paletteKeywords: "travel demand model run any place",
  },
  {
    href: "/scenarios",
    label: "Scenarios",
    railGroup: "analysis",
    icon: "scenarios",
    paletteKeywords: "baseline comparison",
  },
  {
    href: "/explore",
    label: "Corridor Analysis",
    railGroup: "analysis",
    icon: "analysis",
    // "analysis studio" was this module's old name; kept searchable.
    paletteKeywords: "corridor analysis studio explore",
  },
  {
    href: "/county-runs",
    label: "Model Validation",
    railGroup: "analysis",
    icon: "county",
    paletteKeywords:
      "county validation county runs counts calibration onboarding screening",
  },
  {
    href: "/safety",
    label: "Safety",
    railGroup: "analysis",
    icon: "safety",
    paletteKeywords: "crash collision injury screening",
  },
  {
    // Deliberately a one-item group: it headlines the flagship public-input
    // module and leaves room for future public-facing entries.
    href: "/engagement",
    label: "Engagement",
    railGroup: "community",
    icon: "engagement",
    paletteKeywords: "community public map comments",
  },
  {
    href: "/data-hub",
    label: "Data Hub",
    railGroup: "library",
    icon: "data",
    paletteKeywords: "datasets geometry",
  },
  {
    // The Document Library grew out of the Knowledge Base (2026-08-11): the
    // page now indexes every file OpenPlan holds for the workspace, so the
    // label says what a planner is looking for ("where are my files?") while
    // the href stays /knowledge-base — the path rename is deliberately
    // deferred, and "knowledge base" stays searchable as the retired name.
    href: "/knowledge-base",
    label: "Documents",
    railGroup: "library",
    icon: "knowledge",
    paletteKeywords:
      "documents files knowledge base plans studies grounding citations reports exports imagery artifacts library",
  },
  {
    href: "/aerial",
    label: "Aerial Imagery",
    railGroup: "library",
    icon: "aerial",
    paletteKeywords: "aerial ops drone mission imagery",
  },
  {
    // Last in Library on purpose: reference material about the reference
    // material. What OpenPlan is, what each module does, the setup guides, and
    // which fixes belong to whoever operates the deployment.
    href: "/help",
    label: "Help",
    railGroup: "library",
    icon: "help",
    paletteKeywords: "help documentation guides getting started modules support docs",
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

export type AppNavSection = {
  title: string;
  items: Array<{ href: string; label: string }>;
};

/**
 * The contextual section for a pathname: the registry group the current page
 * belongs to, with every member of that group in registry order. The secondary
 * nav renders this directly, so it can never carry a grouping the rail and the
 * palette do not — the registry's groups ARE the only grouping.
 *
 * Longest-prefix match, with the same `===` / `startsWith(href + "/")` test
 * the navs use for active-state, so `/rtp/some-cycle` still resolves to the
 * Plans & Programming group. Unregistered paths return null and the secondary
 * nav renders nothing.
 */
export function findNavSection(pathname: string): AppNavSection | null {
  let matched: AppNavEntry | undefined;
  for (const entry of APP_NAV_ENTRIES) {
    const hit = pathname === entry.href || pathname.startsWith(`${entry.href}/`);
    if (hit && (!matched || entry.href.length > matched.href.length)) {
      matched = entry;
    }
  }
  if (!matched) return null;
  const group = matched.railGroup;
  return {
    title: RAIL_GROUP_TITLES[group],
    items: APP_NAV_ENTRIES.filter((entry) => entry.railGroup === group).map(
      ({ href, label }) => ({ href, label }),
    ),
  };
}

/**
 * Route prefixes the auth proxy puts behind sign-in: every registered surface,
 * plus three carried-forward prefixes — "/workspace" (no page route exists
 * under it today; kept from the old proxy list so any future workspace-scoped
 * page is born protected), "/billing" (survives only as a redirect stub into
 * /invoicing, so the stub redirects through sign-in like its target), and
 * "/command-center" (survives only as a redirect stub into /dashboard, kept
 * protected for the same reason).
 */
export function protectedRoutePrefixes(): string[] {
  return [
    ...APP_NAV_ENTRIES.map((entry) => entry.href),
    "/workspace",
    "/billing",
    "/command-center",
  ];
}

/**
 * The canonical label for a registered href. Falls back to the href itself so
 * an unregistered surface renders as its path instead of crashing a nav.
 */
export function navLabel(href: string): string {
  return APP_NAV_ENTRIES.find((entry) => entry.href === href)?.label ?? href;
}
