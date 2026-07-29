import type { CartographicInspectorSelection } from "@/components/cartographic/cartographic-inspector-dock";
import { DRAWN_PLACE_SOURCE } from "@/lib/geographies/place-of-record";

/**
 * The area a project studies — the project's place of record (`place_*` on
 * `projects`, migration 20260728000009), not its site marker.
 *
 * The two are deliberately separate layers on the shared map because they are
 * separate facts: `latitude`/`longitude` is the intersection or bridge being
 * worked on, this is the area the work covers. A project legitimately has both,
 * and collapsing them would make one of them a guess.
 */
export type ProjectAreaFeatureProperties = {
  kind: "project_area";
  projectId: string;
  projectName: string;
  status: string;
  /** Resolver that produced the area — 'tigerweb', or 'drawn' for a hand-drawn one. */
  placeSource: string | null;
  /** The resolver's own kind vocabulary (county / city / cdp / metro / micro). */
  placeKind: string | null;
  placeLabel: string | null;
};

type NavigateOptions = {
  navigate: (path: string) => void;
  // Optional Mapbox source id so the resulting selection carries a
  // round-trip reference the backdrop can highlight via feature-state.
  sourceId?: string;
};

export function isProjectAreaFeatureProperties(
  value: unknown,
): value is ProjectAreaFeatureProperties {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === "project_area" &&
    typeof v.projectId === "string" &&
    v.projectId.length > 0 &&
    typeof v.projectName === "string" &&
    typeof v.status === "string" &&
    (v.placeSource === null || typeof v.placeSource === "string") &&
    (v.placeKind === null || typeof v.placeKind === "string") &&
    (v.placeLabel === null || typeof v.placeLabel === "string")
  );
}

/**
 * What to call the area itself.
 *
 * A drawn shape has NO identity by construction — the schema forbids it a ref,
 * and the whole point of that rule is that nothing downstream guesses which
 * jurisdiction contains it. So it is described as a drawn area and never given a
 * kind it does not have.
 */
function describeArea(properties: ProjectAreaFeatureProperties): string {
  if (properties.placeSource === DRAWN_PLACE_SOURCE) return "drawn area";
  const label = properties.placeLabel?.trim();
  if (label && label.length > 0) return label;
  if (properties.placeKind) return `unnamed ${properties.placeKind}`;
  return "area not named by its source";
}

export function projectAreaFeatureToSelection(
  properties: unknown,
  { navigate, sourceId }: NavigateOptions,
): CartographicInspectorSelection | null {
  if (!isProjectAreaFeatureProperties(properties)) return null;

  const title =
    properties.projectName.trim().length > 0 ? properties.projectName : "Untitled project";

  const meta: CartographicInspectorSelection["meta"] = [
    { label: "area", value: describeArea(properties) },
    { label: "status", value: properties.status },
  ];
  // The kind is only meaningful for a resolved place; a drawn shape has none,
  // and printing "drawn" twice adds nothing.
  if (properties.placeSource !== DRAWN_PLACE_SOURCE && properties.placeKind) {
    meta.push({ label: "kind", value: properties.placeKind });
  }

  const selection: CartographicInspectorSelection = {
    kind: "project_area",
    title,
    kicker: "Project area",
    avatarChar: "A",
    meta,
    primaryAction: {
      label: "Open project",
      onClick: () => navigate(`/projects/${properties.projectId}`),
    },
  };

  if (sourceId) {
    selection.featureRef = { sourceId, featureId: properties.projectId };
  }

  return selection;
}
