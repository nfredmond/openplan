import type { CartographicInspectorSelection } from "@/components/cartographic/cartographic-inspector-dock";

export type AerialMissionFeatureProperties = {
  kind: "aerial_mission";
  missionId: string;
  projectId: string | null;
  title: string;
  status: string;
  missionType: string;
};

type NavigateOptions = {
  navigate: (path: string) => void;
  // Optional Mapbox source id so the resulting selection carries a
  // round-trip reference the backdrop can highlight via feature-state.
  sourceId?: string;
};

export function isAerialMissionFeatureProperties(
  value: unknown,
): value is AerialMissionFeatureProperties {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === "aerial_mission" &&
    typeof v.missionId === "string" &&
    v.missionId.length > 0 &&
    typeof v.title === "string" &&
    typeof v.status === "string" &&
    typeof v.missionType === "string" &&
    (v.projectId === null || typeof v.projectId === "string")
  );
}

export function aerialMissionFeatureToSelection(
  properties: unknown,
  { navigate, sourceId }: NavigateOptions,
): CartographicInspectorSelection | null {
  if (!isAerialMissionFeatureProperties(properties)) return null;

  const title = properties.title.trim().length > 0 ? properties.title : "Untitled mission";

  const selection: CartographicInspectorSelection = {
    kind: "mission",
    title,
    kicker: "Aerial mission",
    avatarChar: "A",
    meta: [
      { label: "status", value: properties.status },
      { label: "type", value: properties.missionType },
    ],
    primaryAction: {
      label: "Open mission",
      onClick: () => navigate(`/aerial/missions/${properties.missionId}`),
    },
  };

  if (properties.projectId) {
    selection.secondaryAction = {
      label: "Open project",
      onClick: () => navigate(`/projects/${properties.projectId}`),
    };
  }

  if (sourceId) {
    selection.featureRef = { sourceId, featureId: properties.missionId };
  }

  return selection;
}
