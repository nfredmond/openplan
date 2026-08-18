/**
 * Where the model puts its travel, against where travel actually happens.
 *
 * ================================================= WHY THIS CHART EXISTS
 *
 * Measured 2026-08-17 across 24 counties: the model puts 37% of its vehicle
 * miles on principal arterials where FHWA's published figures put 21%, and
 * 26% on freeways where the real share is 45%. That single comparison explains
 * the road-class error pattern the count stations show, and no summary
 * statistic conveys it — two distributions side by side do.
 *
 * PAIRED BARS, NOT A DIFFERENCE. A "model minus reality" bar would report a
 * number nobody can check without also being shown both inputs; and the point
 * a planner needs is that these are two independently sourced distributions,
 * one of which is a published federal statistic.
 *
 * The two series are the first two validated categorical slots. They are also
 * directly labelled, so identity never rests on colour alone.
 */
import { CHART_PALETTE, type ChartMode } from "./palette";

export type RoadClassShare = {
  label: string;
  /** Share of vehicle miles, 0-1. */
  model: number;
  /** Share of vehicle miles, 0-1, from the published source. */
  published: number;
};

export type RoadClassBarsOptions = {
  mode?: ChartMode;
  width?: number;
  height?: number;
  title?: string;
  subtitle?: string;
  modelLabel?: string;
  publishedLabel?: string;
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char
  );
}

// `right` reserves room for the value label drawn past the bar end; at 16px
// the widest bar's "45%" was clipped by the viewBox.
const PADDING = { top: 72, right: 46, bottom: 34, left: 104 };

export function roadClassBarsSvg(
  rows: readonly RoadClassShare[],
  options: RoadClassBarsOptions = {}
): string {
  const mode = options.mode ?? "light";
  const colors = CHART_PALETTE[mode];
  const width = options.width ?? 560;
  const rowHeight = 40;
  const height = options.height ?? PADDING.top + rows.length * rowHeight + PADDING.bottom;
  const plotWidth = width - PADDING.left - PADDING.right;
  const modelLabel = options.modelLabel ?? "This model";
  const publishedLabel = options.publishedLabel ?? "Published (FHWA)";

  if (rows.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 80" width="${width}" height="80"><rect width="${width}" height="80" fill="${colors.surface}"/><text x="${width / 2}" y="44" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" fill="${colors.textSecondary}">No road-class breakdown was recorded for this run.</text></svg>`;
  }

  const maxShare = Math.max(...rows.flatMap((row) => [row.model, row.published]), 0.05);
  const scale = (share: number) => (share / maxShare) * plotWidth;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Share of vehicle miles by road class, this model against published figures">`,
    `<rect width="${width}" height="${height}" fill="${colors.surface}"/>`
  );

  if (options.title) {
    parts.push(
      `<text x="16" y="20" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="${colors.textPrimary}">${escapeXml(options.title)}</text>`
    );
  }
  if (options.subtitle) {
    parts.push(
      `<text x="16" y="36" font-family="system-ui,sans-serif" font-size="11" fill="${colors.textSecondary}">${escapeXml(options.subtitle)}</text>`
    );
  }

  // Legend on its OWN row beneath the heading, never floated into the title's
  // line — at 560px the right-aligned version overlapped a long title, which
  // only rendering the chart and looking at it revealed.
  const legendY = options.subtitle ? 52 : 38;
  const modelLabelWidth = modelLabel.length * 5.6 + 26;
  parts.push(
    `<rect x="16" y="${legendY - 8}" width="10" height="10" rx="2" fill="${colors.series[0]}"/>`,
    `<text x="31" y="${legendY + 1}" font-family="system-ui,sans-serif" font-size="10" fill="${colors.textSecondary}">${escapeXml(modelLabel)}</text>`,
    `<rect x="${(16 + modelLabelWidth).toFixed(0)}" y="${legendY - 8}" width="10" height="10" rx="2" fill="${colors.series[1]}"/>`,
    `<text x="${(31 + modelLabelWidth).toFixed(0)}" y="${legendY + 1}" font-family="system-ui,sans-serif" font-size="10" fill="${colors.textSecondary}">${escapeXml(publishedLabel)}</text>`
  );

  rows.forEach((row, index) => {
    const top = PADDING.top + index * rowHeight;
    const barHeight = 12;
    // 2px surface gap between the paired bars, per the mark spec.
    const modelWidth = Math.max(1, scale(row.model));
    const publishedWidth = Math.max(1, scale(row.published));
    parts.push(
      `<text x="${PADDING.left - 10}" y="${top + 16}" text-anchor="end" font-family="system-ui,sans-serif" font-size="11" fill="${colors.textPrimary}">${escapeXml(row.label)}</text>`,
      `<rect x="${PADDING.left}" y="${top}" width="${modelWidth.toFixed(1)}" height="${barHeight}" rx="4" fill="${colors.series[0]}"><title>${escapeXml(row.label)} — ${modelLabel}: ${(row.model * 100).toFixed(1)}%</title></rect>`,
      `<rect x="${PADDING.left}" y="${top + barHeight + 2}" width="${publishedWidth.toFixed(1)}" height="${barHeight}" rx="4" fill="${colors.series[1]}"><title>${escapeXml(row.label)} — ${publishedLabel}: ${(row.published * 100).toFixed(1)}%</title></rect>`,
      // Direct labels: identity and value never rest on colour alone.
      `<text x="${(PADDING.left + modelWidth + 6).toFixed(1)}" y="${top + 10}" font-family="system-ui,sans-serif" font-size="10" fill="${colors.textSecondary}">${(row.model * 100).toFixed(0)}%</text>`,
      `<text x="${(PADDING.left + publishedWidth + 6).toFixed(1)}" y="${top + barHeight + 12}" font-family="system-ui,sans-serif" font-size="10" fill="${colors.textSecondary}">${(row.published * 100).toFixed(0)}%</text>`
    );
  });

  parts.push(
    `<text x="${PADDING.left}" y="${height - 10}" font-family="system-ui,sans-serif" font-size="10" fill="${colors.textSecondary}">Share of daily vehicle miles</text>`,
    `</svg>`
  );
  return parts.join("");
}
