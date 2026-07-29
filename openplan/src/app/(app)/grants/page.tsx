import { redirect } from "next/navigation";
import { GrantsFundingNeedEditorSection } from "@/components/grants/grants-funding-need-editor-section";
import { GrantsOpportunityCreatorSection } from "@/components/grants/grants-opportunity-creator-section";
import { GrantsOpportunityRegistrySection } from "@/components/grants/grants-opportunity-registry-section";
import { GrantsAwardsReimbursementSection } from "@/components/grants/grants-awards-reimbursement-section";
import { GrantsModelingTriageSection } from "@/components/grants/grants-modeling-triage-section";
import { GrantsReimbursementTriageSection } from "@/components/grants/grants-reimbursement-triage-section";
import { GrantsAwardConversionSection } from "@/components/grants/grants-award-conversion-section";
import { GrantsBcaScreeningSection } from "@/components/grants/grants-bca-screening-section";
import { GrantsGovLiveSection } from "@/components/grants/grants-gov-live-section";
import { GrantsPageIntroHeader } from "@/components/grants/grants-page-intro-header";
import { GrantsProgramCatalogSection } from "@/components/grants/program-catalog-section";
import { GrantsQueueCallout } from "@/components/grants/grants-queue-callout";
import type { FundingOpportunityNarrativeDraftRow } from "@/components/grants/funding-opportunity-narrative-draft-panel";
import { GrantsWorkspaceQueueSection } from "@/components/grants/grants-workspace-queue-section";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import {
  loadWorkspaceOperationsSummaryForWorkspace,
  type WorkspaceOperationsSupabaseLike,
} from "@/lib/operations/workspace-summary";
import {
  buildBillingInvoicePriorityQueue,
  resolveExactBillingInvoiceAwardMatch,
  summarizeBillingInvoiceRecords,
} from "@/lib/invoicing/invoice-records";
import { resolveReimbursementProfile } from "@/lib/invoicing/reimbursement-profile-binding";
import { parseWorkspaceHomeGeography, resolveJurisdiction } from "@/lib/workspaces/home-geography";
import {
  isGrantsAwardCommand,
  isGrantsCommand,
  isGrantsDecisionCommand,
  isGrantsModelingCommand,
  isGrantsReimbursementCommand,
  isGrantsSourcingCommand,
} from "@/lib/operations/grants-links";
import {
  buildProjectFundingStackSummary,
} from "@/lib/projects/funding";
import {
  buildLatestBcaScreeningByProjectId,
  type ProjectBcaScreeningRowLike,
} from "@/lib/grants/bca-evidence";
import {
  buildProjectEngagementEvidenceByProjectId,
  type ProjectEngagementCampaignRowLike,
} from "@/lib/grants/engagement-evidence";
import { bcaAnalysisInputsSchema } from "@/lib/bca/schema";
import {
  buildBcaCrashInputSuggestion,
  type BcaCrashSeverityCounts,
} from "@/lib/safety/bca-evidence";
import {
  buildProjectGrantModelingEvidenceByProjectId,
  describeProjectGrantModelingReadiness,
} from "@/lib/grants/modeling-evidence";
import {
  loadScenarioComparisonSummaryForProjects,
  totalReadySnapshotCount,
} from "@/lib/scenarios/comparison-summary";
import { createClient } from "@/lib/supabase/server";
import {
  loadCurrentWorkspaceMembership,
} from "@/lib/workspaces/current";

import {
  type BillingInvoiceRow,
  type FundingAwardRow,
  type FundingOpportunityRow,
  type GrantsModelingTriageProject,
  type GrantsPageSearchParams,
  type ProgramOption,
  type ProjectFundingProfileRow,
  type ProjectGrantModelingReportRow,
  type ProjectOption,
  type ReportArtifactRow,
  compareFundingOpportunitiesForGrantsQueue,
  compareGrantModelingTriageProjects,
  getReimbursementPriority,
  isClosingSoon,
  isInvoiceOverdue,
  normalizeDecisionFilter,
  normalizeFocusedInvoiceId,
  normalizeFocusedOpportunityId,
  normalizeFocusedProjectId,
  normalizeJoinedRecord,
  normalizeKindFilter,
  normalizeRelinkedInvoiceId,
  normalizeStatusFilter,
  resolveOpportunityPursuitKind,
  resolveGrantsQueueHref,
  resolveProjectExactBillingTriageTarget,
} from "@/lib/grants/page-helpers";

export default async function GrantsPage({
  searchParams,
}: {
  searchParams: GrantsPageSearchParams;
}) {
  const filters = await searchParams;
  const selectedStatus = normalizeStatusFilter(filters.status);
  const selectedDecision = normalizeDecisionFilter(filters.decision);
  const selectedKind = normalizeKindFilter(filters.kind);
  const activeFocusedProjectId = normalizeFocusedProjectId(filters.focusProjectId);
  const activeFocusedOpportunityId = normalizeFocusedOpportunityId(filters.focusOpportunityId);
  const activeFocusedInvoiceId = normalizeFocusedInvoiceId(filters.focusInvoiceId);
  const activeRelinkedInvoiceId = normalizeRelinkedInvoiceId(filters.relinkedInvoiceId);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { membership, workspace } = await loadCurrentWorkspaceMembership(supabase, user.id);
  const canWriteInvoices = canAccessWorkspaceAction("invoices.write", membership?.role);

  if (!membership || !workspace) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="Grants"
        title="Grants need a provisioned workspace"
        description="Funding opportunities, awards, and reimbursement posture only become meaningful when they are attached to a real OpenPlan workspace."
      />
    );
  }

  const [
    opportunitiesRead,
    { data: projectsData },
    { data: programsData },
    { data: fundingAwardsData },
    { data: fundingInvoicesData },
    { data: projectFundingProfilesData },
    { data: projectBcaScreeningsData },
    { data: engagementCampaignsData },
    workspaceGeographyRead,
    operationsSummary,
  ] = await Promise.all([
    supabase
      .from("funding_opportunities")
      .select(
        "id, workspace_id, program_id, project_id, title, opportunity_status, decision_state, agency_name, owner_label, cadence_label, expected_award_amount, opens_at, closes_at, decision_due_at, fit_notes, readiness_notes, decision_rationale, decided_at, summary, pursuit_kind, solicitation_number, updated_at, created_at, programs(id, title, funding_classification), projects(id, name)"
      )
      .eq("workspace_id", membership.workspace_id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("projects")
      .select("id, name")
      .eq("workspace_id", membership.workspace_id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("programs")
      .select("id, title")
      .eq("workspace_id", membership.workspace_id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("funding_awards")
      .select(
        "id, funding_opportunity_id, project_id, program_id, title, awarded_amount, match_amount, obligation_due_at, spending_status, risk_flag, notes, updated_at, created_at, funding_opportunities(id, title), programs(id, title), projects(id, name)"
      )
      .eq("workspace_id", membership.workspace_id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("billing_invoice_records")
      .select("id, project_id, funding_award_id, invoice_number, status, due_date, amount, retention_percent, retention_amount, net_amount")
      .eq("workspace_id", membership.workspace_id)
      .order("due_date", { ascending: true }),
    supabase
      .from("project_funding_profiles")
      .select("project_id, funding_need_amount, local_match_need_amount, notes")
      .eq("workspace_id", membership.workspace_id),
    // Latest screening per project via the DISTINCT ON view — bounded by
    // project count, so no workspace-wide row cap can drop an older project's
    // newest save (which would falsely flip its bca-support cue to "none").
    supabase
      .from("project_bca_screenings_latest")
      .select("id, project_id, inputs_json, result_json, engine_version, created_at")
      .eq("workspace_id", membership.workspace_id),
    // Project-linked engagement campaigns feed the community-engagement
    // evidence cue (the lane reads the E1/E5b caches, never recomputes them).
    supabase
      .from("engagement_campaigns")
      .select(
        "id, project_id, title, status, updated_at, ai_synthesis_json, ai_synthesized_at, representativeness_json, representativeness_computed_at"
      )
      .eq("workspace_id", membership.workspace_id)
      .not("project_id", "is", null)
      .neq("status", "archived")
      .order("updated_at", { ascending: false }),
    // The workspace's home geography drives which reimbursement profile the
    // /grants composer offers — same resolution as the /invoicing page, so
    // the posture select renders identically on both surfaces.
    supabase
      .from("workspaces")
      .select("home_geography_source, home_geography_kind, home_geography_ref, home_country_code, home_subdivision_code")
      .eq("id", membership.workspace_id)
      .maybeSingle(),
    loadWorkspaceOperationsSummaryForWorkspace(
      supabase as unknown as WorkspaceOperationsSupabaseLike,
      membership.workspace_id
    ),
  ]);

  // Pursuit-column tolerance: a deployment that predates migration
  // 20260727000015 rejects the extended select. Fall back to the legacy
  // column list — on that schema every opportunity is truthfully a grant.
  let opportunitiesData: unknown = opportunitiesRead.data;
  if (
    opportunitiesRead.error &&
    /column .* does not exist|could not find the .* column|schema cache/i.test(
      opportunitiesRead.error.message ?? ""
    )
  ) {
    const legacyRead = await supabase
      .from("funding_opportunities")
      .select(
        "id, workspace_id, program_id, project_id, title, opportunity_status, decision_state, agency_name, owner_label, cadence_label, expected_award_amount, opens_at, closes_at, decision_due_at, fit_notes, readiness_notes, decision_rationale, decided_at, summary, updated_at, created_at, programs(id, title, funding_classification), projects(id, name)"
      )
      .eq("workspace_id", membership.workspace_id)
      .order("updated_at", { ascending: false });
    opportunitiesData = legacyRead.data;
  }

  // Where this workspace works, as one answer for every jurisdiction-aware lane
  // on the page. A failed geography read (columns pending on an older
  // deployment) resolves as "jurisdiction unknown" — a disclosed fallback,
  // never a guess.
  const workspaceJurisdiction = resolveJurisdiction(
    parseWorkspaceHomeGeography(workspaceGeographyRead.error ? null : workspaceGeographyRead.data)
  );

  // Which reimbursement profile governs this workspace's composer: its own
  // home geography when a registered profile covers it, otherwise the labeled
  // interim default.
  const reimbursementProfileResolution = resolveReimbursementProfile({
    workspaceJurisdiction,
  });
  const reimbursementProfile =
    reimbursementProfileResolution.kind === "resolved" ? reimbursementProfileResolution.binding : null;

  const projectOptions = (projectsData ?? []) as ProjectOption[];
  const programOptions = (programsData ?? []) as ProgramOption[];
  const projectIdsWithVisibleFundingOpportunities = Array.from(
    new Set(
      ((opportunitiesData ?? []) as FundingOpportunityRow[])
        .map((opportunity) => opportunity.project_id)
        .filter((value): value is string => Boolean(value))
    )
  );
  const { data: projectGrantReportsData } = projectIdsWithVisibleFundingOpportunities.length
    ? await supabase
        .from("reports")
        .select("id, project_id, title, updated_at, generated_at, latest_artifact_kind")
        .in("project_id", projectIdsWithVisibleFundingOpportunities)
        .order("updated_at", { ascending: false })
    : { data: [] };
  const reportIds = ((projectGrantReportsData ?? []) as ProjectGrantModelingReportRow[]).map((report) => report.id);
  const { data: projectGrantReportArtifactsData } = reportIds.length
    ? await supabase
        .from("report_artifacts")
        .select("report_id, generated_at, metadata_json")
        .in("report_id", reportIds)
        .order("generated_at", { ascending: false })
    : { data: [] };
  const projectGrantModelingEvidenceByProjectId = buildProjectGrantModelingEvidenceByProjectId(
    (projectGrantReportsData ?? []) as ProjectGrantModelingReportRow[],
    (projectGrantReportArtifactsData ?? []) as ReportArtifactRow[]
  );

  const scenarioComparisonSummaryResult = projectIdsWithVisibleFundingOpportunities.length
    ? await loadScenarioComparisonSummaryForProjects({
        supabase,
        projectIds: projectIdsWithVisibleFundingOpportunities,
      })
    : { rows: [], scenarioSetProjectMap: new Map<string, string>(), error: null };
  const scenarioComparisonRows = scenarioComparisonSummaryResult.rows;
  const scenarioComparisonIndicatorCount = new Set(scenarioComparisonRows.map((row) => row.indicator_key)).size;
  const scenarioComparisonReadyCount = totalReadySnapshotCount(scenarioComparisonRows);
  const scenarioComparisonProjectsWithSignal = new Set(
    scenarioComparisonRows
      .map((row) => scenarioComparisonSummaryResult.scenarioSetProjectMap.get(row.scenario_set_id))
      .filter((value): value is string => Boolean(value))
  ).size;

  const opportunities = ((opportunitiesData ?? []) as FundingOpportunityRow[])
    .map((opportunity) => ({
      ...opportunity,
      program: normalizeJoinedRecord(opportunity.programs),
      project: normalizeJoinedRecord(opportunity.projects),
    }))
    .sort((left, right) =>
      compareFundingOpportunitiesForGrantsQueue(left, right, projectGrantModelingEvidenceByProjectId)
    );

  const fundingAwards = ((fundingAwardsData ?? []) as FundingAwardRow[]).map((award) => ({
    ...award,
    opportunity: normalizeJoinedRecord(award.funding_opportunities),
    program: normalizeJoinedRecord(award.programs),
    project: normalizeJoinedRecord(award.projects),
  }));
  const fundingInvoices = (fundingInvoicesData ?? []) as BillingInvoiceRow[];
  const projectFundingProfiles = (projectFundingProfilesData ?? []) as ProjectFundingProfileRow[];

  const fundingAwardOpportunityIds = new Set(
    fundingAwards.map((award) => award.funding_opportunity_id).filter((value): value is string => Boolean(value))
  );
  const projectFundingProfileByProjectId = new Map(projectFundingProfiles.map((profile) => [profile.project_id, profile]));
  const projectBcaScreeningRows = (projectBcaScreeningsData ?? []) as Array<
    ProjectBcaScreeningRowLike & { inputs_json: unknown }
  >;
  const latestBcaScreeningByProjectId = buildLatestBcaScreeningByProjectId(projectBcaScreeningRows);

  // Crash-evidence prefill for the BCA screen: the latest READY project-linked
  // crash acquisition per project, plus the observed severity mix of its stored
  // (geocoded) crash points. Any read failure — including a pending safety
  // schema — simply offers no suggestion; nothing here invents a count.
  const projectCrashIngestResult = await supabase
    .from("safety_crash_ingests")
    .select(
      "id, project_id, status, source_label, attribution, severity_completeness, crash_count, geocoded_count, truncated, years_requested, created_at"
    )
    .eq("workspace_id", membership.workspace_id)
    .eq("status", "ready")
    .not("project_id", "is", null)
    .order("created_at", { ascending: false });
  const projectCrashIngestRows = projectCrashIngestResult.error
    ? []
    : ((projectCrashIngestResult.data ?? []) as Array<{
        id: string;
        project_id: string;
        status: string;
        source_label: string | null;
        attribution: string | null;
        severity_completeness: string;
        crash_count: number | null;
        geocoded_count: number | null;
        truncated: boolean | null;
        years_requested: number[] | null;
        created_at: string;
      }>);
  const latestCrashIngestByProjectId = new Map<string, (typeof projectCrashIngestRows)[number]>();
  for (const row of projectCrashIngestRows) {
    if (!latestCrashIngestByProjectId.has(row.project_id)) {
      latestCrashIngestByProjectId.set(row.project_id, row);
    }
  }
  const crashSeverityCount = async (ingestId: string, severity: string): Promise<number> => {
    const { count, error } = await supabase
      .from("safety_crashes")
      .select("id", { count: "exact", head: true })
      .eq("ingest_id", ingestId)
      .eq("severity", severity);
    if (error) throw new Error(error.message);
    return count ?? 0;
  };
  const crashEvidenceByProjectId = new Map<
    string,
    { ingestId: string; suggestion: NonNullable<ReturnType<typeof buildBcaCrashInputSuggestion>> }
  >();
  await Promise.all(
    Array.from(latestCrashIngestByProjectId.entries()).map(async ([crashProjectId, row]) => {
      try {
        const [fatal, severeInjury, injury, pdo] = await Promise.all([
          crashSeverityCount(row.id, "fatal"),
          crashSeverityCount(row.id, "severe_injury"),
          crashSeverityCount(row.id, "injury"),
          crashSeverityCount(row.id, "pdo"),
        ]);
        const severityCounts: BcaCrashSeverityCounts = { fatal, severeInjury, injury, pdo };
        const suggestion = buildBcaCrashInputSuggestion(
          {
            id: row.id,
            status: row.status,
            sourceLabel: row.source_label,
            attribution: row.attribution,
            severityCompleteness: row.severity_completeness,
            crashCount: Number(row.crash_count ?? 0),
            geocodedCount: Number(row.geocoded_count ?? 0),
            truncated: Boolean(row.truncated),
            yearsRequested: row.years_requested ?? [],
          },
          severityCounts
        );
        if (suggestion) {
          crashEvidenceByProjectId.set(crashProjectId, { ingestId: row.id, suggestion });
        }
      } catch {
        // A failed severity read means no suggestion for this project — never a guess.
      }
    })
  );
  const engagementEvidenceByProjectId = buildProjectEngagementEvidenceByProjectId(
    (engagementCampaignsData ?? []) as ProjectEngagementCampaignRowLike[]
  );
  const canWritePrograms = canAccessWorkspaceAction("programs.write", membership.role);
  const bcaScreeningProjects = projectOptions.map((project) => {
    const latest = latestBcaScreeningByProjectId.get(project.id) ?? null;
    // The client body gets serializable props only; saved inputs are re-parsed
    // through the wire schema so a malformed stored payload prefills nothing.
    const latestRow = latest
      ? projectBcaScreeningRows.find((row) => row.id === latest.id) ?? null
      : null;
    const parsedInputs = latestRow ? bcaAnalysisInputsSchema.safeParse(latestRow.inputs_json) : null;
    return {
      id: project.id,
      name: project.name,
      fundingNeedAmount: projectFundingProfileByProjectId.get(project.id)?.funding_need_amount ?? null,
      latestScreening: latest
        ? {
            createdAt: latest.createdAt,
            netPresentValue: latest.netPresentValue,
            benefitCostRatio: latest.benefitCostRatio,
            analysisHorizonYears: latest.analysisHorizonYears,
            inputs: parsedInputs?.success ? parsedInputs.data : null,
          }
        : null,
      crashEvidence: crashEvidenceByProjectId.get(project.id) ?? null,
    };
  });
  const opportunitiesByProjectId = new Map<string, typeof opportunities>();
  const fundingAwardsByProjectId = new Map<string, typeof fundingAwards>();
  const awardLinkedInvoicesByProjectId = new Map<string, BillingInvoiceRow[]>();

  for (const opportunity of opportunities) {
    if (!opportunity.project?.id) continue;
    const current = opportunitiesByProjectId.get(opportunity.project.id) ?? [];
    current.push(opportunity);
    opportunitiesByProjectId.set(opportunity.project.id, current);
  }

  for (const award of fundingAwards) {
    const projectId = award.project?.id ?? award.project_id;
    if (!projectId) continue;
    const current = fundingAwardsByProjectId.get(projectId) ?? [];
    current.push(award);
    fundingAwardsByProjectId.set(projectId, current);
  }

  for (const invoice of fundingInvoices) {
    if (!invoice.project_id || !invoice.funding_award_id) continue;
    const current = awardLinkedInvoicesByProjectId.get(invoice.project_id) ?? [];
    current.push(invoice);
    awardLinkedInvoicesByProjectId.set(invoice.project_id, current);
  }

  const fundingProjectStacks = projectOptions
    .map((project) => {
      const awards = fundingAwardsByProjectId.get(project.id) ?? [];
      if (awards.length === 0) return null;

      const summary = buildProjectFundingStackSummary(
        projectFundingProfileByProjectId.get(project.id),
        awards,
        opportunitiesByProjectId.get(project.id) ?? [],
        awardLinkedInvoicesByProjectId.get(project.id) ?? []
      );
      const linkedInvoiceSummary = summarizeBillingInvoiceRecords(awardLinkedInvoicesByProjectId.get(project.id) ?? []);
      const nextObligationAward = awards.find((award) => award.obligation_due_at === summary.nextObligationAt) ?? null;
      const latestAwardUpdatedAt = awards.reduce<string | null>((latest, award) => {
        if (!latest) return award.updated_at;
        return new Date(award.updated_at).getTime() > new Date(latest).getTime() ? award.updated_at : latest;
      }, null);

      return {
        project,
        awards,
        summary,
        linkedInvoices: awardLinkedInvoicesByProjectId.get(project.id) ?? [],
        linkedInvoiceSummary,
        nextObligationAward,
        latestAwardUpdatedAt,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => {
      const reimbursementDifference =
        getReimbursementPriority(left.summary.reimbursementStatus) -
        getReimbursementPriority(right.summary.reimbursementStatus);
      if (reimbursementDifference !== 0) return reimbursementDifference;
      if (left.summary.awardRiskCount !== right.summary.awardRiskCount) {
        return right.summary.awardRiskCount - left.summary.awardRiskCount;
      }
      return new Date(right.latestAwardUpdatedAt ?? 0).getTime() - new Date(left.latestAwardUpdatedAt ?? 0).getTime();
    });

  const exactBillingTriageInvoiceByProjectId = new Map(
    fundingProjectStacks
      .map((item) => {
        const invoice = resolveProjectExactBillingTriageTarget(item.linkedInvoices);
        return invoice ? [item.project.id, invoice] : null;
      })
      .filter((entry): entry is [string, BillingInvoiceRow] => Boolean(entry))
  );
  const invoiceById = new Map(fundingInvoices.map((invoice) => [invoice.id, invoice]));
  const committedAwardAmount = fundingAwards.reduce((sum, award) => sum + Number(award.awarded_amount ?? 0), 0);
  const trackedMatchAmount = fundingAwards.reduce((sum, award) => sum + Number(award.match_amount ?? 0), 0);
  const awardLinkedInvoices = fundingInvoices.filter((invoice) => Boolean(invoice.funding_award_id));
  const linkedInvoiceSummary = summarizeBillingInvoiceRecords(awardLinkedInvoices);
  const uninvoicedCommittedAmount = Math.max(committedAwardAmount - linkedInvoiceSummary.totalNetAmount, 0);
  const awardWatchCount = fundingAwards.filter((award) => award.risk_flag === "watch" || award.risk_flag === "critical").length;
  const fundingNeedAnchorProjects = projectOptions
    .map((project) => {
      const fundingProfile = projectFundingProfileByProjectId.get(project.id) ?? null;
      const fundingNeedAmount = Number(fundingProfile?.funding_need_amount ?? 0);
      const projectOpportunities = opportunitiesByProjectId.get(project.id) ?? [];
      if (projectOpportunities.length === 0) {
        return null;
      }
      if (Number.isFinite(fundingNeedAmount) && fundingNeedAmount > 0) {
        return null;
      }
      return {
        project,
        opportunityCount: projectOpportunities.length,
        localMatchNeedAmount: Number(fundingProfile?.local_match_need_amount ?? 0),
        notes: fundingProfile?.notes ?? null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.opportunityCount - left.opportunityCount);
  const fundingSourcingProjects = projectOptions
    .map((project) => {
      const fundingProfile = projectFundingProfileByProjectId.get(project.id) ?? null;
      const fundingNeedAmount = Number(fundingProfile?.funding_need_amount ?? 0);
      if (!Number.isFinite(fundingNeedAmount) || fundingNeedAmount <= 0) {
        return null;
      }
      if ((opportunitiesByProjectId.get(project.id) ?? []).length > 0) {
        return null;
      }
      return {
        project,
        fundingNeedAmount,
        localMatchNeedAmount: Number(fundingProfile?.local_match_need_amount ?? 0),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.fundingNeedAmount - left.fundingNeedAmount);
  const fundingGapProjects = projectOptions
    .map((project) => {
      const awards = fundingAwardsByProjectId.get(project.id) ?? [];
      const opportunities = opportunitiesByProjectId.get(project.id) ?? [];
      const linkedInvoices = awardLinkedInvoicesByProjectId.get(project.id) ?? [];
      const summary = buildProjectFundingStackSummary(
        projectFundingProfileByProjectId.get(project.id),
        awards,
        opportunities,
        linkedInvoices
      );
      if (!summary.hasTargetNeed || summary.unfundedAfterLikelyAmount <= 0 || opportunities.length === 0) {
        return null;
      }
      return {
        project,
        awards,
        opportunities,
        linkedInvoices,
        summary,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.summary.unfundedAfterLikelyAmount - left.summary.unfundedAfterLikelyAmount);
  const reimbursementNotStartedCount = fundingProjectStacks.filter(
    (item) => item.summary.reimbursementStatus === "not_started"
  ).length;
  const reimbursementActiveCount = fundingProjectStacks.filter((item) =>
    ["drafting", "in_review", "partially_paid"].includes(item.summary.reimbursementStatus)
  ).length;
  const reimbursementPaidCount = fundingProjectStacks.filter(
    (item) => item.summary.reimbursementStatus === "paid"
  ).length;
  const leadReimbursementStack =
    fundingProjectStacks.find((item) => item.summary.reimbursementStatus === "not_started" && item.awards.length > 0) ?? null;
  const focusedReimbursementStack =
    (activeFocusedProjectId
      ? fundingProjectStacks.find(
          (item) => item.project.id === activeFocusedProjectId && item.summary.reimbursementStatus === "not_started" && item.awards.length > 0
        )
      : null) ?? null;
  const reimbursementComposerStack = focusedReimbursementStack ?? leadReimbursementStack;
  const leadFundingNeedProject = fundingNeedAnchorProjects[0] ?? null;
  const focusedFundingNeedProject =
    (activeFocusedProjectId
      ? fundingNeedAnchorProjects.find((item) => item.project.id === activeFocusedProjectId)
      : null) ?? null;
  const fundingNeedEditorProject = focusedFundingNeedProject ?? leadFundingNeedProject;
  const focusedFundingSourcingProject =
    (activeFocusedProjectId
      ? fundingSourcingProjects.find((item) => item.project.id === activeFocusedProjectId)
      : null) ?? null;
  const focusedFundingGapProject =
    (activeFocusedProjectId
      ? fundingGapProjects.find((item) => item.project.id === activeFocusedProjectId)
      : null) ?? null;
  const fundingOpportunityCreatorProject = focusedFundingSourcingProject?.project ?? focusedFundingGapProject?.project ?? null;
  const fundingOpportunityCreatorMode = focusedFundingSourcingProject
    ? "sourcing"
    : focusedFundingGapProject
      ? "gap"
      : "default";
  const fundingAwardById = new Map(fundingAwards.map((award) => [award.id, award]));
  const fundingAwardOptions = fundingAwards.map((award) => ({
    id: award.id,
    title: award.title,
    projectId: award.project?.id ?? award.project_id ?? null,
  }));
  const fundingAwardProjectRows = fundingAwards.map((award) => ({
    id: award.id,
    project_id: award.project?.id ?? award.project_id ?? null,
    title: award.title,
  }));
  const projectNameById = new Map(projectOptions.map((project) => [project.id, project.name]));
  const reimbursementPriorityQueue = buildBillingInvoicePriorityQueue(fundingInvoices, {
    limit: 5,
    classifyRecord: (record, records) => {
      const exactMatchFundingAward = resolveExactBillingInvoiceAwardMatch(record, records, fundingAwardProjectRows);
      if (!exactMatchFundingAward) {
        return null;
      }

      const overdue = isInvoiceOverdue(record.status, record.due_date);
      const isOutstanding = ["internal_review", "submitted", "approved_for_payment"].includes(record.status);

      return {
        priorityTier: overdue ? 0.5 : isOutstanding ? 1.5 : 2.5,
        reason: overdue
          ? `Exact award relink is ready now: ${exactMatchFundingAward.title} is the only eligible award on this project, and this overdue invoice is the only active unlinked reimbursement record.`
          : isOutstanding
            ? `Exact award relink is ready now: ${exactMatchFundingAward.title} is the only eligible award on this project, and this invoice is the only active unlinked reimbursement record still in payment flow.`
            : `Exact award relink is ready now: ${exactMatchFundingAward.title} is the only eligible award on this project, and this invoice is the only active unlinked reimbursement record.`,
        isExactRelink: true,
      };
    },
  }).filter((entry) => entry.record.status !== "paid" && entry.record.status !== "rejected");
  const exactRelinkReadyCount = fundingInvoices.filter((invoice) =>
    Boolean(resolveExactBillingInvoiceAwardMatch(invoice, fundingInvoices, fundingAwardProjectRows))
  ).length;
  const overdueLinkedInvoiceCount = awardLinkedInvoices.filter((invoice) => isInvoiceOverdue(invoice.status, invoice.due_date)).length;
  const draftLinkedInvoiceCount = awardLinkedInvoices.filter((invoice) => invoice.status === "draft").length;
  const inFlightLinkedInvoiceCount = awardLinkedInvoices.filter((invoice) =>
    ["internal_review", "submitted", "approved_for_payment"].includes(invoice.status)
  ).length;

  const filteredOpportunities = opportunities.filter((opportunity) => {
    if (selectedStatus !== "all" && opportunity.opportunity_status !== selectedStatus) {
      return false;
    }
    if (selectedDecision !== "all" && opportunity.decision_state !== selectedDecision) {
      return false;
    }
    if (selectedKind !== "all" && resolveOpportunityPursuitKind(opportunity) !== selectedKind) {
      return false;
    }
    return true;
  });

  const trackedCount = opportunities.length;
  const openCount = opportunities.filter((opportunity) => opportunity.opportunity_status === "open").length;
  const pursueCount = opportunities.filter((opportunity) => opportunity.decision_state === "pursue").length;
  const monitorCount = opportunities.filter((opportunity) => opportunity.decision_state === "monitor").length;
  const skipCount = opportunities.filter((opportunity) => opportunity.decision_state === "skip").length;
  const closingSoonCount = opportunities.filter((opportunity) => isClosingSoon(opportunity.closes_at)).length;
  const awardedCount = opportunities.filter((opportunity) => opportunity.opportunity_status === "awarded").length;
  const distinctProjectCount = new Set(opportunities.map((opportunity) => opportunity.project?.id).filter(Boolean)).size;
  const distinctProgramCount = new Set(opportunities.map((opportunity) => opportunity.program?.id).filter(Boolean)).size;
  const awardedOpportunitiesMissingRecords = opportunities.filter(
    (opportunity) => opportunity.opportunity_status === "awarded" && !fundingAwardOpportunityIds.has(opportunity.id)
  );
  const leadAwardConversionOpportunity =
    awardedOpportunitiesMissingRecords.find((opportunity) => Boolean(opportunity.project?.id)) ?? null;
  const focusedAwardConversionOpportunity =
    (activeFocusedOpportunityId
      ? awardedOpportunitiesMissingRecords.find(
          (opportunity) => opportunity.id === activeFocusedOpportunityId && Boolean(opportunity.project?.id)
        )
      : null) ?? null;
  const awardConversionOpportunity = focusedAwardConversionOpportunity ?? leadAwardConversionOpportunity;
  const trackedOpportunityTitles = opportunities.map((opportunity) => opportunity.title);
  const { data: focusedOpportunityNarrativeDraftData } = activeFocusedOpportunityId
    ? await supabase
        .from("funding_opportunity_narrative_drafts")
        .select(
          "id, opportunity_id, draft_markdown, model, source, created_at, grounding_json, grounded_sentence_count, total_sentence_count"
        )
        .eq("opportunity_id", activeFocusedOpportunityId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };
  const focusedOpportunityNarrativeDraft =
    (focusedOpportunityNarrativeDraftData as FundingOpportunityNarrativeDraftRow | null) ?? null;
  const grantsQueue = operationsSummary.fullCommandQueue
    .filter((item) => isGrantsCommand(item))
    .map((item) => ({
      ...item,
      href: resolveGrantsQueueHref(item, membership.workspace_id, exactBillingTriageInvoiceByProjectId, invoiceById),
    }));
  const leadGrantsCommand = grantsQueue[0] ?? null;
  const leadReimbursementCommand = grantsQueue.find((item) => isGrantsReimbursementCommand(item)) ?? null;
  const leadAwardCommand = grantsQueue.find((item) => isGrantsAwardCommand(item)) ?? null;
  const leadDecisionCommand = grantsQueue.find((item) => isGrantsDecisionCommand(item)) ?? null;
  const leadSourcingCommand = grantsQueue.find((item) => isGrantsSourcingCommand(item)) ?? null;
  const leadModelingCommand = grantsQueue.find((item) => isGrantsModelingCommand(item)) ?? null;
  const opportunityLinkedModelingProjects = projectOptions
    .map((project) => {
      const projectOpportunities = opportunitiesByProjectId.get(project.id) ?? [];
      if (projectOpportunities.length === 0) {
        return null;
      }

      const modelingEvidence = projectGrantModelingEvidenceByProjectId.get(project.id) ?? null;
      return {
        project,
        opportunityCount: projectOpportunities.length,
        leadOpportunityId: projectOpportunities[0]!.id,
        modelingEvidence,
        modelingReadiness: describeProjectGrantModelingReadiness(modelingEvidence),
      } satisfies GrantsModelingTriageProject;
    })
    .filter((item): item is GrantsModelingTriageProject => Boolean(item));
  const decisionReadyModelingProjects = opportunityLinkedModelingProjects
    .filter((item) => item.modelingReadiness?.key === "decision-ready")
    .sort(compareGrantModelingTriageProjects);
  const staleModelingProjects = opportunityLinkedModelingProjects
    .filter((item) => item.modelingReadiness?.key === "stale")
    .sort(compareGrantModelingTriageProjects);
  const thinModelingProjects = opportunityLinkedModelingProjects
    .filter((item) => item.modelingReadiness?.key === "thin")
    .sort(compareGrantModelingTriageProjects);
  const missingModelingProjects = opportunityLinkedModelingProjects.filter((item) => !item.modelingEvidence);
  const strongestModelingProject = decisionReadyModelingProjects[0] ?? null;
  const stalestModelingProject = staleModelingProjects[0] ?? null;
  const thinnestModelingProject = thinModelingProjects[0] ?? null;
  const missingModelingProject = missingModelingProjects[0] ?? null;

  return (
    <section className="module-page">
      <GrantsPageIntroHeader
        scenarioComparisonIndicatorCount={scenarioComparisonIndicatorCount}
        scenarioComparisonReadyCount={scenarioComparisonReadyCount}
        scenarioComparisonProjectsWithSignal={scenarioComparisonProjectsWithSignal}
        trackedCount={trackedCount}
        openCount={openCount}
        pursueCount={pursueCount}
        closingSoonCount={closingSoonCount}
        awardedCount={awardedCount}
        distinctProjectCount={distinctProjectCount}
        distinctProgramCount={distinctProgramCount}
        monitorCount={monitorCount}
        skipCount={skipCount}
        fundingAwardsCount={fundingAwards.length}
        decisionReadyModelingCount={decisionReadyModelingProjects.length}
        staleModelingCount={staleModelingProjects.length}
        thinModelingCount={thinModelingProjects.length}
        missingModelingCount={missingModelingProjects.length}
        operationsSummary={operationsSummary}
        workspaceCommandCallout={
          leadGrantsCommand ? (
            <GrantsQueueCallout kind="workspace" command={leadGrantsCommand} className="mt-4" variant="hero" />
          ) : null
        }
      />

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-6">
          {fundingNeedEditorProject ? (
            <GrantsFundingNeedEditorSection
              fundingNeedEditorProject={fundingNeedEditorProject}
              fundingNeedAnchorProjectsCount={fundingNeedAnchorProjects.length}
              activeFocusedProjectId={activeFocusedProjectId}
            />
          ) : null}

          <div
            id="grants-gap-resolution-lane"
            className={activeFocusedProjectId === fundingOpportunityCreatorProject?.id ? "scroll-mt-24" : "scroll-mt-24"}
          >
            {leadSourcingCommand ? (
              <GrantsQueueCallout kind="sourcing" command={leadSourcingCommand} className="mb-5" />
            ) : null}
            <GrantsOpportunityCreatorSection
              fundingOpportunityCreatorProject={fundingOpportunityCreatorProject}
              fundingOpportunityCreatorMode={fundingOpportunityCreatorMode}
              focusedFundingGapProject={focusedFundingGapProject}
              focusedFundingSourcingProject={focusedFundingSourcingProject}
              activeFocusedProjectId={activeFocusedProjectId}
              programOptions={programOptions}
              projectOptions={projectOptions}
            />
          </div>

          <GrantsProgramCatalogSection
            trackedTitles={trackedOpportunityTitles}
            workspaceJurisdiction={workspaceJurisdiction}
          />

          <GrantsGovLiveSection trackedTitles={trackedOpportunityTitles} />

          <GrantsReimbursementTriageSection
            reimbursementPriorityQueue={reimbursementPriorityQueue}
            awardLinkedInvoicesCount={awardLinkedInvoices.length}
            overdueLinkedInvoiceCount={overdueLinkedInvoiceCount}
            draftLinkedInvoiceCount={draftLinkedInvoiceCount}
            inFlightLinkedInvoiceCount={inFlightLinkedInvoiceCount}
            exactRelinkReadyCount={exactRelinkReadyCount}
            fundingAwardById={fundingAwardById}
            projectNameById={projectNameById}
            fundingInvoices={fundingInvoices}
            fundingAwardProjectRows={fundingAwardProjectRows}
            fundingAwardOptions={fundingAwardOptions}
            activeFocusedInvoiceId={activeFocusedInvoiceId}
            activeRelinkedInvoiceId={activeRelinkedInvoiceId}
            workspaceId={membership.workspace_id}
            canWriteInvoices={canWriteInvoices}
            reimbursementCommandCallout={
              leadReimbursementCommand ? (
                <GrantsQueueCallout kind="reimbursement" command={leadReimbursementCommand} />
              ) : null
            }
          />

          {leadModelingCommand || opportunityLinkedModelingProjects.length > 0 ? (
            <GrantsModelingTriageSection
              opportunityLinkedModelingProjects={opportunityLinkedModelingProjects}
              decisionReadyModelingProjects={decisionReadyModelingProjects}
              staleModelingProjects={staleModelingProjects}
              thinModelingProjects={thinModelingProjects}
              missingModelingProjects={missingModelingProjects}
              strongestModelingProject={strongestModelingProject}
              stalestModelingProject={stalestModelingProject}
              thinnestModelingProject={thinnestModelingProject}
              missingModelingProject={missingModelingProject}
              leadModelingCommand={leadModelingCommand}
            />
          ) : null}

          <GrantsBcaScreeningSection projects={bcaScreeningProjects} canSave={canWritePrograms} />

          <GrantsWorkspaceQueueSection grantsQueue={grantsQueue} />

          <GrantsAwardConversionSection
            awardedOpportunitiesMissingRecords={awardedOpportunitiesMissingRecords}
            awardConversionOpportunity={awardConversionOpportunity}
            activeFocusedOpportunityId={activeFocusedOpportunityId}
            awardCommandCallout={
              leadAwardCommand ? (
                <GrantsQueueCallout kind="award" command={leadAwardCommand} className="mb-5" />
              ) : null
            }
          />

          {/*
            Two permissions, deliberately not one. Writing invoices is
            owner/admin (`invoices.write`); recording an award close-out is
            whatever `programs.write` allows, which includes members. Handing
            this section only `canWriteInvoices` hid the close-out control from
            every member on the workspace, for an action the close-out route
            would have accepted from them.
          */}
          <GrantsAwardsReimbursementSection
            fundingAwardsCount={fundingAwards.length}
            fundingProjectStacks={fundingProjectStacks}
            committedAwardAmount={committedAwardAmount}
            trackedMatchAmount={trackedMatchAmount}
            uninvoicedCommittedAmount={uninvoicedCommittedAmount}
            awardWatchCount={awardWatchCount}
            linkedInvoiceSummary={linkedInvoiceSummary}
            reimbursementNotStartedCount={reimbursementNotStartedCount}
            reimbursementActiveCount={reimbursementActiveCount}
            reimbursementPaidCount={reimbursementPaidCount}
            reimbursementComposerStack={reimbursementComposerStack}
            reimbursementProfile={reimbursementProfile}
            activeFocusedProjectId={activeFocusedProjectId}
            workspaceId={membership.workspace_id}
            canWriteInvoices={canWriteInvoices}
            canCloseOutAwards={canWritePrograms}
          />
        </div>

        <GrantsOpportunityRegistrySection
          filteredOpportunities={filteredOpportunities}
          opportunitiesCount={opportunities.length}
          selectedStatus={selectedStatus}
          selectedDecision={selectedDecision}
          selectedKind={selectedKind}
          showModelingCaveat={opportunityLinkedModelingProjects.length > 0}
          activeFocusedOpportunityId={activeFocusedOpportunityId}
          projectGrantModelingEvidenceByProjectId={projectGrantModelingEvidenceByProjectId}
          latestBcaScreeningByProjectId={latestBcaScreeningByProjectId}
          engagementEvidenceByProjectId={engagementEvidenceByProjectId}
          focusedOpportunityNarrativeDraft={focusedOpportunityNarrativeDraft}
          decisionCommandCallout={
            leadDecisionCommand ? (
              <GrantsQueueCallout kind="decision" command={leadDecisionCommand} />
            ) : null
          }
        />
      </div>
    </section>
  );
}
