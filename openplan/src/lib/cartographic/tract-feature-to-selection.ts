import type { CartographicInspectorSelection } from "@/components/cartographic/cartographic-inspector-dock";

export type TractFeatureProperties = {
  kind: "census_tract";
  geoid: string;
  name: string | null;
  popTotal: number | null;
  pctZeroVehicle: number | null;
  pctPoverty: number | null;
  pctNonwhite: number | null;
};

type SelectionOptions = {
  // Optional Mapbox source id so the resulting selection carries a
  // round-trip reference the backdrop can highlight via feature-state.
  sourceId?: string;
};

export function isTractFeatureProperties(
  value: unknown,
): value is TractFeatureProperties {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === "census_tract" &&
    typeof v.geoid === "string" &&
    v.geoid.length > 0 &&
    (v.name === null || typeof v.name === "string") &&
    (v.popTotal === null || typeof v.popTotal === "number") &&
    (v.pctZeroVehicle === null || typeof v.pctZeroVehicle === "number") &&
    (v.pctPoverty === null || typeof v.pctPoverty === "number") &&
    (v.pctNonwhite === null || typeof v.pctNonwhite === "number")
  );
}

function fmtInt(value: number | null): string {
  if (value === null) return "—";
  return Math.round(value).toLocaleString("en-US");
}

function fmtPct(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(1)}%`;
}

/**
 * Map a Mapbox feature properties payload for a census tract to the
 * inspector-dock selection shape. First layer with no navigable detail
 * page, so there is no primary action — the dock renders this as an
 * informational selection.
 */
export function tractFeatureToSelection(
  properties: unknown,
  { sourceId }: SelectionOptions = {},
): CartographicInspectorSelection | null {
  if (!isTractFeatureProperties(properties)) return null;

  const title =
    properties.name && properties.name.trim().length > 0
      ? properties.name
      : `Census tract ${properties.geoid}`;

  const meta: CartographicInspectorSelection["meta"] = [
    { label: "population", value: fmtInt(properties.popTotal) },
    { label: "zero-vehicle", value: fmtPct(properties.pctZeroVehicle) },
    { label: "poverty", value: fmtPct(properties.pctPoverty) },
  ];
  if (properties.pctNonwhite !== null) {
    meta.push({ label: "nonwhite", value: fmtPct(properties.pctNonwhite) });
  }

  const selection: CartographicInspectorSelection = {
    kind: "census_tract",
    title,
    kicker: "Census tract",
    avatarChar: "E",
    meta,
  };

  if (sourceId) {
    selection.featureRef = { sourceId, featureId: properties.geoid };
  }

  return selection;
}
