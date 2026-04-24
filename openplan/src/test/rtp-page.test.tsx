import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("redirect");
});
const authGetUserMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();

const rtpCyclesOrderMock = vi.fn();
const rtpCyclesSelectMock = vi.fn(() => ({ order: rtpCyclesOrderMock }));

const projectRtpLinksInMock = vi.fn();
const projectRtpLinksSelectMock = vi.fn(() => ({ in: projectRtpLinksInMock }));

const reportsOrderMock = vi.fn();
const reportsEqMock = vi.fn(() => ({ order: reportsOrderMock }));
const reportsInMock = vi.fn(() => ({ eq: reportsEqMock, order: reportsOrderMock }));
const reportsSelectMock = vi.fn(() => ({ in: reportsInMock }));

const fundingProfilesInMock = vi.fn();
const fundingProfilesSelectMock = vi.fn(() => ({ in: fundingProfilesInMock }));

const fundingAwardsInMock = vi.fn();
const fundingAwardsSelectMock = vi.fn(() => ({ in: fundingAwardsInMock }));

const fundingOpportunitiesInMock = vi.fn();
const fundingOpportunitiesSelectMock = vi.fn(() => ({ in: fundingOpportunitiesInMock }));

const billingInvoicesInMock = vi.fn();
const billingInvoicesSelectMock = vi.fn(() => ({ in: billingInvoicesInMock }));

const reportSectionsInMock = vi.fn();
const reportSectionsSelectMock = vi.fn(() => ({ in: reportSectionsInMock }));

const modelingClaimLimitMock = vi.fn();
const modelingClaimOrderMock = vi.fn(() => ({ limit: modelingClaimLimitMock }));
const modelingClaimNotMock = vi.fn(() => ({ order: modelingClaimOrderMock }));
const modelingClaimEqMock = vi.fn(() => ({
  eq: modelingClaimEqMock,
  not: modelingClaimNotMock,
}));
const modelingClaimSelectMock = vi.fn(() => ({ eq: modelingClaimEqMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "rtp_cycles") {
    return { select: rtpCyclesSelectMock };
  }
  if (table === "project_rtp_cycle_links") {
    return { select: projectRtpLinksSelectMock };
  }
  if (table === "reports") {
    return { select: reportsSelectMock };
  }
  if (table === "project_funding_profiles") {
    return { select: fundingProfilesSelectMock };
  }
  if (table === "funding_awards") {
    return { select: fundingAwardsSelectMock };
  }
  if (table === "funding_opportunities") {
    return { select: fundingOpportunitiesSelectMock };
  }
  if (table === "billing_invoice_records") {
    return { select: billingInvoicesSelectMock };
  }
  if (table === "report_sections") {
    return { select: reportSectionsSelectMock };
  }
  if (table === "modeling_claim_decisions") {
    return { select: modelingClaimSelectMock };
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

vi.mock("@/components/workspaces/workspace-membership-required", () => ({
  WorkspaceMembershipRequired: () => <div data-testid="workspace-membership-required" />,
}));

vi.mock("@/components/ui/state-block", () => ({
  EmptyState: ({ title, description }: { title: string; description: string }) => (
    <div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  ),
}));

vi.mock("@/components/rtp/rtp-cycle-creator", () => ({
  RtpCycleCreator: () => <div data-testid="rtp-cycle-creator" />,
}));

vi.mock("@/components/rtp/rtp-registry-packet-bulk-generate-actions", () => ({
  RtpRegistryPacketBulkGenerateActions: () => <div data-testid="rtp-bulk-generate" />,
}));

vi.mock("@/components/rtp/rtp-registry-packet-bulk-refresh-actions", () => ({
  RtpRegistryPacketBulkRefreshActions: () => <div data-testid="rtp-bulk-refresh" />,
}));

vi.mock("@/components/rtp/rtp-registry-packet-bulk-actions", () => ({
  RtpRegistryPacketBulkActions: () => <div data-testid="rtp-bulk-actions" />,
}));

vi.mock("@/components/rtp/rtp-registry-packet-queue-command-board", () => ({
  RtpRegistryPacketQueueCommandBoard: () => <div data-testid="rtp-queue-command-board" />,
}));

vi.mock("@/components/rtp/rtp-registry-next-action-shortcut", () => ({
  RtpRegistryNextActionShortcut: () => <div data-testid="rtp-next-action-shortcut" />,
}));

vi.mock("@/components/rtp/rtp-registry-packet-row-action", () => ({
  RtpRegistryPacketRowAction: () => <div data-testid="rtp-packet-row-action" />,
}));

import RtpPage from "@/app/(app)/rtp/page";

async function renderPage() {
  render(await RtpPage({ searchParams: Promise.resolve({}) }));
}

describe("RtpPage", () => {
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
      },
    });

    rtpCyclesOrderMock.mockResolvedValue({
      data: [
        {
          id: "rtp-1",
          workspace_id: "workspace-1",
          title: "Nevada County RTP 2050",
          status: "draft",
          geography_label: "Nevada County",
          horizon_start_year: 2025,
          horizon_end_year: 2050,
          adoption_target_date: "2026-10-01",
          public_review_open_at: null,
          public_review_close_at: null,
          summary: "Countywide RTP update.",
          created_at: "2026-04-01T18:00:00.000Z",
          updated_at: "2026-04-14T06:30:00.000Z",
        },
      ],
      error: null,
    });

    projectRtpLinksInMock.mockResolvedValue({
      data: [
        {
          id: "link-1",
          project_id: "project-1",
          rtp_cycle_id: "rtp-1",
          portfolio_role: "constrained",
        },
      ],
      error: null,
    });

    reportsOrderMock.mockResolvedValue({
      data: [],
      error: null,
    });

    fundingProfilesInMock.mockResolvedValue({
      data: [
        {
          project_id: "project-1",
          funding_need_amount: 1000000,
          local_match_need_amount: 0,
        },
      ],
      error: null,
    });

    fundingAwardsInMock.mockResolvedValue({
      data: [],
      error: null,
    });

    fundingOpportunitiesInMock.mockResolvedValue({
      data: [],
      error: null,
    });

    billingInvoicesInMock.mockResolvedValue({
      data: [],
      error: null,
    });

    reportSectionsInMock.mockResolvedValue({
      data: [],
      error: null,
    });

    modelingClaimLimitMock.mockResolvedValue({
      data: [{ county_run_id: "county-run-1" }],
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("surfaces the cycle-card Grants follow-through action for RTP funding gaps", async () => {
    await renderPage();

    expect(screen.getAllByText("Nevada County RTP 2050").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Funding gap review").length).toBeGreaterThan(0);

    const grantsLink = screen.getByRole("link", { name: /Open gap resolution/i });
    expect(grantsLink).toHaveAttribute("href", "/grants#grants-gap-resolution-lane");
  });
});
