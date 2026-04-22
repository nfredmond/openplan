import type { CartographicInspectorSelection } from "@/components/cartographic/cartographic-inspector-dock";

export type ProjectFeatureProperties = {
  kind: "project";
  projectId: string;
  name: string;
  status: string;
  deliveryPhase: string;
  planType: string | null;
};

type NavigateOptions = {
  navigate: (path: string) => void;
  // Optional Mapbox source id so the resulting selection carries a
  // round-trip reference the backdrop can highlight via feature-state.
  sourceId?: string;
};

export function isProjectFeatureProperties(
  value: unknown,
): value is ProjectFeatureProperties {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === "project" &&
    typeof v.projectId === "string" &&
    v.projectId.length > 0 &&
    typeof v.name === "string" &&
    typeof v.status === "string" &&
    typeof v.deliveryPhase === "string" &&
    (v.planType === null || typeof v.planType === "string")
  );
}

export function projectFeatureToSelection(
  properties: unknown,
  { navigate, sourceId }: NavigateOptions,
): CartographicInspectorSelection | null {
  if (!isProjectFeatureProperties(properties)) return null;

  const title = properties.name.trim().length > 0 ? properties.name : "Untitled project";

  const meta: CartographicInspectorSelection["meta"] = [
    { label: "status", value: properties.status },
    { label: "phase", value: properties.deliveryPhase },
  ];
  if (properties.planType) {
    meta.push({ label: "type", value: properties.planType });
  }

  const selection: CartographicInspectorSelection = {
    kind: "project",
    title,
    kicker: "Project",
    avatarChar: "P",
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
