import { parse } from "csv-parse/sync";
import type { CountyOnrampScaffoldSummary } from "@/lib/models/county-onramp";

const PLACEHOLDER_TOKENS = new Set(["", "TBD", "N/A", "NA", "UNKNOWN"]);
const REQUIRED_COLUMNS = ["station_id", "observed_volume", "source_agency", "source_description"] as const;

export class CountyValidationScaffoldCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CountyValidationScaffoldCsvError";
  }
}

function normalizeCell(value: unknown): string {
  return String(value ?? "").trim();
}

function isPlaceholderText(value: unknown): boolean {
  return PLACEHOLDER_TOKENS.has(normalizeCell(value).toUpperCase());
}

function readHeaderColumns(csvContent: string): string[] {
  const rows = parse(csvContent, {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: false,
    to_line: 1,
  }) as string[][];

  const headerRow = rows[0];
  if (!headerRow || headerRow.length === 0) {
    throw new CountyValidationScaffoldCsvError("Scaffold CSV must include a header row.");
  }

  return headerRow.map((value) => normalizeCell(value));
}

export function normalizeCountyValidationScaffoldCsvContent(csvContent: string): string {
  const normalized = csvContent.replace(/\r\n/g, "\n").trimEnd();
  if (!normalized) {
    throw new CountyValidationScaffoldCsvError("Scaffold CSV content cannot be empty.");
  }
  return `${normalized}\n`;
}

export function summarizeCountyValidationScaffoldCsv(csvContent: string): CountyOnrampScaffoldSummary {
  const normalizedContent = normalizeCountyValidationScaffoldCsvContent(csvContent);
  const headerColumns = readHeaderColumns(normalizedContent);
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !headerColumns.includes(column));

  if (missingColumns.length > 0) {
    throw new CountyValidationScaffoldCsvError(
      `Scaffold CSV is missing required columns: ${missingColumns.join(", ")}`
    );
  }

  const rows = parse(normalizedContent, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: false,
  }) as Record<string, unknown>[];

  const stationCount = rows.length;
  const observedVolumeFilledCount = rows.filter((row) => !isPlaceholderText(row.observed_volume)).length;
  const sourceAgencyFilledCount = rows.filter((row) => !isPlaceholderText(row.source_agency)).length;
  const sourceDescriptionFilledCount = rows.filter((row) => !isPlaceholderText(row.source_description)).length;
  const readyStationCount = rows.filter(
    (row) =>
      !isPlaceholderText(row.observed_volume) &&
      !isPlaceholderText(row.source_agency) &&
      !isPlaceholderText(row.source_description)
  ).length;

  let nextActionLabel = "Regenerate the validation scaffold before sourcing observed counts.";
  if (stationCount > 0 && readyStationCount >= stationCount) {
    nextActionLabel =
      "All starter stations have observed counts and source metadata recorded. Tighten definitions if needed, then run validation.";
  } else if (stationCount > 0 && observedVolumeFilledCount === 0) {
    nextActionLabel = `Source observed counts for the ${stationCount} starter stations.`;
  } else if (stationCount > 0) {
    const remaining = stationCount - readyStationCount;
    nextActionLabel = `Complete source metadata and observed counts for the remaining ${remaining} starter stations.`;
  }

  return {
    station_count: stationCount,
    observed_volume_filled_count: observedVolumeFilledCount,
    observed_volume_missing_count: stationCount - observedVolumeFilledCount,
    source_agency_filled_count: sourceAgencyFilledCount,
    source_agency_tbd_count: stationCount - sourceAgencyFilledCount,
    source_description_filled_count: sourceDescriptionFilledCount,
    source_description_missing_count: stationCount - sourceDescriptionFilledCount,
    ready_station_count: readyStationCount,
    next_action_label: nextActionLabel,
  };
}
