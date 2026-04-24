"use client";

import { useState } from "react";

import { useCartographicLayers, type LayerKey } from "./cartographic-context";

type SwatchEntry = { kind: "swatch"; color: string; label: string };
type RampStop = { color: string; label: string };
type RampEntry = { kind: "ramp"; label: string; stops: RampStop[] };
type LegendEntry = SwatchEntry | RampEntry;

type LegendLayerKey = Extract<
  LayerKey,
  "projects" | "aerial" | "corridors" | "rtp" | "equity" | "engagement"
>;

const LEGEND_ORDER: LegendLayerKey[] = [
  "projects",
  "engagement",
  "aerial",
  "corridors",
  "rtp",
  "equity",
];

const LEGEND_ENTRIES: Record<LegendLayerKey, LegendEntry> = {
  projects: { kind: "swatch", color: "#1f6b5e", label: "Projects" },
  engagement: { kind: "swatch", color: "#c24a7f", label: "Community input" },
  aerial: { kind: "swatch", color: "#e45635", label: "Aerial AOIs" },
  corridors: {
    kind: "ramp",
    label: "Corridors by LOS",
    stops: [
      { color: "#4a7a9e", label: "A/B" },
      { color: "#c8962f", label: "C/D" },
      { color: "#b45239", label: "E" },
      { color: "#8a2e24", label: "F" },
    ],
  },
  rtp: { kind: "swatch", color: "#6b4a9e", label: "RTP cycles" },
  // Zero-vehicle-household share by tract. Sequential teal ramp, rising
  // saturation on higher-need bins. Bins match the Mapbox step expression
  // in the backdrop paint for `pctZeroVehicle`.
  equity: {
    kind: "ramp",
    label: "Zero-vehicle households",
    stops: [
      { color: "#d4e8e5", label: "<5%" },
      { color: "#8fb5b0", label: "5–10%" },
      { color: "#4d847c", label: "10–15%" },
      { color: "#1f544c", label: ">15%" },
    ],
  },
};

export function CartographicMapLegend() {
  const { layers } = useCartographicLayers();
  const [collapsed, setCollapsed] = useState(false);

  const visibleKeys = LEGEND_ORDER.filter((key) => layers[key]);
  if (visibleKeys.length === 0) return null;

  return (
    <aside className="op-cart-legend" aria-label="Map legend">
      <button
        type="button"
        className="op-cart-legend__hd"
        onClick={() => setCollapsed((prev) => !prev)}
        aria-expanded={!collapsed}
      >
        <span>Legend</span>
        <span className="op-cart-legend__caret" aria-hidden>
          {collapsed ? "▸" : "▾"}
        </span>
      </button>
      {collapsed ? null : (
        <ul className="op-cart-legend__list" role="list">
          {visibleKeys.map((key) => {
            const entry = LEGEND_ENTRIES[key];
            return (
              <li key={key} className="op-cart-legend__item">
                {entry.kind === "swatch" ? (
                  <>
                    <span
                      className="op-cart-legend__swatch"
                      style={{ background: entry.color }}
                      aria-hidden
                    />
                    <span className="op-cart-legend__label">{entry.label}</span>
                  </>
                ) : (
                  <>
                    <span className="op-cart-legend__label">{entry.label}</span>
                    <span className="op-cart-legend__ramp" aria-hidden>
                      {entry.stops.map((stop) => (
                        <span
                          key={stop.label}
                          className="op-cart-legend__ramp-stop"
                          style={{ background: stop.color }}
                          title={stop.label}
                        />
                      ))}
                    </span>
                    <span className="op-cart-legend__ramp-labels" aria-hidden>
                      {entry.stops.map((stop) => (
                        <span key={stop.label}>{stop.label}</span>
                      ))}
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
