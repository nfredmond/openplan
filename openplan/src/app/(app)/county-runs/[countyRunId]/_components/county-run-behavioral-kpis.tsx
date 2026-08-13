import Link from "next/link";
import { Gauge } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import type { BehavioralOnrampKpiSnapshot } from "@/lib/models/behavioral-onramp-kpis";
import { ScreeningGradeLink } from "@/components/ui/screening-grade-link";
import { describeScreeningGradeRefusal } from "@/lib/models/caveat-gate";

type CountyRunBehavioralKpisProps = {
  countyRunId: string;
  kpis: BehavioralOnrampKpiSnapshot[];
  isThisRunRejected: boolean;
  rejectedTotalCount: number;
  acceptingScreeningGrade: boolean;
  basePathname: string;
  error: string | null;
};

function formatKpiValue(value: number | null, unit: string): string {
  if (value === null || Number.isNaN(value)) return "—";
  if (unit === "ratio") return value.toFixed(4);
  return value.toLocaleString();
}

export function CountyRunBehavioralKpisSection({
  countyRunId,
  kpis,
  isThisRunRejected,
  rejectedTotalCount,
  acceptingScreeningGrade,
  basePathname,
  error,
}: CountyRunBehavioralKpisProps) {
  const forThisRun = kpis.filter((kpi) => kpi.county_run_id === countyRunId);
  const includeHref = `${basePathname}?includeScreening=1`;
  const defaultHref = basePathname;
  const refusalCopy = describeScreeningGradeRefusal(rejectedTotalCount);

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
            <Gauge className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">County run results</p>
            <h2 className="module-section-title">Travel measures for this county</h2>
            <p className="module-section-description">
              Trips, vehicle-miles, and mode shares for this county run. Results from a run that is
              still <ScreeningGradeLink /> are hidden until you ask for them, because the same rule
              governs what reports, grant narratives, and the assistant may use — so what you see
              here is what anyone downstream will see.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={acceptingScreeningGrade ? "warning" : "info"}>
            {acceptingScreeningGrade ? "Screening-grade included" : "Screening-grade hidden"}
          </StatusBadge>
        </div>
      </div>

      {error ? (
        <div className="mt-5 rounded-[0.75rem] border border-destructive/40 bg-destructive/10 px-5 py-4 text-sm text-destructive-foreground">
          These results could not be read, so this panel is not showing them — this is not a
          statement that the run produced none. {error}
        </div>
      ) : null}

      {!error && isThisRunRejected && !acceptingScreeningGrade ? (
        <div className="mt-5 rounded-[0.75rem] border border-amber-300/50 bg-gradient-to-br from-amber-50/90 to-amber-100/40 px-5 py-4 dark:border-amber-900/70 dark:from-amber-950/30 dark:to-amber-950/10">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-amber-900/80 dark:text-amber-100/80">
            Held back
          </p>
          {/*
            THE TIER IS THE CLAIM, not the absence of one. "Screening-grade" is a
            grade OpenPlan awards and defines — it says what these numbers may be
            used for. "Has not been validated yet" says only what has not
            happened, which is a weaker and different statement: it invites a
            planner to read the results as provisionally fine rather than as
            bounded. Say the tier, and link to the one place that explains it.
          */}
          <p className="mt-1 text-sm font-medium leading-relaxed text-foreground">
            This county run is at a <ScreeningGradeLink /> stage. Its results stay hidden until you
            say you have read what that stage lets you conclude.
          </p>
          {refusalCopy ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{refusalCopy}</p> : null}
          <div className="mt-3">
            <Link
              href={includeHref}
              prefetch={false}
              className="inline-flex items-center rounded-[0.4rem] border border-amber-400/60 bg-amber-50/70 px-3 py-1.5 text-xs font-medium text-amber-900 transition hover:bg-amber-100/80 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100"
            >
              Show them anyway
            </Link>
          </div>
        </div>
      ) : null}

      {!error && !isThisRunRejected && forThisRun.length === 0 ? (
        <div className="mt-5 rounded-[0.75rem] border border-dashed border-border/60 bg-background/60 px-5 py-4 text-sm text-muted-foreground">
          No results for this county run yet. They are written when the run&apos;s output file is brought
          into the workspace.
        </div>
      ) : null}

      {!error && forThisRun.length > 0 ? (
        <div className="mt-5 overflow-hidden rounded-[0.75rem] border border-border/70">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-4 py-2 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                  KPI
                </th>
                <th className="px-4 py-2 text-right text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                  Value
                </th>
                <th className="px-4 py-2 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                  Unit
                </th>
              </tr>
            </thead>
            <tbody>
              {forThisRun.map((kpi) => (
                <tr key={kpi.kpi_name} className="border-t border-border/60">
                  <td className="px-4 py-2 font-medium text-foreground">{kpi.kpi_label}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-foreground">
                    {formatKpiValue(kpi.value, kpi.unit)}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{kpi.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {acceptingScreeningGrade ? (
        <div className="mt-4 text-xs text-muted-foreground">
          Showing screening-grade results.{" "}
          <Link href={defaultHref} prefetch={false} className="underline underline-offset-2">
            Hide them again
          </Link>
          .
        </div>
      ) : null}
    </article>
  );
}
