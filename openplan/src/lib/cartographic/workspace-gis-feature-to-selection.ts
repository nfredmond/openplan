/**
 * A clicked shape from one of the workspace's own uploaded layers, turned into
 * an inspector selection.
 *
 * WHY THIS EXISTS AT ALL. Before the importer read the `.dbf`, a shapefile's
 * features carried `properties: {}` — so a bike network uploaded into OpenPlan
 * drew correctly and clicked through to nothing. A layer you cannot interrogate
 * is a picture of your data rather than your data, and the whole point of
 * bringing an agency's own GIS in is that a planner can ask it questions. This
 * module is the answer surface.
 *
 * WHAT IT WILL NOT DO. It never invents a title. If the layer has no label field
 * and the shape carries no obvious name, the selection is titled by its position
 * in the file ("Shape 412") rather than by guessing which attribute is the name
 * — a guessed title on a parcel layer would confidently show an APN as a street
 * address, and nothing on screen would say it was a guess.
 *
 * PURE — no I/O, no clock. Mirrors `tract-feature-to-selection.ts`.
 */

import type { CartographicInspectorSelection } from "@/components/cartographic/cartographic-inspector-dock";

export type WorkspaceGisFeatureProperties = {
  kind: "workspace_gis_feature";
  layerId: string;
  versionId: string;
  featureIndex: number;
  attributes: Record<string, unknown>;
};

type SelectionOptions = {
  /** The planner's own name for the layer. Never derived from the data. */
  layerName: string;
  /** "Version 3", or null when the caller has no version label to hand. */
  versionLabel?: string | null;
  /** The attribute the layer labels shapes by, when the planner chose one. */
  labelField?: string | null;
  /** Mapbox source id, so the selection carries a highlightable reference. */
  sourceId?: string;
};

/**
 * How many attributes reach the inspector dock.
 *
 * The dock is a single strip along the bottom of the map, and a parcels layer
 * routinely carries forty columns. Rendering all of them would push the strip
 * over the map it describes. The cap is DISCLOSED — the last meta item says how
 * many were not shown — because a silently truncated attribute list is a planner
 * concluding their file lacks a column it in fact has.
 */
export const WORKSPACE_GIS_INSPECTOR_ATTRIBUTE_LIMIT = 6;

/**
 * Mapbox GL does not guarantee that a nested `properties` value survives as an
 * object: a GeoJSON source round-trips feature properties through its own
 * serializer, and a nested object can arrive as its JSON text. Both readings are
 * accepted here rather than only the one seen in a dev build — the alternative
 * is an inspector that works in a test and shows an empty attribute list in the
 * browser, which is exactly the class of defect this lane keeps producing.
 */
function coerceAttributes(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Not JSON. An unreadable attribute blob is an empty one, never a
      // fabricated one.
    }
  }
  return {};
}

export function isWorkspaceGisFeatureProperties(
  value: unknown,
): value is WorkspaceGisFeatureProperties {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === "workspace_gis_feature" &&
    typeof v.layerId === "string" &&
    v.layerId.length > 0 &&
    typeof v.versionId === "string" &&
    v.versionId.length > 0 &&
    typeof v.featureIndex === "number" &&
    Number.isFinite(v.featureIndex)
  );
}

/** An attribute value as text. `null` and `undefined` become an em dash, never "null". */
function formatAttributeValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toLocaleString("en-US") : "—";
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return "—";
    return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
  }
  return "—";
}

export function workspaceGisFeatureToSelection(
  properties: unknown,
  { layerName, versionLabel = null, labelField = null, sourceId }: SelectionOptions,
): CartographicInspectorSelection | null {
  if (!isWorkspaceGisFeatureProperties(properties)) return null;

  const attributes = coerceAttributes(
    (properties as unknown as Record<string, unknown>).attributes,
  );
  const entries = Object.entries(attributes);

  // The title comes from the layer's chosen label field, and from nowhere else.
  const labelValue =
    labelField && labelField in attributes ? formatAttributeValue(attributes[labelField]) : null;
  const title =
    labelValue && labelValue !== "—"
      ? labelValue
      : `Shape ${(properties.featureIndex + 1).toLocaleString("en-US")}`;

  const shown = entries.slice(0, WORKSPACE_GIS_INSPECTOR_ATTRIBUTE_LIMIT);
  const meta: CartographicInspectorSelection["meta"] = shown.map(([name, value]) => ({
    label: name,
    value: formatAttributeValue(value),
  }));

  const hidden = entries.length - shown.length;
  if (hidden > 0) {
    // Stated, not silently dropped: the planner otherwise reads this strip as
    // the whole attribute record.
    meta.push({
      label: hidden === 1 ? "more attribute not shown" : "more attributes not shown",
      value: hidden.toLocaleString("en-US"),
    });
  }

  if (entries.length === 0) {
    meta.push({
      label: "this shape carries no attributes",
      value: "—",
    });
  }

  const selection: CartographicInspectorSelection = {
    kind: "workspace_gis_feature",
    title,
    // The KICKER names the layer and the version, because on a map carrying four
    // uploaded layers "which layer did I just click?" is the first question, and
    // "which upload am I looking at?" is the second — a 2025 parcel and a 2026
    // parcel are the same shape on screen.
    kicker: versionLabel ? `${layerName} · ${versionLabel}` : layerName,
    avatarChar: "L",
    meta,
  };

  if (sourceId) {
    selection.featureRef = { sourceId, featureId: properties.featureIndex };
  }

  return selection;
}
