import Link from "next/link";
import { Gauge } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import type { BehavioralOnrampKpiSnapshot } from "@/lib/models/behavioral-onramp-kpis";
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
            <p className="module-section-label">Behavioral onramp KPIs</p>
            <h2 className="module-section-title">County-run KPIs, gated by screening-grade consent</h2>
            <p className="module-section-description">
              KPIs below are loaded via <code>loadBehavioralOnrampKpisForWorkspace</code>. Screening-grade county runs are
              held back by default — pass screening-grade consent to include them. The banner reflects the same caveat
              gate used by the write path, so what you see here matches what downstream readers see.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={acceptingScreeningGrade ? "warning" : "info"}>
            {acceptingScreeningGrade ? "Including screening grade" : "Production grade only"}
          </StatusBadge>
        </div>
      </div>

      {error ? (
        <div className="mt-5 rounded-[0.75rem] border border-destructive/40 bg-destructive/10 px-5 py-4 text-sm text-destructive-foreground">
          KPI load failed: {error}
        </div>
      ) : null}

      {!error && isThisRunRejected && !acceptingScreeningGrade ? (
        <div className="mt-5 rounded-[0.75rem] border border-amber-300/50 bg-gradient-to-br from-amber-50/90 to-amber-100/40 px-5 py-4 dark:border-amber-900/70 dark:from-amber-950/30 dark:to-amber-950/10">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-amber-900/80 dark:text-amber-100/80">
            Screening-grade refusal
          </p>
          <p className="mt-1 text-sm font-medium leading-relaxed text-foreground">
            This county run is at a screening-grade stage. Its KPIs are held back until you explicitly accept the caveat.
          </p>
          {refusalCopy ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{refusalCopy}</p> : null}
          <div className="mt-3">
            <Link
              href={includeHref}
              prefetch={false}
              className="inline-flex items-center rounded-[0.4rem] border border-amber-400/60 bg-amber-50/70 px-3 py-1.5 text-xs font-medium text-amber-900 transition hover:bg-amber-100/80 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100"
            >
              Include screening-grade KPIs
            </Link>
          </div>
        </div>
      ) : null}

      {!error && !isThisRunRejected && forThisRun.length === 0 ? (
        <div className="mt-5 rounded-[0.75rem] border border-dashed border-border/60 bg-background/60 px-5 py-4 text-sm text-muted-foreground">
          No behavioral-onramp KPIs cached for this county run yet. KPIs are written on manifest ingest.
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
          Including screening-grade KPIs.{" "}
          <Link href={defaultHref} prefetch={false} className="underline underline-offset-2">
            Revert to production grade only
          </Link>
          .
        </div>
      ) : null}
    </article>
  );
}
