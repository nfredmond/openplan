"use client";

import { Scale } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { CeqaVmtScreenBody } from "@/components/ceqa/ceqa-vmt-screen-body";
import type { CeqaVmtKpiRowLike } from "@/lib/models/ceqa-vmt-screen";

export type CountyRunCeqaVmtScreenProps = {
  countyRunId: string;
  runName: string | null;
  /** KPI rows already scoped to this county run. */
  kpis: CeqaVmtKpiRowLike[];
  /** True when the run's KPIs are held back by the screening-grade consent gate. */
  heldBackByScreeningGate: boolean;
  includeScreeningHref: string;
};

export function CountyRunCeqaVmtScreen({
  countyRunId,
  runName,
  kpis,
  heldBackByScreeningGate,
  includeScreeningHref,
}: CountyRunCeqaVmtScreenProps) {
  const scenarioId = runName ?? countyRunId;

  return (
    <article className="module-section-surface" data-testid="ceqa-vmt-screen">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
            <Scale className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">CEQA VMT screen</p>
            <h2 className="module-section-title">§15064.3 transportation-impact screening</h2>
            <p className="module-section-description">
              Compares this run&apos;s stored VMT-per-capita KPI against an operator-supplied reference
              baseline using the OPR percent-below screening threshold. Arithmetic only — no model is
              consulted, and nothing is estimated when the KPI set lacks VMT.
            </p>
          </div>
        </div>
        <StatusBadge tone="warning">Screening-level — not a determination of record</StatusBadge>
      </div>

      {heldBackByScreeningGate ? (
        <div className="mt-5 rounded-[0.75rem] border border-amber-300/50 bg-amber-50/60 px-5 py-4 text-sm text-foreground dark:border-amber-900/70 dark:bg-amber-950/20">
          This county run&apos;s KPIs are held back by the screening-grade consent gate, so the CEQA
          screen has no inputs to read.{" "}
          <a href={includeScreeningHref} className="underline underline-offset-2">
            Include screening-grade KPIs
          </a>{" "}
          to run the screen.
        </div>
      ) : (
        <CeqaVmtScreenBody scenarioId={scenarioId} kpis={kpis} />
      )}
    </article>
  );
}
