import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A READ THAT FAILED MAY NOT BE RENDERED AS AN ANSWER — the RTP branch of the
 * report detail page.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `report-detail-page.test.tsx`. That suite
 * drives the STANDARD branch, and the standard branch is where the read-failure
 * handling was built first. The RTP branch returns a different component from a
 * different `return` statement, fed by its own reads — the cycle's chapters, its
 * linked projects, its campaigns, its public comments, and the four funding
 * tables behind the packet's fiscal posture. Every one of those is one half of a
 * PUBLISHED COMPARISON against the frozen packet snapshot, so an empty result is
 * not merely blank: it is a verdict.
 *
 * THE DEFECT. `(rows ?? []).length` cannot tell an outage from an empty cycle,
 * so a single failed read published a drift row reading "Linked projects:
 * generated with 42, current source is 0", and a funding row reading "current
 * source is unfunded with 12 gap projects". An RTP packet is the document an
 * agency's fiscal constraint finding rests on, and those sentences describe
 * money and projects vanishing between generation and today. They came from a
 * broken query.
 *
 * Disclosure alone does not fix this. A banner at the top saying the awards
 * could not be read, with the fabricated drift row still rendered below it, is
 * two contradictory claims on one page. The live value has to be withheld as
 * UNKNOWN, which is what `null` means to `RtpReportDetail`.
 *
 * Nothing here stubs the loader: the real page runs against a real Supabase call
 * shape, because a test that doubles the loader tests the renderer.
 */

const createClientMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});
const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("redirect");
});

const authGetUserMock = vi.fn();
const loadWorkspaceOperationsSummaryForWorkspaceMock = vi.fn();

const REPORT_ROW = {
  id: "report-1",
  workspace_id: "workspace-1",
  project_id: null,
  rtp_cycle_id: "cycle-1",
  engagement_campaign_id: null,
  title: "2050 RTP Packet",
  report_type: "rtp_packet",
  status: "draft",
  summary: "Regional transportation plan packet.",
  generated_at: "2026-05-01T12:00:00.000Z",
  latest_artifact_url: null,
  latest_artifact_kind: "html",
  rtp_basis_stale: null,
  rtp_basis_stale_reason: null,
  rtp_basis_stale_run_id: null,
  rtp_basis_stale_marked_at: null,
  created_at: "2026-03-28T17:00:00.000Z",
  updated_at: "2026-05-01T12:00:00.000Z",
};

/**
 * The frozen packet snapshot. Every number here is the GENERATED side of a
 * comparison, so each one is what a fabricated live zero would be published
 * against.
 */
const ARTIFACT_ROW = {
  id: "artifact-1",
  artifact_kind: "html",
  storage_path: null,
  file_url: null,
  generated_at: "2026-05-01T12:00:00.000Z",
  content_html: "<p>packet</p>",
  metadata_json: {
    sourceContext: {
      enabledSectionKeys: ["fiscal_constraint", "project_list"],
      chapterCount: 9,
      chapterCompleteCount: 4,
      chapterReadyForReviewCount: 2,
      linkedProjectCount: 42,
      engagementCampaignCount: 3,
      cycleLevelCampaignCount: 1,
      chapterLevelCampaignCount: 2,
      engagementPendingCommentCount: 31,
      engagementApprovedCommentCount: 12,
      engagementReadyCommentCount: 7,
      rtpFundingSnapshot: {
        label: "Mostly funded",
        reason: "Awards cover most of the linked need.",
        reimbursementLabel: "Reimbursement current",
        linkedProjectCount: 42,
        fundedProjectCount: 30,
        likelyCoveredProjectCount: 6,
        gapProjectCount: 6,
        totalNeedAmount: 10_000_000,
        committedFundingAmount: 8_000_000,
        likelyFundingAmount: 1_000_000,
        unfundedAfterLikelyAmount: 1_000_000,
        outstandingReimbursementAmount: 250_000,
        capturedAt: "2026-05-01T12:00:00.000Z",
      },
    },
  },
};

// reports: .select(...).eq("id", ...).maybeSingle()
const reportMaybeSingleMock = vi.fn();
const reportEqMock = vi.fn(() => ({ maybeSingle: reportMaybeSingleMock }));
const reportSelectMock = vi.fn(() => ({ eq: reportEqMock }));

// projects: .select(...).eq("id", null).maybeSingle()
const projectMaybeSingleMock = vi.fn(async () => ({ data: null, error: null }));
const projectEqMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectSelectMock = vi.fn(() => ({ eq: projectEqMock }));

// rtp_cycles: .select(...).eq("id", ...).maybeSingle()
const rtpCycleMaybeSingleMock = vi.fn();
const rtpCycleEqMock = vi.fn(() => ({ maybeSingle: rtpCycleMaybeSingleMock }));
const rtpCycleSelectMock = vi.fn(() => ({ eq: rtpCycleEqMock }));

const workspaceMaybeSingleMock = vi.fn();
const workspaceEqMock = vi.fn(() => ({ maybeSingle: workspaceMaybeSingleMock }));
const workspaceSelectMock = vi.fn(() => ({ eq: workspaceEqMock }));

const sectionsOrderMock = vi.fn();
const sectionsEqMock = vi.fn(() => ({ order: sectionsOrderMock }));
const sectionsSelectMock = vi.fn(() => ({ eq: sectionsEqMock }));

const reportRunsOrderMock = vi.fn(async () => ({ data: [], error: null }));
const reportRunsEqMock = vi.fn(() => ({ order: reportRunsOrderMock }));
const reportRunsSelectMock = vi.fn(() => ({ eq: reportRunsEqMock }));

const artifactsOrderMock = vi.fn();
const artifactsEqMock = vi.fn(() => ({ order: artifactsOrderMock }));
const artifactsSelectMock = vi.fn(() => ({ eq: artifactsEqMock }));

// rtp_cycle_chapters: .select(...).eq("rtp_cycle_id", ...)
const rtpChaptersEqMock = vi.fn();
const rtpChaptersSelectMock = vi.fn(() => ({ eq: rtpChaptersEqMock }));

// project_rtp_cycle_links: .select(...).eq("rtp_cycle_id", ...)
const rtpProjectLinksEqMock = vi.fn();
const rtpProjectLinksSelectMock = vi.fn(() => ({ eq: rtpProjectLinksEqMock }));

// engagement_campaigns: .select(...).eq("workspace_id", ...).eq("rtp_cycle_id", ...)
const rtpCampaignsEqCycleMock = vi.fn();
const rtpCampaignsEqWorkspaceMock = vi.fn(() => ({ eq: rtpCampaignsEqCycleMock }));
const campaignSelectMock = vi.fn(() => ({ eq: rtpCampaignsEqWorkspaceMock }));

// engagement_items: .select(...).in("campaign_id", [...])
const engagementItemsInMock = vi.fn();
const engagementItemsSelectMock = vi.fn(() => ({ in: engagementItemsInMock }));

// The four RTP funding reads, all `.select(...).in("project_id", [...])`.
const rtpFundingProfilesInMock = vi.fn();
const rtpFundingProfilesSelectMock = vi.fn(() => ({ in: rtpFundingProfilesInMock }));

const rtpFundingAwardsInMock = vi.fn();
const rtpFundingAwardsSelectMock = vi.fn(() => ({ in: rtpFundingAwardsInMock }));

const rtpFundingOpportunitiesInMock = vi.fn();
const rtpFundingOpportunitiesSelectMock = vi.fn(() => ({ in: rtpFundingOpportunitiesInMock }));

const rtpBillingInvoicesInMock = vi.fn();
const rtpBillingInvoicesSelectMock = vi.fn(() => ({ in: rtpBillingInvoicesInMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "reports") return { select: reportSelectMock };
  if (table === "projects") return { select: projectSelectMock };
  if (table === "rtp_cycles") return { select: rtpCycleSelectMock };
  if (table === "workspaces") return { select: workspaceSelectMock };
  if (table === "report_sections") return { select: sectionsSelectMock };
  if (table === "report_runs") return { select: reportRunsSelectMock };
  if (table === "report_artifacts") return { select: artifactsSelectMock };
  if (table === "rtp_cycle_chapters") return { select: rtpChaptersSelectMock };
  if (table === "project_rtp_cycle_links") return { select: rtpProjectLinksSelectMock };
  if (table === "engagement_campaigns") return { select: campaignSelectMock };
  if (table === "engagement_items") return { select: engagementItemsSelectMock };
  if (table === "project_funding_profiles") return { select: rtpFundingProfilesSelectMock };
  if (table === "funding_awards") return { select: rtpFundingAwardsSelectMock };
  if (table === "funding_opportunities") return { select: rtpFundingOpportunitiesSelectMock };
  if (table === "billing_invoice_records") return { select: rtpBillingInvoicesSelectMock };
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: (...args: unknown[]) => redirectMock(...args),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/reports/report-1",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

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

vi.mock("@/components/reports/report-detail-controls", () => ({
  ReportDetailControls: () => null,
}));

vi.mock("@/components/reports/rtp-report-section-controls", () => ({
  RtpReportSectionControls: () => null,
}));

import ReportDetailPage from "@/app/(app)/reports/[reportId]/page";

async function renderPage() {
  render(await ReportDetailPage({ params: Promise.resolve({ reportId: "report-1" }) }));
}

describe("the RTP branch of the report detail page does not publish a failed read as drift", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
    authGetUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });

    loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValue({
      posture: "under control",
      headline: "Workspace clear",
      detail: "No workspace command pressure in this fixture.",
      nextCommand: null,
      nextActions: [],
      commandQueue: [],
      fullCommandQueue: [],
      counts: {},
    });

    reportMaybeSingleMock.mockResolvedValue({ data: REPORT_ROW, error: null });
    rtpCycleMaybeSingleMock.mockResolvedValue({
      data: {
        id: "cycle-1",
        title: "2050 Regional Transportation Plan",
        status: "drafting",
        summary: null,
        geography_label: "Regional planning area",
        horizon_start_year: 2026,
        horizon_end_year: 2050,
        adoption_target_date: null,
        public_review_open_at: null,
        public_review_close_at: null,
        updated_at: "2026-05-01T12:00:00.000Z",
      },
      error: null,
    });
    workspaceMaybeSingleMock.mockResolvedValue({
      data: { id: "workspace-1", name: "Regional Agency", slug: "regional-agency" },
      error: null,
    });
    sectionsOrderMock.mockResolvedValue({
      data: [
        { id: "section-1", section_key: "fiscal_constraint", title: "Fiscal constraint", enabled: true, sort_order: 1, config_json: {} },
        { id: "section-2", section_key: "project_list", title: "Project list", enabled: true, sort_order: 2, config_json: {} },
      ],
      error: null,
    });
    artifactsOrderMock.mockResolvedValue({ data: [ARTIFACT_ROW], error: null });

    // Live sides that MATCH the frozen snapshot, so every drift row reads
    // "unchanged" in the control case and any fabricated zero is unmistakable.
    rtpChaptersEqMock.mockResolvedValue({
      data: Array.from({ length: 9 }, (_unused, index) => ({
        id: `chapter-${index}`,
        status: index < 4 ? "complete" : index < 6 ? "ready_for_review" : "drafting",
      })),
      error: null,
    });
    rtpProjectLinksEqMock.mockResolvedValue({
      data: Array.from({ length: 42 }, (_unused, index) => ({
        id: `link-${index}`,
        project_id: `project-${index}`,
      })),
      error: null,
    });
    rtpCampaignsEqCycleMock.mockResolvedValue({
      data: [
        { id: "campaign-1", rtp_cycle_chapter_id: null },
        { id: "campaign-2", rtp_cycle_chapter_id: "chapter-1" },
        { id: "campaign-3", rtp_cycle_chapter_id: "chapter-2" },
      ],
      error: null,
    });
    engagementItemsInMock.mockResolvedValue({ data: [], error: null });

    rtpFundingProfilesInMock.mockResolvedValue({ data: [], error: null });
    rtpFundingAwardsInMock.mockResolvedValue({ data: [], error: null });
    rtpFundingOpportunitiesInMock.mockResolvedValue({ data: [], error: null });
    rtpBillingInvoicesInMock.mockResolvedValue({ data: [], error: null });
  });

  /**
   * THE CONTROL CASE, and the reason every test below proves anything: a page
   * that withheld its whole drift table unconditionally would pass all of them
   * and fail this one.
   *
   * These assert the drift DETAIL sentences, not the row LABELS. The labels
   * ("Linked projects", "Funding posture") also appear in the generation-time
   * metric panel, which reports the frozen snapshot and is legitimate whatever
   * the live reads did — so asserting on a label would have passed with the row
   * withheld and proved nothing. Only `compareCountMetric` emits "Still 42."
   */
  it("still publishes the ordinary drift verdicts when every read SUCCEEDS", async () => {
    await renderPage();

    expect(screen.getAllByText(/Still 42\./).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Still 9\./).length).toBeGreaterThan(0);
    // The live cycle genuinely has no comments, so an HONEST count change is
    // published here. That is the same sentence the read-failure test below
    // asserts is absent — which is exactly what makes that assertion mean
    // something rather than passing on a page that never renders the row.
    expect(
      screen.getAllByText(/Generated with 31, current source is 0/i).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/current source is .* with .* gap project/i).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Enabled section set still matches the packet artifact/i).length
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/Part of this report could not be read/i)).not.toBeInTheDocument();
  });

  it("withholds the funding-posture drift row when the live funding reads FAILED", async () => {
    rtpFundingAwardsInMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied for table "funding_awards"' },
    });

    await renderPage();

    // (a) The fiscal claim is gone. With the awards unread the live snapshot
    // describes a cycle holding no committed money, and the packet published
    // that against the generated snapshot as gap projects that appeared.
    // Neither verdict is sayable: not the drift sentence, and not "unchanged"
    // either, which would certify the packet's fiscal posture against a live
    // snapshot this render never read.
    expect(screen.queryByText(/current source is .* with .* gap project/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Still Mostly funded/i)).not.toBeInTheDocument();
    // And the row is withheld OUTRIGHT rather than left in place wearing the
    // component's null-side fallback, "Funding posture was not captured on both
    // sides of the RTP packet comparison yet." That sentence says NOT RECORDED
    // about a read that FAILED — the exact conflation this lane exists to end,
    // and it would sit under a banner saying the awards could not be read.
    expect(
      screen.queryByText(/Funding posture was not captured on both sides/i)
    ).not.toBeInTheDocument();

    // (b) Disclosed by name, said plainly to be a failed read. Internal page, so
    // the database's own message is shown to the person who can act on it.
    expect(screen.getAllByText(/Part of this report could not be read/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/the funding awards on the projects in this RTP cycle/i).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/permission denied for table "funding_awards"/i).length
    ).toBeGreaterThan(0);

    // (c) The rows whose reads DID succeed are still published. Withholding the
    // whole table would be its own defect: a planner losing the drift they can
    // still legitimately be told about.
    expect(screen.getAllByText(/Still 9\./).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Still 42\./).length).toBeGreaterThan(0);
  });

  it("withholds the linked-project count drift instead of reporting 42 projects as 0", async () => {
    rtpProjectLinksEqMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied for table "project_rtp_cycle_links"' },
    });

    await renderPage();

    // The packet recorded 42 linked projects. An unread link table has zero, and
    // the un-guarded page published "Generated with 42, current source is 0" —
    // an outage told to a funder as a plan that lost its project list.
    expect(screen.queryByText(/Generated with 42, current source is 0/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Still 42\./)).not.toBeInTheDocument();

    expect(
      screen.getAllByText(/the projects linked to this RTP cycle/i).length
    ).toBeGreaterThan(0);
    // And the chapter row, whose read succeeded, still reports its comparison.
    expect(screen.getAllByText(/Still 9\./).length).toBeGreaterThan(0);
  });

  it("withholds the comment-count drift when the public comments could not be read", async () => {
    engagementItemsInMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied for table "engagement_items"' },
    });

    await renderPage();

    // "Pending comments: generated with 31, current source is 0" is an empty
    // moderation queue reported from a broken query — on the surface a planner
    // uses to decide whether anyone is still waiting on a response.
    expect(screen.queryByText(/Generated with 31, current source is 0/i)).not.toBeInTheDocument();
    expect(
      screen.getAllByText(/the public comments on this RTP cycle/i).length
    ).toBeGreaterThan(0);
  });

  it("does not present an unread section list as no sections configured", async () => {
    sectionsOrderMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied for table "report_sections"' },
    });

    await renderPage();

    expect(
      screen.queryAllByText(/No enabled section composition is currently configured/i)
    ).toHaveLength(0);
    expect(
      screen.getAllByText(/could not be read, so its current composition is unknown/i).length
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/this report's sections/i).length).toBeGreaterThan(0);
  });
});
