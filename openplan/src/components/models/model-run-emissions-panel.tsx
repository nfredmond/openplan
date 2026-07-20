"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Wind } from "lucide-react";
import {
  deriveEmissionsScreen,
  formatMetricTons,
  EMISSIONS_SCREENING_CAVEAT,
  type EmissionsKpiRowLike,
  type EmissionsScreen,
} from "@/lib/models/emissions-screen";

/**
 * Screening GHG (CO2e) panel for a succeeded AequilibraE run. Lazily fetches the
 * run's KPI rows (same directly-readable `general` category as the CEQA VMT
 * screen) and renders the annual + per-capita CO2e with its screening caveat.
 */
type Props = {
  modelId: string;
  modelRunId: string;
};

export function ModelRunEmissionsPanel({ modelId, modelRunId }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<EmissionsScreen | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function handleToggle() {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (!nextOpen || loaded || isLoading) return;

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
      if (!response.ok) throw new Error(payload.error || "Failed to load run KPIs");
      const rows: EmissionsKpiRowLike[] = (payload.kpis ?? []).map((row) => ({
        kpi_name: String(row.kpi_name ?? ""),
        value: typeof row.value === "number" ? row.value : null,
        unit: typeof row.unit === "string" ? row.unit : null,
        breakdown_json:
          row.breakdown_json && typeof row.breakdown_json === "object"
            ? (row.breakdown_json as Record<string, unknown>)
            : null,
      }));
      setScreen(deriveEmissionsScreen(rows));
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
          <Wind className="h-4 w-4" /> GHG emissions (screening)
        </span>
        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      {isOpen ? (
        <div className="space-y-3 border-t border-border/60 px-4 py-3">
          {isLoading ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading emissions…
            </p>
          ) : error ? (
            <p className="text-xs text-red-600 dark:text-red-300">{error}</p>
          ) : !screen ? (
            <p className="text-xs text-muted-foreground">
              No emissions estimate for this run (requires a computed VMT).
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-x-8 gap-y-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Annual CO₂e</p>
                  <p className="text-lg font-semibold text-foreground">
                    {formatMetricTons(screen.co2eMetricTonsYear)}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Per capita</p>
                  <p className="text-lg font-semibold text-foreground">
                    {screen.co2eKgPerCapitaDay === null
                      ? "—"
                      : `${screen.co2eKgPerCapitaDay.toFixed(2)} kg CO₂e/person/day`}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Rate</p>
                  <p className="text-lg font-semibold text-foreground">
                    {screen.co2eGramsPerMile === null
                      ? "—"
                      : `${screen.co2eGramsPerMile} g/mi${
                          screen.analysisYear ? ` · ${screen.analysisYear}` : ""
                        }`}
                  </p>
                </div>
              </div>
              <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
                {screen.provenance ?? EMISSIONS_SCREENING_CAVEAT}
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
