import Link from "next/link";

import type { PublishedStructuralDiagnosisStudy } from "@/lib/models/published-structural-diagnosis";
import { StatusBadge } from "@/components/ui/status-badge";

export function PublishedStructuralDiagnosisCard({
  study,
}: {
  study: PublishedStructuralDiagnosisStudy | null;
}) {
  if (!study) {
    return (
      <section aria-label="Frozen structural diagnosis" className="module-section-surface mb-6">
        <h2 className="module-section-title">Frozen structural diagnosis unavailable</h2>
        <p className="module-section-description mt-2">
          The published study files could not be read. That is a release-file failure, not evidence that the model passed.
        </p>
      </section>
    );
  }

  const countyIds = [...new Set(study.records.map((record) => record.geographyId))];
  const missingCoordinates = Math.max(
    ...study.records.map((record) => record.findingCounts.missing_usable_point_coordinates ?? 0),
  );
  const zeroVolumeRecords = study.records.reduce(
    (total, record) => total + (record.findingCounts.frozen_matched_links_with_zero_assigned_volume ?? 0),
    0,
  );
  return (
    <section aria-label="Frozen structural diagnosis" className="module-section-surface mb-6" data-testid="published-structural-diagnosis">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="module-section-label">v{study.appVersion} · seven-county frozen study</p>
          <h2 className="module-section-title">Why all fourteen assessments are inconclusive</h2>
        </div>
        <StatusBadge tone="warning">{study.scientificOutcome}</StatusBadge>
      </div>
      <p className="module-section-description mt-3 max-w-[60rem]">
        This diagnosis preserves the v0.39 matches and both model methods. It does not calibrate a model, average methods,
        choose a winner, create an acceptance threshold, or open a holdout.
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>{countyIds.length} counties and {study.records.length} separate county/method records.</li>
        <li>Up to {missingCoordinates.toLocaleString()} observations in a county lack usable point coordinates.</li>
        <li>{zeroVolumeRecords.toLocaleString()} matched observation records across the separate method files retain zero assigned volume.</li>
        <li>Model year, day represented, coefficients, and population vintage remain unknown where the exact evidence does not prove them.</li>
      </ul>
      <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
        <Link className="underline underline-offset-2" href="/api/models/validation-structural-diagnosis/study-result.json">
          Download exact study result
        </Link>
        <Link className="underline underline-offset-2" href="/api/models/validation-structural-diagnosis/study-report.md">
          Download study report
        </Link>
      </div>
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-semibold">County and method diagnosis files</summary>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {study.records.map((record) => (
            <Link
              key={`${record.geographyId}-${record.method}`}
              className="min-w-0 rounded border border-border/70 px-3 py-2 text-xs hover:bg-muted/40"
              href={`/api/models/validation-structural-diagnosis/${record.geographyId}/${record.method}/structural-diagnosis.json`}
            >
              <span className="font-semibold">{record.geographyId} · {record.method}</span>
              <span className="mt-1 block break-all font-mono text-[10px] text-muted-foreground">{record.diagnosisSha256}</span>
            </Link>
          ))}
        </div>
      </details>
    </section>
  );
}
