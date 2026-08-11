import { csvCellForValue, escapeCsvField } from "@/lib/export/csv";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyMetricValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

/** Flatten WITHOUT stringifying, so the CSV writer still knows which values are numbers. */
function flattenMetricsRaw(metrics: Record<string, unknown>): Record<string, unknown> {
  const rows: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metrics)) {
    if ((key === "dataQuality" || key === "mapViewState") && isRecord(value)) {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        rows[`${key}.${nestedKey}`] = nestedValue;
      }
      continue;
    }

    rows[key] = value;
  }

  return rows;
}

export function flattenMetricsForCsv(metrics: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(flattenMetricsRaw(metrics)).map(([key, value]) => [key, stringifyMetricValue(value)])
  );
}

// CSV escaping is the SHARED layer (`@/lib/export/csv`): quoting plus formula
// neutralization for string values. The serializers below hand it the RAW
// value (via csvCellForValue), not a pre-stringified one, so a real number —
// a negative score delta, a coordinate — stays a bare, computable number
// while untrusted text starting `=` `+` `-` `@` is defused. Header keys are
// our own identifiers; escapeCsvField keeps them RFC-4180-safe.

export function serializeMetricsToCsv(metrics: Record<string, unknown>): string {
  const flat = flattenMetricsRaw(metrics);
  const keys = Object.keys(flat).sort((a, b) => a.localeCompare(b));
  const header = keys.map(escapeCsvField).join(",");
  const values = keys.map((key) => csvCellForValue(flat[key])).join(",");
  return `${header}\n${values}\n`;
}

export function serializeRecordsToCsv(records: Array<Record<string, unknown>>): string {
  if (records.length === 0) {
    return "\n";
  }

  const keys = Array.from(
    records.reduce((set, record) => {
      Object.keys(record).forEach((key) => set.add(key));
      return set;
    }, new Set<string>())
  ).sort((a, b) => a.localeCompare(b));

  const header = keys.map(escapeCsvField).join(",");
  const rows = records.map((record) =>
    keys.map((key) => csvCellForValue(record[key])).join(",")
  );

  return `${header}\n${rows.join("\n")}\n`;
}

export function downloadText(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadMetricsCsv(
  metrics: Record<string, unknown>,
  filename = "openplan-metrics.csv"
) {
  const csv = serializeMetricsToCsv(metrics);
  downloadText(csv, filename, "text/csv;charset=utf-8");
}

export function downloadRecordsCsv(
  records: Array<Record<string, unknown>>,
  filename = "openplan-records.csv"
) {
  const csv = serializeRecordsToCsv(records);
  downloadText(csv, filename, "text/csv;charset=utf-8");
}

export function downloadGeojson(
  geojson: GeoJSON.FeatureCollection,
  filename = "openplan-result.geojson"
) {
  const serialized = JSON.stringify(geojson, null, 2);
  downloadText(serialized, filename, "application/geo+json;charset=utf-8");
}
