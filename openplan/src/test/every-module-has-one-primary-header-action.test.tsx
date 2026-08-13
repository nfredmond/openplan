import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE PRIMARY ACTION GOES WHERE A PLANNER LOOKS FOR IT.
 *
 * THE DEFECT. The design system had no header action slot at all —
 * `module-intro-actions`, `module-header-actions` and `module-page-actions` all
 * returned zero hits across `globals.css` and every page. So the one control a
 * planner came to a module to press landed wherever the section order happened
 * to put it: Reports began its "generate a report packet" form — the module's
 * whole purpose — at line 887 of a 1,265-line page, and Engagement and Projects
 * had the same shape. Pages render into `.op-cart-surface`, a fixed panel
 * inset 84px from the top and 16px from the bottom, so on a 1366x768 laptop the
 * intro card and its summary tiles are most of the first screen. Everything
 * below that card is below the fold on the only screen some planners ever see.
 *
 * WHAT THIS PINS, and why each part is here rather than assumed:
 *
 * 1. EXACTLY ONE. A "primary" action is only primary if it is alone. Two
 *    equally-weighted buttons in the slot is the state this guard exists to
 *    keep out, so the count is an equality, not a floor.
 * 2. IN THE HEADER CARD. Asserted by walking up from the button — a slot that
 *    renders somewhere else on the page is the defect wearing the new class
 *    name.
 * 3. IT REACHES ITS TARGET. Every link action's fragment is resolved against
 *    the SAME rendered document. A header button pointing at `#create-report`
 *    when nothing carries that id is a shipped-invisible control, and a source
 *    scan cannot tell a live id from one inside a branch that never renders.
 *    These pages are driven through their real loaders so the id has to survive
 *    the render, not merely appear in the file.
 * 4. IT IS KEYBOARD REACHABLE. Focused for real, and the element has to be a
 *    genuine `<a href>` or `<button>` rather than a clickable div.
 *
 * Safety is in the table with `reaches: null`: its retrieve control acts in
 * place rather than pointing elsewhere. It is here because it was the one
 * module that already had a header action and had built it out of one-off
 * markup — folding it into the shared slot is what keeps this a single pattern
 * instead of two.
 *
 * Knowledge Base is deliberately ABSENT, and that is a finding rather than an
 * omission: its upload tabs are already the first thing under its heading, so a
 * header button would scroll a planner past nothing. A slot added there would
 * be decoration, and decoration is what makes a convention stop meaning
 * anything.
 */

type TableResult = { data: unknown; error: { message: string } | null };

const tableResults = new Map<string, TableResult>();

function resultFor(table: string): TableResult {
  return tableResults.get(table) ?? { data: [], error: null };
}

/**
 * A permissive query builder: every chainable method returns the builder and
 * the builder is a thenable, so any chain these loaders build resolves to the
 * empty, error-free result. This suite is about the header slot, not about row
 * shapes — an empty workspace is the hardest case for it anyway, because a page
 * with nothing in it is exactly where a planner most needs the create control.
 */
function builderFor(table: string) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of [
    "select",
    "order",
    "in",
    "eq",
    "neq",
    "is",
    "limit",
    "or",
    "not",
    "range",
    "gte",
    "lte",
    "filter",
    "overlaps",
    "contains",
  ]) {
    builder[method] = vi.fn(chain);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(resultFor(table)));
  builder.single = vi.fn(() => Promise.resolve(resultFor(table)));
  builder.then = (onFulfilled: unknown, onRejected: unknown) =>
    Promise.resolve(resultFor(table)).then(onFulfilled as never, onRejected as never);
  return builder;
}

const fromMock = vi.fn((table: string) => builderFor(table));
const authGetUserMock = vi.fn();
const createClientMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("redirect");
  }),
  // Several of these pages carry client panels that read the router. They are
  // not stubbed out, because they are part of what competes with the header
  // action for a planner's eye — the "exactly one" count below is only worth
  // anything if the rest of the real page is on screen alongside it.
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) => loadCurrentWorkspaceMembershipMock(...args),
}));

/*
  THE CREATOR FORMS ARE STUBBED; THE DIVS THAT CARRY THEIR IDS ARE NOT.

  Every `id="create-…"` anchor lives on a wrapper the PAGE renders, never inside
  the creator component. Stubbing the forms therefore removes the heavy client
  trees without removing a single link target — if a future change moves an id
  down into a creator, that fragment stops resolving here and this suite says
  so, which is the behavior we want.
*/
vi.mock("@/components/projects/project-workspace-creator", () => ({
  ProjectWorkspaceCreator: () => <div data-testid="project-workspace-creator" />,
}));
vi.mock("@/components/reports/report-creator", () => ({
  ReportCreator: () => <div data-testid="report-creator" />,
}));
vi.mock("@/components/plans/plan-creator", () => ({
  PlanCreator: () => <div data-testid="plan-creator" />,
}));
vi.mock("@/components/programs/program-creator", () => ({
  ProgramCreator: () => <div data-testid="program-creator" />,
}));
vi.mock("@/components/engagement/engagement-campaign-creator", () => ({
  EngagementCampaignCreator: () => <div data-testid="engagement-campaign-creator" />,
}));
vi.mock("@/components/models/model-creator", () => ({
  ModelCreator: () => <div data-testid="model-creator" />,
}));
vi.mock("@/components/scenarios/scenario-set-creator", () => ({
  ScenarioSetCreator: () => <div data-testid="scenario-set-creator" />,
}));
vi.mock("@/components/rtp/rtp-cycle-creator", () => ({
  RtpCycleCreator: () => <div data-testid="rtp-cycle-creator" />,
}));
vi.mock("@/app/(app)/models/_components/network-packages-panel", () => ({
  NetworkPackagesPanel: () => <div data-testid="network-packages-panel" />,
}));

// Mapbox-backed. This suite is about the header slot, not how the map draws.
vi.mock("@/components/safety/safety-crash-map", () => ({
  SafetyCrashMap: () => <div data-testid="safety-crash-map" />,
}));
vi.mock("@/components/models/study-area-picker", () => ({
  StudyAreaPicker: () => <div data-testid="study-area-picker" />,
}));
vi.mock("@/components/cartographic/cartographic-selection-link", () => ({
  CartographicSelectionLink: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
    selection?: unknown;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import EngagementPage from "@/app/(app)/engagement/page";
import ModelsPage from "@/app/(app)/models/page";
import PlansPage from "@/app/(app)/plans/page";
import ProgramsPage from "@/app/(app)/programs/page";
import ProjectsPage from "@/app/(app)/projects/page";
import ReportsPage from "@/app/(app)/reports/page";
import RtpPage from "@/app/(app)/rtp/page";
import SafetyPage from "@/app/(app)/safety/page";
import ScenariosPage from "@/app/(app)/scenarios/page";

type ModuleUnderTest = {
  /** The route as a planner would name it. */
  module: string;
  /** The words on the control. */
  label: string;
  /**
   * The id the action jumps to, or `null` when the action does its work in
   * place rather than pointing at a form further down.
   */
  reaches: string | null;
  /** Rows this page's loader needs before its header action is usable. */
  fixtures?: Record<string, TableResult>;
  render: () => Promise<ReactNode>;
};

/**
 * A workspace that has stated where it is.
 *
 * Safety's retrieve button is disabled until there is a boundary to retrieve
 * crashes for, which is correct behavior and would make "focus it" vacuous. The
 * geography is Nevada County — the same fixture `safety-study-area-precedence`
 * uses — so the control under test is the live, pressable one.
 */
const WORKSPACE_WITH_A_HOME = {
  home_geography_source: "tigerweb",
  home_geography_kind: "county",
  home_geography_ref: "06057",
  home_geography_label: "Nevada County, California",
  home_country_code: "US",
  home_subdivision_code: "CA",
  home_min_lon: -121.3,
  home_min_lat: 39.1,
  home_max_lon: -120.0,
  home_max_lat: 39.6,
  // The boundary itself, not just its box: `resolveStudyArea` builds the
  // picker's corridor text by stringifying this geometry, and it is that text
  // the retrieve button's `bbox` is derived from. A bbox-only row leaves the
  // button correctly disabled and the focus assertion below vacuous.
  home_geometry_geojson: {
    type: "Polygon",
    coordinates: [
      [
        [-121.3, 39.1],
        [-120.0, 39.1],
        [-120.0, 39.6],
        [-121.3, 39.6],
        [-121.3, 39.1],
      ],
    ],
  },
  home_geography_set_at: "2026-07-01T00:00:00.000Z",
};

/**
 * No filters — the module as a planner first lands on it.
 *
 * Each page declares its own `searchParams` shape, but every field on all nine
 * is optional, so one empty object satisfies all of them without a cast. If a
 * page ever makes a search param REQUIRED, this stops compiling rather than
 * being papered over — which is the right place to find that out.
 */
const emptyParams = () => Promise.resolve({});

const MODULES: ModuleUnderTest[] = [
  {
    module: "/projects",
    label: "New project",
    reaches: "create-project",
    render: () => ProjectsPage({ searchParams: emptyParams() }),
  },
  {
    module: "/reports",
    label: "Generate a report",
    reaches: "create-report",
    render: () => ReportsPage({ searchParams: emptyParams() }),
  },
  {
    module: "/engagement",
    label: "New campaign",
    reaches: "create-campaign",
    render: () => EngagementPage({ searchParams: emptyParams() }),
  },
  {
    module: "/plans",
    label: "New plan",
    reaches: "create-plan",
    render: () => PlansPage({ searchParams: emptyParams() }),
  },
  {
    module: "/models",
    label: "New model",
    reaches: "create-model",
    render: () => ModelsPage({ searchParams: emptyParams() }),
  },
  {
    module: "/scenarios",
    label: "New scenario set",
    reaches: "create-scenario-set",
    render: () => ScenariosPage({ searchParams: emptyParams() }),
  },
  {
    module: "/programs",
    label: "New program",
    reaches: "create-program",
    render: () => ProgramsPage({ searchParams: emptyParams() }),
  },
  {
    module: "/rtp",
    label: "New RTP cycle",
    reaches: "create-rtp-cycle",
    render: () => RtpPage({ searchParams: emptyParams() }),
  },
  {
    module: "/safety",
    label: "Retrieve crash data",
    // Acts in place: it starts the retrieval rather than scrolling to a form.
    reaches: null,
    fixtures: { workspaces: { data: WORKSPACE_WITH_A_HOME, error: null } },
    render: () => SafetyPage({ searchParams: emptyParams() }),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  tableResults.clear();

  authGetUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  loadCurrentWorkspaceMembershipMock.mockResolvedValue({
    membership: { workspace_id: "workspace-1", role: "member" },
    workspace: { id: "workspace-1", name: "Workspace" },
  });
  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: fromMock,
  });
});

describe("every module list page offers one primary action in its header", () => {
  it.each(MODULES)("$module", async ({ label, reaches, fixtures, render: renderPage }) => {
    for (const [table, result] of Object.entries(fixtures ?? {})) {
      tableResults.set(table, result);
    }

    const { container } = render(await renderPage());

    // 1. EXACTLY ONE. An equality, not a floor: a second button of equal weight
    //    is the thing that makes neither of them the primary action.
    const actions = Array.from(container.querySelectorAll<HTMLElement>(".module-intro-action"));
    expect(actions.map((action) => action.textContent?.trim())).toEqual([label]);

    const [action] = actions;

    // 2. IN THE HEADER CARD, via the shared slot. Walking up from the button
    //    rather than down from the card, so a slot rendered anywhere else on
    //    the page fails here instead of passing on the class name alone.
    expect(action.closest(".module-intro-actions")).not.toBeNull();
    expect(action.closest(".module-intro-card")).not.toBeNull();

    // 3. A REAL CONTROL — not a clickable div — and keyboard reachable for real
    //    rather than by inspection.
    expect(["A", "BUTTON"]).toContain(action.tagName);
    action.focus();
    expect(document.activeElement).toBe(action);

    // 4. IT REACHES ITS TARGET, resolved inside the very document that rendered
    //    the button.
    if (reaches === null) {
      expect(action.tagName).toBe("BUTTON");
      expect(action.getAttribute("href")).toBeNull();
    } else {
      expect(action.getAttribute("href")).toBe(`#${reaches}`);
      expect(container.querySelector(`#${reaches}`)).not.toBeNull();
    }
  });
});

describe("the slot's own stylesheet", () => {
  const globals = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

  /**
   * The focus ring on this control comes from the one global `:focus-visible`
   * rule; the only way a header action loses its visible focus state is by
   * opting out of that outline. Guarded here because this is the one claim in
   * the suite jsdom cannot make — it computes no styles — and because the CSS
   * file IS the artifact for it.
   */
  it("never suppresses the outline the global focus rule draws", () => {
    const slotRules = globals
      .split("\n")
      .join("\n")
      .match(/\.module-intro-action[^{]*\{[^}]*\}/g);

    expect(slotRules, ".module-intro-action must be defined in globals.css").not.toBeNull();
    for (const rule of slotRules ?? []) {
      expect(rule).not.toMatch(/outline\s*:\s*(none|0)/);
    }
    expect(globals).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid/);
  });

  /**
   * The slot wraps instead of overflowing. At 1366px the intro card is the
   * ~700px left column of `.module-header-grid`, and a nowrap row there pushes
   * a long label out of a card whose `overflow` is `hidden` — it would simply
   * be cut off rather than scroll.
   */
  it("wraps rather than overflowing the card it sits in", () => {
    const slot = globals.match(/\.module-intro-actions\s*\{[^}]*\}/);
    expect(slot, ".module-intro-actions must be defined in globals.css").not.toBeNull();
    expect(slot?.[0]).toMatch(/flex-wrap:\s*wrap/);
  });

  /**
   * THE LABEL STAYS READABLE IN EVERY PALETTE, INCLUDING ONES NOT WRITTEN YET.
   *
   * `--primary` neat is #e45635 in the default light palette: 3.7:1 against the
   * white `--primary-foreground`, under the 4.5:1 WCAG AA wants for text this
   * size. That is why the fill is mixed toward `--foreground` — measured at
   * 4.75:1 in Chrome once mixed, and 7.59:1 in dark.
   *
   * This recomputes that in arithmetic rather than trusting the two spot
   * measurements, because the failure this guards against is a FUTURE one: a
   * sixth palette whose accent is lighter than the five here would ship an
   * unreadable primary button and nothing else would notice. `color-mix(in
   * srgb, …)` interpolates linearly on gamma-encoded channels, which is why
   * plain interpolation below reproduces Chrome's [196, 76, 49] exactly.
   *
   * The mix percentage is READ from the stylesheet rather than repeated here —
   * a guard that hardcodes the number it is checking would pass no matter what
   * the stylesheet said.
   */
  it("keeps the action's label above 4.5:1 in every palette the stylesheet defines", () => {
    const mix = globals.match(
      /\.module-intro-action\s*\{[^}]*color-mix\(in srgb,\s*var\(--primary\)\s*(\d+)%,\s*var\(--foreground\)\s*(\d+)%\)/
    );
    expect(mix, "the action's fill must be a --primary/--foreground mix").not.toBeNull();
    const primaryShare = Number(mix![1]) / 100;
    expect(primaryShare + Number(mix![2]) / 100).toBeCloseTo(1, 5);

    const rgb = (hex: string): [number, number, number] => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
    const relativeLuminance = (hex: string) => {
      const [r, g, b] = rgb(hex).map((channel) => {
        const v = channel / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => {
      const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
      return (l1 + 0.05) / (l2 + 0.05);
    };
    const mixed = (accent: string, ink: string) => {
      const [ar, ag, ab] = rgb(accent);
      const [ir, ig, ib] = rgb(ink);
      const blend = (x: number, y: number) =>
        Math.round(x * primaryShare + y * (1 - primaryShare))
          .toString(16)
          .padStart(2, "0");
      return `#${blend(ar, ir)}${blend(ag, ig)}${blend(ab, ib)}`;
    };

    /** Every `{ … }` block that states an `--accent`, with the selector on it. */
    const themes = Array.from(
      globals.matchAll(/(^|\n)(:root[^{\n]*|\.dark[^{\n]*)\{([^}]*--accent:[^}]*)\}/g)
    ).map(([, , selector, body]) => ({
      selector: selector.trim(),
      accent: body.match(/--accent:\s*(#[0-9a-f]{6})/i)?.[1] ?? null,
      ink: body.match(/--ink:\s*(#[0-9a-f]{6})/i)?.[1] ?? null,
    }));

    // Ten today: default light and dark, plus slate/harbor/meadow/plum in each.
    // An equality, so a palette added without a contrast check fails here
    // instead of quietly widening what this test does not look at.
    expect(themes).toHaveLength(10);

    // `--primary-foreground` is stated only on the two base blocks; the palettes
    // inherit whichever of the two they sit under.
    const baseLabel = (selector: string) =>
      selector.startsWith(".dark")
        ? globals.match(/\n\.dark \{[^}]*--primary-foreground:\s*(#[0-9a-f]{6})/i)?.[1]
        : globals.match(/\n:root \{[^}]*--primary-foreground:\s*(#[0-9a-f]{6})/i)?.[1];

    const failures: string[] = [];
    for (const theme of themes) {
      expect(theme.accent, `${theme.selector} must state --accent`).not.toBeNull();
      expect(theme.ink, `${theme.selector} must state --ink`).not.toBeNull();
      const label = baseLabel(theme.selector);
      expect(label, `${theme.selector} must resolve a --primary-foreground`).toBeTruthy();

      const ratio = contrast(mixed(theme.accent!, theme.ink!), label!);
      if (ratio < 4.5) {
        failures.push(`${theme.selector}: ${ratio.toFixed(2)}:1 (needs 4.5:1)`);
      }
    }
    expect(failures).toEqual([]);
  });
});
