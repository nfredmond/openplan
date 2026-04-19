"use client";

import { StatusBadge } from "@/components/ui/status-badge";

type TractMetric = "minority" | "poverty" | "income" | "disadvantaged";

type Props = {
  mapReady: boolean;
  showPolygonFill: boolean;
  onTogglePolygonFill: () => void;
  showTracts: boolean;
  onToggleTracts: () => void;
  showCrashes: boolean;
  onToggleCrashes: () => void;
  switrsPointLayerAvailable: boolean;
  tractMetric: TractMetric;
  onChangeTractMetric: (value: TractMetric) => void;
};

export function ExploreLayerVisibilityControls({
  mapReady,
  showPolygonFill,
  onTogglePolygonFill,
  showTracts,
  onToggleTracts,
  showCrashes,
  onToggleCrashes,
  switrsPointLayerAvailable,
  tractMetric,
  onChangeTractMetric,
}: Props) {
  return (
    <section className="analysis-studio-surface">
      <div className="analysis-studio-header">
        <div className="analysis-studio-heading">
          <p className="analysis-studio-label">Map layers</p>
          <h3 className="analysis-studio-title">Layer visibility</h3>
        </div>
        <StatusBadge tone={mapReady ? "success" : "neutral"}>{mapReady ? "Ready" : "Init"}</StatusBadge>
      </div>
      <div className="analysis-studio-body">
        <div className="analysis-sidepanel-stack">
          <button
            type="button"
            onClick={onTogglePolygonFill}
            className={["analysis-sidepanel-row is-interactive", showPolygonFill ? "is-active" : "is-muted"].join(" ")}
          >
            <div className="analysis-sidepanel-head">
              <p className="analysis-sidepanel-title">Corridor fill</p>
              <StatusBadge tone={showPolygonFill ? "success" : "neutral"}>{showPolygonFill ? "Visible" : "Hidden"}</StatusBadge>
            </div>
          </button>
          <button
            type="button"
            onClick={onToggleTracts}
            className={["analysis-sidepanel-row is-interactive", showTracts ? "is-active" : "is-muted"].join(" ")}
          >
            <div className="analysis-sidepanel-head">
              <p className="analysis-sidepanel-title">Census tracts</p>
              <StatusBadge tone={showTracts ? "success" : "neutral"}>{showTracts ? "Visible" : "Hidden"}</StatusBadge>
            </div>
          </button>
          <button
            type="button"
            onClick={onToggleCrashes}
            className={["analysis-sidepanel-row is-interactive", showCrashes && switrsPointLayerAvailable ? "is-warning" : "is-muted"].join(" ")}
          >
            <div className="analysis-sidepanel-head">
              <p className="analysis-sidepanel-title">Crash data</p>
              <StatusBadge tone={showCrashes && switrsPointLayerAvailable ? "warning" : "neutral"}>
                {switrsPointLayerAvailable ? (showCrashes ? "Visible" : "Hidden") : "No data"}
              </StatusBadge>
            </div>
          </button>
        </div>
        <div className="mt-3 space-y-1.5">
          <p className="analysis-studio-inline-meta-label">Tract theme</p>
          <select
            value={tractMetric}
            onChange={(event) => onChangeTractMetric(event.target.value as TractMetric)}
            className="analysis-sidepanel-select"
          >
            <option value="minority">Minority share</option>
            <option value="poverty">Poverty share</option>
            <option value="income">Median income</option>
            <option value="disadvantaged">Disadvantaged flag</option>
          </select>
        </div>
      </div>
    </section>
  );
}
