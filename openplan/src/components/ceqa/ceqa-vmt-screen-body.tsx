"use client";

import { useMemo, useState } from "react";
import { Download, Save } from "lucide-react";
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
import {
  describeClaimTierForDetermination,
  type VmtClaimTierEvidence,
  type VmtDeterminationSaveRequest,
} from "@/lib/planner-pack/vmt-screening-records";
import {
  selectCalibratedHoldoutApe,
  selectCalibratedVmtPerCapita,
} from "@/lib/planner-pack/vmt-determination-inputs";
import type { VmtFrameworkResolution } from "@/lib/planner-pack/vmt-significance-frameworks";

/**
 * Presentational core of the VMT significance screen, shared by the county-run
 * panel and the model-run panel. Consumes stored KPI rows only — derivation,
 * empty states, operator inputs, determination, and memo download. Access gating
 * (e.g. the county screening-grade consent gate) stays in the wrappers.
 *
 * THE JURISDICTION BASIS AND THE CLAIM TIER ARE NOT OPTIONAL DISPLAY. A
 * significance determination is the one determination-shaped output OpenPlan
 * produces, and its meaning depends entirely on two facts that are invisible in
 * the arithmetic: WHOSE LAW makes VMT the significance metric here (CEQA
 * §15064.3 is California law and determines nothing in Ohio), and HOW GOOD the
 * model behind the number is (the repo's own record documents sketch-ABM VMT
 * running ~56% below the CARB reference — enough to turn a "potentially
 * significant" into a false "less than significant"). So both are rendered
 * unconditionally, and the ABSENCE of either is stated rather than left blank:
 * a surface that has not resolved a framework says so in the loudest form, which
 * is why the props below are optional but their absent state is never quiet.
 */
export type CeqaVmtScreenBodyProps = {
  /** Scenario identifier stamped on screening rows and the downloaded memo. */
  scenarioId: string;
  /** KPI rows already scoped to the run under screening. */
  kpis: CeqaVmtKpiRowLike[];
  /**
   * Which VMT significance framework governs this workspace's jurisdiction, as
   * the registry resolved it. Omitted by a surface that has not resolved one;
   * that renders the same refusal as an uncovered jurisdiction, because a
   * determination with no established basis is exactly as unquotable.
   */
  frameworkResolution?: VmtFrameworkResolution | null;
  /**
   * Why no framework is available, when the surface knows a more specific reason
   * than "none was resolved" — most importantly, that the lookup itself failed.
   * A failed read must not render as "your jurisdiction is not covered".
   */
  frameworkUnavailableReason?: string | null;
  /** The run's recorded modeling claim tier, when the surface reads it. */
  claimTier?: VmtClaimTierEvidence | null;
  /** Supplied only by a surface that can persist a determination. */
  onSaveDetermination?: (request: VmtDeterminationSaveRequest) => void;
  savePending?: boolean;
  saveError?: string | null;
  saveNotice?: string | null;
};

function formatNumber(value: number, digits = 1): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

export function CeqaVmtScreenBody({
  scenarioId,
  kpis,
  frameworkResolution,
  frameworkUnavailableReason = null,
  claimTier,
  onSaveDetermination,
  savePending = false,
  saveError = null,
  saveNotice = null,
}: CeqaVmtScreenBodyProps) {
  // A covered jurisdiction supplies its OWN starting reference and cut line. The
  // module-level constants remain the fallback for a surface with no resolved
  // framework, but they are a California statewide figure and OPR's percentage —
  // presenting them as universal is the hardcode this branch removes.
  const framework = frameworkResolution?.kind === "covered" ? frameworkResolution.framework : null;
  // The one no-framework explanation, used by BOTH the on-screen panel and the
  // exported memo. Two different absences, and they must not be worded alike —
  // see the jurisdiction-basis JSX below for why a resolved "none covers you"
  // is a fact while an unresolved surface must not claim one.
  const noFrameworkReason =
    frameworkResolution?.kind === "not_covered" ||
    frameworkResolution?.kind === "jurisdiction_unknown" ||
    frameworkResolution?.kind === "ambiguous"
      ? frameworkResolution.reason
      : (frameworkUnavailableReason ??
        "This surface does not resolve which jurisdiction's VMT significance rules apply, so " +
          "OpenPlan cannot say whose determination this would be and will not record one.");
  const [referenceInput, setReferenceInput] = useState(
    String(framework?.defaultReferenceVmtPerCapita ?? DEFAULT_REFERENCE_VMT_PER_CAPITA)
  );
  const [thresholdPctInput, setThresholdPctInput] = useState(
    String((framework?.defaultThresholdPct ?? OPR_DEFAULT_THRESHOLD_PCT) * 100)
  );
  const [projectType, setProjectType] = useState<CeqaProjectType>("residential");
  const [referenceLabel, setReferenceLabel] = useState<CeqaReferenceLabel>("regional");

  const screeningInputs = useMemo(() => deriveCeqaVmtScreeningInputs(kpis), [kpis]);

  // Count-calibration confidence signal (opt-in calibrated runs only). The
  // determination still uses the SCREENING VMT — calibration tunes the model to
  // observed traffic COUNTS (link volumes), which strengthens the evidence for
  // this area's screening determination without recalculating the per-capita
  // VMT aggregate. None on the default (uncalibrated) path.
  const calibratedHoldoutApe = useMemo(() => selectCalibratedHoldoutApe(kpis), [kpis]);

  // Opt-in: a calibrated resident VMT per capita (from the stage-2 nudged OD),
  // present only when the demand nudge accepted. Off by default — the operator
  // must explicitly choose a calibrated-input determination.
  //
  // SELECTED BY THE SHARED RULE, not by a lookup written here. This panel used
  // to accept any row with the calibrated KPI's name, while the save route also
  // required it to be run-level and positive — so a geometry-scoped calibrated
  // slice put a calibrated determination on screen that the server then refused
  // with 422. The refusal was honest; showing a planner a number the product
  // will not keep is not. One definition, called from both sides.
  const calibrated = useMemo(() => selectCalibratedVmtPerCapita(kpis), [kpis]);
  const [useCalibratedInput, setUseCalibratedInput] = useState(false);
  const calibratedActive = useCalibratedInput && calibrated !== null;
  const activeInputs: CeqaVmtScreeningInputs = useMemo(
    () =>
      calibratedActive && calibrated
        ? {
            status: "per-capita",
            vmtPerCapita: calibrated.vmtPerCapita,
            vmtKpiName: calibrated.kpiName,
          }
        : screeningInputs,
    [calibratedActive, calibrated, screeningInputs]
  );

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
      // label must travel into the memo that leaves the tool. The jurisdiction
      // basis and the claim tier travel for the same reason: the memo is the
      // quotable artifact, and it may not assert more than the screen it came
      // from established.
      calibratedBasis: calibratedActive,
      jurisdictionBasis: framework
        ? {
            kind: "framework",
            frameworkName: framework.frameworkName,
            jurisdictionLabel: framework.jurisdiction.label,
            scopeStatement: framework.scopeStatement,
          }
        : { kind: "none", reason: noFrameworkReason },
      claimTier,
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
        provide them.{" "}
        {framework ? (
          <>
            {framework.defaultThresholdRationale} {framework.defaultReferenceRationale}
          </>
        ) : (
          <>
            {/* The pre-filled numbers are NOT neutral and must not be described as
                such: the reference is a California statewide average and the
                percentage is California OPR's recommendation (see
                DEFAULT_REFERENCE_VMT_PER_CAPITA / OPR_DEFAULT_THRESHOLD_PCT).
                With no framework established there is nothing to say they suit
                this workspace, so the honest move is to name where they came
                from rather than to launder them as a universal default. */}
            No significance framework has been established for this workspace, so nothing here can
            tell you what your jurisdiction recommends. The pre-filled values are carried over from
            California&apos;s guidance — a California statewide VMT-per-capita average (
            {formatNumber(DEFAULT_REFERENCE_VMT_PER_CAPITA, 1)}) and the{" "}
            {formatNumber(OPR_DEFAULT_THRESHOLD_PCT * 100, 0)} percent-below cut line recommended by
            California&apos;s Governor&apos;s Office of Planning and Research — and they are a
            starting point for the arithmetic only, not a
            baseline adopted for your area. Replace them with your region&apos;s adopted baseline
            and threshold.
          </>
        )}
      </p>

      {!inputsValid ? (
        <p className="text-sm text-destructive">
          Enter a reference VMT/capita greater than 0 and a threshold percent between 0 and 100
          (exclusive).
        </p>
      ) : null}

      {calibrated ? (
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
            stage ({formatNumber(calibrated.vmtPerCapita, 3)}), a count-informed refinement — clearly a
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
          {/* The jurisdiction basis rides WITH the determination, always. A
              determination that leaves this panel without it is a statement
              about somebody's law, made to a planner who may not be under it. */}
          {framework ? (
            <p
              className="mt-3 rounded-[0.5rem] border border-[color:var(--pine)]/30 bg-[color:var(--pine)]/5 px-3 py-2 text-xs text-foreground/90"
              data-testid="ceqa-vmt-jurisdiction-basis"
            >
              <span className="font-semibold">Jurisdiction basis:</span> {framework.frameworkName},{" "}
              {framework.jurisdiction.label}. Established from this workspace&apos;s stated home
              geography
              {frameworkResolution?.kind === "covered" && frameworkResolution.jurisdiction.label
                ? ` (${frameworkResolution.jurisdiction.label})`
                : ""}
              . {framework.scopeStatement}
            </p>
          ) : (
            <p
              className="mt-3 rounded-[0.5rem] border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-foreground/90"
              data-testid="ceqa-vmt-jurisdiction-basis"
            >
              {/* Two different absences, and they must not be worded alike. A
                  RESOLUTION means the registry answered about this workspace —
                  "none covers you" is then a fact. NO resolution means this
                  surface never asked, and saying "none has been established for
                  this workspace" would state as fact something the surface
                  cannot know: the county-run screen does not resolve one, and a
                  California workspace reading it would be told, wrongly, that it
                  has no framework. */}
              <span className="font-semibold">
                {frameworkResolution
                  ? "No VMT significance framework has been established for this workspace, so the comparison above is arithmetic — not a significance determination for your area."
                  : "This screen has not established which VMT significance framework applies here, so the comparison above is arithmetic — not a significance determination for your area."}
              </span>{" "}
              {noFrameworkReason}
            </p>
          )}
          {/* The claim tier rides with it for the same reason: the arithmetic is
              identical whether the VMT behind it is validated or a prototype. */}
          <p className="mt-2 text-xs text-muted-foreground" data-testid="ceqa-vmt-claim-tier">
            <span className="font-semibold">Modeling claim tier:</span>{" "}
            {/* The one shared sentence — the memo download above renders the
                same words via the same function, so screen and export cannot
                drift apart. */}
            {describeClaimTierForDetermination(claimTier)}
          </p>
          {/* A citation means two different things depending on the jurisdiction
              basis. Under a framework that governs here, it is the AUTHORITY the
              determination rests on. Outside one, the same statute is only where
              the arithmetic came from — printing it unlabelled would let a
              planner in another state read it as authority over their project. */}
          {framework ? (
            <p className="mt-3 text-xs text-muted-foreground" data-testid="ceqa-vmt-citation">
              {framework.statutoryCitation}
            </p>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground" data-testid="ceqa-vmt-citation">
              <span className="font-semibold">Method reference:</span> the comparison above implements
              the VMT-efficiency screening method defined by {CEQA_STATUTORY_CITATION} It is cited as
              the source of the method, not as authority over a project in your area.
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground" data-testid="ceqa-vmt-caveat">
            {CEQA_SCREENING_CAVEAT} This screening-grade output is not a CEQA determination of
            record.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleDownloadMemo}>
              <Download className="h-4 w-4" />
              Download memo (markdown)
            </Button>
            {onSaveDetermination ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="ceqa-vmt-save-determination"
                disabled={!framework || savePending}
                onClick={() =>
                  onSaveDetermination({
                    referenceVmtPerCapita,
                    thresholdPct,
                    projectType,
                    referenceLabel,
                    inputBasis: calibratedActive ? "calibrated" : "screening",
                  })
                }
              >
                <Save className="h-4 w-4" />
                {savePending ? "Saving determination…" : "Save determination to this run"}
              </Button>
            ) : null}
          </div>
          {onSaveDetermination && !framework ? (
            <p className="mt-2 text-xs text-muted-foreground" data-testid="ceqa-vmt-save-blocked">
              Saving is unavailable until a VMT significance framework is established for this
              workspace — a stored determination has to record whose rules it was issued under.
            </p>
          ) : null}
          {saveError ? (
            <p className="mt-2 text-xs text-destructive" data-testid="ceqa-vmt-save-error">
              {saveError}
            </p>
          ) : null}
          {saveNotice ? (
            <p className="mt-2 text-xs text-muted-foreground" data-testid="ceqa-vmt-save-notice">
              {saveNotice}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
