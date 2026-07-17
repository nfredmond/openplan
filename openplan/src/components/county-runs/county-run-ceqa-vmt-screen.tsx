"use client";

import { useMemo, useState } from "react";
import { Download, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  CEQA_PROJECT_TYPES,
  CEQA_REFERENCE_LABELS,
  DEFAULT_REFERENCE_VMT_PER_CAPITA,
  OPR_DEFAULT_THRESHOLD_PCT,
  computeCeqaVmt,
} from "@/lib/planner-pack/ceqa";
import { renderCeqaVmtMarkdown } from "@/lib/planner-pack/render";
import type { CeqaProjectType, CeqaReferenceLabel, CeqaVmtResult } from "@/lib/planner-pack/types";
import {
  CEQA_DAILY_VMT_KPI_NAMES,
  CEQA_MEMO_ENGINE_VERSION,
  CEQA_POPULATION_KPI_NAMES,
  CEQA_SCREENING_CAVEAT,
  CEQA_STATUTORY_CITATION,
  CEQA_VMT_PER_CAPITA_KPI_NAMES,
  buildCeqaScreeningRow,
  deriveCeqaVmtScreeningInputs,
  type CeqaVmtKpiRowLike,
} from "@/lib/models/ceqa-vmt-screen";

export type CountyRunCeqaVmtScreenProps = {
  countyRunId: string;
  runName: string | null;
  /** KPI rows already scoped to this county run. */
  kpis: CeqaVmtKpiRowLike[];
  /** True when the run's KPIs are held back by the screening-grade consent gate. */
  heldBackByScreeningGate: boolean;
  includeScreeningHref: string;
};

function formatNumber(value: number, digits = 1): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

export function CountyRunCeqaVmtScreen({
  countyRunId,
  runName,
  kpis,
  heldBackByScreeningGate,
  includeScreeningHref,
}: CountyRunCeqaVmtScreenProps) {
  const [referenceInput, setReferenceInput] = useState(String(DEFAULT_REFERENCE_VMT_PER_CAPITA));
  const [thresholdPctInput, setThresholdPctInput] = useState(
    String(OPR_DEFAULT_THRESHOLD_PCT * 100)
  );
  const [projectType, setProjectType] = useState<CeqaProjectType>("residential");
  const [referenceLabel, setReferenceLabel] = useState<CeqaReferenceLabel>("regional");

  const screeningInputs = useMemo(() => deriveCeqaVmtScreeningInputs(kpis), [kpis]);

  const referenceVmtPerCapita = Number(referenceInput);
  const thresholdPct = Number(thresholdPctInput) / 100;
  const inputsValid =
    Number.isFinite(referenceVmtPerCapita) &&
    referenceVmtPerCapita > 0 &&
    Number.isFinite(thresholdPct) &&
    thresholdPct > 0 &&
    thresholdPct < 1;

  const scenarioId = runName ?? countyRunId;

  const result: CeqaVmtResult | null = useMemo(() => {
    if (!inputsValid) return null;
    if (
      screeningInputs.status !== "per-capita" &&
      screeningInputs.status !== "total-with-population"
    ) {
      return null;
    }
    try {
      return computeCeqaVmt([buildCeqaScreeningRow(screeningInputs, scenarioId)], {
        referenceVmtPerCapita,
        projectType,
        referenceLabel,
        thresholdPct,
      });
    } catch {
      return null;
    }
  }, [inputsValid, screeningInputs, scenarioId, referenceVmtPerCapita, projectType, referenceLabel, thresholdPct]);

  const scenario = result?.scenarios[0] ?? null;

  function handleDownloadMemo() {
    if (!result) return;
    const markdown = renderCeqaVmtMarkdown(result, {
      runId: scenarioId,
      engineVersion: CEQA_MEMO_ENGINE_VERSION,
    });
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ceqa-vmt-screen-${scenarioId}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

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
      ) : screeningInputs.status === "no-vmt-kpi" || screeningInputs.status === "missing-population" ? (
        <div
          className="mt-5 rounded-[0.75rem] border border-dashed border-border/60 bg-background/60 px-5 py-4 text-sm text-muted-foreground"
          data-testid="ceqa-vmt-empty-state"
        >
          {screeningInputs.status === "missing-population" ? (
            <p>
              This run stores a total daily VMT KPI (<code>{screeningInputs.vmtKpiName}</code>) but no
              population KPI ({Array.from(CEQA_POPULATION_KPI_NAMES).join(", ")}), so per-capita VMT
              cannot be computed. OpenPlan will not estimate it.
            </p>
          ) : (
            <>
              <p>
                No VMT-family KPI is stored for this run, so the CEQA §15064.3 screen cannot run. The
                screen reads a per-capita VMT KPI ({Array.from(CEQA_VMT_PER_CAPITA_KPI_NAMES).join(", ")})
                or a total daily VMT KPI ({Array.from(CEQA_DAILY_VMT_KPI_NAMES).join(", ")}) paired with a
                population KPI. OpenPlan never estimates VMT from trips or any other proxy.
              </p>
              {screeningInputs.availableKpiNames.length > 0 ? (
                <p className="mt-2">
                  KPIs stored for this run: {screeningInputs.availableKpiNames.join(", ")}.
                </p>
              ) : (
                <p className="mt-2">No KPIs are stored for this run yet.</p>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="rounded-[0.75rem] border border-border/70 bg-background/60 px-5 py-4 text-sm">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              KPI inputs (stored)
            </p>
            {screeningInputs.status === "per-capita" ? (
              <p className="mt-1 text-foreground">
                Per-capita daily VMT from <code>{screeningInputs.vmtKpiName}</code>:{" "}
                <span className="font-medium tabular-nums">{formatNumber(screeningInputs.vmtPerCapita, 3)}</span>{" "}
                VMT/capita.
              </p>
            ) : (
              <p className="mt-1 text-foreground">
                Daily VMT from <code>{screeningInputs.vmtKpiName}</code>:{" "}
                <span className="font-medium tabular-nums">{formatNumber(screeningInputs.dailyVmt, 0)}</span>; population
                from <code>{screeningInputs.populationKpiName}</code>:{" "}
                <span className="font-medium tabular-nums">{formatNumber(screeningInputs.population, 0)}</span>.
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-xs font-medium text-muted-foreground">
              Reference VMT/capita ({referenceLabel})
              <Input
                className="mt-1"
                inputMode="decimal"
                value={referenceInput}
                onChange={(event) => setReferenceInput(event.target.value)}
                aria-label="Reference VMT per capita"
              />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              Threshold (% below reference)
              <Input
                className="mt-1"
                inputMode="decimal"
                value={thresholdPctInput}
                onChange={(event) => setThresholdPctInput(event.target.value)}
                aria-label="Screening threshold percent below reference"
              />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              Project type
              <select
                className="module-select mt-1"
                value={projectType}
                onChange={(event) => setProjectType(event.target.value as CeqaProjectType)}
                aria-label="CEQA project type"
              >
                {CEQA_PROJECT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              Reference baseline
              <select
                className="module-select mt-1"
                value={referenceLabel}
                onChange={(event) => setReferenceLabel(event.target.value as CeqaReferenceLabel)}
                aria-label="CEQA reference baseline label"
              >
                {CEQA_REFERENCE_LABELS.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            The reference baseline and threshold are operator-supplied — the stored KPI set cannot
            provide them. The OPR Technical Advisory (December 2018) default is 15% below the regional
            or citywide VMT-per-capita baseline.
          </p>

          {!inputsValid ? (
            <p className="text-sm text-destructive">
              Enter a reference VMT/capita greater than 0 and a threshold percent between 0 and 100
              (exclusive).
            </p>
          ) : null}

          {scenario && result ? (
            <div
              className="rounded-[0.75rem] border border-border/70 bg-background px-5 py-4"
              data-testid="ceqa-vmt-determination"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold text-foreground">
                  Screening determination: {scenario.determination}
                </p>
                <StatusBadge tone={scenario.significant ? "warning" : "success"}>
                  {scenario.significant ? "Potentially significant" : "Less than significant"}
                </StatusBadge>
              </div>
              <p className="mt-2 text-sm text-foreground/90">
                Scenario <code>{scenario.scenario_id}</code>:{" "}
                <span className="tabular-nums">{formatNumber(scenario.vmt_per_capita, 3)}</span> VMT per
                capita versus a cut line of{" "}
                <span className="tabular-nums">{formatNumber(scenario.threshold_vmt_per_capita, 3)}</span> VMT per
                capita ({formatNumber(result.threshold_pct * 100, 0)}% below the {result.reference_label}{" "}
                reference of {formatNumber(result.reference_vmt_per_capita, 3)}) —{" "}
                <span className="tabular-nums">{formatNumber(Math.abs(scenario.delta_pct) * 100, 1)}%</span>{" "}
                {scenario.significant ? "above" : "below"} the threshold.
                {scenario.mitigation_required
                  ? " VMT mitigation or a substantial-evidence finding is required before a lead agency can issue a less-than-significant determination."
                  : ""}
              </p>
              <p className="mt-3 text-xs text-muted-foreground">{CEQA_STATUTORY_CITATION}</p>
              <p className="mt-2 text-xs text-muted-foreground" data-testid="ceqa-vmt-caveat">
                {CEQA_SCREENING_CAVEAT} This screening-grade output is not a CEQA determination of
                record.
              </p>
              <div className="mt-3">
                <Button type="button" variant="outline" size="sm" onClick={handleDownloadMemo}>
                  <Download className="h-4 w-4" />
                  Download memo (markdown)
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}
