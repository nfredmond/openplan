import type { CartographicInspectorSelection } from "@/components/cartographic/cartographic-inspector-dock";

export type CorridorFeatureProperties = {
  kind: "corridor";
  corridorId: string;
  projectId: string | null;
  name: string;
  corridorType: string;
  losGrade: string | null;
};

type NavigateOptions = {
  navigate: (path: string) => void;
  sourceId?: string;
};

export function isCorridorFeatureProperties(
  value: unknown,
): value is CorridorFeatureProperties {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === "corridor" &&
    typeof v.corridorId === "string" &&
    v.corridorId.length > 0 &&
    (v.projectId === null || typeof v.projectId === "string") &&
    typeof v.name === "string" &&
    typeof v.corridorType === "string" &&
    (v.losGrade === null || typeof v.losGrade === "string")
  );
}

export function corridorFeatureToSelection(
  properties: unknown,
  { navigate, sourceId }: NavigateOptions,
): CartographicInspectorSelection | null {
  if (!isCorridorFeatureProperties(properties)) return null;

  const title = properties.name.trim().length > 0 ? properties.name : "Untitled corridor";

  const meta: CartographicInspectorSelection["meta"] = [
    { label: "type", value: properties.corridorType },
  ];
  if (properties.losGrade) {
    meta.push({ label: "LOS", value: properties.losGrade });
  }

  const selection: CartographicInspectorSelection = {
    kind: "corridor",
    title,
    kicker: "Corridor",
    avatarChar: "C",
    meta,
  };

  if (properties.projectId) {
    const { projectId } = properties;
    selection.primaryAction = {
      label: "Open project",
      onClick: () => navigate(`/projects/${projectId}`),
    };
  }

  if (sourceId) {
    selection.featureRef = { sourceId, featureId: properties.corridorId };
  }

  return selection;
}
