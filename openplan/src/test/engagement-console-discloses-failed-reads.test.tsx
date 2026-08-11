import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE ENGAGEMENT CATALOG MAY NOT RENDER A FAILED READ AS AN ANSWER.
 *
 * `const { data } = await supabase…` hands back the same `null` for "this
 * workspace runs no engagement" and "the query failed", and this page's empty
 * state — written for the first — used to state the second as fact. On an
 * agency's own console that sentence is "No campaigns yet": a
 * planning department told it has never engaged anybody, on the strength of a
 * broken query. The same defect shipped twice to the PUBLIC (the plan page and
 * the engagement portal) before it was caught.
 *
 * These assertions drive the REAL page component — not a stub of its loader —
 * because the defect lives in the seam between the read and the sentence. A
 * test that doubles the loader tests the renderer and would have passed
 * throughout.
 *
 * The third case is the one that makes the other two mean anything: when the
 * read SUCCEEDS and the workspace genuinely has nothing, the ordinary empty
 * state must still appear and no failure may be disclosed. Without it a page
 * that shows a warning unconditionally would pass.
 */

const createClientMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const authGetUserMock = vi.fn();

const campaignsOrderMock = vi.fn();
const projectsOrderMock = vi.fn();
const itemsInMock = vi.fn();
const categoriesInMock = vi.fn();

const fromMock = vi.fn((table: string) => {
  if (table === "engagement_campaigns") {
    return { select: () => ({ eq: () => ({ order: campaignsOrderMock }) }) };
  }
  if (table === "projects") {
    return { select: () => ({ eq: () => ({ order: projectsOrderMock }) }) };
  }
  if (table === "engagement_items") {
    return { select: () => ({ in: itemsInMock }) };
  }
  if (table === "engagement_categories") {
    return { select: () => ({ in: categoriesInMock }) };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("redirect");
  }),
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

vi.mock("@/components/engagement/engagement-campaign-creator", () => ({
  EngagementCampaignCreator: () => <div data-testid="engagement-campaign-creator" />,
}));

vi.mock("@/components/cartographic/cartographic-selection-link", () => ({
  CartographicSelectionLink: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    selection?: unknown;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import EngagementPage from "@/app/(app)/engagement/page";

function campaignRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "campaign-1",
    workspace_id: "workspace-1",
    project_id: null,
    title: "Downtown listening",
    summary: "Collect downtown feedback.",
    status: "active",
    engagement_type: "comment_collection",
    share_token: "abcdef0123456789abcdef01",
    allow_public_submissions: true,
    submissions_closed_at: null,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-28T22:00:00.000Z",
    projects: null,
    ...overrides,
  };
}

async function renderPage(searchParams: Record<string, string> = {}) {
  render(await EngagementPage({ searchParams: Promise.resolve(searchParams) }));
}

describe("the engagement catalog discloses a failed read", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authGetUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: "workspace-1", role: "member" },
      workspace: { id: "workspace-1", name: "Workspace" },
    });

    campaignsOrderMock.mockResolvedValue({ data: [], error: null });
    projectsOrderMock.mockResolvedValue({ data: [], error: null });
    itemsInMock.mockResolvedValue({ data: [], error: null });
    categoriesInMock.mockResolvedValue({ data: [], error: null });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("does not tell an agency it has no campaigns when the campaign list could not be read", async () => {
    campaignsOrderMock.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied for table engagement_campaigns" },
    });

    await renderPage();

    // (a) the false absence is gone.
    expect(screen.queryByText(/No campaigns yet/i)).toBeNull();
    // (b) the failure is disclosed, by name, with the operator detail an
    //     internal page is allowed to show.
    expect(screen.getByText(/Part of this page could not be read/i)).toBeInTheDocument();
    expect(screen.getByText(/this workspace's engagement campaigns/i)).toBeInTheDocument();
    expect(screen.getByText(/permission denied for table engagement_campaigns/)).toBeInTheDocument();
    expect(screen.getByText(/This workspace's campaigns could not be listed/i)).toBeInTheDocument();
    // …and no count is offered in place of one that was never established.
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByText("All (0)")).toBeNull();
  });

  it("still shows the ordinary empty state when the read succeeds and the workspace has none", async () => {
    // The control. Without this, a page that warned unconditionally would pass
    // the assertion above and nobody could tell disclosure from noise.
    await renderPage();

    expect(screen.getByText(/No campaigns yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Part of this page could not be read/i)).toBeNull();
    expect(screen.queryByText(/could not be listed/i)).toBeNull();
    expect(screen.queryByText("Unavailable")).toBeNull();
    expect(screen.getByText("All (0)")).toBeInTheDocument();
  });

  it("renders the campaigns that loaded and discloses only the comment read that failed", async () => {
    campaignsOrderMock.mockResolvedValueOnce({ data: [campaignRow()], error: null });
    itemsInMock.mockResolvedValueOnce({ data: null, error: { message: "statement timeout" } });

    await renderPage();

    // Render what loaded — a side read failing does not make the page worthless.
    expect(screen.getByText("Downtown listening")).toBeInTheDocument();
    expect(screen.getByText("All (1)")).toBeInTheDocument();
    // …and say which part to disbelieve.
    expect(screen.getByText(/comments on these campaigns/i)).toBeInTheDocument();
    expect(screen.getByText(/statement timeout/)).toBeInTheDocument();
    expect(screen.getByText(/Comment and category totals could not be read/i)).toBeInTheDocument();
  });

  it("names the project list when that read is the one that failed", async () => {
    projectsOrderMock.mockResolvedValueOnce({
      data: null,
      error: { message: "connection reset" },
    });

    await renderPage();

    expect(screen.getByText(/this workspace's projects/i)).toBeInTheDocument();
    expect(screen.getByText(/connection reset/)).toBeInTheDocument();
    // The campaigns read succeeded, so the ordinary empty state is still the
    // honest thing to say about campaigns.
    expect(screen.getByText(/No campaigns yet/i)).toBeInTheDocument();
  });
});
