import { buildSafetySeedPreview } from "@/lib/grants/ss4a-safety-seed";
import { SAFETY_PLAN_PERSISTENCE_VERSION, type SafetyPlanPersistence } from "@/lib/reports/safety-plan-persistence";
import { safetySeedFixture } from "./fixtures/grants/safety-seed";
import { readSafetyPlanSnapshot } from "@/lib/reports/safety-plan-snapshot";
import * as safetyPlanBuilder from "@/lib/reports/safety-action-plan";
import { PROJECT_PLACE_COLUMN_NAMES } from "@/lib/projects/project-place";
import { collectSupabaseSelectSites } from "./supabase-call-sites";
import Database from "better-sqlite3";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { buildProjectGeoPackage } from "@/lib/projects/project-geopackage";
import { loadProjectEvidenceGeneratedFiles } from "@/lib/project-evidence-bundles/generated-records";
vi.mock("server-only", () => ({}));
import { actor as jurisdictionActor, exportProject } from "./project-jurisdiction-export-fixture";
import { buildProjectJurisdictionReadinessExportPayload } from "@/lib/jurisdiction-readiness/payload";
import { readProjectJurisdiction } from "@/lib/projects/project-jurisdiction";
import { jurisdictionReadinessRegistrySha256 } from "@/lib/jurisdiction-readiness/custody";
import { assert, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { expectProvenanceLanguageOnly } from "./provenance-language-guards";
import { pagingFake } from "./helpers/paging-fake";
import { parseReportAerialEvidenceSourceContext } from "@/lib/reports/aerial-source-context";
import { createHash } from "node:crypto";
import { WORKSPACE_STORAGE_UNREADABLE_MESSAGE, workspaceStorageFullMessage } from "@/lib/workspaces/storage-quota";

// The workspace storage limit (storage-quota.ts). Room by default; a test that
// wants a full or unreadable workspace queues it.
const checkWorkspaceStorageRoomMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/workspaces/storage-quota", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspaces/storage-quota")>()),
  checkWorkspaceStorageRoom: (...args: unknown[]) =>
    checkWorkspaceStorageRoomMock(...args) ?? Promise.resolve({ status: "room", usedBytes: 0, quotaBytes: 5 * 1024 ** 3 }),
}));

const tigerRoadsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/safety/us-road-context-adapter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/safety/us-road-context-adapter")>()),
  loadUsTigerRoadContext: (...args: unknown[]) => tigerRoadsMock(...args),
}));
const safetyRoadReadMock = vi.fn();
const safetyRoadWriteMock = vi.fn();
const safetyRoadSelectMock = vi.fn((_projection: string) => ({ eq: () => ({ eq: () => ({ limit: safetyRoadReadMock }) }) }));

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const executionInsertMock = vi.fn();

const reportMaybeSingleMock = vi.fn();
// Existing scenarios share the newly selected report revision; their explicit
// report fields and all original scenario assertions remain unchanged.
const reportEqMock = vi.fn(() => ({ maybeSingle: async () => {
  const result = await reportMaybeSingleMock();
  return result?.data ? { ...result, data: { updated_at: "2026-03-14T00:00:00.000Z", ...result.data } } : result;
} }));
const reportSelectMock = vi.fn((_columns: string) => ({ eq: reportEqMock }));
const reportWritebackSingleMock = vi.fn().mockResolvedValue({ data: { updated_at: "2026-03-14T02:00:01.000Z" }, error: null });
const reportWritebackSelectMock = vi.fn(() => ({ maybeSingle: reportWritebackSingleMock }));
const reportWritebackQuery = { eq: vi.fn(), select: reportWritebackSelectMock };
const reportUpdateEqMock = reportWritebackQuery.eq.mockReturnValue(reportWritebackQuery);
const artifactWritebackSingleMock = vi.fn().mockResolvedValue({ data: { id: "artifact" }, error: null });
const artifactWritebackSelectMock = vi.fn(() => ({ maybeSingle: artifactWritebackSingleMock }));
const artifactWritebackQuery = { eq: vi.fn(), select: artifactWritebackSelectMock };
const artifactWritebackEqMock = artifactWritebackQuery.eq.mockReturnValue(artifactWritebackQuery);
const artifactWritebackUpdateMock = vi.fn(() => ({ eq: artifactWritebackEqMock }));
const reportUpdateMock = vi.fn(() => ({ eq: reportUpdateEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const workspaceMaybeSingleMock = vi.fn();
const workspaceEqMock = vi.fn(() => ({ maybeSingle: workspaceMaybeSingleMock }));
const workspaceSelectMock = vi.fn((_columns: string) => ({ eq: workspaceEqMock }));

const rtpCycleMaybeSingleMock = vi.fn();
const rtpCycleEqMock = vi.fn(() => ({ maybeSingle: rtpCycleMaybeSingleMock }));
const rtpCycleSelectMock = vi.fn(() => ({ eq: rtpCycleEqMock }));

const projectMaybeSingleMock = vi.fn();
const projectEqMock = vi.fn(() => ({ maybeSingle: projectMaybeSingleMock }));
const projectSelectMock = vi.fn((_columns: string) => ({ eq: projectEqMock }));

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

type FundingReadResult = { data: unknown[] | null; error: unknown; count?: unknown };
type FundingSelectOptions = { count?: string };

/** Return counts only when requested; retain explicit incomplete/error fixtures. */
async function countedFundingRead(read: Promise<FundingReadResult>, options?: FundingSelectOptions): Promise<FundingReadResult> {
  const result = await read;
  if (options?.count !== "exact") return { ...result, count: null };
  if ("count" in result) return result;
  return { ...result, count: !result.error && Array.isArray(result.data) ? result.data.length : null };
}

const fundingAwardsOrderMock = vi.fn();
const fundingAwardsInMock = vi.fn();
const fundingAwardsEqMock = vi.fn((..._args: unknown[]) => ({ order: fundingAwardsOrderMock }));
const fundingAwardsSelectMock = vi.fn((_columns: string, options?: FundingSelectOptions) => ({
  eq: (...args: unknown[]) => {
    const query = fundingAwardsEqMock(...args);
    return { order: (...orderArgs: unknown[]) => countedFundingRead(query.order(...orderArgs), options) };
  },
  in: (...args: unknown[]) => countedFundingRead(fundingAwardsInMock(...args), options),
}));

const fundingOpportunitiesOrderMock = vi.fn();
const fundingOpportunitiesInMock = vi.fn();
const fundingOpportunitiesEqMock = vi.fn((..._args: unknown[]) => ({ order: fundingOpportunitiesOrderMock }));
const fundingOpportunitiesSelectMock = vi.fn((_columns: string, options?: FundingSelectOptions) => ({
  eq: (...args: unknown[]) => {
    const query = fundingOpportunitiesEqMock(...args);
    return { order: (...orderArgs: unknown[]) => countedFundingRead(query.order(...orderArgs), options) };
  },
  in: (...args: unknown[]) => countedFundingRead(fundingOpportunitiesInMock(...args), options),
}));

const billingInvoicesOrderMock = vi.fn();
const billingInvoicesInMock = vi.fn();
const billingInvoicesEqMock = vi.fn((..._args: unknown[]) => ({ order: billingInvoicesOrderMock }));
const billingInvoicesSelectMock = vi.fn((_columns: string, options?: FundingSelectOptions) => ({
  eq: (...args: unknown[]) => {
    const query = billingInvoicesEqMock(...args);
    return { order: (...orderArgs: unknown[]) => countedFundingRead(query.order(...orderArgs), options) };
  },
  in: (...args: unknown[]) => countedFundingRead(billingInvoicesInMock(...args), options),
}));

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
const modelRunMaybeSingleMock = vi.fn();
const modelRunsEqMock = vi.fn((..._args: [string, unknown]) => ({
  eq: modelRunsEqMock,
  in: modelRunsInMock,
  maybeSingle: modelRunMaybeSingleMock,
}));
const modelRunsSelectMock = vi.fn((columns: string) =>
  columns === "id, status, workspace_id, project_id, model_id"
    ? { eq: modelRunsEqMock }
    : { eq: modelRunsEqMock, in: modelRunsInMock }
);
const agreementArtifactsLimitMock = vi.fn();
const agreementArtifactsOrderMock = vi.fn(() => ({ limit: agreementArtifactsLimitMock }));
const agreementArtifactsEqMock = vi.fn(() => ({ eq: agreementArtifactsEqMock, order: agreementArtifactsOrderMock }));
const agreementArtifactsInMock = vi.fn();
const agreementArtifactsSelectMock = vi.fn(() => ({ eq: agreementArtifactsEqMock, in: agreementArtifactsInMock }));

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

const modelingAssessmentOrderMock = vi.fn();
const modelingAssessmentInMock = vi.fn(() => ({ order: modelingAssessmentOrderMock }));
const modelingAssessmentSelectMock = vi.fn(() => ({ in: modelingAssessmentInMock }));
const modelingDiagnosisOrderMock = vi.fn();
const modelingDiagnosisInMock = vi.fn(() => ({ order: modelingDiagnosisOrderMock }));
const modelingDiagnosisSelectMock = vi.fn(() => ({ in: modelingDiagnosisInMock }));
const comparableCustodyOrderMock = vi.fn();
const comparableCustodyInMock = vi.fn(() => ({ order: comparableCustodyOrderMock }));
const comparableCustodySelectMock = vi.fn(() => ({ in: comparableCustodyInMock }));
const structuralDemandCustodyOrderMock = vi.fn();
const structuralDemandCustodyInMock = vi.fn(() => ({ order: structuralDemandCustodyOrderMock }));
const structuralDemandCustodySelectMock = vi.fn(() => ({ in: structuralDemandCustodyInMock }));
const distributedWorkLoadingCustodyOrderMock = vi.fn();
const distributedWorkLoadingCustodyInMock = vi.fn(() => ({ order: distributedWorkLoadingCustodyOrderMock }));
const distributedWorkLoadingCustodySelectMock = vi.fn(() => ({ in: distributedWorkLoadingCustodyInMock }));

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
    // Two reads take this chain: the packet's campaign list awaits it, and the
    // comment-response record pages it. Each read draws one answer from
    // `rtpEngagementCampaignsOrderMock`, held to the server's 1,000-row cap.
    return pagingFake(() => rtpEngagementCampaignsOrderMock(), { serverCap: 1000 }).chain;
  }

  return { eq: engagementCampaignEqIdMock };
});
const engagementCampaignSelectMock = vi.fn(() => ({ eq: engagementCampaignEqWorkspaceMock }));

const engagementCategoriesOrderCreatedMock = vi.fn();
const engagementCategoriesOrderSortMock = vi.fn(() => ({ order: engagementCategoriesOrderCreatedMock }));
const engagementCategoriesEqCampaignMock = vi.fn(() => ({ order: engagementCategoriesOrderSortMock }));
const engagementCategoriesSelectMock = vi.fn(() => ({ eq: engagementCategoriesEqCampaignMock }));

// The fixture behind the campaign's comment read. The read pages, so the chain
// is a paging fake holding the server's 1,000-row cap: a read that stops after
// one request sees at most 1,000 comments, as it would against PostgREST.
const engagementItemsOrderMock = vi.fn();
const engagementItemsPaging = pagingFake(() => engagementItemsOrderMock(), { serverCap: 1000 });
const engagementItemsChainOrderMock = vi.fn(() => engagementItemsPaging.chain);
const engagementItemsRangeMock = vi.fn(engagementItemsPaging.range);
engagementItemsPaging.chain.order = engagementItemsChainOrderMock;
engagementItemsPaging.chain.range = engagementItemsRangeMock;
const engagementItemsEqCampaignMock = vi.fn(() => engagementItemsPaging.chain);
// The RTP packet reads the cycle's items across every linked campaign at once,
// so this table answers `.in` as well as `.eq`. That read pages, so `.in`
// returns a paging fake over what `engagementItemsInMock` answers for the
// latest `.in` arguments, holding the server's 1,000-row cap. The order and
// range mocks record what the read asked for, so a test can see it paged.
const engagementItemsInMock = vi.fn();
let engagementItemsInArgs: unknown[] = [];
const engagementItemsInPaging = pagingFake(() => engagementItemsInMock(...engagementItemsInArgs), { serverCap: 1000 });
const engagementItemsInOrderMock = vi.fn((_column: string, _options?: { ascending?: boolean }) => engagementItemsInPaging.chain);
const engagementItemsInRangeMock = vi.fn(engagementItemsInPaging.range);
engagementItemsInPaging.chain.order = engagementItemsInOrderMock;
engagementItemsInPaging.chain.range = engagementItemsInRangeMock;
const engagementItemsInPagedMock = vi.fn((column: string, values: string[]) => {
  engagementItemsInArgs = [column, values];
  return engagementItemsInPaging.chain;
});
const engagementItemsSelectMock = vi.fn(() => ({
  eq: engagementItemsEqCampaignMock,
  in: engagementItemsInPagedMock,
}));

/**
 * ADDED BECAUSE IT WAS MISSING, and its absence was invisible. The route reads
 * `document_narrative_drafts` through `safeOptionalQuery`, whose classifier used
 * to treat this harness's own `Unexpected table: …` throw as a benign absence.
 * So every test in this file exercised the accepted-narrative path as "no
 * accepted narratives" while believing it had exercised the feature — a harness
 * that cannot fail a named read cannot prove anything about the failure path.
 * The classifier no longer launders that phrasing, so the table has to answer
 * here.
 */
const narrativeDraftsOrderMock = vi.fn();
const narrativeDraftsEqStatusMock = vi.fn(() => ({ order: narrativeDraftsOrderMock }));
const narrativeDraftsEqTargetIdMock = vi.fn(() => ({ eq: narrativeDraftsEqStatusMock }));
const narrativeDraftsEqTargetKindMock = vi.fn(() => ({ eq: narrativeDraftsEqTargetIdMock }));
const narrativeDraftsSelectMock = vi.fn(() => ({ eq: narrativeDraftsEqTargetKindMock }));

const safetyIngestOrderMock = vi.fn();
const safetyIngestEqProjectMock = vi.fn(() => ({
  order: safetyIngestOrderMock,
  in: vi.fn(() => ({ order: safetyIngestOrderMock })),
}));
const safetyIngestEqWorkspaceMock = vi.fn(() => ({ eq: safetyIngestEqProjectMock }));
const safetyIngestSelectMock = vi.fn(() => ({ eq: safetyIngestEqWorkspaceMock }));
const rpcMock = vi.fn();

const artifactsSingleMock = vi.fn();
const artifactsInsertSelectMock = vi.fn(() => ({ single: artifactsSingleMock }));
type ArtifactInsertPayload = {
  metadata_json?: { htmlContent?: string } & Record<string, unknown>;
} & Record<string, unknown>;
const artifactsInsertMock = vi.fn((_payload: ArtifactInsertPayload) => ({ select: artifactsInsertSelectMock }));

// The signed-in member's own Storage client. Migration 20261017000013 removed
// member INSERT on report-artifacts, so by default it refuses the way row
// level security does; the route must never write through it.
const memberStorageUploadMock = vi.fn();
const memberStorageFromMock = vi.fn(() => ({ upload: memberStorageUploadMock }));
const aerialCustodyMaybeSingleMock = vi.fn();
const aerialCustodyEqMock = vi.fn(() => ({ eq: aerialCustodyEqMock, maybeSingle: aerialCustodyMaybeSingleMock }));
const aerialCustodySelectMock = vi.fn(() => ({ eq: aerialCustodyEqMock }));
const serviceStorageDownloadMock = vi.fn();
const serviceStorageUploadMock = vi.fn();
const serviceStorageRemoveMock = vi.fn();
const serviceStorageFromMock = vi.fn((bucket: string) => bucket === "aerial-artifacts"
  ? { download: serviceStorageDownloadMock, upload: serviceStorageUploadMock }
  : { download: serviceStorageDownloadMock, upload: serviceStorageUploadMock, remove: serviceStorageRemoveMock });
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

  if (table === "aerial_artifact_custody") {
    return { select: aerialCustodySelectMock };
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

  if (table === "model_run_artifacts") {
    return { select: agreementArtifactsSelectMock };
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

  if (table === "modeling_validation_assessments") {
    return { select: modelingAssessmentSelectMock };
  }

  if (table === "modeling_validation_structural_diagnoses") {
    return { select: modelingDiagnosisSelectMock };
  }

  if (table === "modeling_validation_instrument_v2_custody") {
    return { select: comparableCustodySelectMock };
  }

  if (table === "modeling_structural_demand_diagnosis_custody") {
    return { select: structuralDemandCustodySelectMock };
  }

  if (table === "modeling_distributed_work_loading_custody") {
    return { select: distributedWorkLoadingCustodySelectMock };
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

  if (table === "document_narrative_drafts") {
    return {
      select: narrativeDraftsSelectMock,
    };
  }

  if (table === "safety_road_context_features") return { select: safetyRoadSelectMock };

  if (table === "safety_crash_ingests") {
    return { select: safetyIngestSelectMock };
  }

  if (table === "report_artifacts") {
    return {
      insert: artifactsInsertMock,
      update: artifactWritebackUpdateMock,
      select: agreementArtifactsSelectMock,
    };
  }

  if (table === "assistant_action_executions") {
    return {
      insert: executionInsertMock,
    };
  }

  // The RTP financial element and the comment-response record. Both travel with
  // the exported packet now, so the generate route reads them. A generic
  // chainable is used rather than a hand-shaped mock because these loaders
  // chain `.eq().order().order()` and `.in().order().order()`, and a mock that
  // matches one arity today breaks the moment a loader adds an order.
  if (
    table === "rtp_horizon_bands" ||
    table === "rtp_financial_assumptions" ||
    table === "rtp_performance_measures" ||
    table === "engagement_closeloop_entries" ||
    // Where each figure in the packet came from. The export body cites the
    // document and page of anything transcribed out of a plan document
    // (Q2, 2026-08-11), so the generate route reads the staging tables too.
    // Empty is the truthful answer for this fixture: nothing here was
    // transcribed, and the packet therefore prints no citations.
    table === "rtp_extraction_candidates" ||
    table === "rtp_extraction_runs"
  ) {
    const empty: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "order", "limit", "not", "is"]) {
      empty[method] = () => empty;
    }
    empty.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
    // The comment-response record pages its responses; an empty table ends on the first page.
    empty.range = async () => ({ data: [], error: null });
    return empty;
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

const LINKED_COUNTY_RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/**
 * Point a report at the county run whose modeling evidence it reports on.
 *
 * WHY EVERY MODELING-EVIDENCE TEST BELOW NOW DOES THIS. There used to be a
 * fallback: a report that named no run got the workspace's five most recently
 * updated `county_runs`, and those rows were printed as the document's own
 * "Assignment modeling claim posture". Nothing in the schema links a
 * `county_run` to a report, a project or an RTP cycle, so they were selected by
 * RECENCY — a packet for one geography could cite model runs for another, with
 * no sentence saying they were unrelated. The fallback is deleted; a document
 * that names no run states the absence instead. So a test that wants evidence
 * must NAME the run, which is also the only way the product produces it.
 */
/**
 * Queue the loader's rules-v4 basis read for a county run that recorded a
 * confirmed pass. Without it the stored screening tier is lowered to
 * prototype-only (KI-2026-10-12-001); call it after the route's own
 * county run read is queued.
 */
function countyRunBasisConfirmsPass() {
  countyRunsMaybeSingleMock.mockResolvedValueOnce({
    data: { basis_rules_version: 4, basis_outcome: "pass", basis_evidence_write: "recorded", basis_reasons: [] },
    error: null,
  });
}

function reportNamesCountyRun(overrides: Record<string, unknown> = {}) {
  reportMaybeSingleMock.mockResolvedValueOnce({
    data: {
      id: "11111111-1111-4111-8111-111111111111",
      workspace_id: "33333333-3333-4333-8333-333333333333",
      project_id: "44444444-4444-4444-8444-444444444444",
      rtp_cycle_id: null,
      modeling_county_run_id: LINKED_COUNTY_RUN_ID,
      title: "Project Status Packet",
      summary: "Packet summary",
      report_type: "project_status",
      status: "draft",
      created_at: "2026-03-14T00:00:00.000Z",
      generated_at: null,
      metadata_json: {},
      ...overrides,
    },
    error: null,
  });
}

describe("POST /api/reports/[reportId]/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    safetyRoadReadMock.mockReset().mockResolvedValue({ data: [], error: null });
    safetyRoadWriteMock.mockReset().mockResolvedValue({ error: null });
    tigerRoadsMock.mockReset().mockResolvedValue({ roads: [], coverageLimit: "No source road fixture", sourceVintage: null });
    engagementItemsPaging.reset();
    executionInsertMock.mockReset().mockResolvedValue({ error: null });

    modelingDiagnosisOrderMock.mockResolvedValue({ data: [], error: null });
    comparableCustodyOrderMock.mockResolvedValue({ data: [], error: null });
    structuralDemandCustodyOrderMock.mockResolvedValue({ data: [], error: null });
    distributedWorkLoadingCustodyOrderMock.mockResolvedValue({ data: [], error: null });
    agreementArtifactsInMock.mockResolvedValue({ data: [], error: null });

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
        // Bound EXPLICITLY to the CA template, with CA geography: the frozen
        // gate snapshot below must be built on THIS binding, never on the
        // registry's interim default — the snapshot assertions pin CA's
        // template id and gate names to prove it.
        stage_gate_template_id: "ca_stage_gates_v0_1",
        home_geography_source: "tigerweb",
        home_country_code: "US",
        home_subdivision_code: "CA",
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
        jurisdiction_context: null,
        place_label: "Nevada County, California",
        place_country_code: "US",
        place_subdivision_code: "CA",
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
    modelRunMaybeSingleMock.mockResolvedValue({
      data: {
        id: "88888888-8888-4888-8888-888888888888",
        status: "succeeded",
        workspace_id: "workspace-1",
        project_id: "project-1",
        model_id: "model-1",
      },
      error: null,
    });
    agreementArtifactsLimitMock.mockResolvedValue({ data: [], error: null });
    modelingClaimMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    modelingClaimInMock.mockResolvedValue({ data: [], error: null });
    modelingAssessmentOrderMock.mockResolvedValue({ data: [], error: null });
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
    narrativeDraftsOrderMock.mockResolvedValue({ data: [], error: null });
    safetyIngestOrderMock.mockResolvedValue({ data: [], error: null });
    rpcMock.mockResolvedValue({ data: [], error: null });

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

    engagementItemsInMock.mockResolvedValue({ data: [], error: null });
    engagementItemsInPaging.reset();

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

    memberStorageUploadMock.mockResolvedValue({ error: { message: "new row violates row-level security policy" } });
    checkWorkspaceStorageRoomMock.mockReset();
    serviceStorageUploadMock.mockResolvedValue({ error: null });
    serviceStorageRemoveMock.mockReset().mockResolvedValue({ error: null });
    renderReportPdfMock.mockResolvedValue({
      bytes: new Uint8Array([37, 80, 68, 70]),
      engine: "chrome",
      pageCount: null,
      disclosure: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
      rpc: rpcMock,
      storage: { from: memberStorageFromMock },
    });
    createServiceRoleClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "report_artifacts") return { insert: artifactsInsertMock };
        if (table === "safety_road_context_features") return { upsert: safetyRoadWriteMock };
        if (table === "assistant_action_executions") {
          return {
            insert: executionInsertMock,
          };
        }
        throw new Error(`Unexpected service table: ${table}`);
      }),
      storage: { from: serviceStorageFromMock },
    });
  });

  it("reads the report revision and joins completed writeback to the generated artifact", async () => {
    const response = await postGenerate(new NextRequest("http://localhost/api/reports/1/generate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: "html" }),
    }), { params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }) });
    expect(response.status).toBe(200);
    expect(reportSelectMock.mock.calls[0][0].split(", ")).toContain("updated_at");
    expect(reportUpdateEqMock).toHaveBeenCalledWith("updated_at", "2026-03-14T00:00:00.000Z");
    expect(reportWritebackSelectMock).toHaveBeenCalledWith("updated_at");
    expect(artifactWritebackEqMock.mock.calls).toEqual([["id", "artifact-1"], ["report_id", "11111111-1111-4111-8111-111111111111"]]);
    expect(artifactWritebackUpdateMock).toHaveBeenCalledWith({ metadata_json: expect.objectContaining({
      generationWriteback: { schema: "openplan.report-generation-writeback.v1", reportUpdatedAt: "2026-03-14T02:00:01.000Z" },
    }) });
    expect(artifactsInsertMock.mock.calls[0][0].metadata_json?.generationWriteback).toBeNull();
  });

  for (const target of ["project", "rtp", "campaign"] as const) {
    function selectTarget() {
      reportNamesCountyRun({
        project_id: target === "project" ? "44444444-4444-4444-8444-444444444444" : null,
        rtp_cycle_id: target === "rtp" ? "77777777-7777-4777-8777-777777777777" : null,
        engagement_campaign_id: target === "campaign" ? "99999999-9999-4999-8999-999999999999" : null,
        modeling_county_run_id: null,
      });
    }
    it(`rejects invalid optional ${target} generation approval before any artifact write`, async () => {
      selectTarget();
      const response = await postGenerate(new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST", headers: {
          "content-type": "application/json",
          "x-openplan-assistant-execution-source": "planner_agent_quick_link",
          "x-openplan-assistant-approval-id": "approval-1",
          "x-openplan-assistant-input-hash": "changed",
        }, body: JSON.stringify({ format: "html" }),
      }), { params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }) });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: "Planner Agent approval hash mismatch." });
      expect(serviceStorageUploadMock).not.toHaveBeenCalled();
      expect(artifactsInsertMock).not.toHaveBeenCalled();
      expect(reportUpdateMock).not.toHaveBeenCalled();
      expect(executionInsertMock).not.toHaveBeenCalled();
    });

    it(`retains a generated ${target} artifact when its audit transport throws`, async () => {
      selectTarget();
      executionInsertMock.mockRejectedValueOnce(new Error("audit transport unavailable"));
      const response = await postGenerate(new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: "html" }),
      }), { params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }) });
      expect(response.status).toBe(200);
      expect(artifactsInsertMock).toHaveBeenCalledOnce();
      expect(executionInsertMock).toHaveBeenCalledOnce();
      expect(mockAudit.warn).toHaveBeenCalledWith("assistant_action_execution_audit_failed", expect.objectContaining({ message: "audit transport unavailable" }));
    });
  }

  it("freezes the planner-selected held orthophoto into packet metadata and rendered HTML", async () => {
    const previewBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
    const previewHash = createHash("sha256").update(previewBytes).digest("hex");
    reportMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        project_id: "44444444-4444-4444-8444-444444444444",
        rtp_cycle_id: null,
        modeling_county_run_id: null,
        title: "Project Status Packet",
        summary: "Packet summary",
        report_type: "project_status",
        status: "draft",
        created_at: "2026-03-14T00:00:00.000Z",
        generated_at: null,
        metadata_json: { aerialOrthoSelections: [{ custodyId: "55555555-5555-4555-8555-555555555555" }] },
      },
      error: null,
    });
    aerialCustodyMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "55555555-5555-4555-8555-555555555555",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        mission_id: "66666666-6666-4666-8666-666666666666",
        kind: "ortho_preview",
        state: "held",
        storage_bucket: "aerial-artifacts",
        storage_path: "33333333-3333-4333-8333-333333333333/66666666-6666-4666-8666-666666666666/job/ortho-preview.png",
        byte_size: previewBytes.byteLength,
        checksum_sha256: previewHash,
        content_type: "image/png",
        held_at: "2026-08-21T17:00:00.000Z",
        bounds_west: -121.2,
        bounds_south: 39.1,
        bounds_east: -121.1,
        bounds_north: 39.2,
        crs: "EPSG:32610",
        pixel_size_m: 0.08,
        aerial_missions: {
          id: "66666666-6666-4666-8666-666666666666",
          workspace_id: "33333333-3333-4333-8333-333333333333",
          project_id: "44444444-4444-4444-8444-444444444444",
          title: "River crossing flight",
          collected_at: "2026-08-20T17:00:00.000Z",
          projects: { name: "Project" },
        },
      },
      error: null,
    });
    serviceStorageDownloadMock.mockResolvedValueOnce({ data: new Blob([previewBytes]), error: null });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      { params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }) },
    );
    expect(response.status).toBe(200);
    const inserted = artifactsInsertMock.mock.calls.at(-1)?.[0];
    expect(inserted?.metadata_json?.aerialOrthoSnapshotsV1).toEqual([
      expect.objectContaining({
        custodyId: "55555555-5555-4555-8555-555555555555",
        sourceChecksumSha256: previewHash,
        frozenChecksumSha256: previewHash,
        pixelSizeM: 0.08,
      }),
    ]);
    expect(String(inserted?.metadata_json?.htmlContent)).toContain("River crossing flight");
    expect(String(inserted?.metadata_json?.htmlContent)).toContain("not survey-grade");
    expect(String(inserted?.metadata_json?.htmlContent)).not.toContain("data:image/png;base64");
    expect(serviceStorageUploadMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/aerial\/55555555-5555-4555-8555-555555555555\.png$/),
      previewBytes,
      { contentType: "image/png", upsert: false },
    );
    const htmlUpload = serviceStorageUploadMock.mock.calls.find((call) => String(call[0]).endsWith(".html"));
    expect(String(htmlUpload?.[1])).toContain("data:image/png;base64");
    // The frozen preview is checked as "already at the limit?" before it is
    // copied, then the packet is checked with its own byte count.
    expect(checkWorkspaceStorageRoomMock.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      ["33333333-3333-4333-8333-333333333333", 0],
      ["33333333-3333-4333-8333-333333333333", (htmlUpload?.[1] as Buffer).byteLength],
    ]);
    expect(memberStorageUploadMock).not.toHaveBeenCalled();
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
    expect(serviceStorageFromMock).toHaveBeenCalledWith("report-artifacts");
    expect(serviceStorageUploadMock).toHaveBeenCalledTimes(1);
    const uploadArgs = serviceStorageUploadMock.mock.calls[0];
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
    expect(serviceStorageUploadMock).toHaveBeenCalled();
    expect(artifactsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata_json: expect.objectContaining({ pdfEngine: "builtin" }),
      })
    );
  });

  it("freezes the exact typed Safety builder result and composes generation's own revisions into seed preview", async () => {
    const fixture = safetySeedFixture();
    const projectId = "44444444-4444-4444-8444-444444444444";
    const reportId = "11111111-1111-4111-8111-111111111111";
    const workspaceId = "33333333-3333-4333-8333-333333333333";
    const report = { id: reportId, workspace_id: workspaceId, project_id: projectId,
      rtp_cycle_id: null, modeling_county_run_id: null, title: "Safety packet", summary: null,
      report_type: "project_status", status: "draft", created_at: "2026-03-14T00:00:00.000Z", generated_at: null,
      metadata_json: fixture.report.metadata_json };
    reportMaybeSingleMock.mockResolvedValueOnce({ data: report, error: null });
    const acquisition = { ...fixture.acquisition, project_id: projectId };
    safetyIngestOrderMock.mockResolvedValueOnce({ data: [acquisition], error: null });
    const effects: string[] = [];
    const persisted: Array<{ artifact: { id: string; report_id: string; generated_at: string; metadata_json: Record<string, unknown> }; reportUpdatedAt: string; projectUpdatedAt: string; persistence: SafetyPlanPersistence }> = [];
    const service = createServiceRoleClientMock.getMockImplementation()!();
    const persistenceRpc = vi.fn(async (_name: string, args: { p_actor: string; p_artifact: { id: string; report_id: string; generated_at: string; metadata_json: Record<string, unknown> }; p_report_update: Record<string, unknown> }) => {
      const snapshot = readSafetyPlanSnapshot(args.p_artifact.metadata_json.safetyPlanSnapshotV1)!;
      // Model the inherited AFTER ROW effects. Native trigger execution remains unproved.
      effects.push("artifact insert: P1", "report writeback: P2", "artifact receipt: P3");
      const projectUpdatedAt = "2026-10-18T12:00:03.000003+00:00";
      const reportUpdatedAt = "2026-10-18T12:00:02.000002+00:00";
      const persistence: SafetyPlanPersistence = { artifact_id: snapshot.artifactId, report_id: reportId, project_id: projectId, workspace_id: workspaceId,
        schema_version: SAFETY_PLAN_PERSISTENCE_VERSION, snapshot_hash: snapshot.hash,
        source_project_updated_at: snapshot.projectUpdatedAt, persisted_project_updated_at: projectUpdatedAt,
        source_report_updated_at: snapshot.reportUpdatedAt, report_updated_at: reportUpdatedAt };
      // PostgREST persists JSON bytes, not JavaScript-only undefined properties.
      const wireArtifact = JSON.parse(JSON.stringify(args.p_artifact)) as typeof args.p_artifact;
      persisted.push({ artifact: { ...wireArtifact, metadata_json: { ...wireArtifact.metadata_json,
        generationWriteback: { schema: "openplan.report-generation-writeback.v1", reportUpdatedAt } } }, reportUpdatedAt, projectUpdatedAt, persistence });
      return { data: persistence, error: null };
    });
    createServiceRoleClientMock.mockReturnValue({ ...service, rpc: persistenceRpc });
    const builder = vi.spyOn(safetyPlanBuilder, "buildSafetyActionPlanSection");
    try {
      const response = await postGenerate(new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: "html" }),
      }), { params: Promise.resolve({ reportId }) });
      expect(response.status).toBe(200);
      expect(persistenceRpc).toHaveBeenCalledWith("persist_safety_plan_generation", expect.objectContaining({ p_actor: "22222222-2222-4222-8222-222222222222" }));
      const result = persisted.at(-1)!;
      const snapshot = readSafetyPlanSnapshot(result.artifact.metadata_json.safetyPlanSnapshotV1)!;
      expect(snapshot).not.toBeNull(); expect(snapshot.draft).toEqual(builder.mock.results.at(-1)!.value);
      expect(snapshot.selection).toEqual(fixture.report.metadata_json.safetyActionPlan);
      expect(effects).toEqual(["artifact insert: P1", "report writeback: P2", "artifact receipt: P3"]);
      const rows = { ...fixture, opportunity: { ...fixture.opportunity, project_id: projectId, workspace_id: workspaceId },
        project: { ...fixture.project, id: projectId, workspace_id: workspaceId, updated_at: result.projectUpdatedAt },
        report: { ...fixture.report, id: reportId, project_id: projectId, workspace_id: workspaceId, updated_at: result.reportUpdatedAt },
        artifact: result.artifact, acquisition, persistence: result.persistence,
        sections: fixture.sections.map((section) => ({ ...section, workspace_id: workspaceId })) };
      expect(buildSafetySeedPreview(rows).sections).toHaveLength(6);
      rows.project.updated_at = "2026-10-18T12:00:03.000004+00:00";
      rows.project.name = "Genuine later source edit";
      expect(() => buildSafetySeedPreview(rows)).toThrow(/custody.*stale/);
      expect(artifactsInsertMock).not.toHaveBeenCalled(); expect(artifactWritebackUpdateMock).not.toHaveBeenCalled();
      expect(safetyIngestSelectMock).toHaveBeenCalledWith(expect.stringContaining("published_through_provenance"));
    } finally { builder.mockRestore(); }
  });

  it.each([
    ["html", "40001", 409, true, "ok"], ["pdf", "40001", 409, true, "ok"],
    ["html", "42501", 500, true, "ok"], ["html", "23514", 500, true, "ok"],
    ["html", "08006", 500, false, "ok"], ["html", "invalid-receipt", 500, false, "ok"],
    ["html", "40001", 409, true, "error"], ["html", "40001", 409, true, "throw"],
  ] as const)("handles uploaded Safety %s after %s refusal and cleanup %s/%s/%s", async (format, code, status, remove, cleanup) => {
    const fixture = safetySeedFixture();
    const projectId = "44444444-4444-4444-8444-444444444444";
    const reportId = "11111111-1111-4111-8111-111111111111";
    const workspaceId = "33333333-3333-4333-8333-333333333333";
    reportMaybeSingleMock.mockResolvedValueOnce({ data: { id: reportId, workspace_id: workspaceId, project_id: projectId,
      rtp_cycle_id: null, modeling_county_run_id: null, title: "Safety packet", summary: null,
      report_type: "project_status", status: "draft", created_at: "2026-03-14T00:00:00.000Z", generated_at: null,
      metadata_json: fixture.report.metadata_json }, error: null });
    safetyIngestOrderMock.mockResolvedValueOnce({ data: [{ ...fixture.acquisition, project_id: projectId }], error: null });
    const service = createServiceRoleClientMock.getMockImplementation()!();
    const persistenceRpc = vi.fn().mockResolvedValue({ data: null, error: code === "invalid-receipt" ? null : { code, message: "Safety persistence refused" } });
    createServiceRoleClientMock.mockReturnValue({ ...service, rpc: persistenceRpc });
    if (cleanup === "error") serviceStorageRemoveMock.mockResolvedValueOnce({ error: { message: "Storage unavailable" } });
    if (cleanup === "throw") serviceStorageRemoveMock.mockRejectedValueOnce(new Error("Storage response lost"));
    const response = await postGenerate(new NextRequest("http://localhost/api/reports/1/generate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format }),
    }), { params: Promise.resolve({ reportId }) });
    expect(response.status).toBe(status);
    expect(persistenceRpc).toHaveBeenCalledTimes(1);
    expect(serviceStorageUploadMock).toHaveBeenCalledTimes(1);
    if (remove) expect(serviceStorageRemoveMock).toHaveBeenCalledWith([serviceStorageUploadMock.mock.calls[0][0]]);
    else expect(serviceStorageRemoveMock).not.toHaveBeenCalled();
    expect(artifactsInsertMock).not.toHaveBeenCalled();
    expect((await response.json()).cleanupPending).toBe(cleanup === "ok" ? undefined : true);
  });

  it("prints a safety action plan saved against another acquisition as a stale notice, and no plan section without one", async () => {
    const report = {
      id: "11111111-1111-4111-8111-111111111111",
      workspace_id: "33333333-3333-4333-8333-333333333333",
      project_id: "44444444-4444-4444-8444-444444444444",
      rtp_cycle_id: null,
      modeling_county_run_id: null,
      title: "Project Status Packet",
      summary: "Packet summary",
      report_type: "project_status",
      status: "draft",
      created_at: "2026-03-14T00:00:00.000Z",
      generated_at: null,
    };
    const generate = () => postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      { params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }) },
    );

    reportMaybeSingleMock.mockResolvedValueOnce({
      data: {
        ...report,
        metadata_json: {
          safetyActionPlan: {
            ingestId: "99999999-9999-4999-8999-999999999999",
            attachments: [{ segmentId: "road:0000abcd:0", segmentLabel: "Main Street", countermeasureIds: ["lighting"] }],
          },
        },
      },
      error: null,
    });
    expect((await generate()).status).toBe(200);
    const stale = String(artifactsInsertMock.mock.calls.at(-1)?.[0]?.metadata_json?.htmlContent);
    expect(stale).toContain('<section id="safety_action_plan">');
    expect(stale).toContain("used a different crash acquisition");
    expect(stale).not.toContain("Main Street");

    reportMaybeSingleMock.mockResolvedValueOnce({ data: { ...report, metadata_json: {} }, error: null });
    expect((await generate()).status).toBe(200);
    const none = String(artifactsInsertMock.mock.calls.at(-1)?.[0]?.metadata_json?.htmlContent);
    expect(none).not.toContain('id="safety_action_plan"');
  });

  it("returns 500 when PDF storage upload fails", async () => {
    serviceStorageUploadMock.mockResolvedValueOnce({ error: { message: "bucket unavailable" } });

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

  describe("the workspace storage limit", () => {
    const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
    const QUOTA = 5 * 1024 ** 3;

    function generate(format: "pdf" | "html") {
      return postGenerate(
        new NextRequest("http://localhost/api/reports/1/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ format }),
        }),
        { params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }) }
      );
    }

    function serviceClient() {
      return createServiceRoleClientMock.mock.results[0]?.value;
    }

    for (const format of ["pdf", "html"] as const) {
      it(`stores a ${format} packet with the service role after checking the limit with its byte count`, async () => {
        const response = await generate(format);

        expect(response.status).toBe(200);
        expect(serviceStorageUploadMock).toHaveBeenCalledTimes(1);
        const [path, bytes] = serviceStorageUploadMock.mock.calls[0];
        expect(String(path).startsWith(`${WORKSPACE_ID}/11111111-1111-4111-8111-111111111111/`)).toBe(true);
        expect(String(path).endsWith(`.${format}`)).toBe(true);
        expect(serviceStorageFromMock).toHaveBeenCalledWith("report-artifacts");
        expect(checkWorkspaceStorageRoomMock).toHaveBeenCalledTimes(1);
        expect(checkWorkspaceStorageRoomMock).toHaveBeenCalledWith(serviceClient(), WORKSPACE_ID, (bytes as Buffer).byteLength);
        expect((bytes as Buffer).byteLength).toBeGreaterThan(0);
        expect(memberStorageFromMock).not.toHaveBeenCalled();
        expect(memberStorageUploadMock).not.toHaveBeenCalled();
      });

      it(`refuses a ${format} packet that would pass the limit, naming the limit and current use, and stores nothing`, async () => {
        const usedBytes = QUOTA - 2;
        checkWorkspaceStorageRoomMock.mockResolvedValueOnce({
          status: "full",
          usedBytes,
          quotaBytes: QUOTA,
          message: workspaceStorageFullMessage(usedBytes, QUOTA, 100),
        });

        const response = await generate(format);

        expect(response.status).toBe(413);
        const body = await response.json();
        expect(body).toEqual({ error: workspaceStorageFullMessage(usedBytes, QUOTA, 100), usedBytes, quotaBytes: QUOTA });
        expect(body.error).toContain("5 GiB storage limit (5 GiB used)");
        expect(serviceStorageUploadMock).not.toHaveBeenCalled();
        expect(memberStorageUploadMock).not.toHaveBeenCalled();
        expect(artifactsInsertMock).not.toHaveBeenCalled();
        expect(reportUpdateMock).not.toHaveBeenCalled();
        expect(mockAudit.warn).toHaveBeenCalledWith(
          "report_artifact_storage_refused",
          expect.objectContaining({ workspaceId: WORKSPACE_ID, status: "full", usedBytes, quotaBytes: QUOTA })
        );
      });

      it(`refuses a ${format} packet when storage use cannot be read`, async () => {
        checkWorkspaceStorageRoomMock.mockResolvedValueOnce({
          status: "unreadable",
          message: WORKSPACE_STORAGE_UNREADABLE_MESSAGE,
          detail: "permission denied for function workspace_storage_bytes",
        });

        const response = await generate(format);

        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: WORKSPACE_STORAGE_UNREADABLE_MESSAGE });
        expect(serviceStorageUploadMock).not.toHaveBeenCalled();
        expect(artifactsInsertMock).not.toHaveBeenCalled();
      });
    }

    for (const target of ["rtp", "campaign"] as const) {
      function selectTarget() {
        reportNamesCountyRun({
          project_id: null,
          rtp_cycle_id: target === "rtp" ? "77777777-7777-4777-8777-777777777777" : null,
          engagement_campaign_id: target === "campaign" ? "99999999-9999-4999-8999-999999999999" : null,
          modeling_county_run_id: null,
        });
      }

      it(`stores a ${target} pdf packet with the service role after checking the limit`, async () => {
        selectTarget();
        const response = await generate("pdf");

        expect(response.status).toBe(200);
        expect(serviceStorageUploadMock).toHaveBeenCalledTimes(1);
        const [path, bytes] = serviceStorageUploadMock.mock.calls[0];
        expect(String(path).endsWith(".pdf")).toBe(true);
        expect(checkWorkspaceStorageRoomMock).toHaveBeenCalledWith(serviceClient(), WORKSPACE_ID, (bytes as Buffer).byteLength);
        expect(memberStorageUploadMock).not.toHaveBeenCalled();
      });

      it(`refuses a ${target} pdf packet at the limit and stores nothing`, async () => {
        selectTarget();
        checkWorkspaceStorageRoomMock.mockResolvedValueOnce({
          status: "full",
          usedBytes: QUOTA,
          quotaBytes: QUOTA,
          message: workspaceStorageFullMessage(QUOTA, QUOTA, 4),
        });

        const response = await generate("pdf");

        expect(response.status).toBe(413);
        expect((await response.json()).error).toBe(workspaceStorageFullMessage(QUOTA, QUOTA, 4));
        expect(serviceStorageUploadMock).not.toHaveBeenCalled();
        expect(memberStorageUploadMock).not.toHaveBeenCalled();
        expect(artifactsInsertMock).not.toHaveBeenCalled();
      });

      it(`stores no file and checks no limit for a ${target} html packet, which lives in the artifact record`, async () => {
        selectTarget();
        const response = await generate("html");

        expect(response.status).toBe(200);
        expect(serviceStorageUploadMock).not.toHaveBeenCalled();
        expect(checkWorkspaceStorageRoomMock).not.toHaveBeenCalled();
      });
    }

    it("refuses before copying a selected aerial preview into a workspace already at its limit", async () => {
      reportMaybeSingleMock.mockResolvedValueOnce({
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          workspace_id: WORKSPACE_ID,
          project_id: "44444444-4444-4444-8444-444444444444",
          rtp_cycle_id: null,
          modeling_county_run_id: null,
          title: "Project Status Packet",
          summary: "Packet summary",
          report_type: "project_status",
          status: "draft",
          created_at: "2026-03-14T00:00:00.000Z",
          generated_at: null,
          metadata_json: { aerialOrthoSelections: [{ custodyId: "55555555-5555-4555-8555-555555555555" }] },
        },
        error: null,
      });
      checkWorkspaceStorageRoomMock.mockResolvedValueOnce({
        status: "full",
        usedBytes: QUOTA,
        quotaBytes: QUOTA,
        message: workspaceStorageFullMessage(QUOTA, QUOTA, 0),
      });

      const response = await generate("html");

      expect(response.status).toBe(413);
      expect((await response.json()).error).toBe(workspaceStorageFullMessage(QUOTA, QUOTA, 0));
      expect(checkWorkspaceStorageRoomMock).toHaveBeenCalledWith(serviceClient(), WORKSPACE_ID, 0);
      expect(aerialCustodyMaybeSingleMock).not.toHaveBeenCalled();
      expect(serviceStorageDownloadMock).not.toHaveBeenCalled();
      expect(serviceStorageUploadMock).not.toHaveBeenCalled();
      expect(artifactsInsertMock).not.toHaveBeenCalled();
    });
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
    const htmlUpload = serviceStorageUploadMock.mock.calls.find((call) => String(call[0]).endsWith(".html"));
    expect(htmlUpload?.[2]).toEqual({ contentType: "text/html", upsert: false });
    expect(await response.json()).toMatchObject({
      reportId: "11111111-1111-4111-8111-111111111111",
      artifactId: "artifact-1",
      format: "html",
    });
    expect(projectSelectMock).toHaveBeenCalledWith(expect.stringContaining("jurisdiction_context"));
    expect(artifactsInsertMock, "Report freezes external readiness version").toHaveBeenCalledWith(
      expect.objectContaining({
        report_id: "11111111-1111-4111-8111-111111111111",
        artifact_kind: "html",
        generated_by: "22222222-2222-4222-8222-222222222222",
        metadata_json: expect.objectContaining({
          generationMode: "structured_html_packet",
          sourceContext: expect.objectContaining({
            linkedRunCount: 1,
            jurisdictionReadiness: expect.objectContaining({
              schema: "openplan.project-jurisdiction-readiness-export.v4",
              contextSource: "legacy_study_place",
              payloadSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
              entries: expect.arrayContaining([expect.objectContaining({
                assessment: expect.objectContaining({
                  jurisdiction: expect.objectContaining({ id: "US-CA" }),
                  reports: expect.arrayContaining([expect.objectContaining({ job: expect.objectContaining({ id: "project-evidence-handoff" }), status: "supported" })]),
                }),
              })]),
            }),
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

  it.each([
    ["known source", "ccrs-ca", false, false, false, true, true],
    ["cache failure", "ccrs-ca", true, false, false, true, false],
    ["cache throws", "ccrs-ca", true, false, false, true, false],
    ["road read failure", "ccrs-ca", false, true, false, false, false],
    ["unknown source", "unknown", false, false, false, false, false],
    ["missing source", null, false, false, false, false, false],
    ["missing selection", "ccrs-ca", false, false, true, false, false],
  ])("selects retained road evidence for an imported packet: %s", async (label, sourceId, cacheFailure, roadReadFailure, missingSelection, fetchExpected, roadExpected) => {
    reportNamesCountyRun({ metadata_json: { safetyIngestSelections: [
      { ingestId: missingSelection ? "missing" : "ingest-roads" },
    ] } });
    sectionsOrderMock.mockResolvedValueOnce({ data: [{ id: "section-safety", section_key: "project_safety_evidence",
      title: "Reported collisions", enabled: true, sort_order: 0, config_json: {} }], error: null });
    safetyIngestOrderMock.mockResolvedValueOnce({ data: [{ id: "ingest-roads", source_id: sourceId,
      project_id: "44444444-4444-4444-8444-444444444444", status: "ready",
      min_lon: -121.2, min_lat: 39.1, max_lon: -120.8, max_lat: 39.5,
      source_label: "Retained source", severity_completeness: "kabco_full", crash_count: 4,
      geocoded_count: 4, years_requested: [2024], truncated: false,
    }], error: null });
    safetyRoadReadMock.mockResolvedValue({ data: roadReadFailure ? null : [], error: roadReadFailure ? { message: "read failed" } : null });
    safetyRoadWriteMock.mockResolvedValue({ error: cacheFailure ? { message: "write failed" } : null });
    if (label === "cache throws") safetyRoadWriteMock.mockRejectedValueOnce(new Error("write failed"));
    tigerRoadsMock.mockResolvedValue({ roads: [{ id: "tiger-road", name: "Source Road",
      sourceId: "us-census-tiger-line-cache", sourceLabel: "U.S. Census TIGER/Line roads", vintage: "2025-01-01",
      geometry: { type: "LineString", coordinates: [[-121.061, 39.218], [-121.061, 39.220]] },
    }], coverageLimit: "Nearest source line within 150 meters", sourceVintage: "2025-01-01" });
    rpcMock.mockImplementation((name: string) => Promise.resolve({ data:
      name === "safety_ksi_concentrations_for_ingests" ? [{ rank: 1, longitude: -121.061, latitude: 39.219,
        crash_count: 4, fatal_crash_count: 1, serious_injury_crash_count: 3, radius_meters: 150 }]
      : name === "safety_crash_evidence_counts" ? [
        { ingest_id: "ingest-roads", dimension: "severity", value: "fatal", record_count: 1 },
        { ingest_id: "ingest-roads", dimension: "severity", value: "severe_injury", record_count: 3 },
      ] : [], error: null }));
    const response = await postGenerate(new NextRequest("http://localhost/api/reports/1/generate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: "html" }),
    }), { params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }) });
    expect(response.status).toBe(200);
    expect(safetyIngestSelectMock).toHaveBeenCalledWith(expect.stringContaining("source_id"));
    expect(safetyRoadSelectMock).toHaveBeenCalledWith("id, road_name, geometry_geojson, source_id, source_vintage");
    expect(tigerRoadsMock).toHaveBeenCalledTimes(fetchExpected ? 1 : 0);
    expect(safetyRoadWriteMock).toHaveBeenCalledTimes(fetchExpected ? 1 : 0);
    if (fetchExpected) {
      expect(tigerRoadsMock).toHaveBeenCalledWith([expect.objectContaining({ longitude: -121.061, latitude: 39.219 })]);
      expect(safetyRoadWriteMock).toHaveBeenCalledWith([expect.objectContaining({
        workspace_id: "33333333-3333-4333-8333-333333333333", project_id: "44444444-4444-4444-8444-444444444444",
        country_code: "US", source_id: "us-census-tiger-line-cache", source_vintage: "2025-01-01", source_feature_id: "tiger-road",
      })], { onConflict: "workspace_id,project_id,source_id,source_vintage,source_feature_id" });
    }
    const html = artifactsInsertMock.mock.calls.at(-1)?.[0]?.metadata_json?.htmlContent;
    if (roadExpected) expect(html).toContain("Source Road");
    else expect(html).not.toContain("Source Road");
  });

  it("carries project-linked KSI concentration ranks into the generated packet", async () => {
    reportNamesCountyRun({
      metadata_json: { safetyIngestSelections: [{ ingestId: "ingest-1" }] },
    });
    sectionsOrderMock.mockResolvedValueOnce({
      data: [{
        id: "section-safety",
        section_key: "project_safety_evidence",
        title: "Reported collisions",
        enabled: true,
        sort_order: 0,
        config_json: {},
      }],
      error: null,
    });
    safetyIngestOrderMock.mockResolvedValueOnce({
      data: [{
        id: "ingest-1",
        project_id: "44444444-4444-4444-8444-444444444444",
        min_lon: -121.2,
        min_lat: 39.1,
        max_lon: -120.8,
        max_lat: 39.5,
        status: "ready",
        source_label: "State crash source",
        attribution: "State agency",
        severity_completeness: "kabco_full",
        crash_count: 7,
        geocoded_count: 7,
        truncated: false,
        years_requested: [2024],
        created_at: "2026-08-24T01:00:00.000Z",
        dimension_coverage: null,
        party_completeness: "not_retrieved",
        party_count: null,
        involvement_basis: null,
      }],
      error: null,
    });
    rpcMock.mockImplementation((name: string) => Promise.resolve(
      name === "safety_ksi_concentrations_for_ingests" ? {
          data: [{
            rank: 1,
            longitude: -121.061,
            latitude: 39.219,
            crash_count: 7,
            fatal_crash_count: 2,
            serious_injury_crash_count: 5,
            radius_meters: 150,
          }],
          error: null,
        }
      : name === "safety_ksi_tract_burden_for_ingests" ? {
          data: [{
            rank: 1,
            geoid: "06019000100",
            tract_name: "Census Tract 1",
            ksi_crash_count: 7,
            fatal_crash_count: 2,
            serious_injury_crash_count: 5,
            population: 3500,
            ksi_per_100k: 200,
            pct_poverty: 24,
            pct_nonwhite: 61,
            pct_zero_vehicle: 9,
            area_median_pct_poverty: 16,
            area_median_pct_nonwhite: 48,
            area_median_pct_zero_vehicle: 7,
          }],
          error: null,
        }
      : {
          data: [
            { ingest_id: "ingest-1", dimension: "severity", value: "fatal", record_count: 2 },
            { ingest_id: "ingest-1", dimension: "severity", value: "severe_injury", record_count: 5 },
          ],
          error: null,
        }));

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      { params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }) }
    );

    expect(response.status).toBe(200);
    const inserted = artifactsInsertMock.mock.calls.at(-1)?.[0];
    expect(inserted?.metadata_json?.htmlContent).toContain("7 KSI crashes");
    expect(inserted?.metadata_json?.htmlContent).toContain("Community burden screen");
    expect(inserted?.metadata_json?.sourceContext).toEqual(expect.objectContaining({
      safetyEvidenceReadStatus: "readable",
      safetyKsiConcentrationReadStatus: "readable",
      safetyKsiEquityReadStatus: "readable",
      safetyAcquisitionCount: 1,
    }));
    expect(rpcMock).toHaveBeenCalledWith("safety_ksi_concentrations_for_ingests", expect.objectContaining({
      p_project_id: "44444444-4444-4444-8444-444444444444",
      p_ingest_ids: ["ingest-1"],
      p_min_lon: -121.2,
      p_max_lon: -120.8,
    }));
  });

  it("keeps crash counts when the optional concentration calculation throws", async () => {
    reportNamesCountyRun({
      metadata_json: { safetyIngestSelections: [{ ingestId: "ingest-1" }] },
    });
    sectionsOrderMock.mockResolvedValueOnce({
      data: [{
        id: "section-safety",
        section_key: "project_safety_evidence",
        title: "Reported collisions",
        enabled: true,
        sort_order: 0,
        config_json: {},
      }],
      error: null,
    });
    safetyIngestOrderMock.mockResolvedValueOnce({
      data: [{
        id: "ingest-1",
        project_id: "44444444-4444-4444-8444-444444444444",
        min_lon: -121.2,
        min_lat: 39.1,
        max_lon: -120.8,
        max_lat: 39.5,
        status: "ready",
        source_label: "State crash source",
        attribution: "State agency",
        severity_completeness: "kabco_full",
        crash_count: 7,
        geocoded_count: 7,
        truncated: false,
        years_requested: [2024],
        created_at: "2026-08-24T01:00:00.000Z",
        dimension_coverage: null,
        party_completeness: "not_retrieved",
        party_count: null,
        involvement_basis: null,
      }],
      error: null,
    });
    rpcMock.mockImplementation((name: string) => {
      if (name === "safety_ksi_concentrations_for_ingests") {
        return Promise.reject(new Error("concentration timeout"));
      }
      return Promise.resolve({
        data: [
          { ingest_id: "ingest-1", dimension: "severity", value: "fatal", record_count: 2 },
          { ingest_id: "ingest-1", dimension: "severity", value: "severe_injury", record_count: 5 },
        ],
        error: null,
      });
    });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      { params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }) }
    );

    expect(response.status).toBe(200);
    const inserted = artifactsInsertMock.mock.calls.at(-1)?.[0];
    expect(inserted?.metadata_json?.htmlContent).toContain("State crash source");
    expect(inserted?.metadata_json?.htmlContent).not.toContain("crash evidence attached to this project could not be read");
    expect(inserted?.metadata_json?.sourceContext).toEqual(expect.objectContaining({
      safetyEvidenceReadStatus: "readable",
      safetyKsiConcentrationReadStatus: "failed",
      safetyAcquisitionCount: 1,
    }));
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
    modelingDiagnosisOrderMock.mockResolvedValueOnce({
      data: [{
        model_run_id: "model-run-1",
        diagnosis_artifact_id: "diagnosis-artifact-1",
        assessment_sha256: "a".repeat(64),
        diagnosis_sha256: "b".repeat(64),
        created_at: "2026-08-28T18:45:00Z",
      }],
      error: null,
    });
    distributedWorkLoadingCustodyOrderMock.mockResolvedValueOnce({
      data: [{
        model_run_id: "model-run-1",
        loading_input_sha256: "d".repeat(64),
        pre_output_audit_sha256: "e".repeat(64),
        development_comparison_sha256: "f".repeat(64),
        method: "aequilibrae",
        scientific_outcome: "inconclusive",
        created_at: "2026-08-31T23:30:00Z",
      }],
      error: null,
    });
    agreementArtifactsInMock.mockResolvedValueOnce({
      data: [{
        id: "diagnosis-artifact-1",
        file_url: "run-artifacts/model-runs/model-run-1/structural-diagnosis.json",
        metadata_json: {
          findings: ["Four matched links retain recorded zero volume."],
          unknown_facts: ["model_year", "day_basis"],
        },
      }],
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
    expect(modelRunsEqMock.mock.calls.filter(([column]) => column === "project_id")).toHaveLength(2);
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
    expect(htmlContent).toContain("Why this is inconclusive");
    expect(htmlContent).toContain("Four matched links retain recorded zero volume.");
    expect(htmlContent).toContain("Unknown basis facts: model_year, day_basis.");
    expect(htmlContent).toContain("b".repeat(64));
    expect(htmlContent).toContain("Distributed work-loading checkpoint: inconclusive, aequilibrae");
    expect(htmlContent).toContain("development evidence only; non-work loading is unchanged and no default is promoted");
    expect(htmlContent).toContain("d".repeat(64));
    expect(htmlContent).toContain("e".repeat(64));
    expect(htmlContent).toContain("f".repeat(64));
    // The cited county run carries its name, stage, and validation posture.
    expect(htmlContent).toContain("County screening baseline");
    // The retired validated-screening stage renders as a count check and
    // never as a pass pill (KI-2026-10-12-001).
    expect(htmlContent).toContain("Count Check Complete");
    expect(htmlContent).not.toContain("Validated Screening");
    expect(htmlContent).toMatch(/<span class="pill pill-hold">Count Check Complete<\/span>/);
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

  it("blocks generation when an attached agreement artifact cannot be read", async () => {
    reportRunsOrderMock.mockResolvedValueOnce({
      data: [{ id: "report-run-2", run_id: null, model_run_id: "model-run-1", county_run_id: null, sort_order: 0 }],
      error: null,
    });
    modelRunsInMock.mockResolvedValueOnce({
      data: [{ id: "model-run-1", run_title: "Dual demand run", engine_key: "dual_demand", status: "succeeded", result_summary_json: {} }],
      error: null,
    });
    agreementArtifactsLimitMock.mockResolvedValueOnce({
      data: null,
      error: { message: "artifact registry unavailable" },
    });

    const response = await postGenerate(
      new NextRequest("http://localhost/api/reports/1/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }),
      { params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }) },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/agreement evidence is unreadable/i) });
    expect(artifactsInsertMock).not.toHaveBeenCalled();
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

    expect(fundingAwardsSelectMock).toHaveBeenCalledWith(
      "id, awarded_amount, match_amount, risk_flag, obligation_due_at, updated_at, created_at, latest_handoff_revision_id, current_handoff_revision_id, currency_code, has_source_backed_issuance",
      { count: "exact" },
    );
    expect(fundingOpportunitiesSelectMock).toHaveBeenCalledWith(
      "id, expected_award_amount, decision_state, opportunity_status, closes_at, updated_at, created_at, has_source_backed_issuance",
      { count: "exact" },
    );
    expect(billingInvoicesSelectMock).toHaveBeenCalledWith(
      "id, funding_award_id, status, amount, retention_percent, retention_amount, net_amount, due_date, invoice_date, created_at, award_handoff_revision_id, currency_code, handoff_applicable_revision_id",
      { count: "exact" },
    );
    expect(fundingAwardsEqMock).toHaveBeenCalledWith("project_id", "44444444-4444-4444-8444-444444444444");
    expect(fundingOpportunitiesEqMock).toHaveBeenCalledWith("project_id", "44444444-4444-4444-8444-444444444444");
    expect(billingInvoicesEqMock).toHaveBeenCalledWith("project_id", "44444444-4444-4444-8444-444444444444");

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
    reportNamesCountyRun();
    countyRunsMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: LINKED_COUNTY_RUN_ID,
        workspace_id: "33333333-3333-4333-8333-333333333333",
        run_name: "Nevada County assignment screening",
        geography_label: "Nevada County, CA",
        stage: "validated-screening",
        updated_at: "2026-04-24T01:00:00.000Z",
      },
      error: null,
    });
    countyRunBasisConfirmsPass();
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

  it("reads only the county run the report names, never the workspace's recent runs", async () => {
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
    countyRunBasisConfirmsPass();
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
        // The stored row says claim_grade_passed; a confirmed rules-v4 pass
        // supports screening grade at most, so that is what is shown.
        modelingEvidenceClaimStatuses: ["screening_grade"],
        modelingEvidence: [
          expect.objectContaining({
            countyRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            geographyLabel: "Nevada County explicit run",
            claimStatus: "screening_grade",
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

  /**
   * A BOARD PACKET IS COMPOSED FROM ITS REPORT'S OWN SECTION SELECTION.
   *
   * This was untested, and the gap was not theoretical: changing the packet
   * route's `composition: { kind: "report_sections", sectionKeys:
   * enabledSectionKeys }` to `{ kind: "whole_plan" }` made the packet declare
   * itself a whole-plan export AND stop honouring the sections a planner had
   * switched off — with the whole suite green. Both halves are asserted here,
   * because either one alone survives that mutation in one direction.
   */
  it("composes the RTP packet from its report's section selection, and says so", async () => {
    reportNamesCountyRun({
      project_id: null,
      rtp_cycle_id: "77777777-7777-4777-8777-777777777777",
      title: "RTP Packet",
      report_type: "rtp_packet",
      created_at: "2026-04-24T00:00:00.000Z",
    });
    sectionsOrderMock.mockResolvedValueOnce({
      data: [
        { id: "section-1", section_key: "cycle_overview", title: "Cycle overview", enabled: true, sort_order: 0, config_json: {} },
        { id: "section-2", section_key: "chapter_digest", title: "Chapter digest", enabled: true, sort_order: 1, config_json: {} },
        // Switched OFF by the planner. A packet that carries it anyway is
        // ignoring the selection this report exists to express.
        { id: "section-3", section_key: "comment_response", title: "Comment response", enabled: false, sort_order: 2, config_json: {} },
        // The section that carries the public-review posture card, so what this
        // packet says about its own packet record is actually on the page.
        { id: "section-4", section_key: "engagement_posture", title: "Engagement posture", enabled: true, sort_order: 3, config_json: {} },
      ],
      error: null,
    });
    // A review window and a linked campaign, so the public-review posture is a
    // real sentence rather than a setup checklist — without them, what the
    // packet says about its own packet record is unobservable and the
    // assertion below cannot fail.
    rtpCycleMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "77777777-7777-4777-8777-777777777777",
        workspace_id: "33333333-3333-4333-8333-333333333333",
        title: "2027 Nevada County RTP",
        status: "draft",
        geography_label: "Nevada County, CA",
        horizon_start_year: 2027,
        horizon_end_year: 2050,
        adoption_target_date: null,
        public_review_open_at: "2026-09-01T00:00:00.000Z",
        public_review_close_at: "2026-10-15T00:00:00.000Z",
        summary: "RTP cycle summary",
        updated_at: "2026-04-24T00:00:00.000Z",
      },
      error: null,
    });
    rtpEngagementCampaignsOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "campaign-1",
          title: "Draft plan open house",
          status: "open",
          engagement_type: "map_comment",
          summary: "Public comment on the draft.",
          rtp_cycle_chapter_id: null,
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
    const html = artifactsInsertMock.mock.calls.at(-1)?.[0]?.metadata_json?.htmlContent as string;

    // It says which document it is …
    // `esc()` turns the apostrophe into `&#39;`, so the assertion is split
    // rather than written as prose that never appears in the output.
    expect(html).toContain("Composed from this report");
    expect(html).toContain("own section selection");
    expect(html).not.toContain("whole-plan export");
    // … names what it left out, because a reader cannot see an omission …
    expect(html).toContain("are excluded from this document");
    expect(html).toContain("Comment Response");
    // … and actually leaves it out.
    expect(html).toContain("<h2>Cycle overview</h2>");
    expect(html).not.toContain("<h2>Comment-response record</h2>");

    // The packet IS a packet record and is generating that record's artifact,
    // so it must not borrow the whole-plan export's "not examined" answer — the
    // same falsehood in the other direction. (Mutation-checked: without the
    // review window and campaign above, flipping the packet route to
    // `{ examined: false }` left the suite green — neither answer reached the
    // rendered page, so the assertion could not fail.)
    expect(html).toContain("1 packet record (1 generated)");
    expect(html).not.toContain("did not examine packet records");
  });

  it("adds modeling evidence claim posture to RTP packet artifacts", async () => {
    reportNamesCountyRun({
      project_id: null,
      rtp_cycle_id: "77777777-7777-4777-8777-777777777777",
      title: "RTP Packet",
      report_type: "rtp_packet",
      created_at: "2026-04-24T00:00:00.000Z",
    });
    sectionsOrderMock.mockResolvedValueOnce({
      data: [
        { id: "section-1", section_key: "cycle_overview", title: "Cycle overview", enabled: true, sort_order: 0, config_json: {} },
        { id: "section-2", section_key: "chapter_digest", title: "Chapter digest", enabled: true, sort_order: 1, config_json: {} },
        { id: "section-3", section_key: "appendix_references", title: "Appendix", enabled: true, sort_order: 2, config_json: {} },
      ],
      error: null,
    });
    countyRunsMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: LINKED_COUNTY_RUN_ID,
        workspace_id: "33333333-3333-4333-8333-333333333333",
        run_name: "Nevada County assignment screening",
        geography_label: "Nevada County, CA",
        stage: "validated-screening",
        updated_at: "2026-04-24T01:00:00.000Z",
      },
      error: null,
    });
    countyRunBasisConfirmsPass();
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

  it("refuses the RTP packet when a linked-project funding read fails, instead of totalling it to zero", async () => {
    // The funding snapshot is a TOTAL, so a failed read carried through as
    // `?? []` leaves no gap a reader could notice. It prints an unfunded
    // portfolio, permanently, in a document a funder or a board keeps.
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
    fundingAwardsInMock.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied for table funding_awards", code: "42501" },
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
    expect(await response.json()).toMatchObject({ error: "Failed to load RTP packet funding records" });
    expect(mockAudit.error).toHaveBeenCalledWith(
      "rtp_report_funding_load_failed",
      expect.objectContaining({ message: "permission denied for table funding_awards", code: "42501" })
    );
    // And no artifact exists to state the zero: the packet was never written,
    // and the report was not marked generated.
    expect(artifactsInsertMock).not.toHaveBeenCalled();
    expect(reportUpdateMock).not.toHaveBeenCalled();
  });

  it("refuses the RTP packet when the cycle's engagement read fails, instead of reporting no comments", async () => {
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
    rtpEngagementCampaignsOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "99999999-9999-4999-8999-999999999999",
          title: "Draft RTP listening campaign",
          status: "active",
          engagement_type: "comment_collection",
          summary: "Comments on the draft plan.",
          rtp_cycle_chapter_id: null,
        },
      ],
      error: null,
    });
    engagementItemsInMock.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied for table engagement_items", code: "42501" },
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
    expect(await response.json()).toMatchObject({ error: "Failed to load RTP packet engagement records" });
    expect(mockAudit.error).toHaveBeenCalledWith(
      "rtp_report_engagement_load_failed",
      expect.objectContaining({ message: "permission denied for table engagement_items", code: "42501" })
    );
    // The claim this refusal exists to prevent — a public-review section telling
    // a board the cycle drew no comments — was never written down.
    expect(artifactsInsertMock).not.toHaveBeenCalled();
    expect(reportUpdateMock).not.toHaveBeenCalled();
  });

  it("still generates the RTP packet when the engagement read succeeds with no rows", async () => {
    // The other half of the distinction: a campaign that genuinely collected
    // nothing is a fact the packet may state. Only a FAILED read is refused.
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
    rtpEngagementCampaignsOrderMock.mockResolvedValueOnce({
      data: [
        {
          id: "99999999-9999-4999-8999-999999999999",
          title: "Draft RTP listening campaign",
          status: "active",
          engagement_type: "comment_collection",
          summary: "Comments on the draft plan.",
          rtp_cycle_chapter_id: null,
        },
      ],
      error: null,
    });
    engagementItemsInMock.mockResolvedValueOnce({ data: [], error: null });

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
    expect(engagementItemsInMock).toHaveBeenCalledWith("campaign_id", [
      "99999999-9999-4999-8999-999999999999",
    ]);
    expect(artifactsInsertMock).toHaveBeenCalled();
  });

  describe("an RTP cycle with more comments than the server returns in one response", () => {
    const FIRST_CAMPAIGN = "99999999-9999-4999-8999-999999999999";
    const SECOND_CAMPAIGN = "88888888-8888-4888-8888-888888888888";
    const ITEM_COLUMNS =
      "id, campaign_id, category_id, status, source_type, latitude, longitude, moderation_notes, created_at, updated_at";

    function comments(campaignId: string, count: number, prefix: string) {
      return Array.from({ length: count }, (_, index) => ({
        id: `${prefix}-${String(index).padStart(6, "0")}`,
        campaign_id: campaignId,
        category_id: null,
        status: index % 2 === 0 ? "approved" : "pending",
        source_type: "public",
        latitude: null,
        longitude: null,
        moderation_notes: null,
        created_at: "2026-04-20T00:00:00.000Z",
        updated_at: "2026-04-20T00:00:00.000Z",
      }));
    }

    function rtpPacketWithTwoCampaigns() {
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
      rtpEngagementCampaignsOrderMock.mockResolvedValueOnce({
        data: [
          {
            id: FIRST_CAMPAIGN,
            title: "Draft RTP listening campaign",
            status: "active",
            engagement_type: "comment_collection",
            summary: "Comments on the draft plan.",
            rtp_cycle_chapter_id: null,
          },
          {
            id: SECOND_CAMPAIGN,
            title: "Corridor chapter survey",
            status: "active",
            engagement_type: "comment_collection",
            summary: "Comments on one chapter.",
            rtp_cycle_chapter_id: null,
          },
        ],
        error: null,
      });
    }

    function generate() {
      return postGenerate(
        new NextRequest("http://localhost/api/reports/1/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ format: "html" }),
        }),
        { params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }) }
      );
    }

    it("counts every comment past the 1,000-row server cap", async () => {
      rtpPacketWithTwoCampaigns();
      // 1,234 comments on the first campaign, then 3 on the second, last in
      // the read order: a read that stops at 1,000 rows undercounts the first
      // campaign and drops the second entirely.
      engagementItemsInMock.mockResolvedValueOnce({
        data: [...comments(FIRST_CAMPAIGN, 1234, "first"), ...comments(SECOND_CAMPAIGN, 3, "second")],
        error: null,
      });

      const response = await generate();

      expect(response.status).toBe(200);
      const sourceContext = artifactsInsertMock.mock.calls.at(-1)?.[0]?.metadata_json?.sourceContext;
      // 617 + 2 approved and 617 + 1 pending across the 1,237 comments.
      expect(sourceContext).toMatchObject({
        engagementApprovedCommentCount: 619,
        engagementPendingCommentCount: 618,
      });

      // The projection carries the columns the counts are computed from, the
      // order is total (`id` breaks ties) so no comment is read twice or
      // skipped, and the read asked for every page until one came back empty.
      expect(engagementItemsSelectMock).toHaveBeenCalledWith(ITEM_COLUMNS);
      expect(engagementItemsInMock).toHaveBeenCalledWith("campaign_id", [FIRST_CAMPAIGN, SECOND_CAMPAIGN]);
      expect(engagementItemsInRangeMock.mock.calls.map(([from, toInclusive]) => [from, toInclusive])).toEqual([
        [0, 499],
        [500, 999],
        [1000, 1499],
        [1237, 1736],
      ]);
      // Every page request carries the same total order.
      expect(engagementItemsInOrderMock.mock.calls.map(([column]) => column)).toEqual(
        Array.from({ length: 4 }, () => ["created_at", "id"]).flat()
      );
    });

    it("refuses the packet when a later page of comments fails", async () => {
      rtpPacketWithTwoCampaigns();
      engagementItemsInMock.mockResolvedValueOnce({ data: comments(FIRST_CAMPAIGN, 1234, "first"), error: null });
      // The first page arrives; the second times out. What was read is a
      // prefix, and a packet built on it would print a short count.
      engagementItemsInRangeMock
        .mockImplementationOnce(engagementItemsInPaging.range)
        .mockImplementationOnce(async () => ({
          data: null,
          error: { message: "canceling statement due to statement timeout", code: "57014" },
        }));

      const response = await generate();

      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ error: "Failed to load RTP packet engagement records" });
      expect(mockAudit.error).toHaveBeenCalledWith(
        "rtp_report_engagement_load_failed",
        expect.objectContaining({ message: "canceling statement due to statement timeout", code: "57014" })
      );
      expect(artifactsInsertMock).not.toHaveBeenCalled();
      expect(reportUpdateMock).not.toHaveBeenCalled();
    });

    it("refuses the packet when the comment read stops before it is finished", async () => {
      rtpPacketWithTwoCampaigns();
      // More rows than the read will request before giving up (200 pages of
      // 500). The read ends with rows still coming and no error; that is an
      // unfinished count, never a total.
      engagementItemsInMock.mockResolvedValueOnce({ data: comments(FIRST_CAMPAIGN, 100_001, "first"), error: null });

      const response = await generate();

      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ error: "Failed to load RTP packet engagement records" });
      expect(mockAudit.error).toHaveBeenCalledWith(
        "rtp_report_engagement_load_failed",
        expect.objectContaining({ message: expect.stringContaining("could not be completed"), code: null })
      );
      expect(artifactsInsertMock).not.toHaveBeenCalled();
      expect(reportUpdateMock).not.toHaveBeenCalled();
    });
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

  it("freezes the snapshot on the workspace's BOUND template and asks the workspaces read for the binding columns", async () => {
    // The snapshot test above pins ca_stage_gates_v0_1 — the BOUND template of
    // the fixture workspace. This one pins the mechanism: the workspaces read
    // must carry the binding columns (projection imported, never retyped), or
    // the route would have nothing to resolve the binding from and the
    // reconciliation would silently fall back to geography alone.
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
    const workspacesProjection = String(workspaceSelectMock.mock.calls[0]?.[0] ?? "");
    expect(workspacesProjection).toContain("stage_gate_template_id");
    expect(workspacesProjection).toContain("home_subdivision_code");
  });

  it("freezes a DIFFERENTLY-bound workspace's snapshot under ITS template, so no caller can hardcode one", async () => {
    // The snapshot test above pins the CA fixture's template id, which proves
    // the route does not use the registry DEFAULT — but not that it threads
    // the binding at all. Verified by mutation: replacing the resolved
    // binding with the literal "ca_stage_gates_v0_1" left all 38 tests in this
    // file green. This is the other half of the pincer. A workspace bound to
    // the federal-aid floor must freeze THAT template's id, version, and gate
    // count, and its CA-gate-id decisions must fall outside the vocabulary
    // (nothing passed, nothing held, every gate awaiting a decision) rather
    // than being frozen into a funder's packet under gate names nobody bound.
    workspaceMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Nevada County Safety Action Program",
        stage_gate_template_id: "us_federal_aid_stage_gates_v0_1",
        home_geography_source: "tigerweb",
        home_country_code: "US",
        home_subdivision_code: "TX",
      },
      error: null,
    });
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
            stageGateSnapshot: expect.objectContaining({
              templateId: "us_federal_aid_stage_gates_v0_1",
              passCount: 0,
              holdCount: 0,
              notStartedCount: 8,
              blockedGate: null,
            }),
          }),
        }),
      })
    );
  });

  it("refuses generation when the workspace names a stage-gate template this deployment does not register", async () => {
    // Substituting any registered template would freeze another jurisdiction's
    // gate names into a packet an agency sends to a funder — the one falsehood
    // a packet cannot be corrected out of once sent.
    workspaceMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Nevada County Safety Action Program",
        stage_gate_template_id: "not_a_registered_template_v9",
        home_geography_source: "tigerweb",
        home_country_code: "US",
        home_subdivision_code: "CA",
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

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("not_a_registered_template_v9");
    expect(body.hint).toContain("Rebind");
    // And nothing was written: no packet is produced on a refused binding.
    expect(artifactsInsertMock).not.toHaveBeenCalled();
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

  describe("a campaign with more comments than the server returns in one response", () => {
    const CAMPAIGN_ID = "99999999-9999-4999-8999-999999999999";
    const ITEM_COLUMNS =
      "id, campaign_id, category_id, status, source_type, latitude, longitude, moderation_notes, created_at, updated_at";

    // 1,234 comments: past PostgREST's 1,000-row cap, so a read that stops
    // after one request counts 1,000 and reports no error.
    function commentRows(count: number) {
      return Array.from({ length: count }, (_, index) => ({
        id: `item-${String(index).padStart(6, "0")}`,
        campaign_id: CAMPAIGN_ID,
        category_id: "category-1",
        status: "approved",
        source_type: "public",
        latitude: null,
        longitude: null,
        moderation_notes: null,
        created_at: "2026-03-12T00:00:00.000Z",
        updated_at: "2026-03-14T03:00:00.000Z",
      }));
    }

    function projectReportCitingTheCampaign() {
      sectionsOrderMock.mockResolvedValueOnce({
        data: [
          {
            id: "section-1",
            section_key: "engagement_summary",
            title: "Engagement campaign summary",
            enabled: true,
            sort_order: 0,
            config_json: { campaignId: CAMPAIGN_ID },
          },
        ],
        error: null,
      });
    }

    function campaignTargetedReport() {
      reportMaybeSingleMock.mockResolvedValueOnce({
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          workspace_id: "33333333-3333-4333-8333-333333333333",
          project_id: null,
          rtp_cycle_id: null,
          engagement_campaign_id: CAMPAIGN_ID,
          title: "Campaign packet",
          summary: null,
          report_type: "project_status",
          status: "draft",
          created_at: "2026-03-14T00:00:00.000Z",
        },
        error: null,
      });
      sectionsOrderMock.mockResolvedValueOnce({
        data: [
          { id: "section-1", section_key: "engagement_summary", title: "Engagement campaign summary", enabled: true, sort_order: 0, config_json: {} },
        ],
        error: null,
      });
      reportRunsOrderMock.mockResolvedValueOnce({ data: [], error: null });
    }

    function generate() {
      return postGenerate(
        new NextRequest("http://localhost/api/reports/1/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ format: "html" }),
        }),
        { params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }) }
      );
    }

    function expectTheFullTotalIsRead() {
      // The projection carries the columns the counts are computed from, and the
      // order is total (`id` breaks ties) so no comment is read twice or skipped
      // across page boundaries.
      expect(engagementItemsSelectMock).toHaveBeenCalledWith(ITEM_COLUMNS);
      expect(engagementItemsEqCampaignMock).toHaveBeenCalledWith("campaign_id", CAMPAIGN_ID);
      expect(engagementItemsChainOrderMock.mock.calls.slice(0, 2).map((call) => (call as unknown[])[0])).toEqual([
        "updated_at",
        "id",
      ]);
    }

    it("counts every comment in a project packet", async () => {
      projectReportCitingTheCampaign();
      engagementItemsOrderMock.mockResolvedValueOnce({ data: commentRows(1234), error: null });

      const response = await generate();

      expect(response.status).toBe(200);
      const sourceContext = artifactsInsertMock.mock.calls.at(-1)?.[0]?.metadata_json?.sourceContext;
      expect(sourceContext).toMatchObject({ engagementCampaignId: CAMPAIGN_ID, engagementItemCount: 1234 });
      expectTheFullTotalIsRead();
    });

    it("counts every comment in a campaign packet", async () => {
      campaignTargetedReport();
      engagementItemsOrderMock.mockResolvedValueOnce({ data: commentRows(1234), error: null });

      const response = await generate();

      expect(response.status).toBe(200);
      const sourceContext = artifactsInsertMock.mock.calls.at(-1)?.[0]?.metadata_json?.sourceContext;
      expect(sourceContext).toMatchObject({ engagementCampaignId: CAMPAIGN_ID, engagementItemCount: 1234 });
      expectTheFullTotalIsRead();
    });

    it("refuses a project packet when a later page of comments fails", async () => {
      projectReportCitingTheCampaign();
      engagementItemsOrderMock.mockResolvedValueOnce({ data: commentRows(1234), error: null });
      // The first page arrives; the second times out. What was read is a prefix,
      // and a packet built on it would print a short count as the campaign's.
      engagementItemsRangeMock
        .mockImplementationOnce(engagementItemsPaging.range)
        .mockImplementationOnce(async () => ({
          data: null,
          error: { message: "canceling statement due to statement timeout", code: "57014" },
        }));

      const response = await generate();

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to load engagement handoff context" });
      expect(mockAudit.error).toHaveBeenCalledWith(
        "report_engagement_load_failed",
        expect.objectContaining({ message: "canceling statement due to statement timeout", code: "57014" })
      );
      expect(artifactsInsertMock).not.toHaveBeenCalled();
      expect(reportUpdateMock).not.toHaveBeenCalled();
    });

    it("refuses a campaign packet when the comment read stops before it is finished", async () => {
      campaignTargetedReport();
      // More rows than the read will request before giving up (200 pages of
      // 500). The read ends with rows still coming and no error; that is an
      // unfinished count, never a total.
      engagementItemsOrderMock.mockResolvedValueOnce({ data: commentRows(100_001), error: null });

      const response = await generate();

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to load engagement campaign records" });
      expect(mockAudit.error).toHaveBeenCalledWith(
        "report_engagement_load_failed",
        expect.objectContaining({
          campaignId: CAMPAIGN_ID,
          message: expect.stringContaining("could not be completed"),
        })
      );
      expect(artifactsInsertMock).not.toHaveBeenCalled();
      expect(reportUpdateMock).not.toHaveBeenCalled();
    });
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

  /**
   * A COUNT ON A FUNDER-FACING PACKET MAY NOT COME FROM A FAILED READ.
   *
   * `loadReportModelingEvidence` used to `audit.warn()` each of these three
   * failures and carry on with an empty list. Observing an error in an operator
   * log is not the same act as declining to state a falsehood in a document: the
   * operator sees the warning, the funder sees "0 modeling evidence item(s)" and
   * `modelingEvidenceCount: 0` frozen into the artifact record.
   *
   * Each test below fails ONE NAMED READ and asserts both halves — the honest
   * refusal is present, and the false claim was never written down.
   */
  it("refuses the RTP packet when the county-run read fails, instead of counting zero modeling evidence", async () => {
    reportNamesCountyRun({
      project_id: null,
      rtp_cycle_id: "77777777-7777-4777-8777-777777777777",
      title: "RTP Packet",
      report_type: "rtp_packet",
      created_at: "2026-04-24T00:00:00.000Z",
    });
    countyRunsMaybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied for table county_runs", code: "42501" },
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
    expect(await response.json()).toMatchObject({
      error: "Failed to load the modeling evidence this packet reports on",
      hint: "This is a read failure, not an empty result.",
    });
    expect(mockAudit.error).toHaveBeenCalledWith(
      "rtp_report_modeling_evidence_load_failed",
      expect.objectContaining({ message: "permission denied for table county_runs" })
    );
    // The claim this refusal exists to prevent — a packet stating the cycle has
    // no modeling basis — was never written down.
    expect(artifactsInsertMock).not.toHaveBeenCalled();
    expect(reportUpdateMock).not.toHaveBeenCalled();
  });

  it("refuses the project packet when a county run's modeling evidence cannot be read", async () => {
    // The worst of the three shapes: the county run loads, its evidence read
    // fails, and the packet used to render `evidence: null` as "no claim
    // decision, 0 source manifests, 0 validation checks" — the honesty
    // firewall's own vocabulary, asserted about a run nobody could read.
    reportNamesCountyRun();
    countyRunsMaybeSingleMock.mockResolvedValueOnce({
      data: {
        id: LINKED_COUNTY_RUN_ID,
        workspace_id: "33333333-3333-4333-8333-333333333333",
        run_name: "Nevada County assignment screening",
        geography_label: "Nevada County, CA",
        stage: "validated-screening",
        updated_at: "2026-04-24T01:00:00.000Z",
      },
      error: null,
    });
    modelingClaimMaybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied for table modeling_claim_decisions", code: "42501" },
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
    expect(await response.json()).toMatchObject({
      error: "Failed to load the modeling evidence this packet reports on",
    });
    expect(mockAudit.error).toHaveBeenCalledWith(
      "report_modeling_evidence_load_failed",
      expect.objectContaining({ message: "permission denied for table modeling_claim_decisions" })
    );
    expect(artifactsInsertMock).not.toHaveBeenCalled();
    expect(reportUpdateMock).not.toHaveBeenCalled();
  });

  it("names the pending migration when the modeling evidence read hits a column this deployment lacks", async () => {
    // The realistic pending-schema case, and the reason the county-run read no
    // longer goes through `safeOptionalQuery`: the runs are right there, one
    // column of the projection is not, and the old wrapper answered that with an
    // empty list — a zero the deployment never established.
    reportNamesCountyRun();
    countyRunsMaybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { message: "column county_runs.geography_label does not exist", code: "42703" },
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
    expect(body.error).toBe("This packet's modeling evidence cannot be read yet");
    expect(body.hint).toContain("never established");
    expect(body.hint).not.toMatch(/migration/i);
    expect(body.operatorDetail).toContain("Apply the latest Supabase migrations");
    expect(artifactsInsertMock).not.toHaveBeenCalled();
  });

  it("still generates when the named county run is gone, and counts zero without reading any other run", async () => {
    // The other half of the distinction. A run that is genuinely missing is a
    // fact the packet may state, and the count may be zero — only a FAILED read
    // is refused. And the zero must stay a zero: the deleted fallback would
    // have filled it with whatever the workspace last touched.
    reportNamesCountyRun();
    countyRunsMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

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
    expect(sourceContext).toMatchObject({
      modelingEvidenceCount: 0,
      modelingEvidence: [],
    });
    expect(countyRunsLimitMock).not.toHaveBeenCalled();
  });

  it("refuses the project packet when a funding read fails, instead of totalling it to zero", async () => {
    // The RTP branch already refuses on these four tables. This branch wrapped
    // the SAME four in `safeOptionalQuery`, so a classified failure printed $0
    // committed and a fully unfunded project — the identical falsehood, one code
    // path over.
    fundingAwardsOrderMock.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied for table funding_awards", code: "42501" },
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
    expect(await response.json()).toMatchObject({
      error: "Failed to load this project's funding records",
      hint: "This is a read failure, not an empty result.",
    });
    expect(mockAudit.error).toHaveBeenCalledWith(
      "report_funding_load_failed",
      expect.objectContaining({ message: "permission denied for table funding_awards" })
    );
    expect(artifactsInsertMock).not.toHaveBeenCalled();
    expect(reportUpdateMock).not.toHaveBeenCalled();
  });

  it("names the pending migration when the project's funding schema is not there yet", async () => {
    billingInvoicesOrderMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'relation "public.billing_invoice_records" does not exist', code: "42P01" },
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
      error: "This project's funding records schema is not available yet",
    });
    expect(artifactsInsertMock).not.toHaveBeenCalled();
  });

  it("does not launder an unclassifiable thrown read into an empty accepted-narrative list", async () => {
    // `safeOptionalQuery` used to classify the string `Unexpected table:` — this
    // harness's OWN throw for a table its double does not know — as a benign
    // absence, in production code. That is what hid the missing
    // `document_narrative_drafts` double for as long as it did. A thrown error
    // the route cannot classify must reach the route's unhandled-error path, not
    // become a packet asserting no operator-accepted narratives exist.
    narrativeDraftsOrderMock.mockImplementationOnce(() => {
      throw new Error("Unexpected table: document_narrative_drafts");
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
    expect(mockAudit.error).toHaveBeenCalledWith(
      "reports_generate_unhandled_error",
      expect.anything()
    );
    expect(artifactsInsertMock).not.toHaveBeenCalled();
  });

  it("actually asks the database for the report's accepted narrative drafts", async () => {
    // The read the laundered throw was hiding: it has to be reachable for any
    // assertion about accepted narratives to mean anything.
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
    expect(narrativeDraftsEqTargetKindMock).toHaveBeenCalledWith("target_kind", "report_section");
    expect(narrativeDraftsEqTargetIdMock).toHaveBeenCalledWith(
      "target_id",
      "11111111-1111-4111-8111-111111111111"
    );
    expect(narrativeDraftsEqStatusMock).toHaveBeenCalledWith("status", "accepted");
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
  // Answer from the actual projection. An omitted column never reappears in a fallback row.
  function pendingProjectSchema(missing: string[], style: "postgres" | "cache" = "postgres", malformed = false) {
    const row: Record<string, unknown> = { ...exportProject,
      jurisdiction_context: malformed ? { invalid: true } : exportProject.jurisdiction_context,
      estimated_cost_amount: 125000, estimated_cost_currency: "EUR",
      estimated_cost_basis_year: 2026, estimated_cost_source_document_id: null,
    };
    projectMaybeSingleMock.mockImplementation(async () => {
      const columns = projectSelectMock.mock.calls.at(-1)![0].split(",").map(column => column.trim());
      const unavailable = missing.find(column => columns.includes(column));
      if (unavailable) return { data: null, error: {
        message: style === "postgres" ? `column projects.${unavailable} does not exist`
          : `Could not find the '${unavailable}' column of 'projects' in the schema cache`,
        code: style === "postgres" ? "42703" : "PGRST204",
      } };
      return { data: Object.fromEntries(columns.filter(column => column in row).map(column => [column, row[column]])), error: null };
    });
  }

  async function generatePendingSchemaReport() {
    return postGenerate(new NextRequest("http://localhost/api/reports/1/generate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: "html" }),
    }), { params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }) });
  }

  function generatedPendingSchemaOutput() {
    const inserted = artifactsInsertMock.mock.calls.at(-1)?.[0];
    assert(inserted?.metadata_json, "Pending-schema report records artifact metadata");
    const source = inserted.metadata_json.sourceContext;
    assert(source && typeof source === "object" && "jurisdictionReadiness" in source, "Pending-schema report records readiness custody");
    const readiness = source.jurisdictionReadiness;
    assert(readiness && typeof readiness === "object", "Pending-schema readiness is an object");
    const html = serviceStorageUploadMock.mock.calls.findLast(call => String(call[0]).endsWith(".html"))?.[1].toString();
    assert(typeof html === "string", "Pending-schema report uploads actual HTML");
    expect(inserted.metadata_json.htmlContent, "Stored HTML snapshot matches uploaded report").toBe(html);
    return { readiness: readiness as Record<string, unknown>, html,
      contextText: new DOMParser().parseFromString(html, "text/html").querySelector("#project-jurisdiction-context")?.textContent ?? "",
      source: source as Record<string, unknown> };
  }

  it("keeps the initial project projection literal and equal to every optional group", async () => {
    const expected = [
      "id", "workspace_id", "name", "summary", "status", "plan_type", "delivery_phase", "created_at", "updated_at",
      "jurisdiction_context", ...PROJECT_PLACE_COLUMN_NAMES,
      "estimated_cost_amount", "estimated_cost_currency", "estimated_cost_basis_year", "estimated_cost_source_document_id",
      "latitude", "longitude",
    ].join(", ");
    expect((await generatePendingSchemaReport()).status).toBe(200);
    expect(projectSelectMock.mock.calls[0][0], "Actual initial projection retains every group in order").toBe(expected);
    const sites = collectSupabaseSelectSites().filter(site =>
      site.file === "src/app/api/reports/[reportId]/generate/route.ts" && site.table === "projects"
    );
    expect(sites.filter(site => site.projection !== null).map(site => site.projection), "Source guard resolves the actual initial projection").toEqual([expected]);
    expect(sites.filter(site => site.projection === null), "Computed fallback stays honestly unchecked").toHaveLength(1);
  });

  it.each([
    ["jurisdiction_context"], [...PROJECT_PLACE_COLUMN_NAMES],
    ["estimated_cost_amount", "estimated_cost_currency", "estimated_cost_basis_year", "estimated_cost_source_document_id"],
    ["latitude", "longitude"],
  ])("removes exactly the confirmed optional group beginning %s", async (...columns: string[]) => {
    pendingProjectSchema([columns[0]]);
    expect((await generatePendingSchemaReport()).status, "Single-group recovery generates").toBe(200);
    const projections = projectSelectMock.mock.calls.map(call => call[0]);
    expect(projections, "Single missing group takes exactly one retry").toHaveLength(2);
    expect(projections[1], "Fallback removes the complete named group and nothing else").toBe(
      projections[0].split(", ").filter(column => !columns.includes(column)).join(", ")
    );
  });

  it.each(["postgres", "cache"] as const)("generates schema-pending jurisdiction with readable place and cost (%s)", async style => {
    pendingProjectSchema(["jurisdiction_context"], style);
    const response = await generatePendingSchemaReport();
    expect(response.status, "Schema-pending jurisdiction still generates").toBe(200);
    expect(projectSelectMock.mock.calls, "Jurisdiction-only fallback is bounded").toHaveLength(2);
    const [wide, fallback] = projectSelectMock.mock.calls.map(call => call[0]);
    expect(wide, "Initial projection reads jurisdiction").toContain("jurisdiction_context");
    expect(fallback, "Fallback removes only unavailable jurisdiction").not.toContain("jurisdiction_context");
    for (const column of ["place_geometry_geojson", "place_label", "estimated_cost_amount", "estimated_cost_currency", "latitude", "longitude"]) {
      expect(fallback, `Fallback retains readable ${column}`).toContain(column);
    }
    expect(projectEqMock.mock.calls, "Fallback retains project predicate").toEqual([["id", "44444444-4444-4444-8444-444444444444"], ["id", "44444444-4444-4444-8444-444444444444"]]);
    const { readiness, html, contextText, source } = generatedPendingSchemaOutput();
    expect(readiness, "Pending custody never invents a human declaration or registry assessment").toEqual({
      schema: "openplan.report-project-jurisdiction-schema-pending.v1", scope: "external_handoff",
      projectId: exportProject.id, projectRevision: exportProject.updated_at,
      registrySha256: jurisdictionReadinessRegistrySha256(),
      jurisdictionReadState: "schema_pending", studyAreaReadState: "ok",
      disclosure: "SCHEMA-PENDING: Project jurisdiction could not be read because this deployment's database is missing the jurisdiction column. Declaration status, adopting authority and legal applicability are unknown. No jurisdiction readiness or support assessment is made. Study geography has a separate read state.",
      payloadSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const { payloadSha256, ...material } = readiness;
    expect(payloadSha256, "Pending custody hashes its actual disclosed read state").toBe(createHash("sha256").update(canonicalizeActionPayload(material)).digest("hex"));
    expect(contextText, "Actual HTML discloses schema-pending jurisdiction").toContain("SCHEMA-PENDING");
    expect(contextText, "Actual HTML retains truthful pending disclosure").toContain(String(readiness.disclosure));
    expect(contextText, "Actual HTML prints pending payload hash").toContain(String(payloadSha256));
    expect(contextText, "Actual HTML prints pending schema identity").toContain(String(readiness.schema));
    expect(contextText, "Pending HTML never substitutes an unset or unresolved declaration").not.toMatch(/No separate declaration|explicitly unresolved|Legacy study-place context|Human-declared project context/);
    expect(source.projectGeographyReadState, "Custody retains readable study geography").toBe("ok");
    expect(html, "Actual report retains readable study boundary").toContain("Uploaded study boundary");
    expect(html, "Actual report retains readable project cost").toContain("EUR");
    expect(html, "Actual report retains readable project cost amount").toContain("125,000");
    expect(html, "External report does not leak actor").not.toContain(jurisdictionActor);
  });

  it.each([["place_label", "jurisdiction_context"], ["jurisdiction_context", "place_label"]])("generates truthful older place and jurisdiction schema disclosure (%j, %j)", async (first, second) => {
    pendingProjectSchema([first, second]);
    expect((await generatePendingSchemaReport()).status, "Older schema still generates").toBe(200);
    expect(projectSelectMock.mock.calls, "Older-schema fallback remains bounded").toHaveLength(3);
    const { readiness, html, source } = generatedPendingSchemaOutput();
    expect(readiness.jurisdictionReadState, "Older schema never claims jurisdiction read success").toBe("schema_pending");
    expect(readiness.studyAreaReadState, "Pending payload records missing study geography").toBe("schema_pending");
    expect(source.projectGeographyReadState, "Custody records missing study geography").toBe("schema_pending");
    expect(html, "Actual HTML discloses unread study area").toContain("This project&#39;s study area could not be read at generation time");
    expect(html, "Older schema retains independently readable cost").toContain("125,000");
    const { payloadSha256, ...material } = readiness;
    expect(payloadSha256, "Older-schema hash reflects actual read states").toBe(createHash("sha256").update(canonicalizeActionPayload(material)).digest("hex"));
  });

  it("keeps schema-pending custody identical across generation clocks", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      pendingProjectSchema(["jurisdiction_context"]);
      vi.setSystemTime(new Date("2028-01-01T00:00:00Z"));
      expect((await generatePendingSchemaReport()).status).toBe(200);
      const first = generatedPendingSchemaOutput().readiness;
      vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
      expect((await generatePendingSchemaReport()).status).toBe(200);
      expect(generatedPendingSchemaOutput().readiness, "Pending custody excludes the generation clock").toEqual(first);
    } finally { vi.useRealTimers(); }
  });

  it("retains strict jurisdiction validation when only place schema is pending", async () => {
    pendingProjectSchema(["place_label"]);
    expect((await generatePendingSchemaReport()).status).toBe(200);
    const { readiness, source } = generatedPendingSchemaOutput();
    expect(projectSelectMock.mock.calls.at(-1)![0], "Place fallback still selects jurisdiction").toContain("jurisdiction_context");
    expect(readiness.schema, "Readable jurisdiction retains strict external contract").toBe("openplan.project-jurisdiction-readiness-export.v4");
    expect(readiness.contextSource, "Readable jurisdiction stays a declaration").toBe("project_declaration");
    expect(source.projectGeographyReadState).toBe("schema_pending");
  });

  it("recovers the older core projection only after each optional group is confirmed missing", async () => {
    pendingProjectSchema(["place_label", "jurisdiction_context", "estimated_cost_amount", "latitude"]);
    expect((await generatePendingSchemaReport()).status, "Old core projection still generates").toBe(200);
    expect(projectSelectMock.mock.calls, "Every optional group is retried at most once").toHaveLength(5);
    expect(projectSelectMock.mock.calls.at(-1)![0], "Final fallback retains the documented core projection").toBe("id, workspace_id, name, summary, status, plan_type, delivery_phase, created_at, updated_at");
    const { readiness } = generatedPendingSchemaOutput();
    expect(readiness.jurisdictionReadState).toBe("schema_pending");
    expect(readiness.studyAreaReadState).toBe("schema_pending");
  });

  it("refuses malformed existing jurisdiction even with pending place schema", async () => {
    pendingProjectSchema(["place_label"], "postgres", true);
    expect((await generatePendingSchemaReport()).status, "Malformed saved jurisdiction fails closed").toBe(500);
    expect(serviceStorageUploadMock, "Malformed jurisdiction writes no artifact").not.toHaveBeenCalled();
    expect(artifactsInsertMock).not.toHaveBeenCalled();
    expect(() => readProjectJurisdiction({ id: "project" }), "Ordinary readers still reject missing projection").toThrow("Project jurisdiction was not read.");
  });

  it.each([
    "permission denied for table projects", "connection terminated unexpectedly",
    "column projects.unrecognized_field does not exist", "schema cache unavailable",
    "column projects.unrelated_place_label does not exist",
    "schema cache connection lost while reading jurisdiction_context",
    "column reports.jurisdiction_context does not exist",
    "Could not find the 'jurisdiction_context' column of 'reports' in the schema cache",
    "permission denied: column projects.jurisdiction_context does not exist",
    'column projects."Jurisdiction_Context" does not exist',
  ])("refuses unclassified project read errors without dropping fields: %s", async message => {
    projectMaybeSingleMock.mockResolvedValue({ data: null, error: { message } });
    expect((await generatePendingSchemaReport()).status, "Unclassified failure refuses report").toBe(500);
    expect(projectSelectMock.mock.calls, "Unclassified failure never retries a narrower projection").toHaveLength(1);
    expect(serviceStorageUploadMock).not.toHaveBeenCalled();
    expect(artifactsInsertMock).not.toHaveBeenCalled();
  });

  it("refuses a failed fallback read instead of generating a partial artifact", async () => {
    projectMaybeSingleMock.mockResolvedValueOnce({ data: null, error: { message: "column projects.jurisdiction_context does not exist" } })
      .mockResolvedValueOnce({ data: null, error: { message: "permission denied for table projects" } });
    expect((await generatePendingSchemaReport()).status, "Failed fallback refuses report").toBe(500);
    expect(projectSelectMock).toHaveBeenCalledTimes(2);
    expect(serviceStorageUploadMock).not.toHaveBeenCalled();
    expect(artifactsInsertMock).not.toHaveBeenCalled();
  });

  it("freezes non-null export-safe report readiness with canonical hash parity", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2028-01-01T00:00:00Z"));
    try {
    projectMaybeSingleMock.mockResolvedValue({ data: exportProject, error: null });
    const expected = buildProjectJurisdictionReadinessExportPayload(exportProject, jurisdictionReadinessRegistrySha256());
    const response = await postGenerate(new NextRequest("http://localhost/api/reports/1/generate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: "html" }),
    }), { params: Promise.resolve({ reportId: "11111111-1111-4111-8111-111111111111" }) });
    expect(response.status).toBe(200);
    const inserted = artifactsInsertMock.mock.calls[0][0];
    assert(inserted.metadata_json, "Generated report includes metadata");
    const sourceContext = inserted.metadata_json.sourceContext;
    assert(
      typeof sourceContext === "object" && sourceContext !== null && "jurisdictionReadiness" in sourceContext,
      "Generated report metadata includes jurisdiction readiness source context"
    );
    const reportReadiness = sourceContext.jurisdictionReadiness;
    expect(reportReadiness, "Report metadata shares external canonical material").toEqual(expected);
    expect(JSON.stringify(reportReadiness), "Report readiness omits internal actor").not.toContain(jurisdictionActor);
    const html = serviceStorageUploadMock.mock.calls.find(call => String(call[0]).endsWith(".html"))?.[1].toString();
    expect(html, "Actual generated report prints shared canonical hash").toContain(expected.payloadSha256);
    expect(html, "Actual generated report excludes jurisdiction actor UUID").not.toContain(jurisdictionActor);
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const client = { from() {
      const query = { select() { return query; }, eq() { return query; }, in() { return query; }, order() { return query; }, range() { return query; },
        async maybeSingle() { return { data: exportProject, error: null }; },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve(resolve({ data: [], error: null })); },
      }; return query;
    } };
    const bundle = await loadProjectEvidenceGeneratedFiles(client, exportProject, new Date());
    const json = JSON.parse(bundle.files.find(file => file.path === "project/jurisdiction-readiness.json")!.bytes.toString());
    expect(json, "Actual report and bundle JSON share canonical material across clocks").toEqual(reportReadiness);
    const standalone = buildProjectGeoPackage({ project: exportProject, corridors: [], generatedAt: new Date() });
    for (const bytes of [standalone.bytes, bundle.files.find(file => file.path === "project/project.gpkg")!.bytes]) {
      const db = new Database(bytes, { readonly: true });
      try {
        const row = db.prepare("SELECT payload_sha256, readiness_payload_json FROM project_jurisdiction_context").get() as { payload_sha256: string; readiness_payload_json: string };
        expect(row.payload_sha256, "Actual report JSON and both GeoPackages share a hash across clocks").toBe(expected.payloadSha256);
        expect(row.readiness_payload_json, "Actual report JSON and both GeoPackages share canonical bytes").toBe(canonicalizeActionPayload(expected));
      } finally { db.close(); }
    }
    } finally { vi.useRealTimers(); }
  });

});
