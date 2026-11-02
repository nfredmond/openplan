import "server-only";
/**
 * REPORT-PACKET FRESHNESS, READ ONCE AND JUDGED BY THE PAGES' OWN RULES.
 *
 * The registry rule lives here because it reads the guided-comparison
 * binding, a server-only module; the Project page's rule and the shared
 * helpers live in `packet-freshness-rules.ts`, which explains how the two
 * rules differ.
 *
 * `loadReportPacketFreshness` is the reader for surfaces that do not already
 * hold the report rows (My Work). It reads each report with only its latest
 * artifact embedded, rather than every artifact ever generated, and pages both
 * of its reads, so a workspace past PostgREST's 1,000-row cap is read whole or
 * reported incomplete. The Reports and Project pages keep their own reads:
 * their tests replay those exact query chains, so moving the reads would mean
 * rewriting the tests that prove the move changed nothing.
 *
 * This module writes nothing.
 */

import { getReportPacketFreshness, type ReportJurisdictionState, type ReportPacketFreshness } from "./catalog";
import { readScopedGuidedComparisonBinding } from "./guided-comparison-binding";
import { reportJurisdictionState } from "./jurisdiction-freshness";
import { PACKET_FRESHNESS_LABELS } from "./packet-labels";
import {
  classifyPacketFreshness,
  evaluateProjectOverviewPacketFreshness,
  latestSafetyAtByProject,
  type PacketArtifact,
  type PacketFreshnessRule,
  type PacketFreshnessStanding,
  type RtpBasisStaleFlag,
} from "./packet-freshness-rules";
import {
  artifactGenerationWritebackIsCurrent,
  artifactSafetyEvidenceReadFailed,
  buildReportRegistryDriftSummary,
  resolveTrackedReportSourceUpdatedAt,
} from "./report-registry-freshness";
import type { ReportDriftSummary } from "./source-review-posture";
import type { ProjectJurisdictionRow } from "@/lib/projects/project-jurisdiction";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import { readEveryPageAsResult } from "@/lib/supabase/paged-read";

/** The report columns the registry rule reads. */
export type RegistryFreshnessReport = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  report_type: string;
  rtp_cycle_id?: string | null;
  engagement_campaign_id?: string | null;
  latest_artifact_kind: string | null;
  generated_at: string | null;
  updated_at: string;
  metadata_json?: Record<string, unknown> | null;
};

export type RegistryPacketFreshnessEvaluation = {
  packetGeneratedAt: string | null;
  safetyUpdatedAt: string | null;
  jurisdictionState: ReportJurisdictionState;
  generationWritebackCurrent: boolean | undefined;
  /** Freshness before the guided comparison is applied; the drift summary reads this one. */
  trackedPacketFreshness: ReportPacketFreshness;
  /** What the registry shows. */
  packetFreshness: ReportPacketFreshness;
  guidedComparison: { liveEvidenceStatus?: "unassessed"; problem: string | null } | undefined;
  sourceReviewDriftSummary: ReportDriftSummary;
};

/**
 * The Reports registry's rule, moved here unchanged from `reports/page.tsx`.
 */
export function evaluateRegistryPacketFreshness(input: {
  report: RegistryFreshnessReport;
  latestArtifact: PacketArtifact | null;
  rtpCycleUpdatedAt: string | null;
  /** The report's project as read from this workspace, or undefined when absent. */
  project: ProjectJurisdictionRow | undefined;
  artifactsReadFailed: boolean;
  latestSafetyAtByProjectId: ReadonlyMap<string, string>;
  safetyReadFailed: boolean;
}): RegistryPacketFreshnessEvaluation {
  const { report, latestArtifact } = input;
  const packetGeneratedAt = latestArtifact?.generated_at ?? report.generated_at;
  const safetyUpdatedAt = report.project_id
    ? input.latestSafetyAtByProjectId.get(report.project_id) ?? null
    : null;
  const jurisdictionState: ReportJurisdictionState = input.artifactsReadFailed
    ? "unavailable"
    : reportJurisdictionState(latestArtifact?.metadata_json, input.project);
  const generationWritebackCurrent = artifactGenerationWritebackIsCurrent(latestArtifact?.metadata_json, report.updated_at);
  const computedPacketFreshness = getReportPacketFreshness({
    latestArtifactKind: report.latest_artifact_kind,
    jurisdictionState,
    generationWritebackCurrent,
    generatedAt: packetGeneratedAt,
    updatedAt: resolveTrackedReportSourceUpdatedAt({
      generatedAt: packetGeneratedAt,
      reportUpdatedAt: report.updated_at,
      cycleUpdatedAt: input.rtpCycleUpdatedAt,
      artifactMetadata: latestArtifact?.metadata_json ?? null,
      safetyUpdatedAt,
    }),
  });
  const packetSafetyEvidenceReadFailed = artifactSafetyEvidenceReadFailed(latestArtifact?.metadata_json);
  let guidedComparison: { liveEvidenceStatus?: "unassessed"; problem: string | null } | undefined;
  let guidedSelectionChanged = false;
  try {
    const scope = { ...report, metadata_json: report.metadata_json ?? null };
    const projectScope = report.project_id ? { id: report.project_id, workspace_id: report.workspace_id } : null;
    const saved = readScopedGuidedComparisonBinding({ reportId: report.id, report: scope, project: projectScope });
    const retained = readScopedGuidedComparisonBinding({ reportId: report.id,
      report: { ...scope, metadata_json: latestArtifact?.metadata_json ?? null }, project: projectScope });
    guidedSelectionChanged = Boolean(packetGeneratedAt && saved?.bindingSha256 !== retained?.bindingSha256);
    if (saved || retained) guidedComparison = { liveEvidenceStatus: "unassessed" as const, problem: null };
  } catch (error) {
    guidedComparison = { problem: error instanceof Error ? error.message : "The saved comparison binding cannot be checked." };
  }
  const safetyReadLimitation = packetSafetyEvidenceReadFailed
    ? "This packet recorded a failed project crash-evidence read. Review the unavailable evidence; that failure does not establish a source change."
    : input.safetyReadFailed && report.project_id
      ? "Project-linked crash evidence could not be checked. This is an unassessed source, not an observed change."
      : null;
  const trackedPacketFreshness: ReportPacketFreshness = safetyReadLimitation && computedPacketFreshness.label !== PACKET_FRESHNESS_LABELS.NO_PACKET
    ? { ...computedPacketFreshness,
        label: computedPacketFreshness.label === PACKET_FRESHNESS_LABELS.CURRENT ? "Source evidence unassessed" : computedPacketFreshness.label,
        tone: "warning" as const,
        detail: `${computedPacketFreshness.label === PACKET_FRESHNESS_LABELS.CURRENT ? "" : `${computedPacketFreshness.detail} `}${safetyReadLimitation}` }
    : computedPacketFreshness;
  const packetFreshness: ReportPacketFreshness = (trackedPacketFreshness.label === PACKET_FRESHNESS_LABELS.CURRENT || trackedPacketFreshness.label === "Source evidence unassessed") && guidedComparison
    ? guidedComparison.problem || guidedSelectionChanged
      ? { label: PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED, tone: "warning" as const,
          detail: guidedComparison.problem ?? "The saved guided comparison differs from the retained artifact." }
      : { label: "Comparison evidence unassessed", tone: "warning" as const,
          detail: "The saved comparison binding is checked. Live files and their source history remain unassessed; save and generation check them again." }
    : trackedPacketFreshness;
  const sourceReviewDriftSummary = buildReportRegistryDriftSummary({
    packetFreshnessLabel: trackedPacketFreshness.label,
    generatedAt: packetGeneratedAt,
    reportUpdatedAt: report.updated_at,
    rtpCycleUpdatedAt: input.rtpCycleUpdatedAt,
    safetyUpdatedAt,
    safetyEvidenceReadFailed: packetSafetyEvidenceReadFailed,
    jurisdictionState,
    generationWritebackCurrent,
    unassessedLabels: input.safetyReadFailed && report.project_id ? ["Live crash evidence unavailable"] : [],
  });
  if (guidedSelectionChanged) {
    sourceReviewDriftSummary.labels.push("Selected guided comparison");
    sourceReviewDriftSummary.changedCount = sourceReviewDriftSummary.labels.length;
    sourceReviewDriftSummary.totalCount = sourceReviewDriftSummary.labels.length;
  }
  return {
    packetGeneratedAt,
    safetyUpdatedAt,
    jurisdictionState,
    generationWritebackCurrent,
    trackedPacketFreshness,
    packetFreshness,
    guidedComparison,
    sourceReviewDriftSummary,
  };
}

// ── The reader ──────────────────────────────────────────────────────────────

/**
 * One row per report, its latest artifact embedded. The `!report_id` hint names
 * the foreign key, so the embed stays unambiguous whatever join tables later
 * reference both tables.
 */
export const PACKET_FRESHNESS_REPORT_SELECT =
  "id, workspace_id, project_id, rtp_cycle_id, engagement_campaign_id, title, report_type, status, generated_at, latest_artifact_kind, updated_at, metadata_json, rtp_basis_stale, rtp_basis_stale_reason, rtp_basis_stale_marked_at, rtp_cycles(updated_at), projects(id, workspace_id, name, updated_at, jurisdiction_context, place_label, place_country_code, place_subdivision_code), report_artifacts!report_id(generated_at, metadata_json)";

/** Every acquisition's time; the latest per project is taken in code, as the registry does. */
export const PACKET_FRESHNESS_SAFETY_SELECT = "id, project_id, created_at";

/** Artifact metadata can be large, so report pages are small. */
const REPORT_PAGE_SIZE = 100;

type ReadError = { message: string; code?: string | null };
type PageResult = { data: unknown[] | null; error: ReadError | null };
type FreshnessQuery = PromiseLike<PageResult> & {
  eq(column: string, value: string): FreshnessQuery;
  not(column: string, operator: string, value: unknown): FreshnessQuery;
  order(column: string, options: { ascending: boolean; referencedTable?: string }): FreshnessQuery;
  limit(count: number, options?: { referencedTable?: string }): FreshnessQuery;
  range(from: number, toInclusive: number): FreshnessQuery;
};
type PacketFreshnessClient = { from(table: string): { select(columns: string): FreshnessQuery } };

export type ReportPacketFreshnessEntry = {
  reportId: string;
  title: string;
  status: string | null;
  projectId: string | null;
  projectName: string | null;
  updatedAt: string;
  freshness: ReportPacketFreshness;
  basisStale: RtpBasisStaleFlag | null;
  standing: PacketFreshnessStanding;
};

type PacketFreshnessReadFailure = { label: string; message: string; pending: boolean };

export type ReportPacketFreshnessLoad = {
  rule: PacketFreshnessRule;
  entries: ReportPacketFreshnessEntry[];
  /** Each read that failed or was cut short, named. An entry list beside a failure is partial. */
  failures: PacketFreshnessReadFailure[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return asRecord(value[0]);
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function failure(label: string, error: ReadError): PacketFreshnessReadFailure {
  return { label, message: error.message, pending: looksLikePendingSchema(error.message) };
}

async function readPaged(
  label: string,
  build: (from: number, toInclusive: number) => PromiseLike<PageResult>,
  pageSize?: number,
): Promise<{ rows: Array<Record<string, unknown>>; failure: PacketFreshnessReadFailure | null }> {
  try {
    const result = await readEveryPageAsResult<unknown, ReadError>(build, `The ${label} read stopped before its last page.`, { pageSize });
    if (result.error) return { rows: [], failure: failure(label, result.error) };
    return { rows: (result.data ?? []) as Array<Record<string, unknown>>, failure: null };
  } catch (error) {
    return { rows: [], failure: failure(label, { message: error instanceof Error ? error.message : "read threw" }) };
  }
}

/**
 * Read every report in a workspace (or one project) and judge each packet by
 * one page's rule. Reads: the reports with their latest artifact, RTP cycle
 * and project embedded; under the registry rule, also the workspace's crash
 * acquisitions. Both reads are paged to completion.
 */
export async function loadReportPacketFreshness(
  supabase: unknown,
  options: { workspaceId: string; projectId?: string | null; rule?: PacketFreshnessRule }
): Promise<ReportPacketFreshnessLoad> {
  const client = supabase as PacketFreshnessClient;
  const rule = options.rule ?? "registry";
  const projectId = options.projectId ?? null;

  const [reportsRead, safetyRead] = await Promise.all([
    readPaged("report packets", (from, to) => {
      let query = client.from("reports").select(PACKET_FRESHNESS_REPORT_SELECT).eq("workspace_id", options.workspaceId);
      if (projectId) query = query.eq("project_id", projectId);
      return query
        .order("generated_at", { ascending: false, referencedTable: "report_artifacts" })
        .order("id", { ascending: false, referencedTable: "report_artifacts" })
        .limit(1, { referencedTable: "report_artifacts" })
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to);
    }, REPORT_PAGE_SIZE),
    rule === "registry"
      ? readPaged("project crash evidence used for packet freshness", (from, to) => {
          let query = client.from("safety_crash_ingests").select(PACKET_FRESHNESS_SAFETY_SELECT).eq("workspace_id", options.workspaceId);
          query = projectId ? query.eq("project_id", projectId) : query.not("project_id", "is", null);
          return query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
        })
      : Promise.resolve({ rows: [], failure: null }),
  ]);

  const failures = [reportsRead.failure, safetyRead.failure].filter(
    (entry): entry is PacketFreshnessReadFailure => entry !== null
  );
  const safetyByProject = latestSafetyAtByProject(
    safetyRead.rows as Array<{ project_id: string | null; created_at: string }>
  );

  const entries = reportsRead.rows.map((row): ReportPacketFreshnessEntry => {
    const report = row as unknown as RegistryFreshnessReport & { title: string | null; status: string | null };
    const artifactRow = asRecord(row.report_artifacts);
    const latestArtifact: PacketArtifact | null = artifactRow && typeof artifactRow.generated_at === "string"
      ? { generated_at: artifactRow.generated_at, metadata_json: asRecord(artifactRow.metadata_json) }
      : null;
    const projectRow = asRecord(row.projects);
    // The registry looks the project up among this workspace's projects.
    const project = projectRow && projectRow.workspace_id === report.workspace_id && projectRow.id === report.project_id
      ? (projectRow as ProjectJurisdictionRow)
      : undefined;
    const freshness = rule === "registry"
      ? evaluateRegistryPacketFreshness({
          report,
          latestArtifact,
          rtpCycleUpdatedAt: asText(asRecord(row.rtp_cycles)?.updated_at),
          project,
          // The artifact arrives with its report, so it cannot fail on its own.
          artifactsReadFailed: false,
          latestSafetyAtByProjectId: safetyByProject,
          safetyReadFailed: safetyRead.failure !== null,
        }).packetFreshness
      : evaluateProjectOverviewPacketFreshness({
          // The Project page reads no report metadata_json.
          report: { latest_artifact_kind: report.latest_artifact_kind, generated_at: report.generated_at, updated_at: report.updated_at },
          latestArtifact: latestArtifact ?? undefined,
          project,
        });
    const basisStale: RtpBasisStaleFlag | null = row.rtp_basis_stale === true
      ? { reason: asText(row.rtp_basis_stale_reason), markedAt: asText(row.rtp_basis_stale_marked_at) }
      : null;
    return {
      reportId: report.id,
      title: report.title ?? "(untitled report)",
      status: report.status,
      projectId: report.project_id,
      projectName: asText(projectRow?.name),
      updatedAt: report.updated_at,
      freshness,
      basisStale,
      standing: classifyPacketFreshness(freshness, basisStale),
    };
  });

  return { rule, entries, failures };
}
