"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
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
  type CeqaVmtScreeningInputs,
} from "@/lib/models/ceqa-vmt-screen";

/**
 * Presentational core of the CEQA §15064.3 VMT screen, shared by the
 * county-run panel and the model-run panel. Consumes stored KPI rows only —
 * derivation, empty states, operator inputs, determination, and memo download.
 * Access gating (e.g. the county screening-grade consent gate) stays in the
 * wrappers.
 */
export type CeqaVmtScreenBodyProps = {
  /** Scenario identifier stamped on screening rows and the downloaded memo. */
  scenarioId: string;
  /** KPI rows already scoped to the run under screening. */
  kpis: CeqaVmtKpiRowLike[];
};

function formatNumber(value: number, digits = 1): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

export function CeqaVmtScreenBody({ scenarioId, kpis }: CeqaVmtScreenBodyProps) {
  const [referenceInput, setReferenceInput] = useState(String(DEFAULT_REFERENCE_VMT_PER_CAPITA));
  const [thresholdPctInput, setThresholdPctInput] = useState(
    String(OPR_DEFAULT_THRESHOLD_PCT * 100)
  );
  const [projectType, setProjectType] = useState<CeqaProjectType>("residential");
  const [referenceLabel, setReferenceLabel] = useState<CeqaReferenceLabel>("regional");

  const screeningInputs = useMemo(() => deriveCeqaVmtScreeningInputs(kpis), [kpis]);

  // Count-calibration confidence signal (opt-in calibrated runs only). The
  // determination still uses the SCREENING VMT — calibration tunes the model to
  // observed traffic COUNTS (link volumes), which strengthens the evidence for
  // this area's screening determination without recalculating the per-capita
  // VMT aggregate. None on the default (uncalibrated) path.
  const calibratedHoldoutApe = useMemo(() => {
    const row = kpis.find((k) => k.kpi_name === "validation_median_ape_calibrated");
    return typeof row?.value === "number" ? row.value : null;
  }, [kpis]);

  // Opt-in: a calibrated resident VMT per capita (from the stage-2 nudged OD),
  // present only when the demand nudge accepted. Off by default — the operator
  // must explicitly choose a calibrated-input determination.
  const calibratedPerCapita = useMemo(() => {
    const row = kpis.find((k) => k.kpi_name === "resident_vmt_per_capita_calibrated");
    return typeof row?.value === "number" ? row.value : null;
  }, [kpis]);
  const [useCalibratedInput, setUseCalibratedInput] = useState(false);
  const calibratedActive = useCalibratedInput && calibratedPerCapita !== null;
  const activeInputs: CeqaVmtScreeningInputs = calibratedActive
    ? { status: "per-capita", vmtPerCapita: calibratedPerCapita as number, vmtKpiName: "resident_vmt_per_capita_calibrated" }
    : screeningInputs;

  const referenceVmtPerCapita = Number(referenceInput);
  const thresholdPct = Number(thresholdPctInput) / 100;
  const inputsValid =
    Number.isFinite(referenceVmtPerCapita) &&
    referenceVmtPerCapita > 0 &&
    Number.isFinite(thresholdPct) &&
    thresholdPct > 0 &&
    thresholdPct < 1;

  const result: CeqaVmtResult | null = useMemo(() => {
    if (!inputsValid) return null;
    if (
      activeInputs.status !== "per-capita" &&
      activeInputs.status !== "total-with-population"
    ) {
      return null;
    }
    try {
      return computeCeqaVmt([buildCeqaScreeningRow(activeInputs, scenarioId)], {
        referenceVmtPerCapita,
        projectType,
        referenceLabel,
        thresholdPct,
      });
    } catch {
      return null;
    }
  }, [inputsValid, activeInputs, scenarioId, referenceVmtPerCapita, projectType, referenceLabel, thresholdPct]);

  const scenario = result?.scenarios[0] ?? null;

  function handleDownloadMemo() {
    if (!result) return;
    const markdown = renderCeqaVmtMarkdown(result, {
      runId: scenarioId,
      engineVersion: CEQA_MEMO_ENGINE_VERSION,
      // Disclose the calibrated basis in the exported artifact — the on-screen
      // label must travel into the memo that leaves the tool.
      calibratedBasis: calibratedActive,
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

  if (screeningInputs.status === "no-vmt-kpi" || screeningInputs.status === "missing-population") {
    return (
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
    );
  }

  return (
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
        or citywide VMT-per-capita baseline. The pre-filled 22.0 reference is the California
        statewide average total VMT per capita (FHWA Highway Statistics 2022–2023, Table PS-1:
        21.8–21.9 mi/day) — total travel on public roads divided by population, a coarse screening
        reference; replace it with your region&apos;s adopted baseline where one exists.
      </p>

      {!inputsValid ? (
        <p className="text-sm text-destructive">
          Enter a reference VMT/capita greater than 0 and a threshold percent between 0 and 100
          (exclusive).
        </p>
      ) : null}

      {calibratedPerCapita !== null ? (
        <label
          className="flex items-start gap-2 rounded-[0.5rem] border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-foreground/90"
          data-testid="ceqa-vmt-calibrated-toggle"
        >
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-border"
            checked={useCalibratedInput}
            onChange={(e) => setUseCalibratedInput(e.target.checked)}
          />
          <span>
            <span className="font-semibold">Use calibrated (count-tuned) VMT for this determination.</span>{" "}
            Off (default) = screening VMT. On = the calibrated resident VMT/capita from the demand-nudge
            stage ({formatNumber(calibratedPerCapita, 3)}), a count-informed refinement — clearly a
            distinct, disclosed calibrated-input determination, not the screening default.
          </span>
        </label>
      ) : null}

      {scenario && result ? (
        <div
          className="rounded-[0.75rem] border border-border/70 bg-background px-5 py-4"
          data-testid="ceqa-vmt-determination"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-foreground">
              {calibratedActive ? "Calibrated-input determination" : "Screening determination"}:{" "}
              {scenario.determination}
            </p>
            <StatusBadge tone={scenario.significant ? "warning" : "success"}>
              {scenario.significant ? "Potentially significant" : "Less than significant"}
            </StatusBadge>
          </div>
          {calibratedActive ? (
            <p className="mt-2 rounded-[0.5rem] border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-foreground/90">
              This determination uses <span className="font-semibold">calibrated (count-tuned) VMT</span>{" "}
              from the demand-nudge stage, count-validated to{" "}
              {calibratedHoldoutApe !== null ? `${formatNumber(calibratedHoldoutApe, 1)}% held-out median APE` : "the held-out count set"}.
              It is a screening-grade calibrated estimate, not the default screening determination
              (toggle off to compare). Calibration primarily improves link-level fit; treat this
              per-capita figure as a count-informed refinement, not a validated forecast.
            </p>
          ) : null}
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
          {calibratedHoldoutApe !== null ? (
            <p
              className="mt-3 rounded-[0.5rem] border border-[color:var(--pine)]/30 bg-[color:var(--pine)]/5 px-3 py-2 text-xs text-foreground/90"
              data-testid="ceqa-vmt-calibration-confidence"
            >
              <span className="font-semibold">Count-validated in this study area:</span> the model
              was calibrated to observed traffic counts and reproduces a held-out (never-fit) count
              set to {formatNumber(calibratedHoldoutApe, 1)}% median absolute percent error. This
              strengthens the evidence for the screening determination above in this area; it does
              not recalculate VMT (calibration tunes link-level traffic fidelity, not the per-capita
              VMT aggregate).
            </p>
          ) : null}
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
  );
}
