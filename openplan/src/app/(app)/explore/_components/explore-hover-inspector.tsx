"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import {
  formatCrashUserFilterLabel,
  type CrashSeverityFilter,
  type CrashUserFilter,
} from "@/lib/analysis/map-view-state";
import { tractMeasureLabelFor, tractMeasureLegend } from "@/lib/cartographic/tract-measure-classes";
import { formatCurrency, formatPercent, titleize } from "./_helpers";
import type { HoveredCrash, HoveredTract, TractLegendItem, TractMetric } from "./_types";

type ExploreHoverInspectorProps = {
  showTracts: boolean;
  crashPointLayerAvailable: boolean;
  tractMetric: TractMetric;
  hoveredTract: HoveredTract | null;
  hoveredCrash: HoveredCrash | null;
  crashSeverityFilter: CrashSeverityFilter;
  crashUserFilter: CrashUserFilter;
};

function buildTractLegend(tractMetric: TractMetric): {
  label: string;
  note: string;
  items: TractLegendItem[];
} {
  if (tractMetric === "poverty") {
    return {
      label: "Poverty share",
      note: "Share of residents below poverty threshold in corridor-context tracts.",
      items: tractMeasureLegend("pctBelowPoverty"),
    };
  }

  if (tractMetric === "income") {
    return {
      label: "Median income",
      note: "Weighted ACS median household income for each intersecting tract.",
      items: tractMeasureLegend("medianIncome"),
    };
  }

  if (tractMetric === "disadvantaged") {
    return {
      label: "Proxy disadvantaged flag",
      note: "ACS income + burden screening proxy (lower income plus elevated poverty, minority share, zero-vehicle, or transit dependence). Runs anywhere ACS is available — NOT the federal CEJST/Justice40 designation.",
      items: [
        { label: "Flagged", color: "#ef4444" },
        { label: "Not flagged", color: "#1f2937" },
      ],
    };
  }

  return {
    label: "Minority share",
    note: "Share of residents identified in the current equity-screening minority population field.",
    items: tractMeasureLegend("pctMinority"),
  };
}

function formatHoveredTractMetric(hoveredTract: HoveredTract | null, tractMetric: TractMetric): string {
  if (!hoveredTract) {
    return "Hover a tract to inspect values";
  }

  if (tractMetric === "income") {
    return formatCurrency(hoveredTract.medianIncome);
  }

  if (tractMetric === "poverty") {
    return formatPercent(hoveredTract.pctBelowPoverty);
  }

  if (tractMetric === "disadvantaged") {
    return hoveredTract.isDisadvantaged ? "Flagged" : "Not flagged";
  }

  return formatPercent(hoveredTract.pctMinority);
}

export function getActiveTractLegendLabel(hoveredTract: HoveredTract | null, tractMetric: TractMetric): string | null {
  if (!hoveredTract) {
    return null;
  }
  if (tractMetric === "disadvantaged") {
    return hoveredTract.isDisadvantaged ? "Flagged" : "Not flagged";
  }
  // The same classes the map paints, so the marked row is the tract's colour.
  if (tractMetric === "income") return tractMeasureLabelFor("medianIncome", hoveredTract.medianIncome);
  if (tractMetric === "poverty") return tractMeasureLabelFor("pctBelowPoverty", hoveredTract.pctBelowPoverty);
  return tractMeasureLabelFor("pctMinority", hoveredTract.pctMinority);
}

export function ExploreHoverInspector({
  showTracts,
  crashPointLayerAvailable,
  tractMetric,
  hoveredTract,
  hoveredCrash,
  crashSeverityFilter,
  crashUserFilter,
}: ExploreHoverInspectorProps) {
  if (!showTracts && !crashPointLayerAvailable) {
    return null;
  }

  const tractLegend = buildTractLegend(tractMetric);
  const hoveredTractMetricValue = formatHoveredTractMetric(hoveredTract, tractMetric);
  const activeTractLegendLabel = getActiveTractLegendLabel(hoveredTract, tractMetric);

  return (
    <section className="analysis-studio-surface">
      <div className="analysis-studio-header">
        <div className="analysis-studio-heading">
          <p className="analysis-studio-label">Map intelligence</p>
          <h3 className="analysis-studio-title">Live hover inspector</h3>
          <p className="analysis-studio-description">
            Hover a census tract or crash point on the map to inspect its attributes here.
          </p>
        </div>
        <StatusBadge tone={hoveredTract || hoveredCrash ? "success" : "neutral"}>
          {hoveredTract || hoveredCrash ? "Active" : "Idle"}
        </StatusBadge>
      </div>
      <div className="analysis-studio-body">
        <div className="analysis-sidepanel-stack">
          {showTracts ? (
            <>
              <div className="analysis-sidepanel-row">
                <div className="analysis-sidepanel-head">
                  <div className="analysis-sidepanel-main">
                    <p className="analysis-sidepanel-title">{tractLegend.label}</p>
                    <p className="analysis-sidepanel-body">{tractLegend.note}</p>
                  </div>
                  <StatusBadge tone="info">Legend</StatusBadge>
                </div>
                <div className="mt-2 space-y-1">
                  {tractLegend.items.map((item) => {
                    const isActive = activeTractLegendLabel === item.label;

                    return (
                      <div
                        key={`legend-${item.label}`}
                        className={[
                          "flex items-center justify-between gap-2 rounded-md px-1.5 py-0.5 text-xs",
                          isActive ? "bg-sky-400/10 text-sky-100 ring-1 ring-sky-300/25" : "text-muted-foreground",
                        ].join(" ")}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full border border-border"
                            style={{ backgroundColor: item.color }}
                          />
                          {item.label}
                        </span>
                        {isActive ? <span className="text-label text-sky-200/80">hovered</span> : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className={["analysis-sidepanel-row", hoveredTract ? "is-active" : "is-muted"].join(" ")}>
                <div className="analysis-sidepanel-head">
                  <div className="analysis-sidepanel-main">
                    <div className="analysis-sidepanel-kicker">
                      <span className="analysis-sidepanel-chip">Tract inspector</span>
                    </div>
                    <p className="analysis-sidepanel-title">{hoveredTract ? hoveredTract.name : "No tract hovered"}</p>
                    <p className="analysis-sidepanel-body">
                      {hoveredTract ? `GEOID ${hoveredTract.geoid}` : "Hover a visible census tract to inspect its attributes."}
                    </p>
                  </div>
                  <StatusBadge tone={hoveredTract?.isDisadvantaged ? "warning" : "neutral"}>
                    {hoveredTract ? hoveredTractMetricValue : "Idle"}
                  </StatusBadge>
                </div>
                {hoveredTract ? (
                  <div className="analysis-sidepanel-stat-grid cols-2">
                    <div className="analysis-sidepanel-stat">
                      <p className="analysis-sidepanel-label">Population</p>
                      <p className="analysis-sidepanel-value">{hoveredTract.population?.toLocaleString("en-US") ?? "N/A"}</p>
                    </div>
                    <div className="analysis-sidepanel-stat">
                      <p className="analysis-sidepanel-label">Median income</p>
                      <p className="analysis-sidepanel-value">{formatCurrency(hoveredTract.medianIncome)}</p>
                    </div>
                    <div className="analysis-sidepanel-stat">
                      <p className="analysis-sidepanel-label">Minority share</p>
                      <p className="analysis-sidepanel-value">{formatPercent(hoveredTract.pctMinority)}</p>
                    </div>
                    <div className="analysis-sidepanel-stat">
                      <p className="analysis-sidepanel-label">Poverty share</p>
                      <p className="analysis-sidepanel-value">{formatPercent(hoveredTract.pctBelowPoverty)}</p>
                    </div>
                    <div className="analysis-sidepanel-stat">
                      <p className="analysis-sidepanel-label">Zero-vehicle HH</p>
                      <p className="analysis-sidepanel-value">{formatPercent(hoveredTract.zeroVehiclePct)}</p>
                    </div>
                    <div className="analysis-sidepanel-stat">
                      <p className="analysis-sidepanel-label">Transit commute</p>
                      <p className="analysis-sidepanel-value">{formatPercent(hoveredTract.transitCommutePct)}</p>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {crashPointLayerAvailable ? (
            <div className={["analysis-sidepanel-row", hoveredCrash ? "is-warning" : "is-muted"].join(" ")}>
              <div className="analysis-sidepanel-head">
                <div className="analysis-sidepanel-main">
                  <div className="analysis-sidepanel-kicker">
                    <span className="analysis-sidepanel-chip">Crash inspector</span>
                  </div>
                  <p className="analysis-sidepanel-title">{hoveredCrash ? hoveredCrash.severityLabel : "Crash details"}</p>
                  <p className="analysis-sidepanel-body">
                    {hoveredCrash
                      ? `${titleize(crashSeverityFilter)} / ${formatCrashUserFilterLabel(crashUserFilter)}`
                      : "Hover a crash point to inspect severity and VRU flags."}
                  </p>
                </div>
                <StatusBadge tone={hoveredCrash ? "warning" : "neutral"}>
                  {hoveredCrash ? "Hovering" : "Idle"}
                </StatusBadge>
              </div>
              {hoveredCrash ? (
                <div className="analysis-sidepanel-stat-grid cols-2">
                  <div className="analysis-sidepanel-stat">
                    <p className="analysis-sidepanel-label">Collision</p>
                    <p className="analysis-sidepanel-value">{hoveredCrash.severityLabel}</p>
                  </div>
                  <div className="analysis-sidepanel-stat">
                    <p className="analysis-sidepanel-label">Year</p>
                    <p className="analysis-sidepanel-value">{hoveredCrash.collisionYear ?? "Unknown"}</p>
                  </div>
                  <div className="analysis-sidepanel-stat">
                    <p className="analysis-sidepanel-label">Fatalities</p>
                    <p className="analysis-sidepanel-value">{hoveredCrash.fatalCount}</p>
                  </div>
                  <div className="analysis-sidepanel-stat">
                    <p className="analysis-sidepanel-label">Injured</p>
                    <p className="analysis-sidepanel-value">{hoveredCrash.injuryCount}</p>
                  </div>
                  <div className="analysis-sidepanel-stat sm:col-span-2">
                    <p className="analysis-sidepanel-label">VRU flags</p>
                    <p className="analysis-sidepanel-value">
                      {[
                        hoveredCrash.pedestrianInvolved ? "Ped" : null,
                        hoveredCrash.bicyclistInvolved ? "Bike" : null,
                      ].filter(Boolean).join(" / ") || "None"}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
