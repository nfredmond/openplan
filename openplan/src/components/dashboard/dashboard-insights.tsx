"use client";

import { useEffect, useState } from "react";

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
 * Outcomes are never carried by colour alone: every plot is single-series. The reasoning behind that is in `chart-primitives.tsx`.
 *
 * WHAT NO TEST OF THIS FILE CAN PROVE. jsdom applies no stylesheet and has no
 * box model, so it cannot establish that any of this is legible, correctly
 * coloured, or the right shape at any width. Those were measured in a browser.
 */

export type DashboardInsightsProps = {
  /** Identifies whose choice this is. The selection is per person, per workspace. */
  userId: string;
  workspaceId: string;
  /** One entry per catalog id. Every figure is built on the server from real rows. */
  series: Record<DashboardChartId, InsightSeries>;
};

export function DashboardInsights({ userId, workspaceId, series }: DashboardInsightsProps) {
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
    <section className="dashboard-panel" aria-labelledby="dashboard-charts" data-testid="dashboard-insights">
      <header className="dashboard-panel-header">
        <h2 id="dashboard-charts" className="dashboard-panel-title">
          Charts
        </h2>
        <DashboardChartPicker selected={selected} onChange={choose} />
      </header>

      {shown.length === 0 ? (
        <p className="dashboard-empty">No charts are switched on. Choose the ones you want.</p>
      ) : null}

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
    </section>
  );
}
