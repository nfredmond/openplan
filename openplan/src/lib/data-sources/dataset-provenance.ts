export type DatasetProvenanceInput = {
  connectorId?: string | null;
  citationText?: string | null;
  sourceUrl?: string | null;
  licenseLabel?: string | null;
  schemaVersion?: string | null;
  checksum?: string | null;
  vintageLabel?: string | null;
  lastRefreshedAt?: string | null;
};

export type DatasetTrustLevel = "verified" | "traceable" | "partial" | "unverified";

export type DatasetTrustLabel = {
  level: DatasetTrustLevel;
  label: string;
  detail: string;
  missing: string[];
};

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function resolveDatasetTrustLabel(dataset: DatasetProvenanceInput): DatasetTrustLabel {
  const hasOrigin = hasText(dataset.connectorId) || hasText(dataset.sourceUrl);
  const hasCitation = hasText(dataset.citationText);
  const hasLicense = hasText(dataset.licenseLabel);
  const hasVersion = hasText(dataset.schemaVersion) || hasText(dataset.vintageLabel);
  const hasIntegrity = hasText(dataset.checksum);
  const hasRefresh = hasText(dataset.lastRefreshedAt);

  const missing = [
    !hasOrigin ? "source" : null,
    !hasCitation ? "citation" : null,
    !hasLicense ? "license" : null,
    !hasVersion ? "version/vintage" : null,
    !hasIntegrity ? "checksum" : null,
    !hasRefresh ? "refresh timestamp" : null,
  ].filter((item): item is string => Boolean(item));

  if (hasOrigin && hasCitation && hasLicense && hasVersion && hasIntegrity && hasRefresh) {
    return {
      level: "verified",
      label: "Verified provenance",
      detail: "Source, citation, license, version, checksum, and refresh timestamp are captured.",
      missing,
    };
  }

  if (hasOrigin && (hasCitation || hasLicense) && hasVersion && (hasIntegrity || hasRefresh)) {
    return {
      level: "traceable",
      label: "Traceable provenance",
      detail: `Operationally traceable; add ${missing.slice(0, 2).join(" and ")} to complete audit readiness.`,
      missing,
    };
  }

  if (hasOrigin || hasCitation || hasLicense || hasVersion || hasIntegrity || hasRefresh) {
    return {
      level: "partial",
      label: "Partial provenance",
      detail: `Some source metadata is captured; missing ${missing.slice(0, 3).join(", ")}.`,
      missing,
    };
  }

  return {
    level: "unverified",
    label: "Unverified provenance",
    detail: "No source, citation, license, version, checksum, or refresh metadata has been captured yet.",
    missing,
  };
}

export function toneForDatasetTrustLevel(level: DatasetTrustLevel): "info" | "success" | "warning" | "danger" | "neutral" {
  if (level === "verified") return "success";
  if (level === "traceable") return "info";
  if (level === "partial") return "warning";
  return "neutral";
}
