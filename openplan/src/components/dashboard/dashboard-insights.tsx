"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { DashboardChartPicker } from "@/components/dashboard/dashboard-chart-picker";
import {
  ChartAreaPlot,
  ChartBarPlot,
  ChartFigure,
  ChartMeterRows,
  ChartRowBars,
} from "@/components/ui/chart-primitives";
import {
  DASHBOARD_CHARTS,
  DEFAULT_DASHBOARD_CHART_IDS,
  dashboardChartStorageKey,
  parseDashboardChartSelection,
  serializeDashboardChartSelection,
  type DashboardChartId,
} from "@/lib/dashboard/chart-catalog";
import type { InsightSeries } from "@/lib/dashboard/insights";

/**
 * The Insights view — the same workspace, read as figures.
 *
 * THE PERSON CHOOSES WHICH FIGURES APPEAR. Five exist; which ones matter
 * depends entirely on what this planner does all day, and guessing that was
 * never going to work. The catalog (`lib/dashboard/chart-catalog.ts`) holds the
 * list, the default (all five) and where the choice is kept; this component
 * holds the state and the layout.
 *
 * EVERY FIGURE IS DRAWN FROM ROWS THIS WORKSPACE REALLY HAS. No sample data,
 * no placeholder series. A figure with nothing behind it says so, and a figure
 * whose query FAILED says that instead, in different words with a different
 * icon — see `ChartBlockedNote`.
 *
 * Outcomes are never carried by colour alone: the stat tiles use an icon and a
 * word, which is the only legal use of the status palette here, and every plot
 * is single-series. The reasoning behind that is in `chart-primitives.tsx`.
 *
 * WHAT NO TEST OF THIS FILE CAN PROVE. jsdom applies no stylesheet and has no
 * box model, so it cannot establish that any of this is legible, correctly
 * coloured, or the right shape at any width. Those were measured in a browser.
 */

type StatTile = {
  label: string;
  value: string;
  detail: string;
  /** Status tiles carry an icon and a word; colour never carries the meaning alone. */
  tone?: "neutral" | "good" | "attention";
};

export type DashboardInsightsProps = {
  /** Identifies whose choice this is. The selection is per person, per workspace. */
  userId: string;
  workspaceId: string;
  tiles: StatTile[];
  /** One entry per catalog id. Every figure is built on the server from real rows. */
  series: Record<DashboardChartId, InsightSeries>;
};

function toneIcon(tone: StatTile["tone"]) {
  if (tone === "good") return <CheckCircle2 className="h-3.5 w-3.5 text-[color:var(--ok)]" />;
  if (tone === "attention") return <AlertTriangle className="h-3.5 w-3.5 text-[color:var(--warn)]" />;
  return null;
}

export function DashboardInsights({ userId, workspaceId, tiles, series }: DashboardInsightsProps) {
  const storageKey = dashboardChartStorageKey(userId, workspaceId);
  const [selected, setSelected] = useState<DashboardChartId[]>([...DEFAULT_DASHBOARD_CHART_IDS]);

  // Before mount the stored choice is unknown, so the default set renders —
  // which is what the server rendered too, so hydration has nothing to correct.
  useEffect(() => {
    try {
      setSelected(parseDashboardChartSelection(window.localStorage.getItem(storageKey)));
    } catch {
      // Storage can be unavailable. The default set is a fine answer.
    }
  }, [storageKey]);

  function choose(next: DashboardChartId[]) {
    const ordered = parseDashboardChartSelection(serializeDashboardChartSelection(next));
    setSelected(ordered);
    try {
      window.localStorage.setItem(storageKey, serializeDashboardChartSelection(ordered));
    } catch {
      // The choice still holds for this visit.
    }
  }

  const shown = DASHBOARD_CHARTS.filter((chart) => selected.includes(chart.id));

  return (
    <div className="space-y-4" data-testid="dashboard-insights">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-2xl border border-border/70 bg-card/70 p-4">
            <p className="flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {toneIcon(tile.tone)}
              {tile.label}
            </p>
            <p className="mt-2 font-display text-3xl font-semibold tabular-nums text-foreground">
              {tile.value}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{tile.detail}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs leading-5 text-muted-foreground">
          {shown.length === 0
            ? "No figures are switched on. Choose the ones you want."
            : "Figures for this workspace. Nothing here is a forecast."}
        </p>
        <DashboardChartPicker selected={selected} onChange={choose} />
      </div>

      {shown.length === 0 ? null : (
        <div className="grid gap-4 xl:grid-cols-2">
          {shown.map((chart) => {
            const figure = series[chart.id];
            return (
              <div key={chart.id} className={chart.fullWidth ? "xl:col-span-2" : undefined}>
                <ChartFigure
                  title={chart.title}
                  caption={chart.caption}
                  series={figure}
                  valueLabel={chart.valueLabel}
                >
                  {chart.form === "area" ? (
                    <ChartAreaPlot series={figure} ariaLabel={`${chart.title}.`} />
                  ) : chart.form === "bars" ? (
                    <ChartBarPlot series={figure} ariaLabel={`${chart.title}.`} />
                  ) : chart.form === "meter" ? (
                    <ChartMeterRows series={figure} />
                  ) : (
                    <ChartRowBars series={figure} />
                  )}
                </ChartFigure>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
