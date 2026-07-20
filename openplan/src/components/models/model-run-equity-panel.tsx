"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Scale } from "lucide-react";
import {
  deriveEquityScreen,
  formatShare,
  EQUITY_SCREENING_CAVEAT,
  type EquityKpiRowLike,
  type EquityScreen,
} from "@/lib/models/equity-screen";

/**
 * Equity / EJ screening panel for a succeeded AequilibraE run: real ACS
 * low-income / minority / zero-vehicle shares by zone, resident VMT/capita for
 * above-typical-disadvantage zones vs the rest, and the disparity ratio.
 * Screening-grade — not the official SB 535 designation (the panel says so).
 */
type Props = {
  modelId: string;
  modelRunId: string;
};

function GroupColumn({
  title,
  vmtPerCapita,
  lowIncome,
  minority,
  zeroVehicle,
  population,
}: {
  title: string;
  vmtPerCapita: number | null;
  lowIncome: number | null;
  minority: number | null;
  zeroVehicle: number | null;
  population: number | null;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="text-lg font-semibold text-foreground">
        {vmtPerCapita === null ? "—" : vmtPerCapita.toFixed(2)}
        <span className="ml-1 text-xs font-normal text-muted-foreground">VMT/capita</span>
      </p>
      <dl className="text-xs text-muted-foreground">
        <div className="flex justify-between gap-4"><dt>Population</dt><dd>{population === null ? "—" : population.toLocaleString("en-US")}</dd></div>
        <div className="flex justify-between gap-4"><dt>Low-income</dt><dd>{formatShare(lowIncome)}</dd></div>
        <div className="flex justify-between gap-4"><dt>Minority</dt><dd>{formatShare(minority)}</dd></div>
        <div className="flex justify-between gap-4"><dt>Zero-vehicle HH</dt><dd>{formatShare(zeroVehicle)}</dd></div>
      </dl>
    </div>
  );
}

export function ModelRunEquityPanel({ modelId, modelRunId }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<EquityScreen | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function handleToggle() {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (!nextOpen || loaded || isLoading) return;

    setError(null);
    setIsLoading(true);
    try {
      const response = await fetch(`/api/models/${modelId}/runs/${modelRunId}/kpis`, { cache: "no-store" });
      const payload = (await response.json()) as { kpis?: Array<Record<string, unknown>>; error?: string };
      if (!response.ok) throw new Error(payload.error || "Failed to load run KPIs");
      const rows: EquityKpiRowLike[] = (payload.kpis ?? []).map((row) => ({
        kpi_name: String(row.kpi_name ?? ""),
        value: typeof row.value === "number" ? row.value : null,
        unit: typeof row.unit === "string" ? row.unit : null,
        breakdown_json:
          row.breakdown_json && typeof row.breakdown_json === "object"
            ? (row.breakdown_json as Record<string, unknown>)
            : null,
      }));
      setScreen(deriveEquityScreen(rows));
      setLoaded(true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load run KPIs");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="rounded-[0.5rem] border border-border/60 bg-muted/25">
      <button
        type="button"
        onClick={() => void handleToggle()}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={isOpen}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Scale className="h-4 w-4" /> Equity / EJ overlay (screening)
        </span>
        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      {isOpen ? (
        <div className="space-y-3 border-t border-border/60 px-4 py-3">
          {isLoading ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading equity overlay…
            </p>
          ) : error ? (
            <p className="text-xs text-red-600 dark:text-red-300">{error}</p>
          ) : !screen ? (
            <p className="text-xs text-muted-foreground">
              No equity overlay for this run (needs a Census key and a dynamic geography).
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {screen.focusZoneCount ?? 0} equity-focus {screen.geography ?? "zone"}
                {(screen.focusZoneCount ?? 0) === 1 ? "" : "s"} ({formatShare(
                  screen.focusPopulationSharePct === null ? null : screen.focusPopulationSharePct / 100
                )} of population)
                {screen.disparityRatio !== null ? (
                  <>
                    {" · "}
                    <span className="font-medium text-foreground">{screen.disparityRatio.toFixed(2)}×</span> resident
                    VMT/capita vs the rest of the study area
                  </>
                ) : null}
              </p>
              <div className="grid grid-cols-2 gap-6">
                <GroupColumn
                  title="Equity-focus zones"
                  vmtPerCapita={screen.focusVmtPerCapita}
                  lowIncome={screen.focus?.avg_low_income_share ?? null}
                  minority={screen.focus?.avg_minority_share ?? null}
                  zeroVehicle={screen.focus?.avg_zero_vehicle_share ?? null}
                  population={screen.focus?.population ?? null}
                />
                <GroupColumn
                  title="Rest of area"
                  vmtPerCapita={screen.restVmtPerCapita}
                  lowIncome={screen.rest?.avg_low_income_share ?? null}
                  minority={screen.rest?.avg_minority_share ?? null}
                  zeroVehicle={screen.rest?.avg_zero_vehicle_share ?? null}
                  population={screen.rest?.population ?? null}
                />
              </div>
              <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
                {screen.provenance ?? EQUITY_SCREENING_CAVEAT}
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
