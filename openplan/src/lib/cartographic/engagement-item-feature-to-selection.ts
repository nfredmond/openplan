import type { CartographicInspectorSelection } from "@/components/cartographic/cartographic-inspector-dock";

export type EngagementItemFeatureProperties = {
  kind: "engagement_item";
  itemId: string;
  campaignId: string;
  title: string | null;
  excerpt: string;
  status: string;
  sourceType: string;
  categoryLabel: string | null;
};

type NavigateOptions = {
  navigate: (path: string) => void;
  // Optional Mapbox source id so the resulting selection carries a
  // round-trip reference the backdrop can highlight via feature-state.
  sourceId?: string;
};

export function isEngagementItemFeatureProperties(
  value: unknown,
): value is EngagementItemFeatureProperties {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === "engagement_item" &&
    typeof v.itemId === "string" &&
    v.itemId.length > 0 &&
    typeof v.campaignId === "string" &&
    v.campaignId.length > 0 &&
    (v.title === null || typeof v.title === "string") &&
    typeof v.excerpt === "string" &&
    typeof v.status === "string" &&
    typeof v.sourceType === "string" &&
    (v.categoryLabel === null || typeof v.categoryLabel === "string")
  );
}

export function engagementItemFeatureToSelection(
  properties: unknown,
  { navigate, sourceId }: NavigateOptions,
): CartographicInspectorSelection | null {
  if (!isEngagementItemFeatureProperties(properties)) return null;

  const titleCandidate = properties.title?.trim() ?? "";
  const title = titleCandidate.length > 0 ? titleCandidate : "Community input";

  const meta: CartographicInspectorSelection["meta"] = [
    { label: "status", value: properties.status },
    { label: "source", value: properties.sourceType },
  ];
  if (properties.categoryLabel) {
    meta.push({ label: "category", value: properties.categoryLabel });
  }
  if (properties.excerpt.trim().length > 0) {
    meta.push({ label: "excerpt", value: properties.excerpt });
  }

  const selection: CartographicInspectorSelection = {
    kind: "engagement",
    title,
    kicker: "Community input",
    avatarChar: "G",
    meta,
    primaryAction: {
      label: "Open campaign",
      onClick: () => navigate(`/engagement/${properties.campaignId}`),
    },
  };

  if (sourceId) {
    selection.featureRef = { sourceId, featureId: properties.itemId };
  }

  return selection;
}
