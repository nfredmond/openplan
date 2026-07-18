"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  BCA_ENGINE_VERSION,
  BCA_METHOD_CITATION,
  BCA_PARAMETER_SOURCE_NOTES,
  BCA_SCREENING_CAVEAT,
  DEFAULT_ANALYSIS_HORIZON_YEARS,
  DEFAULT_BCA_PARAMETERS,
  DEFAULT_DISCOUNT_RATE_PCT,
  computeBenefitCostAnalysis,
  formatUsd,
  renderBcaMemoMarkdown,
  runBcaMonteCarlo,
  type BcaAnalysisInputs,
  type BcaBenefitInput,
  type BcaCostInput,
  type BcaMonteCarloResult,
  type BcaMonteCarloTarget,
  type BcaResult,
} from "@/lib/bca";
import {
  TDM_SCREENING_CAVEAT,
  TDM_STRATEGY_CATALOG,
  applyTdmToAnnualVmt,
  combineTdmStrategies,
  summarizeTdmCombination,
} from "@/lib/tdm";

/**
 * Presentational core of the benefit-cost screening panel on /grants.
 * All computation happens client-side through the pure lib — nothing is
 * persisted, and no value is estimated: the capital prefill is the project's
 * recorded funding need, and every other input is operator-supplied.
 * Unparseable or contradictory inputs block the run with a named message
 * instead of being silently dropped or coerced.
 */
export type BcaScreeningProjectOption = {
  id: string;
  name: string;
  /** Cost-proxy prefill from project_funding_profiles; NUMERIC arrives as string. */
  fundingNeedAmount: number | string | null;
};

export type BcaScreeningBodyProps = {
  projects: BcaScreeningProjectOption[];
};

/** Fixed seed so the uncertainty screen is reproducible; stamped on the memo. */
const BCA_SCREENING_MC_SEED = 20260717;
const BCA_SCREENING_MC_ITERATIONS = 1000;

/** Strategies whose VMT effect is negligible stay out of the VMT-derivation picker. */
const VMT_COUNTING_TDM_STRATEGIES = TDM_STRATEGY_CATALOG.filter(
  (strategy) => strategy.countsTowardVmt
);

type ParsedInput = { value: number | null; invalid: boolean };

function parseOptionalInput(raw: string): ParsedInput {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, invalid: false };
  // Accept natural "$2,500,000" formatting.
  const value = Number(trimmed.replace(/[$,\s]/g, ""));
  return Number.isFinite(value) ? { value, invalid: false } : { value: null, invalid: true };
}

function formatNumber(value: number, digits = 1): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

type BcaScreeningDerivation = {
  inputs: BcaAnalysisInputs | null;
  issues: string[];
};

export function BcaScreeningBody({ projects }: BcaScreeningBodyProps) {
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [capitalCostInput, setCapitalCostInput] = useState("");
  const [spreadYearsInput, setSpreadYearsInput] = useState("1");
  const [annualOmInput, setAnnualOmInput] = useState("");
  const [discountRateInput, setDiscountRateInput] = useState(String(DEFAULT_DISCOUNT_RATE_PCT));
  const [horizonInput, setHorizonInput] = useState(String(DEFAULT_ANALYSIS_HORIZON_YEARS));
  const [baseYearInput, setBaseYearInput] = useState(String(new Date().getFullYear()));
  const [hoursCommuterInput, setHoursCommuterInput] = useState("");
  const [crashesFatalInput, setCrashesFatalInput] = useState("");
  const [crashesInjuryInput, setCrashesInjuryInput] = useState("");
  const [crashesPdoInput, setCrashesPdoInput] = useState("");
  const [vmtReducedInput, setVmtReducedInput] = useState("");
  const [otherBenefitInput, setOtherBenefitInput] = useState("");
  const [tdmBaseVmtInput, setTdmBaseVmtInput] = useState("");
  const [tdmSelectedKeys, setTdmSelectedKeys] = useState<readonly string[]>([]);
  const [uncertaintyEnabled, setUncertaintyEnabled] = useState(false);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;

  function handleProjectChange(projectId: string) {
    setSelectedProjectId(projectId);
    const project = projects.find((entry) => entry.id === projectId) ?? null;
    const need = project ? parseOptionalInput(String(project.fundingNeedAmount ?? "")).value : null;
    // Always reset so a project without a recorded need never inherits the
    // previous project's prefill (the memo would misattribute the cost).
    setCapitalCostInput(need !== null && need > 0 ? String(need) : "");
  }

  function toggleTdmStrategy(key: string) {
    setTdmSelectedKeys((previous) =>
      previous.includes(key) ? previous.filter((entry) => entry !== key) : [...previous, key]
    );
  }

  const tdmCombination = useMemo(() => {
    if (tdmSelectedKeys.length === 0) return null;
    try {
      return combineTdmStrategies(tdmSelectedKeys.map((key) => ({ key })));
    } catch {
      return null;
    }
  }, [tdmSelectedKeys]);

  const tdmBaseVmt = parseOptionalInput(tdmBaseVmtInput).value;
  const tdmApplication = useMemo(() => {
    if (!tdmCombination || tdmBaseVmt === null || tdmBaseVmt <= 0) return null;
    try {
      return applyTdmToAnnualVmt(tdmBaseVmt, tdmCombination);
    } catch {
      return null;
    }
  }, [tdmCombination, tdmBaseVmt]);

  const derivation: BcaScreeningDerivation = useMemo(() => {
    const issues: string[] = [];

    const parseField = (label: string, raw: string): number | null => {
      const parsed = parseOptionalInput(raw);
      if (parsed.invalid) {
        issues.push(`${label} is not a number.`);
        return null;
      }
      if (parsed.value !== null && parsed.value < 0) {
        issues.push(`${label} cannot be negative.`);
        return null;
      }
      return parsed.value;
    };

    const baseYear = parseField("Base year", baseYearInput);
    if (baseYear === null && !issues.some((issue) => issue.startsWith("Base year"))) {
      issues.push("Base year is required.");
    } else if (baseYear !== null && (!Number.isInteger(baseYear) || baseYear < 1900 || baseYear > 2200)) {
      issues.push("Base year must be a whole year between 1900 and 2200.");
    }

    const horizon = parseField("Analysis horizon", horizonInput);
    if (horizon === null && !issues.some((issue) => issue.startsWith("Analysis horizon"))) {
      issues.push("Analysis horizon is required.");
    } else if (horizon !== null && (!Number.isInteger(horizon) || horizon < 1 || horizon > 100)) {
      issues.push("Analysis horizon must be a whole number of years between 1 and 100.");
    }

    const discountRate = parseField("Discount rate", discountRateInput);
    if (discountRate === null && !issues.some((issue) => issue.startsWith("Discount rate"))) {
      issues.push("Discount rate is required.");
    }

    const capital = parseField("Capital cost", capitalCostInput);
    const spreadYears = parseField("Capital spread", spreadYearsInput);
    if (spreadYears !== null && (!Number.isInteger(spreadYears) || spreadYears < 1)) {
      issues.push("Capital spread must be a whole number of years, at least 1.");
    } else if (
      capital !== null &&
      capital > 0 &&
      spreadYears !== null &&
      horizon !== null &&
      spreadYears > horizon
    ) {
      issues.push(
        "Capital spread exceeds the analysis horizon — cost slices past the horizon would be dropped. Shorten the spread or lengthen the horizon."
      );
    }

    const hoursCommuter = parseField("Travel time saved", hoursCommuterInput);
    const fatal = parseField("Fatal crashes avoided", crashesFatalInput);
    const injury = parseField("Injury crashes avoided", crashesInjuryInput);
    const pdo = parseField("PDO crashes avoided", crashesPdoInput);
    const vmtReduced = parseField("Annual VMT reduced", vmtReducedInput);
    const otherBenefit = parseField("Other annual benefit", otherBenefitInput);
    const annualOm = parseField("Annual O&M cost", annualOmInput);

    if (issues.length > 0) return { inputs: null, issues };

    const benefits: BcaBenefitInput[] = [];
    if (hoursCommuter !== null && hoursCommuter > 0) {
      benefits.push({ kind: "travelTime", annualHoursSaved: { commuter: hoursCommuter } });
    }
    if ((fatal ?? 0) > 0 || (injury ?? 0) > 0 || (pdo ?? 0) > 0) {
      benefits.push({
        kind: "safety",
        annualCrashesAvoided: {
          fatal: fatal !== null && fatal > 0 ? fatal : undefined,
          injury: injury !== null && injury > 0 ? injury : undefined,
          propertyDamageOnly: pdo !== null && pdo > 0 ? pdo : undefined,
        },
      });
    }
    if (vmtReduced !== null && vmtReduced > 0) {
      benefits.push({ kind: "emissions", annualVmtReduced: vmtReduced });
      benefits.push({ kind: "vehicleOperating", annualVmtReduced: vmtReduced });
    }
    if (otherBenefit !== null && otherBenefit > 0) {
      benefits.push({ kind: "other", label: "Other annual benefit", annualValue: otherBenefit });
    }

    const costs: BcaCostInput[] = [];
    if (capital !== null && capital > 0) {
      costs.push({ kind: "capital", totalAmount: capital, spreadYears: spreadYears ?? 1 });
    }
    if (annualOm !== null && annualOm > 0) {
      costs.push({ kind: "operationsMaintenance", annualAmount: annualOm });
    }

    if (benefits.length === 0 && costs.length === 0) return { inputs: null, issues: [] };
    return {
      inputs: {
        baseYear: baseYear as number,
        analysisHorizonYears: horizon as number,
        discountRatePct: discountRate as number,
        benefits,
        costs,
      },
      issues: [],
    };
  }, [
    baseYearInput,
    horizonInput,
    discountRateInput,
    hoursCommuterInput,
    crashesFatalInput,
    crashesInjuryInput,
    crashesPdoInput,
    vmtReducedInput,
    otherBenefitInput,
    capitalCostInput,
    spreadYearsInput,
    annualOmInput,
  ]);

  const analysisInputs = derivation.inputs;

  const computation: { result: BcaResult | null; engineError: string | null } = useMemo(() => {
    if (!analysisInputs) return { result: null, engineError: null };
    try {
      return { result: computeBenefitCostAnalysis(analysisInputs), engineError: null };
    } catch (error) {
      return {
        result: null,
        engineError: error instanceof Error ? error.message : "The screening engine rejected these inputs.",
      };
    }
  }, [analysisInputs]);
  const result = computation.result;

  const monteCarlo: BcaMonteCarloResult | null = useMemo(() => {
    if (!uncertaintyEnabled || !analysisInputs || !result) return null;
    const draws: BcaMonteCarloTarget[] = [
      ...analysisInputs.costs.map((_, index) => ({
        target: "costScale" as const,
        index,
        spec: { distribution: "triangular" as const, min: 0.8, mode: 1, max: 1.5 },
      })),
      ...analysisInputs.benefits.map((_, index) => ({
        target: "benefitScale" as const,
        index,
        spec: { distribution: "triangular" as const, min: 0.7, mode: 1, max: 1.2 },
      })),
    ];
    if (draws.length === 0) return null;
    try {
      return runBcaMonteCarlo(analysisInputs, {}, {
        seed: BCA_SCREENING_MC_SEED,
        iterations: BCA_SCREENING_MC_ITERATIONS,
        draws,
      });
    } catch {
      return null;
    }
  }, [uncertaintyEnabled, analysisInputs, result]);

  function handleApplyTdm() {
    if (!tdmApplication) return;
    setVmtReducedInput(String(Math.round(tdmApplication.annualVmtReduced)));
  }

  function handleDownloadMemo() {
    if (!result) return;
    const contextLabel = selectedProject?.name ?? "Manual entry";
    const tdmSummaryLines =
      tdmApplication && tdmCombination
        ? [
            summarizeTdmCombination(tdmCombination),
            `Applied to an operator-supplied base of ${formatNumber(tdmApplication.baseAnnualVmt, 0)} annual VMT, reducing ${formatNumber(tdmApplication.annualVmtReduced, 0)} VMT per year.`,
            TDM_SCREENING_CAVEAT,
          ]
        : undefined;
    const parameterNotes = (
      Object.keys(DEFAULT_BCA_PARAMETERS) as Array<keyof typeof DEFAULT_BCA_PARAMETERS>
    ).map((key) => `${key} = ${DEFAULT_BCA_PARAMETERS[key]} — ${BCA_PARAMETER_SOURCE_NOTES[key]}`);
    const markdown = renderBcaMemoMarkdown(result, {
      contextLabel,
      engineVersion: BCA_ENGINE_VERSION,
      monteCarlo,
      tdmSummaryLines,
      parameterNotes,
    });
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `bca-screen-${selectedProject?.id ?? "manual"}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  const bcr = result?.benefitCostRatio ?? null;

  return (
    <div className="mt-5 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-xs font-medium text-muted-foreground">
          Project (prefills capital cost)
          <select
            className="module-select mt-1"
            value={selectedProjectId}
            onChange={(event) => handleProjectChange(event.target.value)}
            aria-label="Project for benefit-cost screening"
          >
            <option value="">Manual entry</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          Capital cost ($)
          <Input
            className="mt-1"
            inputMode="decimal"
            value={capitalCostInput}
            onChange={(event) => setCapitalCostInput(event.target.value)}
            aria-label="Capital cost in dollars"
          />
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          Capital spread (years)
          <Input
            className="mt-1"
            inputMode="numeric"
            value={spreadYearsInput}
            onChange={(event) => setSpreadYearsInput(event.target.value)}
            aria-label="Years to spread capital cost over"
          />
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          Annual O&amp;M cost ($/yr)
          <Input
            className="mt-1"
            inputMode="decimal"
            value={annualOmInput}
            onChange={(event) => setAnnualOmInput(event.target.value)}
            aria-label="Annual operations and maintenance cost"
          />
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          Discount rate (%/yr)
          <Input
            className="mt-1"
            inputMode="decimal"
            value={discountRateInput}
            onChange={(event) => setDiscountRateInput(event.target.value)}
            aria-label="Real discount rate percent"
          />
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          Analysis horizon (years)
          <Input
            className="mt-1"
            inputMode="numeric"
            value={horizonInput}
            onChange={(event) => setHorizonInput(event.target.value)}
            aria-label="Analysis horizon in years"
          />
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          Base year
          <Input
            className="mt-1"
            inputMode="numeric"
            value={baseYearInput}
            onChange={(event) => setBaseYearInput(event.target.value)}
            aria-label="Analysis base year"
          />
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          Other annual benefit ($/yr)
          <Input
            className="mt-1"
            inputMode="decimal"
            value={otherBenefitInput}
            onChange={(event) => setOtherBenefitInput(event.target.value)}
            aria-label="Other annual benefit in dollars"
          />
        </label>
      </div>

      {selectedProject ? (
        <p className="text-xs text-muted-foreground">
          Capital cost is prefilled from the project&apos;s recorded funding need — replace it with
          the full project cost estimate if that differs. OpenPlan does not estimate costs.
        </p>
      ) : null}

      <div className="rounded-[0.75rem] border border-border/70 bg-background/60 px-5 py-4">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Annual benefits (operator-supplied)
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-xs font-medium text-muted-foreground">
            Travel time saved (person-hrs/yr)
            <Input
              className="mt-1"
              inputMode="decimal"
              value={hoursCommuterInput}
              onChange={(event) => setHoursCommuterInput(event.target.value)}
              aria-label="Annual commuter person-hours saved"
            />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            Fatal crashes avoided (/yr)
            <Input
              className="mt-1"
              inputMode="decimal"
              value={crashesFatalInput}
              onChange={(event) => setCrashesFatalInput(event.target.value)}
              aria-label="Annual fatal crashes avoided"
            />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            Injury crashes avoided (/yr)
            <Input
              className="mt-1"
              inputMode="decimal"
              value={crashesInjuryInput}
              onChange={(event) => setCrashesInjuryInput(event.target.value)}
              aria-label="Annual injury crashes avoided"
            />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            PDO crashes avoided (/yr)
            <Input
              className="mt-1"
              inputMode="decimal"
              value={crashesPdoInput}
              onChange={(event) => setCrashesPdoInput(event.target.value)}
              aria-label="Annual property-damage-only crashes avoided"
            />
          </label>
          <label className="block text-xs font-medium text-muted-foreground sm:col-span-2">
            Annual VMT reduced (mi/yr — monetized as emissions + vehicle operating savings)
            <Input
              className="mt-1"
              inputMode="decimal"
              value={vmtReducedInput}
              onChange={(event) => setVmtReducedInput(event.target.value)}
              aria-label="Annual vehicle miles traveled reduced"
            />
          </label>
        </div>
      </div>

      <details className="rounded-[0.75rem] border border-border/70 bg-background/60 px-5 py-4">
        <summary className="cursor-pointer text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Derive VMT reduction from TDM strategies
        </summary>
        <div className="mt-3 space-y-3">
          <label className="block max-w-xs text-xs font-medium text-muted-foreground">
            Base annual VMT affected (mi/yr)
            <Input
              className="mt-1"
              inputMode="decimal"
              value={tdmBaseVmtInput}
              onChange={(event) => setTdmBaseVmtInput(event.target.value)}
              aria-label="Base annual VMT affected by TDM strategies"
            />
          </label>
          <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {VMT_COUNTING_TDM_STRATEGIES.map((strategy) => (
              <label key={strategy.key} className="flex items-start gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={tdmSelectedKeys.includes(strategy.key)}
                  onChange={() => toggleTdmStrategy(strategy.key)}
                  aria-label={`Include ${strategy.name}`}
                />
                <span>
                  {strategy.name}{" "}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    ({formatNumber(strategy.defaultVmtReductionPct, 1)}%)
                  </span>
                </span>
              </label>
            ))}
          </div>
          {tdmCombination ? (
            <>
              <p className="text-sm text-foreground/90" data-testid="bca-tdm-summary">
                {summarizeTdmCombination(tdmCombination)}
              </p>
              <p className="text-xs text-muted-foreground" data-testid="bca-tdm-caveat">
                {TDM_SCREENING_CAVEAT}
              </p>
            </>
          ) : null}
          {tdmApplication ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-foreground/90">
                Estimated reduction:{" "}
                <span className="font-medium tabular-nums">
                  {formatNumber(tdmApplication.annualVmtReduced, 0)}
                </span>{" "}
                annual VMT.
              </p>
              <Button type="button" variant="outline" size="sm" onClick={handleApplyTdm}>
                Use as VMT reduced
              </Button>
            </div>
          ) : tdmCombination ? (
            <p className="text-xs text-muted-foreground">
              Enter a base annual VMT above to convert the combined percentage into miles. OpenPlan
              does not estimate a base.
            </p>
          ) : null}
        </div>
      </details>

      {derivation.issues.length > 0 ? (
        <div
          className="rounded-[0.75rem] border border-destructive/40 bg-background px-5 py-4 text-sm text-destructive"
          data-testid="bca-input-issues"
          role="alert"
        >
          <p className="font-semibold">The screen will not run until these inputs are fixed:</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            {derivation.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {computation.engineError ? (
        <p className="text-sm text-destructive" data-testid="bca-engine-error" role="alert">
          {computation.engineError}
        </p>
      ) : null}

      {derivation.issues.length === 0 && !analysisInputs ? (
        <div
          className="rounded-[0.75rem] border border-dashed border-border/60 bg-background/60 px-5 py-4 text-sm text-muted-foreground"
          data-testid="bca-empty-state"
        >
          <p>
            Enter at least one cost or benefit (and a valid base year, horizon, and discount rate)
            to run the screen. Every input is operator-supplied — OpenPlan never estimates a missing
            cost or benefit.
          </p>
        </div>
      ) : null}

      {result ? (
        <div
          className="rounded-[0.75rem] border border-border/70 bg-background px-5 py-4"
          data-testid="bca-determination"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-foreground">
              Screening result:{" "}
              {bcr === null ? (
                "benefit-cost ratio not computable (no discounted costs entered)"
              ) : (
                <>
                  benefit-cost ratio <span className="tabular-nums">{formatNumber(bcr, 2)}</span>
                </>
              )}
            </p>
            <StatusBadge tone={bcr !== null && bcr >= 1 ? "success" : "warning"}>
              {bcr !== null && bcr >= 1 ? "BCR at or above 1.0" : "BCR below 1.0 or incomplete"}
            </StatusBadge>
          </div>
          <p className="mt-2 text-sm text-foreground/90">
            Net present value{" "}
            <span className="font-medium tabular-nums">{formatUsd(result.netPresentValue)}</span> over{" "}
            <span className="tabular-nums">{result.analysisHorizonYears}</span> years from{" "}
            <span className="tabular-nums">{result.baseYear}</span> (benefits{" "}
            <span className="tabular-nums">{formatUsd(result.presentValueBenefits)}</span> vs costs{" "}
            <span className="tabular-nums">{formatUsd(result.presentValueCosts)}</span>, discounted at{" "}
            <span className="tabular-nums">{formatNumber(result.discountRatePct, 1)}%</span>
            {result.co2DiscountRatePct !== result.discountRatePct
              ? ` with CO₂ at ${formatNumber(result.co2DiscountRatePct, 1)}%`
              : ""}
            ).{" "}
            {result.internalRateOfReturnPct !== null
              ? `Internal rate of return ${formatNumber(result.internalRateOfReturnPct, 1)}%.`
              : "An internal rate of return is not computable from these flows."}{" "}
            {result.paybackYearsDiscounted !== null
              ? `Discounted payback in ${formatNumber(result.paybackYearsDiscounted, 1)} years.`
              : "Discounted benefits do not repay discounted costs within the horizon."}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <input
                type="checkbox"
                checked={uncertaintyEnabled}
                onChange={(event) => setUncertaintyEnabled(event.target.checked)}
                aria-label="Run uncertainty screen"
              />
              Uncertainty screen (benefits −30%/+20%, costs −20%/+50%, triangular)
            </label>
          </div>
          {monteCarlo ? (
            <p className="mt-2 text-sm text-foreground/90" data-testid="bca-mc-summary">
              Across <span className="tabular-nums">{monteCarlo.iterations}</span> seeded draws:
              probability BCR ≥ 1.0 is{" "}
              <span className="font-medium tabular-nums">
                {formatNumber(monteCarlo.probabilityBcrAtLeastOne * 100, 0)}%
              </span>
              ; NPV 10th–90th percentile{" "}
              <span className="tabular-nums">{formatUsd(monteCarlo.npv.percentiles.p10)}</span> to{" "}
              <span className="tabular-nums">{formatUsd(monteCarlo.npv.percentiles.p90)}</span> (seed{" "}
              <span className="tabular-nums">{monteCarlo.seed}</span>, reproducible).
            </p>
          ) : null}

          <p className="mt-3 text-xs text-muted-foreground">{BCA_METHOD_CITATION}</p>
          <p className="mt-2 text-xs text-muted-foreground" data-testid="bca-caveat">
            {BCA_SCREENING_CAVEAT}
          </p>
          <div className="mt-3">
            <Button type="button" variant="outline" size="sm" onClick={handleDownloadMemo}>
              <Download className="h-4 w-4" />
              Download memo (markdown)
            </Button>
          </div>
        </div>
      ) : null}

      <details className="rounded-[0.75rem] border border-border/60 bg-background/60 px-5 py-3 text-sm">
        <summary className="cursor-pointer text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Monetization defaults and sources
        </summary>
        <dl className="mt-3 space-y-1.5 text-xs text-muted-foreground">
          {(Object.keys(DEFAULT_BCA_PARAMETERS) as Array<keyof typeof DEFAULT_BCA_PARAMETERS>).map(
            (key) => (
              <div key={key} className="flex flex-wrap gap-1.5">
                <dt className="font-semibold text-foreground/70">
                  {key} = <span className="tabular-nums">{String(DEFAULT_BCA_PARAMETERS[key])}</span>
                </dt>
                <dd>— {BCA_PARAMETER_SOURCE_NOTES[key]}</dd>
              </div>
            )
          )}
        </dl>
      </details>
    </div>
  );
}
