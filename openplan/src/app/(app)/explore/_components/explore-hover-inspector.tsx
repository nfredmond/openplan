"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import {
  formatCrashUserFilterLabel,
  type CrashSeverityFilter,
  type CrashUserFilter,
} from "@/lib/analysis/map-view-state";
import { formatCurrency, formatPercent, titleize } from "./_helpers";
import type { HoveredCrash, HoveredTract, TractLegendItem, TractMetric } from "./_types";

type ExploreHoverInspectorProps = {
  showTracts: boolean;
  switrsPointLayerAvailable: boolean;
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
      items: [
        { label: "0-10%", color: "#0b3b2e" },
        { label: "10-20%", color: "#15803d" },
        { label: "20-30%", color: "#65a30d" },
        { label: "30-45%", color: "#ca8a04" },
        { label: "45%+", color: "#b91c1c" },
      ],
    };
  }

  if (tractMetric === "income") {
    return {
      label: "Median income",
      note: "Weighted ACS median household income for each intersecting tract.",
      items: [
        { label: "<$45k", color: "#7f1d1d" },
        { label: "$45k-$70k", color: "#b45309" },
        { label: "$70k-$100k", color: "#0f766e" },
        { label: "$100k-$150k", color: "#0ea5e9" },
        { label: "$150k+", color: "#e0f2fe" },
      ],
    };
  }

  if (tractMetric === "disadvantaged") {
    return {
      label: "Disadvantaged flag",
      note: "Binary flag based on lower income plus elevated poverty, minority share, zero-vehicle, or transit dependence.",
      items: [
        { label: "Flagged", color: "#ef4444" },
        { label: "Not flagged", color: "#1f2937" },
      ],
    };
  }

  return {
    label: "Minority share",
    note: "Share of residents identified in the current equity-screening minority population field.",
    items: [
      { label: "0-30%", color: "#123047" },
      { label: "30-55%", color: "#1d4ed8" },
      { label: "55-75%", color: "#2563eb" },
      { label: "75-100%", color: "#0f766e" },
      { label: "Highest concentration", color: "#34d399" },
    ],
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

export function ExploreHoverInspector({
  showTracts,
  switrsPointLayerAvailable,
  tractMetric,
  hoveredTract,
  hoveredCrash,
  crashSeverityFilter,
  crashUserFilter,
}: ExploreHoverInspectorProps) {
  if (!showTracts && !switrsPointLayerAvailable) {
    return null;
  }

  const tractLegend = buildTractLegend(tractMetric);
  const hoveredTractMetricValue = formatHoveredTractMetric(hoveredTract, tractMetric);

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
                  {tractLegend.items.map((item) => (
                    <div key={`legend-${item.label}`} className="flex items-center gap-2 py-0.5 text-xs text-slate-300/90">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/15"
                        style={{ backgroundColor: item.color }}
                      />
                      {item.label}
                    </div>
                  ))}
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
                      <p className="analysis-sidepanel-value">{hoveredTract.population?.toLocaleString() ?? "N/A"}</p>
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

          {switrsPointLayerAvailable ? (
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
                      : "Hover a SWITRS collision point to inspect severity and VRU flags."}
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
