import { StatusBadge } from "@/components/ui/status-badge";
import {
  formatGuidedComparisonValue,
  type GuidedComparisonResult,
} from "@/lib/models/guided-comparison-results";
import { titleizeScenarioValue } from "@/lib/scenarios/catalog";

export function GuidedComparisonResultsPanel({
  snapshotId,
  results,
  unreadable,
}: {
  snapshotId: string;
  results: readonly GuidedComparisonResult[];
  unreadable: boolean;
}) {
  if (unreadable) {
    return (
      <div className="module-note mt-4 border-amber-400/40 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/20">
        The four bound model results or their validation decisions could not be read for this render. The snapshot
        remains on file, but no values are shown as if they were complete.
      </div>
    );
  }

  if (results.length !== 2 || results.some((result) => result.metrics.length !== 2)) {
    return (
      <div className="module-note mt-4 border-amber-400/40 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/20">
        The exact comparison is missing a method, scenario, headline result, or same-unit pair. No substitution or
        cross-method average was calculated.
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4" data-testid={`guided-results-${snapshotId}`}>
      <p className="text-sm font-semibold tracking-tight">Four bound results, kept separate by method</p>
      {results.map((result) => (
        <section key={result.method} className="rounded-[0.5rem] border border-border/70 bg-background/75 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="font-semibold text-foreground">{result.methodLabel}</h4>
            <StatusBadge tone="warning">Screening evidence · no cross-method average</StatusBadge>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="pb-2 pr-4 font-medium">Result</th>
                  <th className="pb-2 pr-4 font-medium">No-build baseline</th>
                  <th className="pb-2 pr-4 font-medium">Build scenario</th>
                  <th className="pb-2 font-medium">Raw change</th>
                </tr>
              </thead>
              <tbody>
                {result.metrics.map((metric) => (
                  <tr key={metric.key} className="border-t border-border/60">
                    <th className="py-2 pr-4 font-medium text-foreground">{metric.label}</th>
                    <td className="py-2 pr-4 tabular-nums">
                      {formatGuidedComparisonValue(metric.baseline, metric.key)} {metric.unit}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">
                      {formatGuidedComparisonValue(metric.build, metric.key)} {metric.unit}
                    </td>
                    <td className="py-2 tabular-nums">
                      {metric.delta > 0 ? "+" : ""}
                      {formatGuidedComparisonValue(metric.delta, metric.key)} {metric.unit}
                      {metric.percentDelta === null
                        ? ""
                        : ` (${metric.percentDelta > 0 ? "+" : ""}${metric.percentDelta.toFixed(1)}%)`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {([
              ["No-build baseline", result.baseline],
              ["Build scenario", result.build],
            ] as const).map(([label, run]) => (
              <div key={label} className="rounded-[0.4rem] border border-border/60 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-foreground">{label} validation</p>
                  <StatusBadge tone={run.claimStatus === "validated" ? "success" : "warning"}>
                    {run.claimStatus ? titleizeScenarioValue(run.claimStatus) : "Unknown"}
                  </StatusBadge>
                </div>
                <p className="mt-2 text-muted-foreground">
                  {run.statusReason ?? "No track-matched validation decision was readable for this exact run."}
                </p>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
