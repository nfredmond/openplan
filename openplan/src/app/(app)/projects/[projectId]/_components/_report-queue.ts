import {
  getReportNavigationHref,
  getReportPacketFreshness,
  describeComparisonSnapshotAggregate,
  describeEvidenceChainSummary,
} from "@/lib/reports/catalog";
import { PACKET_FRESHNESS_LABELS } from "@/lib/reports/packet-labels";

/**
 * The project control room's report-packet queue, shaped for the shared
 * command-queue component.
 *
 * Extracted from the page (which sits at the max-lines cap) — pure
 * presentation shaping, no I/O. Same reasoning as `_timeline.ts`.
 */

type QueueReport = {
  id: string;
  title: string;
  packetFreshness: ReturnType<typeof getReportPacketFreshness>;
  comparisonDigest: ReturnType<typeof describeComparisonSnapshotAggregate>;
  evidenceChainDigest: ReturnType<typeof describeEvidenceChainSummary>;
};

export type ProjectReportQueueItem = {
  key: string;
  href: string;
  title: string;
  subtitle: string;
  detail: string;
  badges: Array<{ label: string; value?: string | number | null }>;
};

/** How many packets the queue offers before it stops being a queue. */
const QUEUE_WINDOW = 4;

function firstAction(report: QueueReport): string {
  if (report.packetFreshness.label === PACKET_FRESHNESS_LABELS.REFRESH_RECOMMENDED) {
    return `First action: refresh ${report.title}`;
  }
  if (report.packetFreshness.label === PACKET_FRESHNESS_LABELS.NO_PACKET) {
    return `First action: generate ${report.title}`;
  }
  if (report.evidenceChainDigest?.blockedGateDetail) {
    return `First action: review governance hold in ${report.title}`;
  }
  if (report.comparisonDigest) {
    return `First action: review comparison-backed packet ${report.title}`;
  }
  return `First action: review ${report.title}`;
}

export function buildProjectReportQueueItems(
  reports: QueueReport[]
): ProjectReportQueueItem[] {
  return reports.slice(0, QUEUE_WINDOW).map((report) => {
    const badges: ProjectReportQueueItem["badges"] = [];
    if (report.packetFreshness.label !== PACKET_FRESHNESS_LABELS.CURRENT) {
      badges.push({ label: report.packetFreshness.label });
    }
    if (report.comparisonDigest) {
      badges.push({ label: "Comparison-backed" });
    }
    if (report.evidenceChainDigest?.blockedGateDetail) {
      badges.push({ label: "Governance hold" });
    }

    return {
      key: report.id,
      href: getReportNavigationHref(report.id, report.packetFreshness.label),
      title: report.title,
      subtitle: firstAction(report),
      detail:
        report.evidenceChainDigest?.blockedGateDetail ??
        report.comparisonDigest?.detail ??
        report.packetFreshness.detail,
      badges,
    };
  });
}
