import type { CartographicInspectorSelection } from "@/components/cartographic/cartographic-inspector-dock";

export type RtpCycleFeatureProperties = {
  kind: "rtp_cycle";
  rtpCycleId: string;
  title: string;
  status: string;
  geographyLabel: string | null;
  horizonStartYear: number | null;
  horizonEndYear: number | null;
};

type NavigateOptions = {
  navigate: (path: string) => void;
  // Optional Mapbox source id so the resulting selection carries a
  // round-trip reference the backdrop can highlight via feature-state.
  sourceId?: string;
};

export function isRtpCycleFeatureProperties(
  value: unknown,
): value is RtpCycleFeatureProperties {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === "rtp_cycle" &&
    typeof v.rtpCycleId === "string" &&
    v.rtpCycleId.length > 0 &&
    typeof v.title === "string" &&
    typeof v.status === "string" &&
    (v.geographyLabel === null || typeof v.geographyLabel === "string") &&
    (v.horizonStartYear === null || typeof v.horizonStartYear === "number") &&
    (v.horizonEndYear === null || typeof v.horizonEndYear === "number")
  );
}

export function rtpCycleFeatureToSelection(
  properties: unknown,
  { navigate, sourceId }: NavigateOptions,
): CartographicInspectorSelection | null {
  if (!isRtpCycleFeatureProperties(properties)) return null;

  const title = properties.title.trim().length > 0 ? properties.title : "Untitled RTP cycle";

  const meta: CartographicInspectorSelection["meta"] = [
    { label: "status", value: properties.status },
  ];
  if (properties.geographyLabel) {
    meta.push({ label: "geography", value: properties.geographyLabel });
  }
  if (properties.horizonStartYear !== null && properties.horizonEndYear !== null) {
    meta.push({
      label: "horizon",
      value: `${properties.horizonStartYear}–${properties.horizonEndYear}`,
    });
  }

  const selection: CartographicInspectorSelection = {
    kind: "rtp",
    title,
    kicker: "RTP cycle",
    avatarChar: "R",
    meta,
    primaryAction: {
      label: "Open cycle",
      onClick: () => navigate(`/rtp/${properties.rtpCycleId}`),
    },
  };

  if (sourceId) {
    selection.featureRef = { sourceId, featureId: properties.rtpCycleId };
  }

  return selection;
}
