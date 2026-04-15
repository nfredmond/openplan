import {
  describeComparisonSnapshotAggregate,
  getReportNavigationHref,
  getReportPacketFreshness,
  parseStoredComparisonSnapshotAggregate,
} from "@/lib/reports/catalog";

export type ProjectGrantModelingReportRow = {
  id: string;
  project_id: string;
  title: string;
  updated_at: string;
  generated_at: string | null;
  latest_artifact_kind: string | null;
};

export type ProjectGrantModelingArtifactRow = {
  report_id: string;
  generated_at: string;
  metadata_json: Record<string, unknown> | null;
};

type ProjectGrantComparisonDigest = NonNullable<
  ReturnType<typeof describeComparisonSnapshotAggregate>
>;

type ProjectGrantModelingLeadReport = {
  id: string;
  title: string;
  href: string;
  packetFreshness: ReturnType<typeof getReportPacketFreshness>;
  comparisonDigest: ProjectGrantComparisonDigest;
};

export type ProjectGrantModelingEvidence = {
  projectId: string;
  comparisonBackedCount: number;
  leadComparisonReport: ProjectGrantModelingLeadReport;
};

function getGrantSupportFreshnessPriority(label: string) {
  switch (label) {
    case "Packet current":
      return 0;
    case "Refresh recommended":
      return 1;
    case "No packet":
      return 2;
    default:
      return 3;
  }
}

export function buildProjectGrantModelingEvidenceByProjectId(
  reports: ProjectGrantModelingReportRow[] | null | undefined,
  artifacts: ProjectGrantModelingArtifactRow[] | null | undefined
) {
  const latestArtifactByReportId = new Map<string, ProjectGrantModelingArtifactRow>();
  for (const artifact of artifacts ?? []) {
    if (!latestArtifactByReportId.has(artifact.report_id)) {
      latestArtifactByReportId.set(artifact.report_id, artifact);
    }
  }

  const reportsByProjectId = new Map<
    string,
    Array<{
      id: string;
      title: string;
      updatedAt: string;
      packetFreshness: ReturnType<typeof getReportPacketFreshness>;
      comparisonDigest: ProjectGrantComparisonDigest | null;
    }>
  >();

  for (const report of reports ?? []) {
    const latestArtifact = latestArtifactByReportId.get(report.id) ?? null;
    const projectReports = reportsByProjectId.get(report.project_id) ?? [];
    projectReports.push({
      id: report.id,
      title: report.title,
      updatedAt: report.updated_at,
      packetFreshness: getReportPacketFreshness({
        latestArtifactKind: report.latest_artifact_kind,
        generatedAt: latestArtifact?.generated_at ?? report.generated_at,
        updatedAt: report.updated_at,
      }),
      comparisonDigest: describeComparisonSnapshotAggregate(
        parseStoredComparisonSnapshotAggregate(latestArtifact?.metadata_json ?? null)
      ),
    });
    reportsByProjectId.set(report.project_id, projectReports);
  }

  const evidenceByProjectId = new Map<string, ProjectGrantModelingEvidence>();

  for (const [projectId, projectReports] of reportsByProjectId.entries()) {
    const sortedReports = [...projectReports].sort((left, right) => {
      const freshnessPriority =
        getGrantSupportFreshnessPriority(left.packetFreshness.label) -
        getGrantSupportFreshnessPriority(right.packetFreshness.label);
      if (freshnessPriority !== 0) {
        return freshnessPriority;
      }

      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });

    const comparisonBackedReports = sortedReports.filter((report) => Boolean(report.comparisonDigest));
    const leadComparisonReport = comparisonBackedReports[0] ?? null;

    if (!leadComparisonReport?.comparisonDigest) {
      continue;
    }

    evidenceByProjectId.set(projectId, {
      projectId,
      comparisonBackedCount: comparisonBackedReports.length,
      leadComparisonReport: {
        id: leadComparisonReport.id,
        title: leadComparisonReport.title,
        href: getReportNavigationHref(
          leadComparisonReport.id,
          leadComparisonReport.packetFreshness.label
        ),
        packetFreshness: leadComparisonReport.packetFreshness,
        comparisonDigest: leadComparisonReport.comparisonDigest,
      },
    });
  }

  return evidenceByProjectId;
}
