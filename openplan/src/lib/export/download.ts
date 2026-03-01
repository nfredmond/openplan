
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

function escapeCsvCell(value: string): string {
  if (value.includes('"') || value.includes(",") || value.includes("\n")) {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return value;
}

export function flattenMetricsForCsv(metrics: Record<string, unknown>): Record<string, string> {
  const rows: Record<string, string> = {};

  for (const [key, value] of Object.entries(metrics)) {
    if (key === "dataQuality" && isRecord(value)) {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        rows[`dataQuality.${nestedKey}`] = stringifyMetricValue(nestedValue);
      }
      continue;
    }

    rows[key] = stringifyMetricValue(value);
  }

  return rows;
}

export function serializeMetricsToCsv(metrics: Record<string, unknown>): string {
  const flat = flattenMetricsForCsv(metrics);
  const keys = Object.keys(flat).sort((a, b) => a.localeCompare(b));
  const header = keys.map(escapeCsvCell).join(",");
  const values = keys.map((key) => escapeCsvCell(flat[key] ?? "")).join(",");
  return `${header}\n${values}\n`;
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

export function downloadGeojson(
  geojson: GeoJSON.FeatureCollection,
  filename = "openplan-result.geojson"
) {
  const serialized = JSON.stringify(geojson, null, 2);
  downloadText(serialized, filename, "application/geo+json;charset=utf-8");
}
