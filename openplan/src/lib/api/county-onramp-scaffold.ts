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

/**
 * Which count stations a PERSON changed, comparing a save against what was
 * there before.
 *
 * WHY THIS MATTERS MORE THAN IT SOUNDS. Observed counts reach a run two ways:
 * fetched from a state DOT's published feed, or typed in by a planner. Once
 * they are in the same CSV column they are indistinguishable — and they carry
 * completely different authority. "Caltrans measured 27,000 here in 2023" and
 * "someone at the agency believed it was about 27,000" are not the same
 * evidence, and a grant reviewer is entitled to know which one a figure rests
 * on.
 *
 * Compares by `station_id` and reports only the fields that actually moved. A
 * save that changed nothing reports nothing: re-saving an untouched scaffold
 * must not make every count look hand-entered.
 */
export function diffCountyValidationScaffoldEdits(
  previousCsvContent: string | null | undefined,
  nextCsvContent: string
): { stationId: string; fields: string[] }[] {
  const trackedFields = ["observed_volume", "source_agency", "source_description"] as const;

  const readRows = (content: string | null | undefined): Map<string, Record<string, string>> => {
    if (!content || !content.trim()) return new Map();
    try {
      const rows = parse(normalizeCountyValidationScaffoldCsvContent(content), {
        bom: true,
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Record<string, unknown>[];
      return new Map(
        rows
          .map((row) => [normalizeCell(row.station_id), row] as const)
          .filter(([stationId]) => stationId.length > 0)
          .map(([stationId, row]) => [
            stationId,
            Object.fromEntries(trackedFields.map((field) => [field, normalizeCell(row[field])])),
          ])
      );
    } catch {
      // An unreadable previous version cannot tell us what changed. Reporting
      // NO edits is the honest answer — claiming every station was edited
      // because the old copy would not parse would overstate a person's
      // involvement, and this record is used to qualify evidence.
      return new Map();
    }
  };

  const previous = readRows(previousCsvContent);
  const next = readRows(nextCsvContent);

  const edits: { stationId: string; fields: string[] }[] = [];
  for (const [stationId, nextRow] of next) {
    const previousRow = previous.get(stationId);
    // No earlier version of this station, so nobody changed it: either this is
    // the first save, or the worksheet was regenerated and the station arrived
    // with whatever the generator gave it. This single guard also covers the
    // whole-file cases — a missing or unreadable previous version leaves every
    // lookup empty and yields no edits, which is the honest answer when the
    // comparison cannot be made. (An earlier redundant early-return for those
    // cases was removed: a mutation proved it changed nothing, and a branch no
    // test can kill is a branch that will drift.)
    if (!previousRow) continue;
    const changed = trackedFields.filter((field) => previousRow[field] !== nextRow[field]);
    if (changed.length > 0) edits.push({ stationId, fields: [...changed] });
  }
  return edits;
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
