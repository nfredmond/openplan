"use client";

import { useState } from "react";

import { useCartographicLayers, type LayerKey } from "./cartographic-context";
import {
  CRASH_SEVERITY_COLOR,
  CRASH_SEVERITY_LEGEND_LABEL,
  CRASH_SEVERITY_LEGEND_ORDER,
} from "@/lib/cartographic/crash-severity-palette";
import {
  TRANSIT_SERVICE_TIER_COLOR,
  TRANSIT_SERVICE_TIER_LEGEND_LABEL,
  TRANSIT_SERVICE_TIER_LEGEND_ORDER,
  TRANSIT_SERVICE_TIER_LEGEND_TITLE,
} from "@/lib/cartographic/transit-service-tier-palette";

type SwatchEntry = { kind: "swatch"; color: string; label: string };
type RampStop = { color: string; label: string };
type RampEntry = { kind: "ramp"; label: string; stops: RampStop[] };
type LegendEntry = SwatchEntry | RampEntry;

type LegendLayerKey = Extract<
  LayerKey,
  | "projects"
  | "projectAreas"
  | "aerial"
  | "corridors"
  | "rtp"
  | "equity"
  | "engagement"
  | "crashes"
  | "transit"
>;

const LEGEND_ORDER: LegendLayerKey[] = [
  "projects",
  "projectAreas",
  "engagement",
  "aerial",
  "corridors",
  "rtp",
  "equity",
  "crashes",
  "transit",
];

const LEGEND_ENTRIES: Record<LegendLayerKey, LegendEntry> = {
  projects: { kind: "swatch", color: "#1f6b5e", label: "Projects" },
  // Same green family as the project marker, lower saturation: the area and the
  // site belong to the same project, and the area is the quieter of the two.
  projectAreas: { kind: "swatch", color: "#4f8a7b", label: "Project areas" },
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
  /**
   * Crash severity, keyed off the shared palette so the swatch and the Mapbox
   * paint expression cannot drift.
   *
   * All four KABCO buckets are listed because they are the vocabulary, not a
   * claim that every one of them is populated — the only currently storable
   * source cannot separate suspected serious injuries, and the layer's coverage
   * notes say so in the panel directly above this legend. Omitting the bucket
   * instead would leave a future full-KABCO source painting a colour with no key.
   */
  crashes: {
    kind: "ramp",
    label: "Crash severity",
    stops: CRASH_SEVERITY_LEGEND_ORDER.map((severity) => ({
      color: CRASH_SEVERITY_COLOR[severity],
      label: CRASH_SEVERITY_LEGEND_LABEL[severity],
    })),
  },
  /**
   * Transit stops by peak headway, keyed off the shared palette so the swatch
   * and the Mapbox paint expression cannot drift.
   *
   * THIS ENTRY WAS MISSING WHILE THE LAYER PAINTED THREE MEANING-BEARING
   * COLOURS. A planner could see frequent, basic and untiered stops as three
   * different dots with nothing on screen saying which was which, so the only
   * available readings were "guess" and "assume the darker one is better". An
   * unkeyed colour that carries a claim is worse than no colour at all: it is a
   * finding the reader invents.
   *
   * "No interval" is listed rather than omitted for the same reason the
   * unpopulated KABCO bucket is: the ramp documents what a colour MEANS, and a
   * stop with a single daily trip genuinely has no derivable headway.
   */
  transit: {
    kind: "ramp",
    label: TRANSIT_SERVICE_TIER_LEGEND_TITLE,
    stops: TRANSIT_SERVICE_TIER_LEGEND_ORDER.map((tier) => ({
      color: TRANSIT_SERVICE_TIER_COLOR[tier],
      label: TRANSIT_SERVICE_TIER_LEGEND_LABEL[tier],
    })),
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
