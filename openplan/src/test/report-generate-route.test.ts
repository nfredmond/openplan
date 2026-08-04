import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { expectProvenanceLanguageOnly } from "./provenance-language-guards";
import { parseReportAerialEvidenceSourceContext } from "@/lib/reports/aerial-source-context";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const reportMaybeSingleMock = vi.fn();
const reportEqMock = vi.fn(() => ({ maybeSingle: reportMaybeSingleMock }));
const reportSelectMock = vi.fn(() => ({ eq: reportEqMock }));
const reportUpdateEqMock = vi.fn().mockResolvedValue({ error: null });
const reportUpdateMock = vi.fn(() => ({ eq: reportUpdateEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const workspaceMaybeSingleMock = vi.fn();
const workspaceEqMock = vi.fn(() => ({ maybeSingle: workspaceMaybeSingleMock }));
const workspaceSelectMock = vi.fn(() => ({ eq: workspaceEqMock }));

const rtpCycleMaybeSingleMock = vi.fn();
const rtpCycleEqMock = vi.fn(() => ({ maybeSingle: rtpCycleMaybeSingleMock }));
const rtpCycleSelectMock = vi.fn(() => ({ eq: rtpCycleEqMock }));

const projectMaybeSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectSelectMock = vi.fn(() => ({ eq: projectEqMock }));

const sectionsOrderMock = vi.fn();
const sectionsEqMock = vi.fn(() => ({ order: sectionsOrderMock }));
const sectionsSelectMock = vi.fn(() => ({ eq: sectionsEqMock }));

const reportRunsOrderMock = vi.fn();
const reportRunsEqMock = vi.fn(() => ({ order: reportRunsOrderMock }));
const reportRunsSelectMock = vi.fn(() => ({ eq: reportRunsEqMock }));

// Workspace AND project scoped. The snapshot built from these rows is frozen
// into a packet an agency sends to a funder, so a gate that passed on a
// different project in the same workspace must not be able to reach it.
const stageGateDecisionsLimitMock = vi.fn();
const stageGateDecisionsOrderMock = vi.fn(() => ({ limit: stageGateDecisionsLimitMock }));
const stageGateDecisionsEqProjectMock = vi.fn(() => ({ order: stageGateDecisionsOrderMock }));
const stageGateDecisionsEqMock = vi.fn(() => ({ eq: stageGateDecisionsEqProjectMock }));
const stageGateDecisionsSelectMock = vi.fn((_columns: string) => ({ eq: stageGateDecisionsEqMock }));

const deliverablesLimitMock = vi.fn();
const deliverablesOrderMock = vi.fn(() => ({ limit: deliverablesLimitMock }));
const deliverablesEqMock = vi.fn(() => ({ order: deliverablesOrderMock }));
const deliverablesSelectMock = vi.fn(() => ({ eq: deliverablesEqMock }));

const risksLimitMock = vi.fn();
const risksOrderMock = vi.fn(() => ({ limit: risksLimitMock }));
const risksEqMock = vi.fn(() => ({ order: risksOrderMock }));
const risksSelectMock = vi.fn(() => ({ eq: risksEqMock }));

const issuesLimitMock = vi.fn();
const issuesOrderMock = vi.fn(() => ({ limit: issuesLimitMock }));
const issuesEqMock = vi.fn(() => ({ order: issuesOrderMock }));
const issuesSelectMock = vi.fn(() => ({ eq: issuesEqMock }));

const decisionsLimitMock = vi.fn();
const decisionsOrderMock = vi.fn(() => ({ limit: decisionsLimitMock }));
const decisionsEqMock = vi.fn(() => ({ order: decisionsOrderMock }));
const decisionsSelectMock = vi.fn(() => ({ eq: decisionsEqMock }));

const meetingsLimitMock = vi.fn();
const meetingsOrderMock = vi.fn(() => ({ limit: meetingsLimitMock }));
const meetingsEqMock = vi.fn(() => ({ order: meetingsOrderMock }));
const meetingsSelectMock = vi.fn(() => ({ eq: meetingsEqMock }));

const fundingProfilesMaybeSingleMock = vi.fn();
const fundingProfilesInMock = vi.fn();
const fundingProfilesEqMock = vi.fn(() => ({ maybeSingle: fundingProfilesMaybeSingleMock }));
const fundingProfilesSelectMock = vi.fn(() => ({ eq: fundingProfilesEqMock, in: fundingProfilesInMock }));

const fundingAwardsOrderMock = vi.fn();
const fundingAwardsInMock = vi.fn();
const fundingAwardsEqMock = vi.fn(() => ({ order: fundingAwardsOrderMock }));
const fundingAwardsSelectMock = vi.fn(() => ({ eq: fundingAwardsEqMock, in: fundingAwardsInMock }));

const fundingOpportunitiesOrderMock = vi.fn();
const fundingOpportunitiesInMock = vi.fn();
const fundingOpportunitiesEqMock = vi.fn(() => ({ order: fundingOpportunitiesOrderMock }));
const fundingOpportunitiesSelectMock = vi.fn(() => ({ eq: fundingOpportunitiesEqMock, in: fundingOpportunitiesInMock }));

const billingInvoicesOrderMock = vi.fn();
const billingInvoicesInMock = vi.fn();
const billingInvoicesEqMock = vi.fn(() => ({ order: billingInvoicesOrderMock }));
const billingInvoicesSelectMock = vi.fn(() => ({ eq: billingInvoicesEqMock, in: billingInvoicesInMock }));

// Aerial provenance for the packet. Loaded through the aerial module's own
// provider, so the packet's aerial claims trace to mission + evidence-package
// rows instead of the `undefined` the read side used to parse.
const aerialMissionsOrderMock = vi.fn();
const aerialMissionsEqMock = vi.fn(() => ({ order: aerialMissionsOrderMock }));
const aerialMissionsSelectMock = vi.fn(() => ({ eq: aerialMissionsEqMock }));

const aerialPackagesOrderMock = vi.fn();
const aerialPackagesEqMock = vi.fn(() => ({ order: aerialPackagesOrderMock }));
const aerialPackagesInMock = vi.fn(() => ({ order: aerialPackagesOrderMock }));
const aerialPackagesSelectMock = vi.fn(() => ({
  eq: aerialPackagesEqMock,
  in: aerialPackagesInMock,
}));

const scenarioEntriesInMock = vi.fn();
const scenarioEntriesSelectMock = vi.fn(() => ({ in: scenarioEntriesInMock }));

const scenarioSetsInMock = vi.fn();
const scenarioSetsSelectMock = vi.fn(() => ({ in: scenarioSetsInMock }));

const runsInMock = vi.fn();
const runsCountGteMock = vi.fn().mockResolvedValue({ count: 0, error: null });
const runsCountEqMock = vi.fn(() => ({ gte: runsCountGteMock }));
const runsSelectMock = vi.fn(
  (_cols: string, opts?: { count?: string; head?: boolean }) => {
    if (opts?.count === "exact") {
      return { eq: runsCountEqMock };
    }
    return { in: runsInMock };
  }
);

const rtpChaptersOrderMock = vi.fn();
const rtpChaptersEqMock = vi.fn(() => ({ order: rtpChaptersOrderMock }));
const rtpChaptersSelectMock = vi.fn(() => ({ eq: rtpChaptersEqMock }));

const projectRtpLinksOrderMock = vi.fn();
const projectRtpLinksEqMock = vi.fn(() => ({ order: projectRtpLinksOrderMock }));
const projectRtpLinksSelectMock = vi.fn(() => ({ eq: projectRtpLinksEqMock }));

const countyRunsLimitMock = vi.fn();
const countyRunsOrderMock = vi.fn(() => ({ limit: countyRunsLimitMock }));
const countyRunsMaybeSingleMock = vi.fn();
const countyRunsEqMock = vi.fn((column?: string) => {
  if (column === "id") {
    return { maybeSingle: countyRunsMaybeSingleMock };
  }

  return { order: countyRunsOrderMock };
});
const countyRunsInMock = vi.fn();
const countyRunsSelectMock = vi.fn(() => ({ eq: countyRunsEqMock, in: countyRunsInMock }));

const modelRunsInMock = vi.fn();
const modelRunsSelectMock = vi.fn(() => ({ in: modelRunsInMock }));

const modelingClaimMaybeSingleMock = vi.fn();
const modelingClaimEqTrackMock = vi.fn(() => ({ maybeSingle: modelingClaimMaybeSingleMock }));
const modelingClaimEqCountyRunMock = vi.fn(() => ({ eq: modelingClaimEqTrackMock }));
/**
 * `.in("model_run_id", …)` is how `loadRtpEvidenceRunDisclosures` asks for the
 * claim tiers a generated packet discloses beside each cited model run — a
 * different shape from the county-run `.eq().eq().maybeSingle()` path above.
 * The double answered only the latter, so wiring the shared tier lookup into
 * this route made it throw a TypeError and the route answered 500. Defaults to
 * no recorded decision; a test that needs a tier overrides it.
 */
const modelingClaimInMock = vi.fn();
const modelingClaimSelectMock = vi.fn(() => ({
  eq: modelingClaimEqCountyRunMock,
  in: modelingClaimInMock,
}));

const modelingSourcesOrderMock = vi.fn();
const modelingSourcesEqMock = vi.fn(() => ({ order: modelingSourcesOrderMock }));
const modelingSourcesSelectMock = vi.fn(() => ({ eq: modelingSourcesEqMock }));

const modelingValidationsOrderMock = vi.fn();
const modelingValidationsEqTrackMock = vi.fn(() => ({ order: modelingValidationsOrderMock }));
const modelingValidationsEqCountyRunMock = vi.fn(() => ({ eq: modelingValidationsEqTrackMock }));
const modelingValidationsSelectMock = vi.fn(() => ({ eq: modelingValidationsEqCountyRunMock }));

const engagementCampaignMaybeSingleMock = vi.fn();
const engagementCampaignEqIdMock = vi.fn(() => ({ maybeSingle: engagementCampaignMaybeSingleMock }));
const rtpEngagementCampaignsOrderMock = vi.fn();
const engagementCampaignEqWorkspaceMock = vi.fn((column?: string) => {
  if (column === "rtp_cycle_id") {
    return { order: rtpEngagementCampaignsOrderMock };
  }

  return { eq: engagementCampaignEqIdMock };
});
const engagementCampaignSelectMock = vi.fn(() => ({ eq: engagementCampaignEqWorkspaceMock }));

const engagementCategoriesOrderCreatedMock = vi.fn();
const engagementCategoriesOrderSortMock = vi.fn(() => ({ order: engagementCategoriesOrderCreatedMock }));
const engagementCategoriesEqCampaignMock = vi.fn(() => ({ order: engagementCategoriesOrderSortMock }));
const engagementCategoriesSelectMock = vi.fn(() => ({ eq: engagementCategoriesEqCampaignMock }));

const engagementItemsOrderMock = vi.fn();
const engagementItemsEqCampaignMock = vi.fn(() => ({ order: engagementItemsOrderMock }));
const engagementItemsSelectMock = vi.fn(() => ({ eq: engagementItemsEqCampaignMock }));

const artifactsSingleMock = vi.fn();
const artifactsInsertSelectMock = vi.fn(() => ({ single: artifactsSingleMock }));
type ArtifactInsertPayload = {
  metadata_json?: { htmlContent?: string } & Record<string, unknown>;
} & Record<string, unknown>;
const artifactsInsertMock = vi.fn((_payload: ArtifactInsertPayload) => ({ select: artifactsInsertSelectMock }));

const storageUploadMock = vi.fn();
const storageFromMock = vi.fn(() => ({ upload: storageUploadMock }));
const renderReportPdfMock = vi.fn();

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "reports") {
    return {
      select: reportSelectMock,
      update: reportUpdateMock,
    };
  }

  if (table === "workspace_members") {
    return {
      select: membershipSelectMock,
    };
  }

  if (table === "workspaces") {
    return {
      select: workspaceSelectMock,
    };
  }

  if (table === "rtp_cycles") {
    return {
      select: rtpCycleSelectMock,
    };
  }

  if (table === "projects") {
    return {
      select: projectSelectMock,
    };
  }

  if (table === "report_sections") {
    return {
      select: sectionsSelectMock,
    };
  }

  if (table === "report_runs") {
    return {
      select: reportRunsSelectMock,
    };
  }

  if (table === "stage_gate_decisions") {
    return {
      select: stageGateDecisionsSelectMock,
    };
  }

  if (table === "project_deliverables") {
    return {
      select: deliverablesSelectMock,
    };
  }

  if (table === "project_risks") {
    return {
      select: risksSelectMock,
    };
  }

  if (table === "project_issues") {
    return {
      select: issuesSelectMock,
    };
  }

  if (table === "project_decisions") {
    return {
      select: decisionsSelectMock,
    };
  }

  if (table === "project_meetings") {
    return {
      select: meetingsSelectMock,
    };
  }

  if (table === "project_funding_profiles") {
    return {
      select: fundingProfilesSelectMock,
    };
  }

  if (table === "funding_awards") {
    return {
      select: fundingAwardsSelectMock,
    };
  }

  if (table === "funding_opportunities") {
    return {
      select: fundingOpportunitiesSelectMock,
    };
  }

  if (table === "billing_invoice_records") {
    return {
      select: billingInvoicesSelectMock,
    };
  }

  if (table === "aerial_missions") {
    return {
      select: aerialMissionsSelectMock,
    };
  }

  if (table === "aerial_evidence_packages") {
    return {
      select: aerialPackagesSelectMock,
    };
  }

  if (table === "scenario_entries") {
    return {
      select: scenarioEntriesSelectMock,
    };
  }

  if (table === "scenario_sets") {
    return {
      select: scenarioSetsSelectMock,
    };
  }

  if (table === "runs") {
    return {
      select: runsSelectMock,
    };
  }

  if (table === "rtp_cycle_chapters") {
    return {
      select: rtpChaptersSelectMock,
    };
  }

  if (table === "project_rtp_cycle_links") {
    return {
      select: projectRtpLinksSelectMock,
    };
  }

  if (table === "county_runs") {
    return {
      select: countyRunsSelectMock,
    };
  }

  if (table === "model_runs") {
    return {
      select: modelRunsSelectMock,
    };
  }

  if (table === "modeling_claim_decisions") {
    return {
      select: modelingClaimSelectMock,
    };
  }

  if (table === "modeling_source_manifests") {
    return {
      select: modelingSourcesSelectMock,
    };
  }

  if (table === "modeling_validation_results") {
    return {
      select: modelingValidationsSelectMock,
    };
  }

  if (table === "engagement_campaigns") {
    return {
      select: engagementCampaignSelectMock,
    };
  }

  if (table === "engagement_categories") {
    return {
      select: engagementCategoriesSelectMock,
    };
  }

  if (table === "engagement_items") {
    return {
      select: engagementItemsSelectMock,
    };
  }

  if (table === "report_artifacts") {
    return {
      insert: artifactsInsertMock,
    };
  }

  if (table === "assistant_action_executions") {
    return {
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/reports/pdf", () => ({
  renderReportPdf: (...args: unknown[]) => renderReportPdfMock(...args),
}));

import { POST as postGenerate } from "@/app/api/reports/[reportId]/generate/route";

describe("POST /api/reports/[reportId]/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    authGetUserMock.mockResolvedValue({
      data: {
        user: {
          id: "22222222-2222-4222-8222-222222222222",
        },
      },
    });

    reportMaybeSingleMock.mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        project_id: "44444444-4444-4444-8444-444444444444",
        title: "Project Status Packet",
        summary: "Packet summary",
        report_type: "project_status",
        status: "draft",
        created_at: "2026-03-14T00:00:00.000Z",
      },
      error: null,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: {
        workspace_id: "33333333-3333-4333-8333-333333333333",
        role: "member",
      },
      error: null,
    });

    workspaceMaybeSingleMock.mockResolvedValue({
      data: {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Nevada County Safety Action Program",
        plan: "pilot",
        subscription_plan: "pilot",
        subscription_status: "active",
      },
      error: null,
    });

    rtpCycleMaybeSingleMock.mockResolvedValue({
      data: {
        id: "77777777-7777-4777-8777-777777777777",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        title: "2027 Nevada County RTP",
        status: "draft",
        geography_label: "Nevada County, CA",
        horizon_start_year: 2027,
        horizon_end_year: 2050,
        adoption_target_date: null,
        public_review_open_at: null,
        public_review_close_at: null,
        summary: "RTP cycle summary",
        updated_at: "2026-04-24T00:00:00.000Z",
      },
      error: null,
    });

    projectMaybeSingleMock.mockResolvedValue({
      data: {
        id: "44444444-4444-4444-8444-444444444444",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        name: "Nevada County Safety Action Program",
        summary: "Project summary",
        status: "active",
        plan_type: "safety_plan",
        delivery_phase: "analysis",
        created_at: "2026-03-13T00:00:00.000Z",
        updated_at: "2026-03-14T01:00:00.000Z",
      },
      error: null,
    });

    sectionsOrderMock.mockResolvedValue({
      data: [{ id: "section-1", section_key: "project_overview", title: "Project overview", enabled: true, sort_order: 0, config_json: {} }],
      error: null,
    });

    reportRunsOrderMock.mockResolvedValue({
      data: [{ id: "report-run-1", run_id: "55555555-5555-4555-8555-555555555555", sort_order: 0 }],
      error: null,
    });
    rtpChaptersOrderMock.mockResolvedValue({
      data: [
        {
          id: "rtp-chapter-1",
          title: "Existing conditions",
          section_type: "performance",
          status: "ready_for_review",
          summary: "Model-backed existing conditions.",
          guidance: "Include validation caveats.",
          content_markdown: "The screening run identifies capacity stress on SR-174.",
          sort_order: 10,
        },
      ],
      error: null,
    });
    projectRtpLinksOrderMock.mockResolvedValue({ data: [], error: null });
    rtpEngagementCampaignsOrderMock.mockResolvedValue({ data: [], error: null });
    countyRunsLimitMock.mockResolvedValue({ data: [], error: null });
    countyRunsMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    countyRunsInMock.mockResolvedValue({ data: [], error: null });
    modelRunsInMock.mockResolvedValue({ data: [], error: null });
    modelingClaimMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    modelingClaimInMock.mockResolvedValue({ data: [], error: null });
    modelingSourcesOrderMock.mockResolvedValue({ data: [], error: null });
    modelingValidationsOrderMock.mockResolvedValue({ data: [], error: null });
    stageGateDecisionsLimitMock.mockResolvedValue({ data: [], error: null });

    deliverablesLimitMock.mockResolvedValue({ data: [], error: null });
    risksLimitMock.mockResolvedValue({ data: [], error: null });
    issuesLimitMock.mockResolvedValue({ data: [], error: null });
    decisionsLimitMock.mockResolvedValue({ data: [], error: null });
    meetingsLimitMock.mockResolvedValue({ data: [], error: null });
    fundingProfilesMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    fundingProfilesInMock.mockResolvedValue({ data: [], error: null });
    fundingAwardsOrderMock.mockResolvedValue({ data: [], error: null });
    fundingAwardsInMock.mockResolvedValue({ data: [], error: null });
    fundingOpportunitiesOrderMock.mockResolvedValue({ data: [], error: null });
    fundingOpportunitiesInMock.mockResolvedValue({ data: [], error: null });
    billingInvoicesOrderMock.mockResolvedValue({ data: [], error: null });
    billingInvoicesInMock.mockResolvedValue({ data: [], error: null });

    const runRowsById = new Map([
      [
        "55555555-5555-4555-8555-555555555555",
        {
          id: "55555555-5555-4555-8555-555555555555",
          title: "Run A",
          query_text: "Assess corridor",
          summary_text: "Run summary",
          ai_interpretation: "AI interpretation",
          metrics: {
            overallScore: 81,
            confidence: "high",
            sourceSnapshots: {
              census: { fetchedAt: "2026-03-12T00:00:00.000Z" },
              transit: { fetchedAt: "2026-03-12T00:00:00.000Z" },
              crashes: { fetchedAt: "2026-03-12T00:00:00.000Z" },
            },
            dataQuality: {
              censusAvailable: true,
              crashDataAvailable: true,
              lodesSource: "lodes",
              equitySource: "cejst-proxy-census",
            },
          },
          created_at: "2026-03-12T00:00:00.000Z",
        },
      ],
      [
        "66666666-6666-4666-8666-666666666666",
        {
          id: "66666666-6666-4666-8666-666666666666",
          title: "Existing conditions baseline",
          query_text: "Assess current conditions",
          summary_text: "Baseline summary",
          ai_interpretation: "Baseline interpretation",
          metrics: {
            overallScore: 74,
            confidence: "medium",
          },
          created_at: "2026-03-10T00:00:00.000Z",
        },
      ],
    ]);

    runsInMock.mockImplementation(async (_column: string, ids: string[]) => ({
      data: ids
        .map((id) => runRowsById.get(id))
        .filter((value): value is NonNullable<ReturnType<typeof runRowsById.get>> => Boolean(value)),
      error: null,
    }));

    scenarioEntriesInMock.mockImplementation(async (column: string) => {
      if (column === "attached_run_id") {
        return {
          data: [
            {
              id: "scenario-entry-alt",
              scenario_set_id: "scenario-set-1",
              entry_type: "alternative",
              label: "Protected bike package",
              attached_run_id: "55555555-5555-4555-8555-555555555555",
              sort_order: 1,
              created_at: "2026-03-09T00:00:00.000Z",
              updated_at: "2026-03-14T01:30:00.000Z",
            },
          ],
          error: null,
        };
      }

      if (column === "scenario_set_id") {
        return {
          data: [
            {
              id: "scenario-entry-baseline",
              scenario_set_id: "scenario-set-1",
              entry_type: "baseline",
              label: "Existing conditions",
              attached_run_id: "66666666-6666-4666-8666-666666666666",
              sort_order: 0,
              created_at: "2026-03-08T00:00:00.000Z",
              updated_at: "2026-03-14T01:00:00.000Z",
            },
            {
              id: "scenario-entry-alt",
              scenario_set_id: "scenario-set-1",
              entry_type: "alternative",
              label: "Protected bike package",
              attached_run_id: "55555555-5555-4555-8555-555555555555",
              sort_order: 1,
              created_at: "2026-03-09T00:00:00.000Z",
              updated_at: "2026-03-14T01:30:00.000Z",
            },
          ],
          error: null,
        };
      }

      throw new Error(`Unexpected scenario_entries lookup column: ${column}`);
    });

    scenarioSetsInMock.mockResolvedValue({
      data: [
        {
          id: "scenario-set-1",
          title: "Downtown alternatives",
          baseline_entry_id: "scenario-entry-baseline",
          updated_at: "2026-03-14T01:15:00.000Z",
        },
      ],
      error: null,
    });

    // Default: this project has no aerial work — a SUCCESSFUL read of zero
    // rows, which is a different thing from a read that failed.
    aerialMissionsOrderMock.mockResolvedValue({ data: [], error: null });
    aerialPackagesOrderMock.mockResolvedValue({ data: [], error: null });

    engagementCampaignMaybeSingleMock.mockResolvedValue({
      data: {
        id: "99999999-9999-4999-8999-999999999999",
        title: "Downtown listening campaign",
        summary: "Capture walking and crossing feedback.",
        status: "active",
        engagement_type: "comment_collection",
        share_token: "share-token-12345",
        updated_at: "2026-03-14T02:30:00.000Z",
      },
      error: null,
    });

    engagementCategoriesOrderCreatedMock.mockResolvedValue({
      data: [
        {
          id: "category-1",
          label: "Safety",
          slug: "safety",
          description: "Crossings and vehicle behavior",
          sort_order: 0,
          created_at: "2026-03-12T00:00:00.000Z",
          updated_at: "2026-03-13T00:00:00.000Z",
        },
      ],
      error: null,
    });

    engagementItemsOrderMock.mockResolvedValue({
      data: [
        {
          id: "item-1",
          campaign_id: "99999999-9999-4999-8999-999999999999",
          category_id: "category-1",
          status: "approved",
          source_type: "public",
          latitude: 34.1,
          longitude: -118.3,
          moderation_notes: "Verified in workshop.",
          created_at: "2026-03-12T00:00:00.000Z",
          updated_at: "2026-03-14T03:00:00.000Z",
        },
      ],
      error: null,
    });

    artifactsSingleMock.mockResolvedValue({
      data: {
        id: "artifact-1",
        report_id: "11111111-1111-4111-8111-111111111111",
        artifact_kind: "html",
        generated_at: "2026-03-14T02:00:00.000Z",
        metadata_json: {},
      },
      error: null,
    });

    storageUploadMock.mockResolvedValue({ error: null });
    renderReportPdfMock.mockResolvedValue({
      bytes: new Uint8Array([37, 80, 68, 70]),
      engine: "chrome",
      pageCount: null,
      disclosure: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
      storage: { from: storageFromMock },
    });
    createServiceRoleClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "assistant_action_executions") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        throw new Error(`Unexpected service table: ${table}`);
      }),
    });
  });

  it("persists a pdf artifact with storage_path + sets latest_artifact_kind to pdf", async () => {
    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "pdf" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    expect(renderReportPdfMock).toHaveBeenCalledTimes(1);
    expect(storageFromMock).toHaveBeenCalledWith("report-artifacts");
    expect(storageUploadMock).toHaveBeenCalledTimes(1);
    const uploadArgs = storageUploadMock.mock.calls[0];
    const uploadPath: string = uploadArgs[0];
    expect(uploadPath.startsWith("33333333-3333-4333-8333-333333333333/11111111-1111-4111-8111-111111111111/")).toBe(
      true
    );
    expect(uploadPath.endsWith(".pdf")).toBe(true);
    expect(uploadArgs[2]).toMatchObject({ contentType: "application/pdf", upsert: false });
    expect(artifactsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        artifact_kind: "pdf",
        storage_path: uploadPath,
      })
    );
    expect(reportUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ latest_artifact_kind: "pdf" })
    );
    expect(await response.json()).toMatchObject({
      format: "pdf",
      storagePath: uploadPath,
    });
  });

  it("rejects oversized generation requests before auth lookup", async () => {
    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html", oversized: "x".repeat(257 * 1024) }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(413);
    expect(createClientMock).not.toHaveBeenCalled();
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "request_body_too_large",
      expect.objectContaining({
        reportId: "11111111-1111-4111-8111-111111111111",
        maxBytes: 256 * 1024,
      })
    );
  });

  /**
   * CORRECTED, not updated. This previously asserted that a rendering failure
   * returns 500 — describing the code rather than the intent. A deployment
   * without a browser engine (the $0/self-host case) would then have had NO
   * working PDF export at all, and "requires operator setup" is a defect here.
   * `renderReportPdf` falls back to the built-in typesetter, so a COMPLETE
   * packet still leaves the building; only the typesetting differs, and the
   * tier is recorded on the artifact.
   */
  it("still produces a packet when no browser engine is available, recording the tier", async () => {
    renderReportPdfMock.mockResolvedValueOnce({
      bytes: new Uint8Array([37, 80, 68, 70]),
      engine: "builtin",
      pageCount: 4,
      disclosure: "Typeset by OpenPlan's built-in PDF writer",
    });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "pdf" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    expect(storageUploadMock).toHaveBeenCalled();
    expect(artifactsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata_json: expect.objectContaining({ pdfEngine: "builtin" }),
      })
    );
  });

  it("returns 500 when PDF storage upload fails", async () => {
    storageUploadMock.mockResolvedValueOnce({ error: { message: "bucket unavailable" } });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "pdf" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(500);
    expect(renderReportPdfMock).toHaveBeenCalledTimes(1);
    expect(artifactsInsertMock).not.toHaveBeenCalled();
  });

  it("returns 403 when workspace role is unsupported", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({
      data: {
        workspace_id: "33333333-3333-4333-8333-333333333333",
        role: "viewer",
      },
      error: null,
    });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Workspace access denied" });
  });

  it("persists an html artifact and updates report status", async () => {
    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      reportId: "11111111-1111-4111-8111-111111111111",
      artifactId: "artifact-1",
      format: "html",
    });
    expect(artifactsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        report_id: "11111111-1111-4111-8111-111111111111",
        artifact_kind: "html",
        generated_by: "22222222-2222-4222-8222-222222222222",
        metadata_json: expect.objectContaining({
          generationMode: "structured_html_packet",
          sourceContext: expect.objectContaining({
            linkedRunCount: 1,
            evidenceChainSummary: expect.objectContaining({
              linkedRunCount: 1,
              scenarioSetLinkCount: 1,
            }),
          }),
        }),
      })
    );
    expect(reportUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "generated",
        latest_artifact_kind: "html",
        metadata_json: expect.objectContaining({
          artifactHistory: [
            expect.objectContaining({
              artifactId: "artifact-1",
              artifactKind: "html",
              generatedBy: "22222222-2222-4222-8222-222222222222",
              generationMode: "structured_html_packet",
              sourceContextSummary: expect.objectContaining({
                reportOrigin: "report_builder",
                linkedRunCount: 1,
                modelingEvidenceCount: 0,
                engagementItemCount: 0,
              }),
            }),
          ],
        }),
        rtp_basis_stale: false,
        rtp_basis_stale_reason: null,
        rtp_basis_stale_run_id: null,
        rtp_basis_stale_marked_at: null,
      })
    );
  });

  it("renders cited model and county runs with honest engine, status, and screening framing", async () => {
    sectionsOrderMock.mockResolvedValueOnce({
      data: [
        { id: "section-1", section_key: "project_overview", title: "Project overview", enabled: true, sort_order: 0, config_json: {} },
        { id: "section-2", section_key: "run_summaries", title: "Run summaries", enabled: true, sort_order: 1, config_json: {} },
      ],
      error: null,
    });
    reportRunsOrderMock.mockResolvedValueOnce({
      data: [
        { id: "report-run-1", run_id: "55555555-5555-4555-8555-555555555555", model_run_id: null, county_run_id: null, sort_order: 0 },
        { id: "report-run-2", run_id: null, model_run_id: "model-run-1", county_run_id: null, sort_order: 1 },
        { id: "report-run-3", run_id: null, model_run_id: null, county_run_id: "county-run-1", sort_order: 2 },
      ],
      error: null,
    });
    modelRunsInMock.mockResolvedValueOnce({
      data: [
        {
          id: "model-run-1",
          run_title: "SR-49 fast screening",
          engine_key: "aequilibrae",
          status: "succeeded",
          result_summary_json: { overallScore: 63, accessibilityScore: 52 },
        },
      ],
      error: null,
    });
    countyRunsInMock.mockResolvedValueOnce({
      data: [
        {
          id: "county-run-1",
          run_name: "County screening baseline",
          stage: "validated-screening",
          validation_summary_json: { passed: 3, warned: 1, failed: 0 },
        },
      ],
      error: null,
    });
    // A recorded claim tier for the cited model run, which the packet must
    // disclose beside it.
    modelingClaimInMock.mockResolvedValueOnce({
      data: [{ model_run_id: "model-run-1", claim_status: "calibrated_to_counts" }],
      error: null,
    });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    const generatedArtifact = artifactsInsertMock.mock.calls.at(-1)?.[0];
    const htmlContent = String(generatedArtifact?.metadata_json?.htmlContent ?? "");
    // The cited model run carries its title, engine, status, KPI line, and the
    // run-mode caveat verbatim.
    expect(htmlContent).toContain("SR-49 fast screening");
    expect(htmlContent).toContain("Fast Screening");
    expect(htmlContent).toContain("Succeeded");
    expect(htmlContent).toContain("Overall score 63/100");
    expect(htmlContent).toContain("Accessibility 52/100");
    expect(htmlContent).toContain("Screening-grade prototype output.");
    // AND ITS CLAIM TIER, from `modeling_claim_decisions` (seeded above), which
    // is the third thing a reader needs before trusting the figures. This route
    // rendered engine + status + KPIs only while `citedModelRunClaimTierLine`
    // sat in html.ts as dead code — the tier was resolved, tested, and reached
    // no packet. A funder reads this file; only an assertion on the generated
    // HTML proves the disclosure survived the route.
    expect(htmlContent).toContain("Claim tier: Calibrated to counts");
    // The cited county run carries its name, stage, and validation posture.
    expect(htmlContent).toContain("County screening baseline");
    expect(htmlContent).toContain("Validated Screening");
    expect(htmlContent).toContain("3 pass");
    expect(htmlContent).toContain("1 warning");
    expectProvenanceLanguageOnly(htmlContent);

    const sourceContext = generatedArtifact?.metadata_json?.sourceContext as Record<string, unknown>;
    expect(sourceContext).toMatchObject({
      linkedRunCount: 1,
      citedModelRunCount: 1,
      citedCountyRunCount: 1,
      citedModelRuns: [
        { id: "model-run-1", runTitle: "SR-49 fast screening", engineKey: "aequilibrae", status: "succeeded" },
      ],
      citedCountyRuns: [{ id: "county-run-1", runName: "County screening baseline", stage: "validated-screening" }],
    });
  });

  it("persists project funding profile scan and source-context readiness in artifact metadata", async () => {
    fundingProfilesMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "funding-profile-1",
        funding_need_amount: 2_000_000,
        local_match_need_amount: 400_000,
        updated_at: "2026-05-09T12:00:00.000Z",
      },
      error: null,
    });
    fundingAwardsOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "award-1",
          awarded_amount: 900_000,
          match_amount: 150_000,
          risk_flag: "none",
          obligation_due_at: "2099-06-01T00:00:00.000Z",
          updated_at: "2026-05-09T13:00:00.000Z",
          created_at: "2026-05-08T00:00:00.000Z",
        },
      ],
      error: null,
    });
    fundingOpportunitiesOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "opportunity-1",
          expected_award_amount: 500_000,
          decision_state: "pursue",
          opportunity_status: "open",
          closes_at: "2099-06-15T00:00:00.000Z",
          updated_at: "2026-05-09T14:00:00.000Z",
          created_at: "2026-05-08T00:00:00.000Z",
        },
      ],
      error: null,
    });
    billingInvoicesOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "invoice-1",
          funding_award_id: "award-1",
          status: "submitted",
          amount: 250_000,
          retention_percent: 0,
          retention_amount: 0,
          net_amount: 250_000,
          due_date: null,
          invoice_date: "2026-05-09T15:00:00.000Z",
          created_at: "2026-05-09T15:00:00.000Z",
        },
      ],
      error: null,
    });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    const generatedArtifact = artifactsInsertMock.mock.calls.at(-1)?.[0];
    const sourceContext = generatedArtifact?.metadata_json?.sourceContext as Record<string, unknown>;

    expect(sourceContext.projectFundingSnapshot).toMatchObject({
      fundingNeedAmount: 2_000_000,
      committedFundingAmount: 900_000,
      likelyFundingAmount: 500_000,
      unfundedAfterLikelyAmount: 600_000,
      latestSourceUpdatedAt: "2026-05-09T15:00:00.000Z",
    });
    expect(sourceContext.projectFundingProfileScan).toMatchObject({
      status: "attention",
      label: "Funding profile needs operator review",
      lanes: expect.arrayContaining([
        expect.objectContaining({ id: "funding_target", status: "attention", amount: 600_000 }),
        expect.objectContaining({ id: "local_match", status: "attention", amount: 250_000 }),
        expect.objectContaining({ id: "evidence_support", status: "ready" }),
      ]),
    });
    expect(JSON.stringify(sourceContext.projectFundingProfileScan)).toContain("not an award prediction");
    expect(sourceContext.fundingSourceContextReadiness).toMatchObject({
      status: "attention",
      hasComparisonEvidence: true,
      linkedRunCount: 1,
      fundingScanStatus: "attention",
      operatorReviewCaveat: expect.stringContaining("not legal compliance automation, award prediction, or autonomous approval"),
    });
    expect(sourceContext.fundingSourceContextReadiness).toMatchObject({
      label: expect.stringContaining("operator review"),
      detail: expect.stringContaining("operator reviews"),
    });
    expectProvenanceLanguageOnly(JSON.stringify(sourceContext.fundingSourceContextReadiness));
  });

  it("adds modeling evidence claim posture to project report artifacts", async () => {
    countyRunsLimitMock.mockResolvedValueOnce({
      data: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          workspace_id: "33333333-3333-4333-8333-333333333333",
          run_name: "Nevada County assignment screening",
          geography_label: "Nevada County, CA",
          stage: "validated-screening",
          updated_at: "2026-04-24T01:00:00.000Z",
        },
      ],
      error: null,
    });
    modelingClaimMaybeSingleMock.mockResolvedValueOnce({
      data: {
        track: "assignment",
        claim_status: "screening_grade",
        status_reason: "Worst matched facility APE 237.62% exceeds the 50% claim-grade threshold.",
        reasons_json: ["Worst matched facility APE 237.62% exceeds the 50% claim-grade threshold."],
        validation_summary_json: {
          passed: 3,
          warned: 1,
          failed: 1,
          missingRequiredMetricKeys: [],
          requiredMetricKeys: ["assignment_final_gap", "critical_absolute_percent_error"],
        },
        decided_at: "2026-04-24T01:00:00.000Z",
      },
      error: null,
    });
    modelingSourcesOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "source-1",
          source_key: "observed_count_validation",
          source_kind: "local_public_counts",
          source_label: "Observed count validation",
          source_url: null,
          source_vintage: "2026",
          geography_id: "06057",
          geography_label: "Nevada County, CA",
          license_note: "Public agency count data.",
          citation_text: "Observed public count validation for Nevada County.",
        },
      ],
      error: null,
    });
    modelingValidationsOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "validation-1",
          track: "assignment",
          metric_key: "critical_absolute_percent_error",
          metric_label: "Critical facility absolute percent error",
          observed_value: 237.62,
          threshold_value: 50,
          threshold_max_value: null,
          threshold_comparator: "lte",
          status: "fail",
          blocks_claim_grade: true,
          detail: "Worst matched facility APE 237.62% exceeds the 50% claim-grade threshold.",
          source_manifest_id: "source-1",
          evaluated_at: "2026-04-24T01:00:00.000Z",
        },
      ],
      error: null,
    });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    const generatedArtifact = artifactsInsertMock.mock.calls.at(-1)?.[0];
    const metadata = generatedArtifact?.metadata_json;

    expect(metadata).toEqual(
      expect.objectContaining({
        generationMode: "structured_html_packet",
        htmlContent: expect.stringContaining("Modeling evidence and claim posture"),
        sourceContext: expect.objectContaining({
          modelingEvidenceCount: 1,
          modelingEvidenceClaimStatuses: ["screening_grade"],
          modelingEvidence: [
            expect.objectContaining({
              countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              claimStatus: "screening_grade",
              sourceManifestCount: 1,
              validationResultCount: 1,
              reportLanguage:
                "Screening-grade modeling result. Use for planning context only, and include the validation caveats before making any outward claim.",
            }),
          ],
          evidenceChainSummary: expect.objectContaining({
            modelingEvidenceCount: 1,
            modelingEvidenceClaimLabel: "Screening-grade",
          }),
        }),
      })
    );
    expect(metadata?.htmlContent).toContain("Worst matched facility APE 237.62% exceeds the 50% claim-grade threshold.");
    expect(metadata?.htmlContent).toContain("Observed count validation");
    expect(metadata?.htmlContent).toContain("Modeling claim posture");
    expect(metadata?.htmlContent).toContain("not describe it as a validated behavioral forecast or certified calibration");
    expectProvenanceLanguageOnly(metadata?.htmlContent);
  });

  it("uses a report-linked modeling county run before recent workspace runs", async () => {
    reportMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        project_id: "44444444-4444-4444-8444-444444444444",
        rtp_cycle_id: null,
        modeling_county_run_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        title: "Project Status Packet",
        summary: "Packet summary",
        report_type: "project_status",
        status: "draft",
        created_at: "2026-03-14T00:00:00.000Z",
        generated_at: null,
        metadata_json: {},
      },
      error: null,
    });
    countyRunsMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        run_name: "Explicit assignment run",
        geography_label: "Nevada County explicit run",
        stage: "validated-screening",
        updated_at: "2026-04-24T02:00:00.000Z",
      },
      error: null,
    });
    modelingClaimMaybeSingleMock.mockResolvedValueOnce({
      data: {
        track: "assignment",
        claim_status: "claim_grade_passed",
        status_reason: "All required public-data validation checks passed.",
        reasons_json: [],
        validation_summary_json: {
          passed: 5,
          warned: 0,
          failed: 0,
          missingRequiredMetricKeys: [],
          requiredMetricKeys: ["assignment_final_gap"],
        },
        decided_at: "2026-04-24T02:00:00.000Z",
      },
      error: null,
    });
    modelingSourcesOrderMock.mockResolvedValueOnce({ data: [], error: null });
    modelingValidationsOrderMock.mockResolvedValueOnce({ data: [], error: null });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    expect(countyRunsEqMock).toHaveBeenCalledWith("id", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(countyRunsLimitMock).not.toHaveBeenCalled();
    const generatedArtifact = artifactsInsertMock.mock.calls.at(-1)?.[0];
    expect(generatedArtifact?.metadata_json?.sourceContext).toEqual(
      expect.objectContaining({
        modelingEvidenceCount: 1,
        modelingEvidenceClaimStatuses: ["claim_grade_passed"],
        modelingEvidence: [
          expect.objectContaining({
            countyRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            geographyLabel: "Nevada County explicit run",
            claimStatus: "claim_grade_passed",
          }),
        ],
      })
    );
  });

  it("persists compact project-record provenance in artifact metadata and html", async () => {
    deliverablesLimitMock.mockResolvedValueOnce({
      data: [
        {
          id: "deliverable-1",
          title: "ADA curb ramp package",
          summary: "Bundle for near-term accessibility fixes.",
          status: "in_progress",
          due_date: "2026-03-20T00:00:00.000Z",
          created_at: "2026-03-14T00:00:00.000Z",
        },
      ],
      error: null,
    });
    risksLimitMock.mockResolvedValueOnce({
      data: [
        {
          id: "risk-1",
          title: "Grant match exposure",
          description: "Funding share remains unresolved.",
          status: "open",
          created_at: "2026-03-18T15:30:00.000Z",
        },
      ],
      error: null,
    });
    issuesLimitMock.mockResolvedValueOnce({
      data: [
        {
          id: "issue-1",
          title: "Signal timing conflict",
          description: "Peak phasing needs revision.",
          status: "open",
          created_at: "2026-03-19T09:45:00.000Z",
        },
      ],
      error: null,
    });
    decisionsLimitMock.mockResolvedValueOnce({
      data: [
        {
          id: "decision-1",
          title: "Advance quick-build crosswalk package",
          rationale: "Near-term safety benefit is high.",
          status: "approved",
          decided_at: "2026-03-17T18:00:00.000Z",
          created_at: "2026-03-16T12:00:00.000Z",
        },
      ],
      error: null,
    });
    meetingsLimitMock.mockResolvedValueOnce({
      data: [
        {
          id: "meeting-1",
          title: "Operations review",
          notes: "Confirmed striping sequencing.",
          meeting_at: "2026-03-15T17:00:00.000Z",
          created_at: "2026-03-15T17:00:00.000Z",
        },
      ],
      error: null,
    });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    expect(artifactsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata_json: expect.objectContaining({
          sourceContext: expect.objectContaining({
            projectRecordsSnapshot: {
              deliverables: {
                count: 1,
                latestTitle: "ADA curb ramp package",
                latestAt: "2026-03-20T00:00:00.000Z",
              },
              risks: {
                count: 1,
                latestTitle: "Grant match exposure",
                latestAt: "2026-03-18T15:30:00.000Z",
              },
              issues: {
                count: 1,
                latestTitle: "Signal timing conflict",
                latestAt: "2026-03-19T09:45:00.000Z",
              },
              decisions: {
                count: 1,
                latestTitle: "Advance quick-build crosswalk package",
                latestAt: "2026-03-17T18:00:00.000Z",
              },
              meetings: {
                count: 1,
                latestTitle: "Operations review",
                latestAt: "2026-03-15T17:00:00.000Z",
              },
            },
          }),
          htmlContent: expect.stringContaining("Project records provenance"),
        }),
      })
    );

    const generatedArtifact = artifactsInsertMock.mock.calls.at(-1)?.[0];
    const generatedHtml = generatedArtifact?.metadata_json?.htmlContent;

    expect(generatedHtml).toContain("ADA curb ramp package");
    expect(generatedHtml).toContain("Grant match exposure");
    expect(generatedHtml).toContain("Signal timing conflict");
    expect(generatedHtml).toContain("Advance quick-build crosswalk package");
    expect(generatedHtml).toContain("Operations review");
    expect(generatedHtml).toContain('/projects/44444444-4444-4444-8444-444444444444#project-deliverables');
    expect(generatedHtml).toContain('/projects/44444444-4444-4444-8444-444444444444#project-risks');
  });

  it("adds modeling evidence claim posture to RTP packet artifacts", async () => {
    reportMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        project_id: null,
        rtp_cycle_id: "77777777-7777-4777-8777-777777777777",
        title: "RTP Packet",
        summary: "Packet summary",
        report_type: "rtp_packet",
        status: "draft",
        created_at: "2026-04-24T00:00:00.000Z",
        generated_at: null,
        metadata_json: {},
      },
      error: null,
    });
    sectionsOrderMock.mockResolvedValueOnce({
      data: [
        { id: "section-1", section_key: "cycle_overview", title: "Cycle overview", enabled: true, sort_order: 0, config_json: {} },
        { id: "section-2", section_key: "chapter_digest", title: "Chapter digest", enabled: true, sort_order: 1, config_json: {} },
        { id: "section-3", section_key: "appendix_references", title: "Appendix", enabled: true, sort_order: 2, config_json: {} },
      ],
      error: null,
    });
    countyRunsLimitMock.mockResolvedValueOnce({
      data: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          workspace_id: "33333333-3333-4333-8333-333333333333",
          run_name: "Nevada County assignment screening",
          geography_label: "Nevada County, CA",
          stage: "validated-screening",
          updated_at: "2026-04-24T01:00:00.000Z",
        },
      ],
      error: null,
    });
    modelingClaimMaybeSingleMock.mockResolvedValueOnce({
      data: {
        track: "assignment",
        claim_status: "screening_grade",
        status_reason: "Worst matched facility APE 237.62% exceeds the 50% claim-grade threshold.",
        reasons_json: ["Worst matched facility APE 237.62% exceeds the 50% claim-grade threshold."],
        validation_summary_json: {
          passed: 3,
          warned: 1,
          failed: 1,
          missingRequiredMetricKeys: [],
          requiredMetricKeys: ["assignment_final_gap", "critical_absolute_percent_error"],
        },
        decided_at: "2026-04-24T01:00:00.000Z",
      },
      error: null,
    });
    modelingSourcesOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "source-1",
          source_key: "observed_count_validation",
          source_kind: "local_public_counts",
          source_label: "Observed count validation",
          source_url: null,
          source_vintage: "2026",
          geography_id: "06057",
          geography_label: "Nevada County, CA",
          license_note: "Public agency count data.",
          citation_text: "Observed public count validation for Nevada County.",
        },
      ],
      error: null,
    });
    modelingValidationsOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "validation-1",
          track: "assignment",
          metric_key: "critical_absolute_percent_error",
          metric_label: "Critical facility absolute percent error",
          observed_value: 237.62,
          threshold_value: 50,
          threshold_max_value: null,
          threshold_comparator: "lte",
          status: "fail",
          blocks_claim_grade: true,
          detail: "Worst matched facility APE 237.62% exceeds the 50% claim-grade threshold.",
          source_manifest_id: "source-1",
          evaluated_at: "2026-04-24T01:00:00.000Z",
        },
      ],
      error: null,
    });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    const generatedArtifact = artifactsInsertMock.mock.calls.at(-1)?.[0];
    const metadata = generatedArtifact?.metadata_json;

    expect(metadata).toEqual(
      expect.objectContaining({
        generationMode: "rtp_html_packet",
        htmlContent: expect.stringContaining("Assignment modeling claim posture"),
        sourceContext: expect.objectContaining({
          reportOrigin: "rtp_cycle_packet",
          modelingEvidenceCount: 1,
          modelingEvidenceClaimStatuses: ["screening_grade"],
          modelingEvidence: [
            expect.objectContaining({
              countyRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              claimStatus: "screening_grade",
              sourceManifestCount: 1,
              validationResultCount: 1,
              reportLanguage:
                "Screening-grade modeling result. Use for planning context only, and include the validation caveats before making any outward claim.",
            }),
          ],
        }),
      })
    );
    expect(metadata?.htmlContent).toContain("Worst matched facility APE 237.62% exceeds the 50% claim-grade threshold.");
    expect(metadata?.htmlContent).toContain("Observed count validation");
    expect(metadata?.htmlContent).toContain("not describe it as a validated behavioral forecast or certified calibration");
    expectProvenanceLanguageOnly(metadata?.htmlContent);
  });

  it("persists RTP linked-project funding scans and funding source-context readiness", async () => {
    reportMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        project_id: null,
        rtp_cycle_id: "77777777-7777-4777-8777-777777777777",
        title: "RTP Packet",
        summary: "Packet summary",
        report_type: "rtp_packet",
        status: "draft",
        created_at: "2026-04-24T00:00:00.000Z",
        generated_at: null,
        metadata_json: {},
      },
      error: null,
    });
    projectRtpLinksOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "link-1",
          project_id: "44444444-4444-4444-8444-444444444444",
          portfolio_role: "constrained",
          priority_rationale: "Core safety project for the constrained RTP list.",
          projects: {
            id: "44444444-4444-4444-8444-444444444444",
            name: "Nevada County Safety Action Program",
            status: "active",
            delivery_phase: "analysis",
            summary: "Project summary",
            updated_at: "2026-05-09T10:00:00.000Z",
          },
        },
      ],
      error: null,
    });
    fundingProfilesInMock.mockResolvedValueOnce({
      data: [
        {
          project_id: "44444444-4444-4444-8444-444444444444",
          funding_need_amount: 1_000_000,
          local_match_need_amount: 100_000,
          updated_at: "2026-05-09T11:00:00.000Z",
        },
      ],
      error: null,
    });
    fundingAwardsInMock.mockResolvedValueOnce({
      data: [
        {
          project_id: "44444444-4444-4444-8444-444444444444",
          awarded_amount: 1_000_000,
          match_amount: 100_000,
          risk_flag: "none",
          obligation_due_at: "2099-01-01T00:00:00.000Z",
          updated_at: "2026-05-09T12:00:00.000Z",
          created_at: "2026-05-09T12:00:00.000Z",
        },
      ],
      error: null,
    });
    fundingOpportunitiesInMock.mockResolvedValueOnce({ data: [], error: null });
    billingInvoicesInMock.mockResolvedValueOnce({
      data: [
        {
          project_id: "44444444-4444-4444-8444-444444444444",
          status: "paid",
          amount: 1_000_000,
          retention_percent: 0,
          retention_amount: 0,
          net_amount: 1_000_000,
          due_date: null,
          invoice_date: "2026-05-09T13:00:00.000Z",
          created_at: "2026-05-09T13:00:00.000Z",
        },
      ],
      error: null,
    });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    expect(fundingProfilesInMock).toHaveBeenCalledWith("project_id", [
      "44444444-4444-4444-8444-444444444444",
    ]);
    const generatedArtifact = artifactsInsertMock.mock.calls.at(-1)?.[0];
    const sourceContext = generatedArtifact?.metadata_json?.sourceContext as Record<string, unknown>;

    expect(sourceContext.rtpFundingSnapshot).toMatchObject({
      linkedProjectCount: 1,
      trackedProjectCount: 1,
      fundedProjectCount: 1,
      committedFundingAmount: 1_000_000,
      latestSourceUpdatedAt: "2026-05-09T13:00:00.000Z",
    });
    expect(sourceContext.rtpFundingProfileScans).toEqual([
      expect.objectContaining({
        projectId: "44444444-4444-4444-8444-444444444444",
        projectName: "Nevada County Safety Action Program",
        portfolioRole: "constrained",
        latestFundingSourceUpdatedAt: "2026-05-09T13:00:00.000Z",
        scan: expect.objectContaining({
          status: "attention",
          lanes: expect.arrayContaining([
            expect.objectContaining({ id: "funding_target", status: "ready" }),
            expect.objectContaining({ id: "closeout", status: "ready" }),
            expect.objectContaining({ id: "evidence_support", status: "attention" }),
          ]),
        }),
      }),
    ]);
    expect(sourceContext.rtpFundingSourceContextReadiness).toMatchObject({
      status: "attention",
      linkedProjectScanCount: 1,
      attentionProjectScanCount: 1,
      operatorReviewCaveat: expect.stringContaining("not legal compliance automation, award prediction, or autonomous approval"),
    });
    expect(sourceContext.rtpFundingSourceContextReadiness).toMatchObject({
      label: expect.stringContaining("operator review"),
      detail: expect.stringContaining("operator review"),
    });
    expectProvenanceLanguageOnly(JSON.stringify(sourceContext.rtpFundingSourceContextReadiness));

    const htmlContent = String(generatedArtifact?.metadata_json?.htmlContent ?? "");
    expect(htmlContent).toContain("Funding source context");
    expect(htmlContent).toContain("Captured during packet generation");
    expect(htmlContent).toContain("Nevada County Safety Action Program");
    expect(htmlContent).toContain("Funding profile needs operator review");
    expect(htmlContent).toContain("Operator-review caveat");
    expect(htmlContent).toContain("not legal compliance automation, award prediction, or autonomous approval");
    expect(htmlContent).not.toMatch(/grant-award/i);
    expect(htmlContent).not.toMatch(/legal (?:sign-off|approval|determination) (?:is|was) (?:ready|complete|granted)/i);
    expect(htmlContent).not.toMatch(/autonomous (?:approval|planning|decision) (?:is|was) (?:ready|complete|granted)/i);
  });

  it("persists a compact stage-gate snapshot in artifact metadata and html", async () => {
    stageGateDecisionsLimitMock.mockResolvedValueOnce({
      data: [
        {
          id: "stage-gate-1",
          project_id: "44444444-4444-4444-8444-444444444444",
          gate_id: "G01_INITIATION_AUTHORIZATION",
          decision: "PASS",
          rationale: "Charter is approved.",
          decided_at: "2026-03-13T16:00:00.000Z",
          missing_artifacts: [],
        },
        {
          id: "stage-gate-2",
          project_id: "44444444-4444-4444-8444-444444444444",
          gate_id: "G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS",
          decision: "HOLD",
          rationale: "Civil rights plan is still missing.",
          decided_at: "2026-03-14T01:00:00.000Z",
          missing_artifacts: ["G02_E03"],
        },
      ],
      error: null,
    });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    // The snapshot is only about THIS project. Read workspace-wide, a gate that
    // passed on a neighbouring project would be frozen into this packet as a
    // pass of its own — the one falsehood a packet cannot be corrected out of
    // once it has been sent.
    expect(stageGateDecisionsSelectMock.mock.calls[0]?.[0]).toContain("project_id");
    expect(stageGateDecisionsEqMock).toHaveBeenCalledWith(
      "workspace_id",
      "33333333-3333-4333-8333-333333333333"
    );
    expect(stageGateDecisionsEqProjectMock).toHaveBeenCalledWith(
      "project_id",
      "44444444-4444-4444-8444-444444444444"
    );
    expect(artifactsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata_json: expect.objectContaining({
          sourceContext: expect.objectContaining({
            stageGateSnapshot: expect.objectContaining({
              templateId: "ca_stage_gates_v0_1",
              templateVersion: "0.1.0",
              passCount: 1,
              holdCount: 1,
              notStartedCount: 7,
              blockedGate: expect.objectContaining({
                gateId: "G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS",
                name: "Agreements, Procurement, and Civil Rights Setup",
                missingArtifacts: ["G02_E03"],
              }),
              nextGate: expect.objectContaining({
                gateId: "G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS",
              }),
              controlHealth: expect.objectContaining({
                totalOperatorControlEvidenceCount: expect.any(Number),
                gatesWithOperatorControlsCount: expect.any(Number),
              }),
            }),
          }),
          htmlContent: expect.stringContaining("Governance and stage-gate provenance"),
        }),
      })
    );

    const generatedArtifact = artifactsInsertMock.mock.calls.at(-1)?.[0];
    const generatedHtml = generatedArtifact?.metadata_json?.htmlContent;

    expect(generatedHtml).toContain("Evidence chain summary");
    expect(generatedHtml).toContain("ca_stage_gates_v0_1");
    expect(generatedHtml).toContain("1 pass");
    expect(generatedHtml).toContain("1 hold");
    expect(generatedHtml).toContain("Civil rights plan is still missing.");
    expect(generatedHtml).toContain("Missing artifacts: G02_E03.");
    expect(generatedHtml).toContain("G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS");
    expect(generatedHtml).toContain('/projects/44444444-4444-4444-8444-444444444444#project-governance');
  });

  it("names the missing migration when the decision log cannot be scoped yet, instead of a generic 500", async () => {
    // Code deploys ahead of migrations. Until 20260728000011 lands there is no
    // `project_id` to filter on, and refusing is right — a workspace-wide
    // fallback would freeze a neighbouring project's gate verdict into a packet
    // an agency sends to a funder. But the refusal has to be actionable, in the
    // shape this route already uses for a pending campaign-target schema.
    stageGateDecisionsLimitMock.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'column stage_gate_decisions.project_id does not exist',
        code: "42703",
      },
    });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.hint).toContain("20260728000011_stage_gate_decisions_project_scope");
    // And nothing was written: a packet is never produced from a gate read that
    // failed.
    expect(artifactsInsertMock).not.toHaveBeenCalled();
  });

  it("still refuses generically when the decision log fails for a reason a migration will not fix", async () => {
    // A policy or permission failure must not be reported as a pending
    // migration — that would send an operator to apply one that is already
    // applied, and the real cause would go unlooked-at.
    stageGateDecisionsLimitMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied for table stage_gate_decisions', code: "42501" },
    });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(500);
    expect(artifactsInsertMock).not.toHaveBeenCalled();
  });

  it("persists scenario-set provenance derived from linked report runs", async () => {
    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);

    expect(artifactsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata_json: expect.objectContaining({
          sourceContext: expect.objectContaining({
            scenarioSetLinkCount: 1,
            scenarioSetLinks: [
              expect.objectContaining({
                scenarioSetId: "scenario-set-1",
                scenarioSetTitle: "Downtown alternatives",
                baselineLabel: "Existing conditions",
                baselineRunTitle: "Existing conditions baseline",
                comparisonSummary: expect.objectContaining({
                  label: "Ready to compare",
                  readyAlternatives: 1,
                }),
                matchedEntries: [
                  expect.objectContaining({
                    label: "Protected bike package",
                    entryType: "alternative",
                    comparisonLabel: "Ready to compare",
                    comparisonReady: true,
                  }),
                ],
              }),
            ],
          }),
          htmlContent: expect.stringContaining("Scenario basis"),
        }),
      })
    );

    const generatedArtifact = artifactsInsertMock.mock.calls.at(-1)?.[0];
    const generatedHtml = generatedArtifact?.metadata_json?.htmlContent;

    expect(generatedHtml).toContain("Downtown alternatives");
    expect(generatedHtml).toContain("Baseline: <strong>Existing conditions</strong> • Existing conditions baseline");
    expect(generatedHtml).toContain("Protected bike package");
    expect(generatedHtml).toContain('/scenarios/scenario-set-1');
  });

  it("includes configured engagement handoff context when the section is enabled", async () => {
    sectionsOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "section-1",
          section_key: "engagement_summary",
          title: "Engagement campaign summary",
          enabled: true,
          sort_order: 0,
          config_json: {
            campaignId: "99999999-9999-4999-8999-999999999999",
            provenance: {
              origin: "engagement_campaign_handoff",
              reason:
                "Created from an engagement campaign to preserve handoff-ready public input context for project reporting.",
              capturedAt: "2026-03-14T01:45:00.000Z",
              campaign: {
                id: "99999999-9999-4999-8999-999999999999",
                projectId: "44444444-4444-4444-8444-444444444444",
                title: "Downtown listening campaign",
                summary: "Capture walking and crossing feedback.",
                status: "active",
                engagementType: "comment_collection",
                createdAt: "2026-03-01T00:00:00.000Z",
                updatedAt: "2026-03-14T01:30:00.000Z",
              },
              counts: {
                totalItems: 14,
                readyForHandoffCount: 9,
                actionableCount: 2,
                uncategorizedItems: 1,
              },
            },
          },
        },
      ],
      error: null,
    });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    expect(artifactsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata_json: expect.objectContaining({
          htmlContent: expect.stringContaining("Downtown listening campaign"),
          sourceContext: expect.objectContaining({
            reportOrigin: "engagement_campaign_handoff",
            reportReason:
              "Created from an engagement campaign to preserve handoff-ready public input context for project reporting.",
            engagementCampaignId: "99999999-9999-4999-8999-999999999999",
            engagementSnapshotCapturedAt: "2026-03-14T01:45:00.000Z",
            engagementCampaignSnapshot: expect.objectContaining({
              title: "Downtown listening campaign",
              engagementType: "comment_collection",
              updatedAt: "2026-03-14T01:30:00.000Z",
            }),
            engagementCountsSnapshot: expect.objectContaining({
              totalItems: 14,
              readyForHandoffCount: 9,
              actionableCount: 2,
              uncategorizedItems: 1,
            }),
            engagementCampaignCurrent: expect.objectContaining({
              status: "active",
              engagementType: "comment_collection",
            }),
            engagementItemCount: 1,
            engagementReadyForHandoffCount: 1,
          }),
        }),
      })
    );

    const generatedArtifact = artifactsInsertMock.mock.calls.at(-1)?.[0];
    const generatedHtml = generatedArtifact?.metadata_json?.htmlContent;

    expect(generatedHtml).toContain("Report origin: Engagement Campaign Handoff");
    expect(generatedHtml).toContain(
      "Created from an engagement campaign to preserve handoff-ready public input context for project reporting."
    );
    expect(generatedHtml).toContain("Handoff snapshot: 9 ready for handoff • 14 total items");
    expect(generatedHtml).toContain("Current live campaign counts: 1 ready for handoff • 1 total items.");
    expect(generatedHtml).toContain('/engagement/99999999-9999-4999-8999-999999999999');
    expect(generatedHtml).toContain('/engage/share-token-12345');
    expect(generatedHtml).not.toMatch(/public consensus|public approval|community endorsement/i);
    expectProvenanceLanguageOnly(generatedHtml);
  });

  it("generates a campaign-targeted packet from engagement records", async () => {
    reportMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        project_id: null,
        rtp_cycle_id: null,
        engagement_campaign_id: "99999999-9999-4999-8999-999999999999",
        title: "Downtown listening campaign Engagement Handoff Packet",
        summary: "Campaign packet summary",
        report_type: "project_status",
        status: "draft",
        created_at: "2026-03-14T00:00:00.000Z",
      },
      error: null,
    });
    sectionsOrderMock.mockResolvedValueOnce({
      data: [
        { id: "section-1", section_key: "status_snapshot", title: "Campaign snapshot", enabled: true, sort_order: 0, config_json: {} },
        { id: "section-2", section_key: "engagement_summary", title: "Engagement campaign summary", enabled: true, sort_order: 1, config_json: {} },
        { id: "section-3", section_key: "methods_assumptions", title: "Methods and provenance", enabled: true, sort_order: 2, config_json: {} },
      ],
      error: null,
    });
    reportRunsOrderMock.mockResolvedValueOnce({ data: [], error: null });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      reportId: "11111111-1111-4111-8111-111111111111",
      artifactId: "artifact-1",
      format: "html",
    });
    // No project table was ever queried: the packet is engagement-scoped.
    expect(projectMaybeSingleMock).not.toHaveBeenCalled();
    expect(artifactsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        report_id: "11111111-1111-4111-8111-111111111111",
        artifact_kind: "html",
        generated_by: "22222222-2222-4222-8222-222222222222",
        metadata_json: expect.objectContaining({
          generationMode: "campaign_html_packet",
          auditability: expect.objectContaining({ posture: "campaign_packet_v1" }),
          sourceContext: expect.objectContaining({
            engagementCampaignId: "99999999-9999-4999-8999-999999999999",
            engagementCampaignTitle: "Downtown listening campaign",
            engagementItemCount: 1,
            engagementReadyForHandoffCount: 1,
            citedModelRunCount: 0,
            citedCountyRunCount: 0,
            notApplicableSectionKeys: [],
          }),
        }),
      })
    );
    expect(reportUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "generated",
        latest_artifact_kind: "html",
      })
    );

    const generatedArtifact = artifactsInsertMock.mock.calls.at(-1)?.[0];
    const generatedHtml = String(generatedArtifact?.metadata_json?.htmlContent ?? "");
    expect(generatedHtml).toContain("Downtown listening campaign");
    expect(generatedHtml).toContain("Engagement Campaign");
    expect(generatedHtml).toContain("Auditability posture");
    expectProvenanceLanguageOnly(generatedHtml);
  });

  it("renders disclosed not-applicable blocks for project-scoped sections on a campaign packet", async () => {
    reportMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        project_id: null,
        rtp_cycle_id: null,
        engagement_campaign_id: "99999999-9999-4999-8999-999999999999",
        title: "Campaign status packet",
        summary: null,
        report_type: "project_status",
        status: "draft",
        created_at: "2026-03-14T00:00:00.000Z",
      },
      error: null,
    });
    // The generic create path seeds the standard project_status templates on
    // a campaign target; every enabled key must render, never 500.
    sectionsOrderMock.mockResolvedValueOnce({
      data: [
        { id: "section-1", section_key: "project_overview", title: "Project overview", enabled: true, sort_order: 0, config_json: {} },
        { id: "section-2", section_key: "deliverables", title: "Deliverables", enabled: true, sort_order: 1, config_json: {} },
        { id: "section-3", section_key: "risks_issues", title: "Risks and issues", enabled: true, sort_order: 2, config_json: {} },
        { id: "section-4", section_key: "activity_timeline", title: "Recent activity timeline", enabled: true, sort_order: 3, config_json: {} },
      ],
      error: null,
    });
    reportRunsOrderMock.mockResolvedValueOnce({ data: [], error: null });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    const generatedArtifact = artifactsInsertMock.mock.calls.at(-1)?.[0];
    const generatedHtml = String(generatedArtifact?.metadata_json?.htmlContent ?? "");
    // The overview renders the campaign as the packet subject, disclosed.
    expect(generatedHtml).toContain("This packet targets the engagement campaign directly; no project is attached.");
    // Project-scoped sections are disclosed gaps, not fabricated content.
    expect(generatedHtml).toContain("Not applicable to a campaign-scoped report");
    expect(generatedHtml).not.toContain("No project activity is attached yet.");
    const sourceContext = generatedArtifact?.metadata_json?.sourceContext as Record<string, unknown>;
    expect(sourceContext).toMatchObject({
      notApplicableSectionKeys: ["deliverables", "risks_issues", "activity_timeline"],
    });
  });

  it("renders cited typed runs on a campaign packet", async () => {
    reportMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        project_id: null,
        rtp_cycle_id: null,
        engagement_campaign_id: "99999999-9999-4999-8999-999999999999",
        title: "Campaign analysis packet",
        summary: null,
        report_type: "analysis_summary",
        status: "draft",
        created_at: "2026-03-14T00:00:00.000Z",
      },
      error: null,
    });
    sectionsOrderMock.mockResolvedValueOnce({
      data: [
        { id: "section-1", section_key: "run_summaries", title: "Selected run summaries", enabled: true, sort_order: 0, config_json: {} },
      ],
      error: null,
    });
    reportRunsOrderMock.mockResolvedValueOnce({
      data: [
        { id: "report-run-1", run_id: null, model_run_id: "model-run-1", county_run_id: null, sort_order: 0 },
        { id: "report-run-2", run_id: null, model_run_id: null, county_run_id: "county-run-1", sort_order: 1 },
      ],
      error: null,
    });
    modelRunsInMock.mockResolvedValueOnce({
      data: [
        {
          id: "model-run-1",
          run_title: "SR-49 fast screening",
          engine_key: "aequilibrae",
          status: "succeeded",
          result_summary_json: { overallScore: 63 },
        },
      ],
      error: null,
    });
    countyRunsInMock.mockResolvedValueOnce({
      data: [
        {
          id: "county-run-1",
          run_name: "County screening baseline",
          stage: "validated-screening",
          validation_summary_json: { passed: 3, warned: 1, failed: 0 },
        },
      ],
      error: null,
    });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    const generatedArtifact = artifactsInsertMock.mock.calls.at(-1)?.[0];
    const generatedHtml = String(generatedArtifact?.metadata_json?.htmlContent ?? "");
    expect(generatedHtml).toContain("SR-49 fast screening");
    expect(generatedHtml).toContain("Overall score 63/100");
    expect(generatedHtml).toContain("County screening baseline");
    expect(generatedHtml).toContain("3 pass");
    expectProvenanceLanguageOnly(generatedHtml);
    const sourceContext = generatedArtifact?.metadata_json?.sourceContext as Record<string, unknown>;
    expect(sourceContext).toMatchObject({
      citedModelRunCount: 1,
      citedCountyRunCount: 1,
      citedModelRuns: [
        { id: "model-run-1", runTitle: "SR-49 fast screening", engineKey: "aequilibrae", status: "succeeded" },
      ],
      citedCountyRuns: [{ id: "county-run-1", runName: "County screening baseline", stage: "validated-screening" }],
    });
  });

  it("answers 503 with the migration hint when a targetless row hides a campaign target", async () => {
    // A pre-campaign-column select can only produce this shape when the
    // campaign-target migration is pending or the schema cache is stale.
    reportMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        project_id: null,
        rtp_cycle_id: null,
        title: "Campaign status packet",
        summary: null,
        report_type: "project_status",
        status: "draft",
        created_at: "2026-03-14T00:00:00.000Z",
      },
      error: null,
    });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      hint: expect.stringContaining("20260727000008_reports_engagement_campaign_target"),
    });
    expect(artifactsInsertMock).not.toHaveBeenCalled();
  });

  it("records the project's aerial evidence packages in artifact provenance", async () => {
    aerialMissionsOrderMock.mockResolvedValue({
      data: [
        {
          id: "aerial-mission-1",
          title: "Corridor shoulder inventory",
          status: "complete",
          mission_type: "corridor_survey",
          project_id: "44444444-4444-4444-8444-444444444444",
          aoi_geojson: { type: "Polygon", coordinates: [] },
          updated_at: "2026-03-13T00:00:00.000Z",
        },
      ],
      error: null,
    });
    aerialPackagesOrderMock.mockResolvedValue({
      data: [
        {
          id: "aerial-package-1",
          mission_id: "aerial-mission-1",
          title: "Shoulder orthomosaic QA bundle",
          status: "ready",
          verification_readiness: "ready",
          notes: "Operator reviewed the imagery against the field log.",
          updated_at: "2026-03-13T01:00:00.000Z",
        },
      ],
      error: null,
    });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    const sourceContext = artifactsInsertMock.mock.calls.at(-1)?.[0]?.metadata_json
      ?.sourceContext as Record<string, unknown>;
    const aerial = parseReportAerialEvidenceSourceContext(
      sourceContext?.aerialEvidenceSourceContext
    );

    // The read side parses what the write side stored — the whole point of the
    // connector. Before it existed this was always null.
    expect(aerial).not.toBeNull();
    expect(aerial).toMatchObject({
      readiness: "ready",
      missionCount: 1,
      packageCount: 1,
      sourceContextPackageCount: 1,
      operatorAssisted: true,
      autonomousPhotogrammetryClaim: false,
      surveyGradeCertificationClaim: false,
    });
    // OpenPlan holds no imagery bytes, so the packet may not imply the cited
    // artifact is still downloadable.
    expect(aerial?.caveat).toContain("time-limited signed URLs");
    expect(aerial?.caveat).toContain("may already have expired");
    expectProvenanceLanguageOnly(`${aerial?.label} ${aerial?.detail} ${aerial?.caveat}`);
  });

  it("records an unreadable aerial source as unreadable, not as an absent one", async () => {
    aerialMissionsOrderMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "public.aerial_missions" does not exist' },
    });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    const sourceContext = artifactsInsertMock.mock.calls.at(-1)?.[0]?.metadata_json
      ?.sourceContext as Record<string, unknown>;
    const aerial = parseReportAerialEvidenceSourceContext(
      sourceContext?.aerialEvidenceSourceContext
    );

    expect(aerial).toMatchObject({
      readiness: "blocked",
      label: "Aerial evidence could not be read",
      missionCount: 0,
      packageCount: 0,
    });
    expect(aerial?.detail).toContain("aerial tables are not present");
    expect(aerial?.blockers[0]).toContain("aerial tables are not present");
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "report_aerial_source_context_unreadable",
      expect.objectContaining({ reason: expect.stringContaining("could not be read") })
    );
  });

  it("leaves aerial provenance absent when the project genuinely has no aerial work", async () => {
    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      {
        params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }),
      }
    );

    expect(response.status).toBe(200);
    const sourceContext = artifactsInsertMock.mock.calls.at(-1)?.[0]?.metadata_json
      ?.sourceContext as Record<string, unknown>;
    expect(sourceContext?.aerialEvidenceSourceContext).toBeNull();
    expect(mockAudit.warn).not.toHaveBeenCalledWith(
      "report_aerial_source_context_unreadable",
      expect.anything()
    );
  });
});
