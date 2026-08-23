import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** A chain that is empty however it is terminated — awaited, or paged with `.range`. */
function emptyPagedChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order", "limit"]) chain[method] = () => chain;
  chain.range = async () => ({ data: [], error: null });
  chain.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
    resolve({ data: [], error: null });
  return chain;
}

const createClientMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const authGetUserMock = vi.fn();

const campaignsOrderMock = vi.fn();
const campaignsEqMock = vi.fn((..._args: unknown[]) => ({ order: campaignsOrderMock }));
const campaignSelectMock = vi.fn((..._args: unknown[]) => ({ eq: campaignsEqMock }));

const projectsOrderMock = vi.fn();

const fromMock = vi.fn((table: string) => {
  if (table === "engagement_campaigns") {
    return { select: campaignSelectMock };
  }
  if (table === "projects") {
    return { select: () => ({ eq: () => ({ order: projectsOrderMock }) }) };
  }
  if (table === "engagement_items") {
    // Paged read: `.in()` chains on to `.order().order().range()`. Empty either
    // way — an empty page is what tells the paging loop it is exhausted.
    return { select: () => ({ in: () => emptyPagedChain() }) };
  }
  if (table === "engagement_categories") {
    return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) };
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

async function renderPage() {
  render(await EngagementPage({ searchParams: Promise.resolve({}) }));
}

describe("EngagementPage portal status chips", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authGetUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: "workspace-1", role: "member" },
      workspace: { id: "workspace-1", name: "Workspace" },
    });

    campaignsOrderMock.mockResolvedValue({ data: [], error: null });
    projectsOrderMock.mockResolvedValue({ data: [], error: null });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("selects the public-portal columns the chip logic needs (per migration 20260321000032)", async () => {
    await renderPage();

    expect(campaignSelectMock).toHaveBeenCalledTimes(1);
    const selectColumns = String(campaignSelectMock.mock.calls[0][0]);
    for (const column of ["share_token", "allow_public_submissions", "submissions_closed_at", "status"]) {
      expect(selectColumns).toContain(column);
    }
    // Scoping assertion: the campaigns read must filter to the ACTIVE
    // workspace — RLS grants all memberships, so an unfiltered read merges
    // workspaces (2026-08-03 review, unscoped-list-page class).
    expect(campaignsEqMock).toHaveBeenCalledWith("workspace_id", "workspace-1");
  });

  it("shows a Private / Staged / Live chip per campaign from the shared portal-state rules", async () => {
    campaignsOrderMock.mockResolvedValueOnce({
      data: [
        campaignRow({ id: "c-live", title: "Live campaign" }),
        campaignRow({ id: "c-staged", title: "Staged campaign", status: "draft" }),
        campaignRow({ id: "c-private", title: "Private campaign", share_token: null }),
      ],
      error: null,
    });

    await renderPage();

    expect(screen.getByText(/Portal · Live/)).toBeInTheDocument();
    expect(screen.getByText(/Portal · Staged/)).toBeInTheDocument();
    expect(screen.getByText(/Portal · Private/)).toBeInTheDocument();
  });

  it("does not label a closed campaign's saved link as live", async () => {
    campaignsOrderMock.mockResolvedValueOnce({
      data: [campaignRow({ id: "c-closed", title: "Closed campaign", status: "closed" })],
      error: null,
    });

    await renderPage();

    expect(screen.queryByText(/Portal · Live/)).toBeNull();
    expect(screen.getByText(/Portal · Staged/)).toBeInTheDocument();
  });
});
