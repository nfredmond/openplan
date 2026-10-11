import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("redirect");
});
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const loadWorkspaceOperationsSummaryForWorkspaceMock = vi.fn();

const runsLimitMock = vi.fn();
const runsOrderMock = vi.fn(() => ({ limit: runsLimitMock }));
const runsEqMock = vi.fn(() => ({ order: runsOrderMock }));
const runsSelectMock = vi.fn(() => ({ eq: runsEqMock }));

const modelRunsRowsMock = vi.fn(() => ({ data: [] as unknown[], error: null }));

// The recent-actions audit feed the dashboard absorbed from the retired
// Command Center page (loadRecentActionExecutionsForWorkspace).
const actionLimitMock = vi.fn(() => ({ data: [] as unknown[], error: null }));
const actionOrderMock = vi.fn(() => ({ limit: actionLimitMock }));
const actionEqMock = vi.fn(() => ({ order: actionOrderMock }));
const actionSelectMock = vi.fn(() => ({ eq: actionEqMock }));

// The workspace's home geography, as the page reads it server-side. `null` is
// the honest unset state a fresh workspace is in.
const homeGeographyRowMock = vi.fn<() => { data: unknown; error: unknown }>(() => ({
  data: null,
  error: null,
}));
const workspacesSelectMock = vi.fn((columns: string) => {
  void columns;
  return { eq: () => ({ maybeSingle: async () => homeGeographyRowMock() }) };
});

// A chainable stand-in for the capped chart reads: every filter returns itself
// and the chain resolves to no rows and no error.
const chartReadChainMock = () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["eq", "gte", "order", "limit"]) {
    chain[method] = () => chain;
  }
  chain.then = <T,>(resolve: (value: { data: unknown[]; error: null }) => T) =>
    Promise.resolve({ data: [], error: null }).then(resolve);
  return chain;
};

const fromMock = vi.fn((table: string) => {
  if (table === "runs") {
    return { select: runsSelectMock };
  }

  // Deployment health observes this workspace's in-flight model runs to say
  // whether the modeling worker is picking work up.
  if (table === "model_runs") {
    return {
      select: () => ({ eq: () => ({ in: async () => modelRunsRowsMock() }) }),
    };
  }

  if (table === "workspaces") {
    return { select: workspacesSelectMock };
  }

  if (table === "projects") {
    const chain: Record<string, unknown> = {};
    for (const method of ["eq", "in", "order", "limit"]) chain[method] = () => chain;
    chain.then = <T,>(resolve: (value: { data: unknown[]; error: null }) => T) =>
      Promise.resolve({ data: [{ id: "p1", name: "Main Street", status: "active", delivery_phase: "analysis" }], error: null }).then(resolve);
    return { select: () => chain };
  }

  if (table === "assistant_action_executions") {
    return { select: actionSelectMock };
  }

  // The three lanes the Insights figures read (loadDashboardChartRows). They
  // answer empty-and-successful here, which is what a fresh workspace looks
  // like; the figures' own refusals are proven in dashboard-chart-*.test.ts
  // against a fake that records every filter.
  if (
    table === "engagement_items" ||
    table === "funding_awards" ||
    table === "billing_invoice_records"
  ) {
    return { select: () => chartReadChainMock() };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
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

// Whether an Anthropic key resolves for the workspace (stored key OR
// deployment env) — the page reads it through the SAME helper every AI route
// uses. The context wrapper is pass-through here so the resolution can be
// varied per test without a service-role client.
const hasAnthropicAccessMock = vi.fn(() => false);
vi.mock("@/lib/integrations/anthropic-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/integrations/anthropic-access")>(
    "@/lib/integrations/anthropic-access"
  );
  return { ...actual, hasAnthropicAccess: () => hasAnthropicAccessMock() };
});
vi.mock("@/lib/integrations/workspace-keys", async () => {
  const actual = await vi.importActual<typeof import("@/lib/integrations/workspace-keys")>(
    "@/lib/integrations/workspace-keys"
  );
  return {
    ...actual,
    withWorkspaceIntegrationContext: async (_workspaceId: string, fn: () => Promise<unknown>) =>
      fn(),
  };
});

vi.mock("@/lib/operations/workspace-summary", async () => {
  const actual = await vi.importActual<typeof import("@/lib/operations/workspace-summary")>(
    "@/lib/operations/workspace-summary"
  );

  return {
    ...actual,
    loadWorkspaceOperationsSummaryForWorkspace: (...args: unknown[]) =>
      loadWorkspaceOperationsSummaryForWorkspaceMock(...args),
  };
});

const loadMyWorkMock = vi.fn();
vi.mock("@/lib/my-work/query", async () => {
  const actual = await vi.importActual<typeof import("@/lib/my-work/query")>("@/lib/my-work/query");
  return { ...actual, loadMyWork: (...args: unknown[]) => loadMyWorkMock(...args) };
});

const loadWorkspaceDatesMock = vi.fn();
vi.mock("@/lib/dashboard/workspace-dates", () => ({
  loadWorkspaceDates: (...args: unknown[]) => loadWorkspaceDatesMock(...args),
}));

vi.mock("@/components/runs/RunHistory", () => ({
  RunHistory: () => <div data-testid="run-history" />,
}));

vi.mock("@/components/workspaces/workspace-membership-required", () => ({
  WorkspaceMembershipRequired: () => <div data-testid="workspace-membership-required" />,
}));

import DashboardPage from "@/app/(app)/dashboard/page";
import { buildWorkspaceOperationsSummaryFromSourceRows } from "@/lib/operations/workspace-summary";
import type { MyWorkItem, MyWorkResult } from "@/lib/my-work/types";
import { ReadFailureLog } from "@/lib/ui/read-failures";

function myWorkItem(overrides: Partial<MyWorkItem>): MyWorkItem {
  return {
    sourceId: "deliverables",
    block: "deadlines",
    id: "d1",
    title: "Deliverable",
    projectId: "p1",
    projectName: "Main Street",
    dueOn: "2099-01-01",
    isOverdue: false,
    ownerLabel: null,
    badge: { label: "Deliverable", tone: "neutral" },
    detail: null,
    href: "/projects/p1",
    dedupKey: null,
    ...overrides,
  };
}

function myWorkResult(items: MyWorkItem[]): MyWorkResult {
  return {
    scope: "all_projects",
    items,
    reads: new ReadFailureLog(),
    perSource: {},
    rowsRead: {},
    limitPerSource: 20,
    departedIncludedInUnassigned: true,
  };
}

async function renderPage(searchParams?: Record<string, string | string[] | undefined>) {
  render(
    await DashboardPage(searchParams ? { searchParams: Promise.resolve(searchParams) } : {})
  );
}

/**
 * The operations summary a workspace with exactly two rows produces — one
 * `workspaces` row and one `workspace_members` row, which is what the
 * handle_new_user trigger leaves behind at sign-up. Built by the real builder
 * from empty source rows rather than hand-written zeros, so the fixture cannot
 * drift from what an actually-empty workspace yields.
 */
function emptyWorkspaceSummary() {
  return buildWorkspaceOperationsSummaryFromSourceRows({
    projects: [],
    plans: [],
    programs: [],
    reports: [],
    fundingOpportunities: [],
  });
}

/**
 * Developer changelog lines that used to be rendered as workspace content under
 * a "Baseline" heading. They described the repository, not the workspace, and
 * at least one of them ("Core layers now use GTFS, crashes, Census, and LODES
 * inputs.") was flatly untrue of an empty workspace with no Census key. They
 * are deleted; this list keeps them deleted.
 */
const RETIRED_BASELINE_CHANGELOG_LINES = [
  /Supabase auth flow is live for sign-up, sign-in, and protected routes/i,
  /Analysis API accepts schema-checked corridor scoring requests/i,
  /Runs persist and reload cleanly at workspace scope/i,
  /Report endpoint returns structured HTML \/ PDF-ready output/i,
  /Core layers now use GTFS, crashes, Census, and LODES inputs/i,
  /KPI instrumentation tracks completion, reporting, and time-to-first-result/i,
];

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
        },
      },
    });

    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: {
        workspace_id: "workspace-1",
        role: "owner",
      },
      workspace: {
        id: "workspace-1",
        name: "OpenPlan QA",
        plan: "pilot",
        created_at: "2026-04-01T18:00:00.000Z",
      },
    });

    loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValue({
      posture: "attention",
      headline: "Run release review on current packets",
      detail: "A current RTP packet still carries linked-project funding follow-up.",
      counts: {
        projects: 1,
        activeProjects: 1,
        plans: 0,
        plansNeedingSetup: 0,
        programs: 0,
        activePrograms: 0,
        reports: 1,
        reportRefreshRecommended: 0,
        reportNoPacket: 0,
        reportPacketCurrent: 1,
        rtpFundingReviewPackets: 1,
        comparisonBackedReports: 0,
        fundingOpportunities: 1,
        openFundingOpportunities: 1,
        closingSoonFundingOpportunities: 0,
        projectFundingNeedAnchorProjects: 0,
        projectFundingSourcingProjects: 0,
        projectFundingDecisionProjects: 0,
        projectFundingAwardRecordProjects: 0,
        projectFundingReimbursementStartProjects: 0,
        projectFundingReimbursementActiveProjects: 0,
        projectFundingGapProjects: 0,
        queueDepth: 1,
      },
      nextCommand: {
        key: "review-current-report-packets",
        moduleKey: "grants",
        moduleLabel: "Grants",
        title: "Run release review on current packets",
        detail: "1 current RTP packet still carries funding follow-up from linked projects.",
        href: "/grants#grants-gap-resolution-lane",
        tone: "warning",
        priority: 2.5,
        badges: [
          { label: "Current", value: 1 },
          { label: "Funding review", value: 1 },
        ],
      },
      commandQueue: [
        {
          key: "review-current-report-packets",
          moduleKey: "grants",
          moduleLabel: "Grants",
          title: "Run release review on current packets",
          detail: "1 current RTP packet still carries funding follow-up from linked projects.",
          href: "/grants#grants-gap-resolution-lane",
          tone: "warning",
          priority: 2.5,
          badges: [
            { label: "Current", value: 1 },
            { label: "Funding review", value: 1 },
          ],
        },
      ],
      fullCommandQueue: [
        {
          key: "review-current-report-packets",
          moduleKey: "grants",
          moduleLabel: "Grants",
          title: "Run release review on current packets",
          detail: "1 current RTP packet still carries funding follow-up from linked projects.",
          href: "/grants#grants-gap-resolution-lane",
          tone: "warning",
          priority: 2.5,
          badges: [
            { label: "Current", value: 1 },
            { label: "Funding review", value: 1 },
          ],
        },
      ],
    });

    runsLimitMock.mockResolvedValue({ data: [], error: null });
    loadMyWorkMock.mockImplementation(async () => myWorkResult([]));
    loadWorkspaceDatesMock.mockResolvedValue({ items: [], failed: [], capped: [] });
    homeGeographyRowMock.mockReturnValue({ data: null, error: null });
    // Default: no Anthropic key resolves — the honest state of a fresh
    // deployment with no env key and no stored workspace key.
    hasAnthropicAccessMock.mockReturnValue(false);

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("keeps the full setup checklist on an active workspace whose geography is unset", async () => {
    // The default summary has a project and a report, and the default
    // geography row is null (unset). Activity is not the same as being set up.
    await renderPage();

    expect(screen.getByRole("heading", { name: "Set up this workspace" })).toBeInTheDocument();
    expect(screen.getByText("Tell OpenPlan where you work")).toBeInTheDocument();
    expect(screen.getByText("Start here")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Help" })).toHaveAttribute("href", "/help");
  });

  it("folds the checklist into one line once the place is set", async () => {
    homeGeographyRowMock.mockReturnValueOnce({
      data: {
        home_geography_source: "tigerweb",
        home_geography_kind: "county",
        home_geography_ref: "00000",
        home_geography_label: "Example County, Example State",
        home_country_code: "US",
      },
      error: null,
    });
    await renderPage();

    expect(screen.queryByRole("heading", { name: "Set up this workspace" })).not.toBeInTheDocument();
    const summary = screen.getByText("Setup checklist").closest("summary");
    expect(summary?.textContent).toMatch(/1 of 3 done/);
    expect(screen.getByText("Example County, Example State")).toBeInTheDocument();
  });

  it("leaves the Planner Agent's action record to its own page, linked from the foot", async () => {
    await renderPage();

    expect(screen.queryByText("Assistant action activity")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Planner Agent activity" })).toHaveAttribute(
      "href",
      "/assistant-activity"
    );
  });

  describe("sign-up intent", () => {
    it("adds the public-comment-campaign step for an engagement arrival", async () => {
      await renderPage({ intent: "engagement" });

      expect(screen.getByText("Start a public comment campaign")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Open Engagement/ })).toHaveAttribute(
        "href",
        "/engagement"
      );
    });

    it("shows no engagement step without the intent, and ignores unknown intents", async () => {
      await renderPage({ intent: "sell-me-something" });

      expect(screen.queryByText("Start a public comment campaign")).not.toBeInTheDocument();
    });
  });

  it("reads the overdue backlog and the coming weeks as two bounded My Work reads", async () => {
    await renderPage();

    expect(loadMyWorkMock).toHaveBeenCalledTimes(2);
    const [backlogCall, upcomingCall] = loadMyWorkMock.mock.calls.map((call) => call[1]);
    expect(backlogCall).toMatchObject({ scope: "all_projects", limitPerSource: 20 });
    expect(backlogCall.dueBefore).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(backlogCall.dueOnOrAfter).toBeUndefined();
    expect(upcomingCall).toMatchObject({ scope: "all_projects", limitPerSource: 10, datedOnly: true });
    // The two reads meet at one boundary, so no item falls between them.
    expect(upcomingCall.dueOnOrAfter).toBe(backlogCall.dueBefore);
  });

  it("reads only the caller's assigned work when the scope says so", async () => {
    await renderPage({ scope: "mine" });

    for (const call of loadMyWorkMock.mock.calls) {
      expect(call[1].scope).toBe("assigned");
    }
    expect(screen.getByRole("link", { name: "Assigned to me" })).toHaveAttribute("aria-current", "page");
  });

  it("lists blocked work and workspace next steps in Needs you, and dated work in Coming up", async () => {
    loadMyWorkMock
      .mockResolvedValueOnce(
        myWorkResult([
          myWorkItem({ id: "g1", sourceId: "stage_gate_holds", block: "blocked_projects", title: "Main Street held at design gate", dueOn: null, href: "/projects/p1?tab=gates" }),
          myWorkItem({ id: "o1", title: "Overdue traffic study", dueOn: "2026-09-01", isOverdue: true, href: "/projects/p1?tab=delivery" }),
        ])
      )
      .mockResolvedValueOnce(
        myWorkResult([myWorkItem({ id: "u1", title: "Board packet draft", dueOn: "2099-01-15", href: "/projects/p1?tab=delivery#u1" })])
      );
    await renderPage();

    const needs = screen.getByRole("region", { name: "Needs you" });
    expect(needs).toHaveTextContent("Main Street held at design gate");
    expect(needs).toHaveTextContent("Run release review on current packets");
    expect(needs).not.toHaveTextContent("Board packet draft");

    const coming = screen.getByRole("region", { name: "Coming up" });
    expect(coming).toHaveTextContent("Overdue traffic study");
    expect(coming).toHaveTextContent("1 item overdue");
    expect(coming).not.toHaveTextContent("Main Street held at design gate");
  });

  it("names a source that could not be read instead of showing a clear list", async () => {
    const failed = myWorkResult([]);
    failed.reads.check("project deliverables", { error: { message: "permission denied" } });
    loadMyWorkMock.mockResolvedValueOnce(myWorkResult([])).mockResolvedValueOnce(failed);
    await renderPage();

    const coming = screen.getByRole("region", { name: "Coming up" });
    expect(coming).toHaveTextContent("Could not check project deliverables");
    expect(coming).not.toHaveTextContent("Nothing is due");
  });

  it("says so when a source returned its full cap", async () => {
    const capped = myWorkResult([]);
    capped.rowsRead = { deliverables: 10 };
    loadMyWorkMock.mockResolvedValueOnce(myWorkResult([])).mockResolvedValueOnce(capped);
    await renderPage();

    expect(screen.getByRole("region", { name: "Coming up" })).toHaveTextContent(
      "More deliverables may be due than are shown here. My Work lists them all."
    );
  });

  it("shows a figure as not available when its read failed, never as zero", async () => {
    await renderPage();

    // The default summary carries no module observations, so the comment
    // count was never measured.
    const comments = screen.getByText("Comments to review").closest("a");
    expect(comments).toHaveTextContent("Not available");
    expect(comments).not.toHaveTextContent(/\b0\b/);
  });

  it("no longer renders the developer changelog, quick actions or the command board", async () => {
    await renderPage();

    for (const line of RETIRED_BASELINE_CHANGELOG_LINES) {
      expect(screen.queryByText(line)).not.toBeInTheDocument();
    }
    expect(screen.queryByText("Baseline")).not.toBeInTheDocument();
    expect(screen.queryByText("Quick actions")).not.toBeInTheDocument();
    expect(screen.queryByText("Workflow spine")).not.toBeInTheDocument();
    expect(screen.queryByText("What is worth your attention today")).not.toBeInTheDocument();
  });

  /**
   * First run: a workspace with exactly two rows — one `workspaces` row and one
   * `workspace_members` row — which is what sign-up leaves behind. Everything
   * the dashboard says in this state has to be true of it.
   */
  describe("first run", () => {
    const SET_HOME_GEOGRAPHY_ROW = {
      home_geography_source: "tigerweb",
      home_geography_kind: "county",
      home_geography_ref: "00000",
      home_geography_label: "Example County, Example State",
      home_country_code: "US",
    };

    async function renderFirstRun(options?: { role?: string; homeGeographyRow?: unknown }) {
      loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValueOnce(emptyWorkspaceSummary());

      if (options?.role) {
        loadCurrentWorkspaceMembershipMock.mockResolvedValueOnce({
          membership: { workspace_id: "workspace-1", role: options.role },
          workspace: {
            id: "workspace-1",
            name: "OpenPlan QA",
            created_at: "2026-04-01T18:00:00.000Z",
          },
        });
      }

      if (options?.homeGeographyRow !== undefined) {
        homeGeographyRowMock.mockReturnValueOnce({ data: options.homeGeographyRow, error: null });
      }

      await renderPage();
    }

    it("shows the geography step and links to workspace setup when no place is set", async () => {
      await renderFirstRun();

      // The geography step is outstanding and says so. (Emphasis sits on the
      // AI-key step, which is also outstanding and comes first.)
      expect(screen.getByText("Tell OpenPlan where you work")).toBeInTheDocument();
      expect(screen.getByText("Start here")).toBeInTheDocument();
      expect(
        screen.getByText(/Not set\. Choose it in Workspace setup & health\./)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Maps, jurisdiction rules, equity data, and study-area defaults across OpenPlan all read this one setting/)
      ).toBeInTheDocument();

      expect(screen.getByRole("link", { name: "Open where-you-work setting" })).toHaveAttribute(
        "href",
        "/workspace",
      );
    });

    it("reads only the home-geography identity columns, never the stored boundary polygon", async () => {
      await renderFirstRun();

      expect(workspacesSelectMock).toHaveBeenCalled();
      const columns = workspacesSelectMock.mock.calls[0]?.[0] ?? "";
      expect(columns).toContain("home_geography_source");
      expect(columns).toContain("home_geography_label");
      // The polygon can be megabytes and nothing on this page draws it.
      expect(columns).not.toContain("home_geometry_geojson");
    });

    it("marks the geography step done with the resolved label", async () => {
      hasAnthropicAccessMock.mockReturnValue(true);
      await renderFirstRun({ homeGeographyRow: SET_HOME_GEOGRAPHY_ROW });

      // AI key and geography are both done; nothing outstanding is emphasized.
      expect(screen.getAllByText("Done")).toHaveLength(2);
      expect(screen.getByText("Set to Example County, Example State.")).toBeInTheDocument();
      expect(screen.queryByText("Start here")).not.toBeInTheDocument();

    });

    it("does not claim a geography is set when the row carries no resolvable source", async () => {
      // A stray label with no source is not a geography — the migration's
      // coherence CHECK says the same thing. It must read as unset.
      await renderFirstRun({
        homeGeographyRow: { home_geography_label: "Example County, Example State" },
      });

      expect(screen.getByText("Start here")).toBeInTheDocument();
      expect(screen.queryByText(/^Set to /)).not.toBeInTheDocument();
    });

    it("leads with the AI step and links to integration setup while no key resolves", async () => {
      await renderFirstRun();

      const step = screen.getByText("Turn on your AI assistant").closest("li");
      expect(step).not.toBeNull();
      // First incomplete step in display order carries the one emphasis.
      expect(step!.textContent).toContain("Start here");
      expect(step!.textContent).toMatch(
        /Without a key, the Planner Agent, narrative drafting, and comment translation are unavailable/
      );

      expect(screen.getByRole("link", { name: "Open integration setup" })).toHaveAttribute(
        "href",
        "/workspace#workspace-integrations",
      );
    });

    it("marks the AI step done when a key resolves", async () => {
      hasAnthropicAccessMock.mockReturnValue(true);
      await renderFirstRun();

      const step = screen.getByText("Turn on your AI assistant").closest("li");
      expect(step!.textContent).toContain("Done");
      expect(
        screen.getByText("On — an AI key is available to this workspace.")
      ).toBeInTheDocument();

    });

    it("points the screening step at Corridor Analysis and reports that no runs exist", async () => {
      await renderFirstRun();

      expect(screen.getByText("Run your first screening")).toBeInTheDocument();
      expect(screen.getByText("No analysis runs yet.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Open Corridor Analysis/ })).toHaveAttribute("href", "/explore");
    });

    it("offers the invite step to an owner only", async () => {
      await renderFirstRun();

      expect(screen.getByText("Invite your team")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Open the team panel/ })).toHaveAttribute(
        "href",
        "/workspace#workspace-team"
      );
      // The page cannot read who else is in the workspace (workspace_members
      // RLS is own-row only), so the step must not carry a completion claim.
      expect(screen.getByText("Optional")).toBeInTheDocument();
    });

    it("hides the invite step from a plain member, who cannot invite anyone", async () => {
      await renderFirstRun({ role: "member" });

      expect(screen.getByText("Tell OpenPlan where you work")).toBeInTheDocument();
      expect(screen.queryByText("Invite your team")).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Open the team panel/ })).not.toBeInTheDocument();
      // A member still sees the state and is told who can change it.
      expect(screen.getByText(/Not set\. A workspace owner or admin can set it\./)).toBeInTheDocument();
    });

    it("shows one path, not four: no goal cards, no quick actions, no changelog", async () => {
      await renderFirstRun();

      // The four navigation goal cards that only called router.push().
      expect(screen.queryByText("Model any place")).not.toBeInTheDocument();
      expect(screen.queryByText("Collect community input")).not.toBeInTheDocument();
      expect(screen.queryByText("Find & write grants")).not.toBeInTheDocument();
      expect(screen.queryByText("Build an RTP")).not.toBeInTheDocument();

      // The second ladder and the third entry-point set.
      expect(screen.queryByText("Workflow spine")).not.toBeInTheDocument();
      expect(screen.queryByText("Quick actions")).not.toBeInTheDocument();

      for (const line of RETIRED_BASELINE_CHANGELOG_LINES) {
        expect(screen.queryByText(line)).not.toBeInTheDocument();
      }
    });
  });
});
