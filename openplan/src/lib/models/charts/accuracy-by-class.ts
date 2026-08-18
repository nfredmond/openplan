/**
 * How accurate this run is, road class by road class.
 *
 * ================================================= WHY A FUNDER NEEDS THIS
 *
 * A single median error is the wrong summary for a document somebody makes a
 * funding decision from. Measured across 24 counties, a screening run's error
 * on freeways and on collectors differ by a factor of three — so "this model
 * is X% accurate" is true of no road in particular, and a corridor number
 * quoted from it inherits an accuracy nobody stated.
 *
 * This draws each class's own error with its own station count, so a reader
 * can see which roads the run can speak for. A class with one or two stations
 * is drawn and LABELLED as such rather than hidden: a 12% error over two
 * stations is not evidence, and pretending it is would be the failure this
 * whole lane exists to avoid.
 *
 * The 30% screening line is the gate OpenPlan already applies; drawing it lets
 * a reader see pass and fail without being told a verdict.
 */
import { CHART_PALETTE, type ChartMode } from "./palette";

export type RoadClassAccuracy = {
  roadClass: string;
  stations: number;
  medianAbsolutePercentError: number;
  /** Model / observed. Above 1 means the model puts too much traffic here. */
  medianModelOverObserved?: number | null;
};

export type AccuracyByClassOptions = {
  mode?: ChartMode;
  width?: number;
  title?: string;
  subtitle?: string;
  /** The screening gate, drawn as a reference line. */
  gatePercent?: number;
  /** Below this a class is drawn but marked as too few stations to rely on. */
  thinStationCount?: number;
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char
  );
}

const PADDING = { top: 64, right: 150, bottom: 36, left: 104 };

export function accuracyByClassSvg(
  rows: readonly RoadClassAccuracy[],
  options: AccuracyByClassOptions = {}
): string {
  const mode = options.mode ?? "light";
  const colors = CHART_PALETTE[mode];
  const width = options.width ?? 560;
  const gate = options.gatePercent ?? 30;
  const thin = options.thinStationCount ?? 5;
  const rowHeight = 30;
  const height = PADDING.top + Math.max(rows.length, 1) * rowHeight + PADDING.bottom;
  const plotWidth = width - PADDING.left - PADDING.right;

  if (rows.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 80" width="${width}" height="80"><rect width="${width}" height="80" fill="${colors.surface}"/><text x="${width / 2}" y="44" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" fill="${colors.textSecondary}">No count station matched this run, so its accuracy is unmeasured.</text></svg>`;
  }

  const maxError = Math.max(...rows.map((row) => row.medianAbsolutePercentError), gate * 1.5);
  const scale = (value: number) => (value / maxError) * plotWidth;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Median error by road class, against the screening threshold">`,
    `<rect width="${width}" height="${height}" fill="${colors.surface}"/>`
  );
  if (options.title) {
    parts.push(`<text x="16" y="22" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="${colors.textPrimary}">${escapeXml(options.title)}</text>`);
  }
  if (options.subtitle) {
    parts.push(`<text x="16" y="38" font-family="system-ui,sans-serif" font-size="11" fill="${colors.textSecondary}">${escapeXml(options.subtitle)}</text>`);
  }

  const gateX = PADDING.left + scale(gate);
  parts.push(
    `<line x1="${gateX.toFixed(1)}" y1="${PADDING.top - 8}" x2="${gateX.toFixed(1)}" y2="${(PADDING.top + rows.length * rowHeight).toFixed(1)}" stroke="${colors.reference}" stroke-width="1" stroke-dasharray="4 3"/>`,
    `<text x="${(gateX + 4).toFixed(1)}" y="${PADDING.top - 12}" font-family="system-ui,sans-serif" font-size="10" fill="${colors.textSecondary}">${gate}% screening threshold</text>`
  );

  rows.forEach((row, index) => {
    const top = PADDING.top + index * rowHeight;
    const barWidth = Math.max(1, scale(row.medianAbsolutePercentError));
    const withinGate = row.medianAbsolutePercentError <= gate;
    const isThin = row.stations < thin;
    const fill = withinGate ? colors.good : colors.series[1];
    parts.push(
      `<text x="${PADDING.left - 10}" y="${top + 15}" text-anchor="end" font-family="system-ui,sans-serif" font-size="11" fill="${colors.textPrimary}">${escapeXml(row.roadClass)}</text>`,
      `<rect x="${PADDING.left}" y="${top + 4}" width="${barWidth.toFixed(1)}" height="14" rx="4" fill="${fill}" fill-opacity="${isThin ? 0.45 : 1}"><title>${escapeXml(row.roadClass)}: median error ${row.medianAbsolutePercentError.toFixed(1)}% over ${row.stations} station${row.stations === 1 ? "" : "s"}</title></rect>`,
      `<text x="${(PADDING.left + barWidth + 6).toFixed(1)}" y="${top + 15}" font-family="system-ui,sans-serif" font-size="10" fill="${colors.textSecondary}">${row.medianAbsolutePercentError.toFixed(0)}% · ${row.stations} stn${isThin ? " · too few to rely on" : ""}</text>`
    );
  });

  parts.push(
    `<text x="${PADDING.left}" y="${height - 10}" font-family="system-ui,sans-serif" font-size="10" fill="${colors.textSecondary}">Median difference between modelled and observed volume</text>`,
    `</svg>`
  );
  return parts.join("");
}

/** The same figures as rows, so the document can carry a table beside the chart. */
export function accuracyByClassRows(rows: readonly RoadClassAccuracy[]): RoadClassAccuracy[] {
  return [...rows].sort((a, b) => a.medianAbsolutePercentError - b.medianAbsolutePercentError);
}
