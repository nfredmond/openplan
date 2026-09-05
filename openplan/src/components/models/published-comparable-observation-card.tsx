import type { PublishedComparableObservationStudy } from "@/lib/models/published-comparable-observation-study";
import { StatusBadge } from "@/components/ui/status-badge";

// Keep the exact file and its frozen custody together without routing an attachment as a page.
function ArtifactDownload({ href, label, filename, sha256 }: {
  href: string; label: string; filename: string; sha256: string | undefined;
}) {
  return <div className="min-w-0">
    <a download className="underline" href={href}>{label}</a>
    <p className="mt-1 break-all font-mono">{filename}</p>
    <p className="mt-1 break-all font-mono text-muted-foreground">{sha256 ? `SHA-256 ${sha256}` : "SHA-256 unavailable"}</p>
  </div>;
}

export function PublishedComparableObservationCard({
  study,
}: {
  study: PublishedComparableObservationStudy | null;
}) {
  if (!study) return null;
  const geographyIds = [...new Set(study.diagnoses.map((record) => record.geographyId))];
  const coverage = study.diagnoses[0]?.coverage ?? {};
  return (
    <section aria-label="Comparable observation instrument" className="module-section-surface mb-6" data-testid="published-comparable-observation-study">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="module-section-label">v{study.version} · repaired instrument</p>
          <h2 className="module-section-title">Comparable observations and whole-road matches</h2>
        </div>
        <StatusBadge tone="warning">{study.scientificOutcome}</StatusBadge>
      </div>
      <p className="module-section-description mt-3 max-w-[64rem]">
        The instrument now keeps stable sites, repeated measurement lineage, complete HPMS sections, and explicit direction aggregation. This is repaired evidence coverage, not improved model accuracy. The modeled quantity is synthetic expanded daily traffic, not AADT.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div><span className="font-semibold">Coverage</span><span className="mt-1 block text-muted-foreground">{geographyIds.length} counties · {study.diagnoses.length} separate method records</span></div>
        <div><span className="font-semibold">First published county</span><span className="mt-1 block text-muted-foreground">{Object.entries(coverage).map(([key, value]) => `${key} ${value}`).join(" · ") || "No readable coverage"}</span></div>
        <div><span className="font-semibold">Release SHA</span><span className="mt-1 block break-all font-mono text-xs text-muted-foreground">{study.releaseSha}</span></div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
        <a download className="underline underline-offset-2" href="/api/models/comparable-observation-study/study-result.json">Download exact study result</a>
        <a download className="underline underline-offset-2" href="/api/models/comparable-observation-study/study-report.md">Download study report</a>
      </div>
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-semibold">Observation, match, basis, assessment, and diagnosis downloads</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {geographyIds.map((geographyId) => {
            const records = study.diagnoses.filter((record) => record.geographyId === geographyId);
            const instrument = records[0];
            return (
            <div key={geographyId} className="min-w-0 rounded border border-border/70 p-3 text-xs">
              <p className="font-semibold">{geographyId}</p>
              <div className="mt-2 grid min-w-0 grid-cols-1 gap-4">
                <ArtifactDownload label="observations" filename="observation-package-v2.json" href={`/api/models/comparable-observation-study/${geographyId}/instrument/observation-package-v2.json`} sha256={instrument?.bindings.observation_package_sha256} />
                <ArtifactDownload label="match audit" filename="pre-volume-match-audit-v2.json" href={`/api/models/comparable-observation-study/${geographyId}/instrument/pre-volume-match-audit-v2.json`} sha256={instrument?.bindings.match_audit_sha256} />
                {records.flatMap((record) => [
                  ["input bundle", "validation-input-bundle-v2.json", record.bindings.input_bundle_sha256],
                  ["basis", "comparison-basis-v2.json", record.bindings.comparison_basis_sha256],
                  ["assessment", "assessment-v2.json", record.bindings.assessment_sha256],
                  ["diagnosis", "structural-diagnosis-v2.json", record.sha256],
                ].map(([label, filename, sha256]) => (
                  <ArtifactDownload key={`${record.method}-${filename}`} label={`${record.method} ${label}`} filename={`${geographyId}-${record.method}-${filename}`} href={`/api/models/comparable-observation-study/${geographyId}/${record.method}/${filename}`} sha256={sha256} />
                )))}
              </div>
            </div>
          ); })}
        </div>
      </details>
    </section>
  );
}
