import {
  resolveDatasetDependentOutputContext,
  type DatasetDependentOutputContext,
} from "@/lib/data-sources/dataset-dependent-output-context";
import { resolveDatasetLineageReadiness } from "@/lib/data-sources/dataset-lineage-readiness";

export type ReportDataHubDatasetRow = {
  id: string;
  name: string;
  status: string;
  geography_scope: string;
  geometry_attachment: string;
  thematic_metric_key: string | null;
  citation_text: string | null;
  source_url: string | null;
  license_label: string | null;
  vintage_label: string | null;
  schema_version: string | null;
  checksum: string | null;
  row_count: number | null;
  last_refreshed_at: string | null;
};

export type ReportDataHubRefreshJobRow = {
  dataset_id: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
};

export type ReportDataHubProjectLinkRow = {
  dataset_id: string;
  project_id: string;
  relationship_type: string;
  linked_at: string;
};

function isOverlayReadyDataset(dataset: ReportDataHubDatasetRow): boolean {
  return (
    dataset.status === "ready" &&
    ["point", "route", "corridor", "tract", "county", "region", "statewide", "national"].includes(
      dataset.geography_scope
    )
  );
}

function isThematicReadyDataset(dataset: ReportDataHubDatasetRow): boolean {
  return (
    dataset.status === "ready" &&
    Boolean(dataset.thematic_metric_key) &&
    ((dataset.geography_scope === "tract" && dataset.geometry_attachment === "analysis_tracts") ||
      ((dataset.geography_scope === "corridor" || dataset.geography_scope === "route") &&
        dataset.geometry_attachment === "analysis_corridor") ||
      (dataset.geography_scope === "point" && dataset.geometry_attachment === "analysis_crash_points"))
  );
}

export function buildReportDatasetOutputContexts(input: {
  datasets: ReportDataHubDatasetRow[];
  links: ReportDataHubProjectLinkRow[];
  refreshJobs: ReportDataHubRefreshJobRow[];
}): DatasetDependentOutputContext[] {
  const latestRefreshJobByDataset = new Map<string, ReportDataHubRefreshJobRow>();
  for (const job of input.refreshJobs) {
    if (!job.dataset_id || latestRefreshJobByDataset.has(job.dataset_id)) continue;
    latestRefreshJobByDataset.set(job.dataset_id, job);
  }

  return input.datasets.map((dataset) => {
    const linkedProjectCount = input.links.filter(
      (link) => link.dataset_id === dataset.id
    ).length;
    const lineageReadiness = resolveDatasetLineageReadiness({
      citationText: dataset.citation_text,
      sourceUrl: dataset.source_url,
      licenseLabel: dataset.license_label,
      vintageLabel: dataset.vintage_label,
      schemaVersion: dataset.schema_version,
      checksum: dataset.checksum,
      rowCount: dataset.row_count,
      lastRefreshedAt: dataset.last_refreshed_at,
      geographyScope: dataset.geography_scope,
      geometryAttachment: dataset.geometry_attachment,
    });
    const latestRefreshJob = latestRefreshJobByDataset.get(dataset.id);

    return resolveDatasetDependentOutputContext({
      status: dataset.status,
      linkedProjectCount,
      lineageLevel: lineageReadiness.level,
      overlayReady: isOverlayReadyDataset(dataset),
      thematicReady: isThematicReadyDataset(dataset),
      latestRefreshStatus: latestRefreshJob?.status,
      latestRefreshAt:
        latestRefreshJob?.completed_at ||
        latestRefreshJob?.started_at ||
        latestRefreshJob?.created_at,
    });
  });
}
