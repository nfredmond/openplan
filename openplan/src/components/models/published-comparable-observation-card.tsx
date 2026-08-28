import Link from "next/link";

import type { PublishedComparableObservationStudy } from "@/lib/models/published-comparable-observation-study";
import { StatusBadge } from "@/components/ui/status-badge";

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
        <Link className="underline underline-offset-2" href="/api/models/comparable-observation-study/study-result.json">Download exact study result</Link>
        <Link className="underline underline-offset-2" href="/api/models/comparable-observation-study/study-report.md">Download study report</Link>
      </div>
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-semibold">Observation, match, basis, assessment, and diagnosis downloads</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {geographyIds.map((geographyId) => (
            <div key={geographyId} className="min-w-0 rounded border border-border/70 p-3 text-xs">
              <p className="font-semibold">{geographyId}</p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-2">
                <Link className="underline" href={`/api/models/comparable-observation-study/${geographyId}/instrument/observation-package-v2.json`}>observations</Link>
                <Link className="underline" href={`/api/models/comparable-observation-study/${geographyId}/instrument/pre-volume-match-audit-v2.json`}>match audit</Link>
                {(["aequilibrae", "activitysim"] as const).flatMap((method) => [
                  <Link key={`${method}-input-bundle`} className="underline" href={`/api/models/comparable-observation-study/${geographyId}/${method}/validation-input-bundle-v2.json`}>{method} input bundle</Link>,
                  <Link key={`${method}-basis`} className="underline" href={`/api/models/comparable-observation-study/${geographyId}/${method}/comparison-basis-v2.json`}>{method} basis</Link>,
                  <Link key={`${method}-assessment`} className="underline" href={`/api/models/comparable-observation-study/${geographyId}/${method}/assessment-v2.json`}>{method} assessment</Link>,
                  <Link key={`${method}-diagnosis`} className="underline" href={`/api/models/comparable-observation-study/${geographyId}/${method}/structural-diagnosis-v2.json`}>{method} diagnosis</Link>,
                ])}
              </div>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
