/**
 * Modelled volume against observed count, one dot per station.
 *
 * ================================================ WHY THIS CHART, FIRST
 *
 * It is the standard picture in traffic modelling, and it answers in one look
 * what a median error cannot: whether the model is biased (the cloud sits above
 * or below the 1:1 line), how much spread there is, and whether a handful of
 * outliers are carrying the summary statistic.
 *
 * It would have made a real defect obvious on the day it shipped. Ramp counts
 * matched to mainline links put a vertical stripe of points at the far left —
 * tiny observed values against large modelled ones. That defect survived
 * months of median-error reporting and was found by inspecting rows.
 *
 * ============================================================== THE SCALE
 *
 * Log-log, because station volumes span four orders of magnitude (80 to 87,000
 * in the study counties). On a linear scale every rural station collapses onto
 * the origin and the chart becomes a picture of the three biggest freeways.
 *
 * Ratio bands (2x and 0.5x) are drawn rather than a regression line: a fitted
 * line invites reading a correction factor off the chart, which is exactly the
 * scalar-fitting trap this lane has documented. The bands say how far off a
 * point is; they do not propose a fix.
 */
import { CHART_PALETTE, type ChartMode } from "./palette";

export type AccuracyPoint = {
  stationId: string;
  label: string;
  observed: number;
  modelled: number;
  roadClass?: string | null;
};

export type AccuracyScatterOptions = {
  mode?: ChartMode;
  width?: number;
  height?: number;
  title?: string;
  /** Rendered under the title. The caption a funder reads. */
  subtitle?: string;
};

const PADDING = { top: 44, right: 20, bottom: 48, left: 62 };

function niceLogTicks(min: number, max: number): number[] {
  const ticks: number[] = [];
  for (let exponent = Math.floor(Math.log10(min)); exponent <= Math.ceil(Math.log10(max)); exponent += 1) {
    ticks.push(10 ** exponent);
  }
  return ticks.filter((tick) => tick >= min / 1.5 && tick <= max * 1.5);
}

function formatTick(value: number): string {
  if (value >= 1000) return `${value / 1000}k`;
  return String(value);
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char
  );
}

/**
 * Returns SVG markup. A string rather than JSX so the same chart can be
 * embedded in a React page AND in the Markdown provenance document a funder
 * reads — one implementation, so the two can never disagree about what the
 * model said.
 */
export function accuracyScatterSvg(
  points: readonly AccuracyPoint[],
  options: AccuracyScatterOptions = {}
): string {
  const mode = options.mode ?? "light";
  const colors = CHART_PALETTE[mode];
  const width = options.width ?? 560;
  const height = options.height ?? 420;
  const plotWidth = width - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;

  const usable = points.filter(
    (point) => Number.isFinite(point.observed) && Number.isFinite(point.modelled) && point.observed > 0 && point.modelled > 0
  );

  if (usable.length === 0) {
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">`,
      `<rect width="${width}" height="${height}" fill="${colors.surface}"/>`,
      `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" fill="${colors.textSecondary}">`,
      `No count station matched this run, so there is nothing to compare.</text>`,
      `</svg>`,
    ].join("");
  }

  const values = usable.flatMap((point) => [point.observed, point.modelled]);
  const min = Math.max(1, Math.min(...values) * 0.7);
  const max = Math.max(...values) * 1.4;
  const logMin = Math.log10(min);
  const logMax = Math.log10(max);
  const scale = (value: number) => (Math.log10(value) - logMin) / (logMax - logMin);
  const x = (value: number) => PADDING.left + scale(value) * plotWidth;
  const y = (value: number) => PADDING.top + plotHeight - scale(value) * plotHeight;

  const ticks = niceLogTicks(min, max);
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Modelled traffic volume against observed count, one point per station, logarithmic scale">`
  );
  parts.push(`<rect width="${width}" height="${height}" fill="${colors.surface}"/>`);

  if (options.title) {
    parts.push(
      `<text x="${PADDING.left}" y="20" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="${colors.textPrimary}">${escapeXml(options.title)}</text>`
    );
  }
  if (options.subtitle) {
    parts.push(
      `<text x="${PADDING.left}" y="36" font-family="system-ui,sans-serif" font-size="11" fill="${colors.textSecondary}">${escapeXml(options.subtitle)}</text>`
    );
  }

  for (const tick of ticks) {
    parts.push(
      `<line x1="${x(tick).toFixed(1)}" y1="${PADDING.top}" x2="${x(tick).toFixed(1)}" y2="${PADDING.top + plotHeight}" stroke="${colors.grid}" stroke-width="1"/>`,
      `<line x1="${PADDING.left}" y1="${y(tick).toFixed(1)}" x2="${PADDING.left + plotWidth}" y2="${y(tick).toFixed(1)}" stroke="${colors.grid}" stroke-width="1"/>`,
      `<text x="${x(tick).toFixed(1)}" y="${PADDING.top + plotHeight + 16}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="${colors.textSecondary}">${formatTick(tick)}</text>`,
      `<text x="${PADDING.left - 8}" y="${(y(tick) + 3).toFixed(1)}" text-anchor="end" font-family="system-ui,sans-serif" font-size="10" fill="${colors.textSecondary}">${formatTick(tick)}</text>`
    );
  }

  // Ratio bands first, so points sit on top of them.
  for (const [ratio, dash, label] of [
    [2, "4 3", "2× observed"],
    [0.5, "4 3", "½× observed"],
  ] as const) {
    const from = Math.max(min, min / ratio);
    const to = Math.min(max, max / ratio);
    if (to <= from) continue;
    parts.push(
      `<line x1="${x(from).toFixed(1)}" y1="${y(from * ratio).toFixed(1)}" x2="${x(to).toFixed(1)}" y2="${y(to * ratio).toFixed(1)}" stroke="${colors.textSecondary}" stroke-width="1" stroke-dasharray="${dash}" opacity="0.55"/>`,
      `<title>${escapeXml(label)}</title>`
    );
  }

  // The 1:1 line is the reference the whole chart is read against.
  parts.push(
    `<line x1="${x(min).toFixed(1)}" y1="${y(min).toFixed(1)}" x2="${x(max).toFixed(1)}" y2="${y(max).toFixed(1)}" stroke="${colors.reference}" stroke-width="2"/>`,
    `<text x="${(PADDING.left + plotWidth - 4).toFixed(1)}" y="${(y(max) + 14).toFixed(1)}" text-anchor="end" font-family="system-ui,sans-serif" font-size="10" fill="${colors.textSecondary}">model = observed</text>`
  );

  for (const point of usable) {
    const ratio = point.modelled / point.observed;
    // Colour carries the direction of the error, and every point also has a
    // hover title — colour is never the only channel.
    const fill = ratio > 2 || ratio < 0.5 ? colors.critical : colors.series[0];
    parts.push(
      `<circle cx="${x(point.observed).toFixed(1)}" cy="${y(point.modelled).toFixed(1)}" r="4" fill="${fill}" fill-opacity="0.72" stroke="${colors.surface}" stroke-width="1">`,
      `<title>${escapeXml(point.label || point.stationId)}: observed ${Math.round(point.observed).toLocaleString()}, modelled ${Math.round(point.modelled).toLocaleString()} (${ratio.toFixed(2)}×)</title>`,
      `</circle>`
    );
  }

  parts.push(
    `<text x="${PADDING.left + plotWidth / 2}" y="${height - 8}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="${colors.textSecondary}">Observed count (vehicles per day)</text>`,
    `<text transform="translate(14 ${PADDING.top + plotHeight / 2}) rotate(-90)" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="${colors.textSecondary}">Modelled volume</text>`,
    `</svg>`
  );

  return parts.join("");
}

/** The accompanying table, because a chart is never the only channel. */
export function accuracyScatterRows(points: readonly AccuracyPoint[]): Array<{
  label: string;
  observed: number;
  modelled: number;
  ratio: number;
}> {
  return points
    .filter((p) => p.observed > 0 && Number.isFinite(p.modelled))
    .map((p) => ({
      label: p.label || p.stationId,
      observed: p.observed,
      modelled: p.modelled,
      ratio: p.modelled / p.observed,
    }))
    .sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio)));
}
