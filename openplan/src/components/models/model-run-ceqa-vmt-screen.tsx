"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { CeqaVmtScreenBody } from "@/components/ceqa/ceqa-vmt-screen-body";
import type { CeqaVmtKpiRowLike } from "@/lib/models/ceqa-vmt-screen";

/**
 * CEQA §15064.3 screen for a succeeded model run. The AequilibraE worker
 * stores `daily_vmt` / `vmt_per_capita` / `population_total` KPIs in the
 * directly-readable `general` category (no consent gate — the behavioral
 * consent gate applies only to county-run behavioral_onramp KPIs), so this
 * panel lazily fetches the run's KPI rows and feeds the shared screen body.
 */
type ModelRunCeqaVmtScreenProps = {
  modelId: string;
  modelRunId: string;
  runTitle: string;
};

export function ModelRunCeqaVmtScreen({ modelId, modelRunId, runTitle }: ModelRunCeqaVmtScreenProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kpis, setKpis] = useState<CeqaVmtKpiRowLike[] | null>(null);

  async function handleToggle() {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (!nextOpen || kpis !== null || isLoading) return;

    setError(null);
    setIsLoading(true);
    try {
      const response = await fetch(`/api/models/${modelId}/runs/${modelRunId}/kpis`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        kpis?: Array<Record<string, unknown>>;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load run KPIs");
      }
      setKpis(
        (payload.kpis ?? []).map((row) => ({
          kpi_name: String(row.kpi_name ?? ""),
          kpi_label: typeof row.kpi_label === "string" ? row.kpi_label : null,
          value: typeof row.value === "number" ? row.value : null,
          unit: typeof row.unit === "string" ? row.unit : null,
          geometry_ref: typeof row.geometry_ref === "string" ? row.geometry_ref : null,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load run KPIs");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <article className="module-section-surface" data-testid="model-run-ceqa-vmt-screen">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
            <Scale className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">CEQA VMT screen</p>
            <h2 className="module-section-title">§15064.3 transportation-impact screening</h2>
            <p className="module-section-description">
              Screens this run&apos;s stored VMT KPIs — derived from assignment link volumes
              (Σ volume × length), screening-grade, not measured — against an operator-supplied
              reference baseline using the OPR percent-below threshold. Arithmetic only; nothing is
              estimated when the KPI set lacks VMT.
            </p>
          </div>
        </div>
        <StatusBadge tone="warning">Screening-level — not a determination of record</StatusBadge>
      </div>

      <div className="mt-4">
        <Button type="button" variant="outline" size="sm" onClick={handleToggle}>
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {isOpen ? "Hide CEQA screen" : "Run CEQA screen"}
        </Button>
      </div>

      {isOpen ? (
        isLoading ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading stored KPIs…
          </p>
        ) : error ? (
          <p className="mt-4 text-sm text-destructive">{error}</p>
        ) : kpis !== null ? (
          <CeqaVmtScreenBody scenarioId={runTitle} kpis={kpis} />
        ) : null
      ) : null}
    </article>
  );
}
