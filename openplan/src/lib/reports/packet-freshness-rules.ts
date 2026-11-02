/**
 * REPORT-PACKET FRESHNESS RULES THAT NEED NO SERVER-ONLY MODULE.
 *
 * Two pages judge whether a generated packet still matches its sources, and
 * they do not use the same rule:
 *
 * - The Reports registry (`registry`, in `packet-freshness-loader.ts`)
 *   compares the latest artifact with the report's tracked sources (RTP cycle,
 *   project, funding snapshot, the project's latest crash acquisition), the
 *   generation writeback receipt, the jurisdiction fingerprint and the saved
 *   guided-comparison binding. A failed artifact or crash read makes the
 *   packet unassessed, never current.
 * - The Project page (`project_overview`, here) compares only the report's own
 *   revision, the writeback receipt and the jurisdiction fingerprint. It
 *   ignores the RTP cycle and crash acquisitions, and it skips the guided
 *   comparison because the page selects no report `metadata_json`. A legacy
 *   artifact without a writeback receipt is compared with the report's
 *   `updated_at` directly, with no grace period.
 *
 * Both rules moved out of their pages unchanged, and the pages' existing
 * tests prove their output did not move. The difference is recorded, not
 * resolved: choosing one would change what one page shows.
 *
 * The registry rule reads the guided-comparison binding, which is a
 * server-only module. This file stays importable without it so the Project
 * page keeps its import graph.
 */

import type { ReportPacketFreshness } from "./catalog";
import { reportJurisdictionState } from "./jurisdiction-freshness";
import { PACKET_FRESHNESS_LABELS } from "./packet-labels";
import { resolveReportPacketRowFreshness } from "./report-registry-freshness";
import type { ProjectJurisdictionRow } from "@/lib/projects/project-jurisdiction";

export type PacketFreshnessRule = "registry" | "project_overview";

export type PacketArtifact = {
  generated_at: string;
  metadata_json: Record<string, unknown> | null;
};

/** Newest-first artifact rows, reduced to the latest artifact per report. */
export function latestArtifactByReport<Row extends { report_id: string }>(rows: readonly Row[]): Map<string, Row> {
  const latest = new Map<string, Row>();
  for (const row of rows) {
    if (!latest.has(row.report_id)) latest.set(row.report_id, row);
  }
  return latest;
}

/** Newest-first crash acquisition rows, reduced to the latest acquisition time per project. */
export function latestSafetyAtByProject(
  rows: ReadonlyArray<{ project_id: string | null; created_at: string }>
): Map<string, string> {
  const latest = new Map<string, string>();
  for (const row of rows) {
    if (row.project_id && !latest.has(row.project_id)) latest.set(row.project_id, row.created_at);
  }
  return latest;
}

/** The Project page's rule, moved here unchanged from `projects/[projectId]/page.tsx`. */
export function evaluateProjectOverviewPacketFreshness(input: {
  report: { latest_artifact_kind: string | null; generated_at: string | null; updated_at: string; metadata_json?: Record<string, unknown> | null };
  latestArtifact: PacketArtifact | undefined;
  project: ProjectJurisdictionRow | null | undefined;
}): ReportPacketFreshness {
  return resolveReportPacketRowFreshness(input.report, input.latestArtifact,
    reportJurisdictionState(input.latestArtifact?.metadata_json, input.project));
}

/** What a packet's freshness means for work: one of four answers, never a blank. */
export type PacketFreshnessStanding =
  | { state: "no_packet" }
  | { state: "current" }
  | { state: "stale"; reasons: string[] }
  | { state: "unassessed"; reasons: string[] };

/** The flag a successful upstream model run sets on a packet (20260416000049). */
export type RtpBasisStaleFlag = { reason: string | null; markedAt: string | null };

/** The sentence the RTP report page shows when the flag carries no reason. */
const RTP_BASIS_STALE_FALLBACK_REASON =
  "An upstream model run succeeded after this packet was last generated.";

/**
 * Classify a rule's label. "Refresh recommended" is stale and the unassessed
 * labels stay unassessed. Neither page reads `rtp_basis_stale` into its label
 * (the report page shows it on its own), so the flag is added here as a
 * separate reason and changes neither page.
 */
export function classifyPacketFreshness(
  freshness: ReportPacketFreshness,
  basisStale: RtpBasisStaleFlag | null
): PacketFreshnessStanding {
  if (freshness.label === PACKET_FRESHNESS_LABELS.NO_PACKET) return { state: "no_packet" };
  const basisReason = basisStale ? basisStale.reason?.trim() || RTP_BASIS_STALE_FALLBACK_REASON : null;
  if (freshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED) {
    return { state: "stale", reasons: [freshness.detail, ...(basisReason ? [basisReason] : [])] };
  }
  if (basisReason) return { state: "stale", reasons: [basisReason] };
  if (freshness.label === PACKET_FRESHNESS_LABELS.CURRENT) return { state: "current" };
  return { state: "unassessed", reasons: [freshness.detail] };
}
