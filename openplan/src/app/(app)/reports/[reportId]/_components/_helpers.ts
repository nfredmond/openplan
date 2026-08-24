import type { ReportNarrativeDraftRow } from "@/components/reports/report-narrative-draft-panel";
import type { PortfolioFundingSnapshot } from "@/lib/projects/funding";
import { formatDateTime, sectionSupportsAiNarrative } from "@/lib/reports/catalog";
import type { ReportScenarioSetLink } from "@/lib/reports/scenario-provenance";
import type {
  ProjectStageGateSnapshot,
  StageGateSnapshotGateSummary,
  StageGateWorkflowState,
} from "@/lib/stage-gates/summary";
import type {
  CurrentProjectRecordEntry,
  DriftStatus,
  EngagementCampaignSnapshot,
  ProjectRecordSnapshotEntry,
  ReportRow,
  RunAuditEntry,
  StageGateSnapshotControlHealth,
} from "./_types";
import { formatMoney } from "@/lib/money/format";

export function driftTone(
  status: DriftStatus
): "success" | "warning" | "neutral" | "info" {
  if (status === "unchanged") return "success";
  if (status === "gate changed" || status === "count changed") return "warning";
  if (status === "updated") return "info";
  return "neutral";
}

export function asHtmlContent(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  if (!metadata) return null;
  return typeof metadata.htmlContent === "string"
    ? metadata.htmlContent
    : null;
}

export function asRunAudit(
  metadata: Record<string, unknown> | null | undefined
): RunAuditEntry[] {
  if (!metadata || !Array.isArray(metadata.runAudit)) {
    return [];
  }

  return metadata.runAudit.filter((item): item is RunAuditEntry => {
    if (!item || typeof item !== "object") {
      return false;
    }

    const record = item as Record<string, unknown>;
    const gate = record.gate;

    return (
      typeof record.runId === "string" &&
      Boolean(gate) &&
      typeof gate === "object"
    );
  });
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function asSourceContext(
  metadata: Record<string, unknown> | null | undefined
) {
  if (!metadata) return null;
  return asRecord(metadata.sourceContext);
}

export function asScenarioSetLinks(value: unknown): ReportScenarioSetLink[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is ReportScenarioSetLink =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).scenarioSetId === "string" &&
      typeof (item as Record<string, unknown>).scenarioSetTitle === "string" &&
      Array.isArray((item as Record<string, unknown>).matchedEntries)
  );
}

export function asProjectRecordSnapshotEntry(
  value: unknown
): ProjectRecordSnapshotEntry | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    count: asNullableNumber(record.count) ?? 0,
    latestTitle: asNullableString(record.latestTitle),
    latestAt: asNullableString(record.latestAt),
  };
}

export function asStageGateSnapshotGateSummary(
  value: unknown
): StageGateSnapshotGateSummary | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const workflowState = asNullableString(
    record.workflowState
  ) as StageGateWorkflowState | null;
  const missingArtifacts = Array.isArray(record.missingArtifacts)
    ? record.missingArtifacts.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0
      )
    : [];

  if (
    !workflowState ||
    !["pass", "hold", "not_started"].includes(workflowState)
  ) {
    return null;
  }

  return {
    gateId: asNullableString(record.gateId) ?? "Unknown gate",
    sequence: asNullableNumber(record.sequence) ?? 0,
    name: asNullableString(record.name) ?? "Unknown gate",
    workflowState,
    rationale: asNullableString(record.rationale) ?? "No rationale provided.",
    missingArtifacts,
    requiredEvidenceCount: asNullableNumber(record.requiredEvidenceCount) ?? 0,
    operatorControlEvidenceCount:
      asNullableNumber(record.operatorControlEvidenceCount) ?? 0,
  };
}

export function asStageGateSnapshotControlHealth(
  value: unknown
): StageGateSnapshotControlHealth {
  const record = asRecord(value);

  return {
    totalOperatorControlEvidenceCount:
      asNullableNumber(record?.totalOperatorControlEvidenceCount) ?? 0,
    gatesWithOperatorControlsCount:
      asNullableNumber(record?.gatesWithOperatorControlsCount) ?? 0,
  };
}

export function asStageGateSnapshot(
  value: unknown
): ProjectStageGateSnapshot | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const templateId = asNullableString(record.templateId);
  const templateVersion = asNullableString(record.templateVersion);

  if (!templateId || !templateVersion) {
    return null;
  }

  return {
    templateId,
    templateVersion,
    passCount: asNullableNumber(record.passCount) ?? 0,
    holdCount: asNullableNumber(record.holdCount) ?? 0,
    notStartedCount: asNullableNumber(record.notStartedCount) ?? 0,
    blockedGate: asStageGateSnapshotGateSummary(record.blockedGate),
    nextGate: asStageGateSnapshotGateSummary(record.nextGate),
    controlHealth: asStageGateSnapshotControlHealth(record.controlHealth),
  };
}

export function asPortfolioFundingSnapshot(
  value: unknown
): PortfolioFundingSnapshot | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    capturedAt: asNullableString(record.capturedAt),
    latestSourceUpdatedAt: asNullableString(record.latestSourceUpdatedAt),
    linkedProjectCount: asNullableNumber(record.linkedProjectCount) ?? 0,
    trackedProjectCount: asNullableNumber(record.trackedProjectCount) ?? 0,
    fundedProjectCount: asNullableNumber(record.fundedProjectCount) ?? 0,
    likelyCoveredProjectCount:
      asNullableNumber(record.likelyCoveredProjectCount) ?? 0,
    gapProjectCount: asNullableNumber(record.gapProjectCount) ?? 0,
    committedFundingAmount:
      asNullableNumber(record.committedFundingAmount) ?? 0,
    likelyFundingAmount: asNullableNumber(record.likelyFundingAmount) ?? 0,
    totalPotentialFundingAmount:
      asNullableNumber(record.totalPotentialFundingAmount) ?? 0,
    unfundedAfterLikelyAmount:
      asNullableNumber(record.unfundedAfterLikelyAmount) ?? 0,
    paidReimbursementAmount:
      asNullableNumber(record.paidReimbursementAmount) ?? 0,
    outstandingReimbursementAmount:
      asNullableNumber(record.outstandingReimbursementAmount) ?? 0,
    uninvoicedAwardAmount:
      asNullableNumber(record.uninvoicedAwardAmount) ?? 0,
    awardRiskCount: asNullableNumber(record.awardRiskCount) ?? 0,
    label: asNullableString(record.label) ?? "Unknown funding posture",
    reason:
      asNullableString(record.reason) ??
      "No RTP funding posture was captured on this packet artifact.",
    reimbursementLabel:
      asNullableString(record.reimbursementLabel) ??
      "Unknown reimbursement posture",
    reimbursementReason:
      asNullableString(record.reimbursementReason) ??
      "No RTP reimbursement posture was captured on this packet artifact.",
  };
}

export function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function maxTimestamp(
  ...values: Array<string | null | undefined>
): string | null {
  const timestamps = values
    .map((value) => parseTimestamp(value))
    .filter((value): value is number => value !== null);

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

export function formatCompactDateTime(value: string | null | undefined): string {
  return value ? formatDateTime(value) : "Unavailable";
}

/**
 * Report packets round to the dollar. An absent figure reads as $0 here on
 * purpose — every caller is a snapshot total the packet builder has already
 * defaulted — and the surfaces that use it carry `ROUNDED_MONEY_NOTE`.
 */
export function formatCurrency(value: number | null | undefined): string {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return formatMoney(numeric, { precision: "whole" });
}

export function asEngagementCampaignSnapshot(
  value: unknown
): EngagementCampaignSnapshot | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = asNullableString(record.id);
  const title = asNullableString(record.title);

  if (!id || !title) {
    return null;
  }

  return {
    id,
    title,
    status: asNullableString(record.status),
    updatedAt: asNullableString(record.updatedAt),
  };
}

export function buildCurrentProjectRecordEntry<
  T extends { title: string | null; created_at: string | null },
>(
  items: T[],
  getAt: (item: T) => string | null
): CurrentProjectRecordEntry {
  return {
    count: items.length,
    latestTitle: items[0]?.title ?? null,
    latestAt: items[0] ? getAt(items[0]) : null,
  };
}

export function summarizeProjectRecordDrift(changes: string[]): string {
  if (changes.length === 0) {
    return "Snapshot counts and latest record timing still match live project records.";
  }

  return changes.join(" ");
}

const REPORT_DETAIL_COLUMNS =
  "id, workspace_id, project_id, rtp_cycle_id, engagement_campaign_id, land_use_plan_id, title, report_type, status, summary, generated_at, latest_artifact_url, latest_artifact_kind, metadata_json, created_at, updated_at, rtp_basis_stale, rtp_basis_stale_reason, rtp_basis_stale_run_id, rtp_basis_stale_marked_at";

type ReportDetailQueryResult = {
  data: ReportRow | null;
  error: { message?: string | null } | null;
};

type ReportDetailClientLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => { maybeSingle: () => Promise<ReportDetailQueryResult> };
    };
  };
};

type ProjectFundingQueryClientLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => {
        // `error` is narrowed to its message here — unlike the loose `unknown`
        // elsewhere in this file — because the caller has to be able to SAY
        // which read failed, and a page that cannot name the failure ends up
        // presenting the empty result instead.
        maybeSingle: () => Promise<{ data: unknown; error?: { message?: string | null } | null }>;
        order: (
          column: string,
          options: { ascending: boolean }
        ) => Promise<{ data: unknown; error?: { message?: string | null } | null }>;
      };
    };
  };
};

/**
 * The project's live funding source rows (profile, awards, opportunities,
 * award-linked invoices) in the exact shape `buildProjectFundingSnapshot`
 * consumes. A report without a project target resolves to the empty posture.
 */
export async function loadProjectFundingSourceRows(
  supabase: unknown,
  projectId: string | null
): Promise<{
  profile: { id: string; funding_need_amount: number | null; local_match_need_amount: number | null; notes?: string | null; updated_at: string | null } | null;
  awards: Array<Record<string, unknown>>;
  opportunities: Array<Record<string, unknown>>;
  invoices: Array<Record<string, unknown>>;
  unreadable: boolean;
  unreadableMessage: string | null;
}> {
  if (!projectId) {
    // No project target is a genuine ABSENCE, not a failed read: there is no
    // funding board to fail. `unreadable` stays false so the caller keeps
    // comparing, which is the honest thing to do here.
    return { profile: null, awards: [], opportunities: [], invoices: [], unreadable: false, unreadableMessage: null };
  }

  const client = supabase as ProjectFundingQueryClientLike;
  const [profileResult, awardsResult, opportunitiesResult, invoicesResult] = await Promise.all([
    client
      .from("project_funding_profiles")
      .select("id, funding_need_amount, local_match_need_amount, notes, updated_at")
      .eq("project_id", projectId)
      .maybeSingle(),
    client
      .from("funding_awards")
      .select("id, awarded_amount, match_amount, risk_flag, obligation_due_at, updated_at, created_at")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false }),
    client
      .from("funding_opportunities")
      .select("id, expected_award_amount, decision_state, opportunity_status, closes_at, updated_at, created_at")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false }),
    client
      .from("billing_invoice_records")
      .select("id, funding_award_id, status, amount, retention_percent, retention_amount, net_amount, due_date, invoice_date, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
  ]);

  return {
    profile: (profileResult.data ?? null) as Awaited<
      ReturnType<typeof loadProjectFundingSourceRows>
    >["profile"],
    awards: (awardsResult.data ?? []) as Array<Record<string, unknown>>,
    opportunities: (opportunitiesResult.data ?? []) as Array<Record<string, unknown>>,
    invoices: (invoicesResult.data ?? []) as Array<Record<string, unknown>>,
    /**
     * Whether any of the four reads FAILED, and the message if so.
     *
     * Added because the four `?? []` above are lossy in the one way that
     * matters: they turn a permission failure into a project with no money,
     * and the caller builds a funding snapshot from the result and publishes it
     * as drift against the packet's frozen one — "Committed awards: $8,000,000
     * -> $0." on a report an agency sends to a funder. The empty arrays are kept
     * (a page that 500s because a side panel failed is worse), so this flag is
     * how the caller learns not to treat them as an answer.
     */
    unreadable: [profileResult, awardsResult, opportunitiesResult, invoicesResult].some(
      (result) => Boolean(result?.error)
    ),
    unreadableMessage:
      [profileResult, awardsResult, opportunitiesResult, invoicesResult].find((result) =>
        Boolean(result?.error)
      )?.error?.message ?? null,
  };
}

type NarrativeDraftQueryClientLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => {
        eq: (
          column: string,
          value: string
        ) => {
          order: (
            column: string,
            options: { ascending: boolean }
          ) => Promise<{ data: unknown; error: { message?: string | null } | null }>;
        };
      };
    };
  };
};

/**
 * AI narrative assist props for the report detail page: which enabled sections
 * are on the AI-narrative whitelist for this report type, seeded with the
 * latest stored draft per section. Project-targeted reports only; returns
 * null when the panel should not render at all, and a pre-20260727000013
 * database simply seeds no drafts.
 */
export async function loadAiNarrativeDraftPanelInputs(
  supabase: unknown,
  report: { id: string; report_type: string | null; project_id: string | null; engagement_campaign_id?: string | null },
  sectionList: Array<{ section_key: string; title: string; enabled: boolean }>
): Promise<{
  reportId: string;
  sections: Array<{ sectionKey: string; title: string }>;
  initialDrafts: Record<string, ReportNarrativeDraftRow | null>;
} | null> {
  const sections =
    !report.engagement_campaign_id && report.project_id
      ? sectionList
          .filter(
            (section) =>
              section.enabled && sectionSupportsAiNarrative(report.report_type, section.section_key)
          )
          .map((section) => ({ sectionKey: section.section_key, title: section.title }))
      : [];

  if (sections.length === 0) {
    return null;
  }

  const client = supabase as NarrativeDraftQueryClientLike;
  const result = await client
    .from("document_narrative_drafts")
    .select(
      "id, section_key, draft_markdown, model, status, grounding_json, grounded_sentence_count, total_sentence_count, accepted_markdown, accepted_at, created_at"
    )
    .eq("target_kind", "report_section")
    .eq("target_id", report.id)
    .order("created_at", { ascending: false });

  const rows =
    result.error &&
    /relation .* does not exist|column .* does not exist|schema cache/i.test(
      result.error.message ?? ""
    )
      ? []
      : ((result.data ?? []) as ReportNarrativeDraftRow[]);

  return {
    reportId: report.id,
    sections,
    initialDrafts: Object.fromEntries(
      sections.map((section) => [
        section.sectionKey,
        rows.find((row) => row.section_key === section.sectionKey) ?? null,
      ])
    ),
  };
}

/**
 * Load the report row for the detail page, preferring the campaign-target
 * column. Until migration 20260727000008 is applied that column does not
 * exist, and existing project/RTP reports must keep rendering — so a
 * pending-schema error falls back to the legacy column list.
 */
export async function loadReportDetailRow(
  supabase: unknown,
  reportId: string
): Promise<ReportDetailQueryResult> {
  const client = supabase as ReportDetailClientLike;
  const primary = await client
    .from("reports")
    .select(`${REPORT_DETAIL_COLUMNS}, engagement_campaign_id`)
    .eq("id", reportId)
    .maybeSingle();

  if (
    primary.error &&
    /column .* does not exist|schema cache/i.test(primary.error.message ?? "")
  ) {
    return client
      .from("reports")
      .select(REPORT_DETAIL_COLUMNS)
      .eq("id", reportId)
      .maybeSingle();
  }

  return primary;
}
