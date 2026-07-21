"use client";

import { useState } from "react";
import { Car, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ITE_TRIP_GEN_SCREENING_CAVEAT } from "@/lib/models/ite-trip-generation";
import { TRIP_GEN_UNIT_LABELS } from "@/lib/models/ite-rates";

/**
 * Screening worksheet for a succeeded `ite_trip_generation` model run. The
 * engine stores five KPI rows in the `ite_trip_generation` category (see
 * buildIteTripGenerationKpiRows); this panel lazily fetches the run's KPI rows,
 * filters to that category, and renders the stored totals plus the per-line-item
 * breakdown that rides on the `project_daily_trip_ends` row.
 *
 * CLAIM BOUNDARY: this is a WORKSHEET. It never issues an impact conclusion,
 * never compares against a cut line, and always shows the screening caveat —
 * even before the fetch and in the empty state.
 */
type ModelRunTripGenScreenProps = {
  modelId: string;
  modelRunId: string;
  runTitle: string;
};

type TripGenKpiRow = {
  kpi_name: string;
  kpi_label: string | null;
  kpi_category: string | null;
  value: number | null;
  unit: string | null;
  breakdown_json: Record<string, unknown> | null;
};

/** Fixed display order for the engine's five stored totals. */
const TRIP_GEN_TOTAL_KPI_ORDER = [
  "project_daily_trip_ends",
  "project_am_peak_hour_trip_ends",
  "project_pm_peak_hour_trip_ends",
  "project_daily_vmt_screen",
  "project_program_units",
] as const;

const COMPARISON_BASIS_LABELS: Record<string, string> = {
  no_build_zero: "no-build baseline (the baseline site generates zero trips)",
  existing_use_net_new: "net new versus the existing on-site use",
};

type TripGenLineItemView = {
  landUse: string;
  unitBasis: string;
  quantity: number | null;
  grossDailyTrips: number | null;
  netDailyTrips: number | null;
  amPeakTrips: number | null;
  pmPeakTrips: number | null;
  dailyVmt: number | null;
};

function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function unitBasisLabel(basis: string): string {
  return (TRIP_GEN_UNIT_LABELS as Record<string, string>)[basis] ?? basis;
}

/** Defensive parse of `breakdown_json.lineItems` (JSON from the DB, not typed). */
function parseLineItems(value: unknown): TripGenLineItemView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    return [
      {
        landUse: typeof record.landUse === "string" ? record.landUse : "(unnamed land use)",
        unitBasis: typeof record.unitBasis === "string" ? record.unitBasis : "",
        quantity: toNumberOrNull(record.quantity),
        grossDailyTrips: toNumberOrNull(record.grossDailyTrips),
        netDailyTrips: toNumberOrNull(record.netDailyTrips),
        amPeakTrips: toNumberOrNull(record.amPeakTrips),
        pmPeakTrips: toNumberOrNull(record.pmPeakTrips),
        dailyVmt: toNumberOrNull(record.dailyVmt),
      },
    ];
  });
}

function NumberCell({ value, digits = 2 }: { value: number | null; digits?: number }) {
  return (
    <td className="px-4 py-2 text-right tabular-nums text-foreground">
      {value !== null ? formatNumber(value, digits) : "—"}
    </td>
  );
}

/**
 * Presentational body: stored totals, the per-line-item table, and the
 * assumptions line. Consumes already-filtered `ite_trip_generation` KPI rows.
 * The permanent caveat lives in the wrapper so it renders in every state.
 */
export function TripGenScreenBody({ kpis }: { kpis: TripGenKpiRow[] }) {
  if (kpis.length === 0) {
    return (
      <div
        className="mt-5 rounded-[0.75rem] border border-dashed border-border/60 bg-background/60 px-5 py-4 text-sm text-muted-foreground"
        data-testid="trip-gen-empty-state"
      >
        <p>
          No trip-generation KPIs are stored for this run, so the worksheet has nothing to show. It
          reads only the <code>ite_trip_generation</code> KPI rows written by the engine — OpenPlan
          does not estimate values that were never stored.
        </p>
      </div>
    );
  }

  const byName = new Map(kpis.map((row) => [row.kpi_name, row]));
  const totals = TRIP_GEN_TOTAL_KPI_ORDER.flatMap((name) => {
    const row = byName.get(name);
    return row ? [row] : [];
  });
  const breakdown = byName.get("project_daily_trip_ends")?.breakdown_json ?? null;
  const lineItems = parseLineItems(breakdown?.lineItems);
  const avgTripLengthMiles = toNumberOrNull(breakdown?.avgTripLengthMiles);
  const comparisonBasis =
    typeof breakdown?.comparisonBasis === "string" ? breakdown.comparisonBasis : null;

  return (
    <div className="mt-5 space-y-4">
      <div className="rounded-[0.75rem] border border-border/70 bg-background/60 px-5 py-4 text-sm">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Program totals (stored KPIs)
        </p>
        <ul className="mt-1 divide-y divide-border/50">
          {totals.map((row) => (
            <li key={row.kpi_name} className="flex items-baseline justify-between gap-4 py-1.5">
              <span className="text-foreground">{row.kpi_label ?? row.kpi_name}</span>
              <span className="font-medium tabular-nums text-foreground">
                {row.value !== null ? formatNumber(row.value) : "—"}
                {row.unit ? (
                  <span className="ml-1.5 font-normal text-muted-foreground">{row.unit}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {lineItems.length > 0 ? (
        <div className="overflow-x-auto rounded-[0.75rem] border border-border/70 bg-background/60">
          <table className="w-full min-w-[640px] text-sm" data-testid="trip-gen-line-items">
            <thead>
              <tr className="border-b border-border/60 text-left text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <th className="px-4 py-2.5 font-semibold">Land use</th>
                <th className="px-4 py-2.5 font-semibold">Unit basis</th>
                <th className="px-4 py-2.5 text-right font-semibold">Quantity</th>
                <th className="px-4 py-2.5 text-right font-semibold">Gross daily</th>
                <th className="px-4 py-2.5 text-right font-semibold">Net daily</th>
                <th className="px-4 py-2.5 text-right font-semibold">AM peak</th>
                <th className="px-4 py-2.5 text-right font-semibold">PM peak</th>
                <th className="px-4 py-2.5 text-right font-semibold">Daily VMT (screen)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {lineItems.map((li, index) => (
                <tr key={`${li.landUse}-${index}`}>
                  <td className="px-4 py-2 text-foreground">{li.landUse}</td>
                  <td className="px-4 py-2 text-muted-foreground">{unitBasisLabel(li.unitBasis)}</td>
                  <NumberCell value={li.quantity} />
                  <NumberCell value={li.grossDailyTrips} />
                  <NumberCell value={li.netDailyTrips} />
                  <NumberCell value={li.amPeakTrips} />
                  <NumberCell value={li.pmPeakTrips} />
                  <NumberCell value={li.dailyVmt} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground" data-testid="trip-gen-assumptions">
        Assumptions (stored with the run):
        {avgTripLengthMiles !== null
          ? ` average vehicle trip length ${formatNumber(avgTripLengthMiles)} miles for the rate-based VMT screen;`
          : " average trip length not recorded;"}{" "}
        comparison basis —{" "}
        {comparisonBasis !== null
          ? (COMPARISON_BASIS_LABELS[comparisonBasis] ?? comparisonBasis)
          : "not recorded"}
        . Net trips apply the stored internal-capture and pass-by reductions per line item.
      </p>
    </div>
  );
}

export function ModelRunTripGenScreen({ modelId, modelRunId, runTitle }: ModelRunTripGenScreenProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kpis, setKpis] = useState<TripGenKpiRow[] | null>(null);

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
        (payload.kpis ?? [])
          .map((row) => ({
            kpi_name: String(row.kpi_name ?? ""),
            kpi_label: typeof row.kpi_label === "string" ? row.kpi_label : null,
            kpi_category: typeof row.kpi_category === "string" ? row.kpi_category : null,
            value: typeof row.value === "number" ? row.value : null,
            unit: typeof row.unit === "string" ? row.unit : null,
            breakdown_json:
              row.breakdown_json && typeof row.breakdown_json === "object"
                ? (row.breakdown_json as Record<string, unknown>)
                : null,
          }))
          .filter((row) => row.kpi_category === "ite_trip_generation")
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load run KPIs");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <article className="module-section-surface" data-testid="model-run-trip-gen-screen">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
            <Car className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">Trip generation</p>
            <h2 className="module-section-title">Trip generation screening worksheet</h2>
            <p className="module-section-description">
              Reads the trip-generation KPIs stored for run &quot;{runTitle}&quot; — daily and
              peak-hour vehicle trip ends from published public-agency average rates, plus a
              rate-based VMT screen (net trips × assumed average trip length). Arithmetic over
              stored rows only; nothing is estimated when the KPI set is empty, and no impact
              conclusion is issued here.
            </p>
          </div>
        </div>
        <StatusBadge tone="warning" data-testid="trip-gen-screening-badge">
          Screening worksheet — not a study or determination
        </StatusBadge>
      </div>

      <div className="mt-4">
        <Button type="button" variant="outline" size="sm" onClick={handleToggle} aria-expanded={isOpen}>
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {isOpen ? "Hide worksheet" : "Open worksheet"}
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
          <TripGenScreenBody kpis={kpis} />
        ) : null
      ) : null}

      <p className="mt-4 text-xs text-muted-foreground" data-testid="trip-gen-caveat">
        {ITE_TRIP_GEN_SCREENING_CAVEAT}
      </p>
    </article>
  );
}
