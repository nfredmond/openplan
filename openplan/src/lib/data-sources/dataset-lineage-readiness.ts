export type DatasetLineageFieldKey =
  | "citation"
  | "sourceUrl"
  | "license"
  | "vintage"
  | "schema"
  | "checksum"
  | "rowCount"
  | "refreshDate"
  | "geography"
  | "geometryAttachment";

export type DatasetLineageReadinessInput = {
  citationText?: string | null;
  sourceUrl?: string | null;
  licenseLabel?: string | null;
  vintageLabel?: string | null;
  schemaVersion?: string | null;
  checksum?: string | null;
  rowCount?: number | null;
  lastRefreshedAt?: string | null;
  geographyScope?: string | null;
  geometryAttachment?: string | null;
};

export type DatasetLineageReadinessLevel = "complete" | "usable" | "partial" | "not_ready";

export type DatasetLineageCheck = {
  key: DatasetLineageFieldKey;
  label: string;
  ready: boolean;
  detail: string;
};

export type DatasetLineageReadiness = {
  level: DatasetLineageReadinessLevel;
  label: string;
  detail: string;
  readyCount: number;
  totalCount: number;
  missing: string[];
  checks: DatasetLineageCheck[];
};

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasUsableRowCount(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function hasGeometryAttachment(value: string | null | undefined): boolean {
  return hasText(value) && value?.trim().toLowerCase() !== "none";
}

function check(
  key: DatasetLineageFieldKey,
  label: string,
  ready: boolean,
  readyDetail: string,
  missingDetail: string
): DatasetLineageCheck {
  return {
    key,
    label,
    ready,
    detail: ready ? readyDetail : missingDetail,
  };
}

export function resolveDatasetLineageReadiness(dataset: DatasetLineageReadinessInput): DatasetLineageReadiness {
  const checks: DatasetLineageCheck[] = [
    check("citation", "Citation", hasText(dataset.citationText), "Citation text is captured.", "Add citation text."),
    check(
      "sourceUrl",
      "Source URL",
      hasText(dataset.sourceUrl),
      "Source URL is captured.",
      "Add source URL or API endpoint."
    ),
    check(
      "license",
      "License",
      hasText(dataset.licenseLabel),
      "License posture is captured.",
      "Add license or use constraint."
    ),
    check("vintage", "Vintage", hasText(dataset.vintageLabel), "Vintage is captured.", "Add vintage or reporting period."),
    check("schema", "Schema", hasText(dataset.schemaVersion), "Schema version is captured.", "Add schema version."),
    check("checksum", "Checksum", hasText(dataset.checksum), "Checksum is captured.", "Add checksum or content hash."),
    check("rowCount", "Row count", hasUsableRowCount(dataset.rowCount), "Row count is captured.", "Add row count."),
    check("refreshDate", "Refresh date", hasText(dataset.lastRefreshedAt), "Refresh date is captured.", "Add last refresh date."),
    check("geography", "Geography", hasText(dataset.geographyScope), "Geography scope is captured.", "Add geography scope."),
    check(
      "geometryAttachment",
      "Geometry attachment",
      hasGeometryAttachment(dataset.geometryAttachment),
      "Geometry attachment is captured.",
      "Attach geometry or mark the dataset as registry-only."
    ),
  ];

  const readyCount = checks.filter((item) => item.ready).length;
  const missing = checks.filter((item) => !item.ready).map((item) => item.label);
  const hasCoreTrace =
    checks.find((item) => item.key === "citation")?.ready === true &&
    checks.find((item) => item.key === "sourceUrl")?.ready === true &&
    checks.find((item) => item.key === "license")?.ready === true &&
    checks.find((item) => item.key === "geography")?.ready === true &&
    checks.find((item) => item.key === "refreshDate")?.ready === true;

  if (readyCount === checks.length) {
    return {
      level: "complete",
      label: "Lineage complete",
      detail:
        "Citation, source URL, license, vintage, schema, checksum, row count, refresh date, geography, and geometry attachment are captured.",
      readyCount,
      totalCount: checks.length,
      missing,
      checks,
    };
  }

  if (readyCount >= 8 && hasCoreTrace) {
    return {
      level: "usable",
      label: "Lineage usable",
      detail: `Core lineage is traceable; fill ${missing.slice(0, 2).join(" and ")} before calling this audit-complete.`,
      readyCount,
      totalCount: checks.length,
      missing,
      checks,
    };
  }

  if (readyCount >= 4) {
    return {
      level: "partial",
      label: "Lineage partial",
      detail: `Some lineage fields are captured; missing ${missing.slice(0, 3).join(", ")}.`,
      readyCount,
      totalCount: checks.length,
      missing,
      checks,
    };
  }

  return {
    level: "not_ready",
    label: "Lineage not ready",
    detail:
      "Dataset lineage is too thin for audit handoff; capture source, license, vintage/schema, refresh, geography, and geometry posture.",
    readyCount,
    totalCount: checks.length,
    missing,
    checks,
  };
}

export function toneForDatasetLineageReadiness(
  level: DatasetLineageReadinessLevel
): "info" | "success" | "warning" | "danger" | "neutral" {
  if (level === "complete") return "success";
  if (level === "usable") return "info";
  if (level === "partial") return "warning";
  return "neutral";
}
