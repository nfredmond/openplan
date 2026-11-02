import type { AtpEvidenceRecords, AtpProjectRecord } from "@/lib/grants/atp-evidence-appendices";
import type { AtpPacketRun } from "@/lib/grants/atp-packet";
import { buildProjectEngagementEvidenceByProjectId } from "@/lib/grants/engagement-evidence";
import {
  buildSafetyCrashEvidenceMap,
  foldCrashEvidenceCounts,
  readSafetyCrashEvidenceIngest,
  SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION,
} from "@/lib/safety/crash-evidence";
import { BCA_VERSION_ROW, CAMPAIGN_ROW, EVIDENCE_IDS } from "./ss4a-evidence";
import { seedId } from "./safety-seed";

/**
 * A synthetic ATP evidence set for one linked project: a planning-level
 * estimate, a corridor analysis run whose safety score was computed and whose
 * equity score was withheld, a finished crash acquisition from a source that
 * separates serious injuries, a saved BCA version and one engagement campaign.
 * Names and counts are test values, not a real place.
 */
export const ATP_IDS = {
  workspace: EVIDENCE_IDS.workspace,
  project: EVIDENCE_IDS.project,
  opportunity: EVIDENCE_IDS.opportunity,
  run: seedId(700),
  ingest: seedId(701),
  costDocument: seedId(702),
};

export const ATP_GENERATED_AT = "2026-11-02T18:30:00.000Z";

export function atpProjectRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ATP_IDS.project,
    name: "Main Street sidewalk gap closure",
    summary: "Close the sidewalk gap on Main Street between two schools.",
    estimated_cost_amount: "2850000.00",
    estimated_cost_currency: "USD",
    estimated_cost_basis_year: 2026,
    estimated_cost_recorded_at: "2026-11-02T16:05:00+00:00",
    estimated_cost_source_document_id: null,
    ...overrides,
  };
}

export function atpProject(overrides: Partial<AtpProjectRecord> = {}): AtpProjectRecord {
  return {
    id: ATP_IDS.project,
    name: "Main Street sidewalk gap closure",
    summary: "Close the sidewalk gap on Main Street between two schools.",
    estimated_cost_amount: "2850000.00",
    estimated_cost_currency: "USD",
    estimated_cost_basis_year: 2026,
    estimated_cost_recorded_at: "2026-11-02T16:05:00+00:00",
    estimated_cost_source_document_id: null,
    ...overrides,
  };
}

export const EQUITY_WITHHELD = "Equity is withheld because required demographic inputs are unavailable.";

export function atpRunMetrics(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    safetyScore: 60,
    equityScore: 41,
    scorePresentation: {
      safety: { value: 60, eligible: true, withheldReason: null },
      equity: { value: null, eligible: false, withheldReason: EQUITY_WITHHELD },
    },
    dataQuality: { censusAvailable: false, crashDataAvailable: true, crashDataComplete: true },
    disadvantagedTracts: 0,
    lowIncomeTracts: 0,
    sourceSnapshots: {
      crashes: {
        label: "California Crash Reporting System (CCRS)",
        yearsQueried: [2022, 2023, 2024, 2025],
        fetchedAt: "2026-11-02T03:40:33.341Z",
      },
    },
    ...overrides,
  };
}

export function atpRun(overrides: Partial<AtpPacketRun> = {}): AtpPacketRun {
  return { id: ATP_IDS.run, title: "Main Street ATP screen", created_at: "2026-11-02T17:00:00+00:00", metrics: atpRunMetrics(), ...overrides };
}

export function atpIngestRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row: Record<string, unknown> = Object.fromEntries(SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION.split(", ").map((key) => [key, null]));
  return Object.assign(row, {
    id: ATP_IDS.ingest, project_id: ATP_IDS.project, status: "ready", source_id: "ccrs",
    source_label: "California Crash Reporting System (CCRS)", created_at: "2026-11-02T15:00:00+00:00",
    min_lon: -100.05, min_lat: 39.95, max_lon: -99.95, max_lat: 40.05,
    severity_completeness: "kabco_full", crash_count: 80, geocoded_count: 80, stored_count: 80, truncated: false,
    years_requested: [2022, 2023, 2024, 2025], party_completeness: "not_supported",
    dimension_coverage: { study_area: { basis: "place_boundary", boundarySource: "project_place", outsideBoundaryCount: 261, boundaryUnreadable: false, rectangleReportedCount: 341, rectangleMappableCount: 341, countsAreLowerBound: false } },
  }, overrides);
}

/** The grouped-count RPC's rows for the acquisition: 2 fatal, 12 serious, 63 other injury, 3 property damage. */
export function atpSeverityCountRows(ingestId: string = ATP_IDS.ingest) {
  return [
    { ingest_id: ingestId, dimension: "severity", value: "fatal", record_count: 2 },
    { ingest_id: ingestId, dimension: "severity", value: "severe_injury", record_count: 12 },
    { ingest_id: ingestId, dimension: "severity", value: "injury", record_count: 63 },
    { ingest_id: ingestId, dimension: "severity", value: "pdo", record_count: 3 },
  ];
}

export function atpCrashEvidence(rowOverrides: Record<string, unknown> = {}, countRows: ReturnType<typeof atpSeverityCountRows> | null = atpSeverityCountRows()) {
  const ingest = readSafetyCrashEvidenceIngest(atpIngestRow(rowOverrides))!;
  return buildSafetyCrashEvidenceMap([ingest], countRows === null ? null : foldCrashEvidenceCounts(countRows)).get(ingest.id)!;
}

/** Every record present: the shape the loader returns for a complete project. */
export function completeAtpRecords(): AtpEvidenceRecords {
  return {
    projectId: ATP_IDS.project,
    project: { status: "ready", project: atpProject() },
    run: { status: "ready", run: atpRun() },
    crash: { status: "ready", evidence: atpCrashEvidence(), retrievedAt: "2026-11-02T15:00:00+00:00" },
    bca: { status: "workbench", row: BCA_VERSION_ROW() },
    engagement: { status: "ready", evidence: buildProjectEngagementEvidenceByProjectId([CAMPAIGN_ROW]).get(ATP_IDS.project)!, truncated: false },
    generatedAt: ATP_GENERATED_AT,
    timeZone: "UTC",
  };
}
