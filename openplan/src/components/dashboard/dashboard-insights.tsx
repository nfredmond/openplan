"use client";

import { useId, useState } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

import type { InsightSeries } from "@/lib/dashboard/insights";

/**
 * The Insights view — the same workspace, read as figures.
 *
 * COLOUR DECISIONS, MADE BY MEASUREMENT RATHER THAN TASTE.
 *
 * Every plot here is SINGLE-SERIES and drawn in `--chart-1`, which resolves to
 * the active palette's secondary accent. That is not a stylistic preference: the
 * palette is user-selectable across five colour families and two modes, so any
 * multi-series categorical scheme would need CVD separation to hold across ten
 * combinations, and it does not. The obvious two-colour encoding — succeeded
 * green against failed red — was measured with the palette validator and fails
 * outright: ΔE 5.4 in light and 3.1 in dark for deuteranopia, against a floor of
 * 6. A reader with the commonest colour-vision deficiency could not tell a
 * successful run from a failed one.
 *
 * So outcomes are never a colour: they are stat tiles carrying an ICON AND A
 * WORD, which is the only legal use of the status palette, and the plots stay
 * one series each. A single series also needs no legend — the figure's title
 * names it.
 *
 * Every figure has a table view behind a toggle, because a chart that cannot be
 * read by a screen reader has simply not reported its numbers.
 */

type StatTile = {
  label: string;
  value: string;
  detail: string;
  /** Status tiles carry an icon and a word; colour never carries the meaning alone. */
  tone?: "neutral" | "good" | "attention";
};

export type DashboardInsightsProps = {
  tiles: StatTile[];
  runsPerMonth: InsightSeries;
  recentScores: InsightSeries;
  lanePressure: InsightSeries;
};

function toneIcon(tone: StatTile["tone"]) {
  if (tone === "good") return <CheckCircle2 className="h-3.5 w-3.5 text-[color:var(--ok)]" />;
  if (tone === "attention") return <AlertTriangle className="h-3.5 w-3.5 text-[color:var(--warn)]" />;
  return null;
}

function BlockedFigure({ reason }: { reason: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-dashed border-border/70 bg-background/40 px-4 py-6 text-sm text-muted-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      {/*
        The reason, not an empty axis. A chart drawn through no data invites the
        reader to conclude "flat" or "zero"; both are findings, and neither was
        measured.
      */}
      <p className="leading-6">{reason}</p>
    </div>
  );
}

function TableView({ series, valueLabel }: { series: InsightSeries; valueLabel: string }) {
  return (
    <table className="mt-3 w-full text-left text-xs">
      <thead className="text-muted-foreground">
        <tr>
          <th scope="col" className="py-1 font-medium">
            Period
          </th>
          <th scope="col" className="py-1 text-right font-medium">
            {valueLabel}
          </th>
        </tr>
      </thead>
      <tbody>
        {series.points.map((point) => (
          <tr key={point.label} className="border-t border-border/50">
            <th scope="row" className="py-1 font-normal text-foreground/85">
              {point.label}
            </th>
            <td className="py-1 text-right tabular-nums text-foreground">{point.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Figure({
  title,
  caption,
  series,
  valueLabel,
  children,
}: {
  title: string;
  caption: string;
  series: InsightSeries;
  valueLabel: string;
  children: React.ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);

  return (
    <section className="rounded-2xl border border-border/70 bg-card/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{caption}</p>
        </div>
        {series.blockedReason ? null : (
          <button
            type="button"
            onClick={() => setShowTable((open) => !open)}
            className="shrink-0 rounded-lg border border-border/70 px-2 py-1 text-[0.68rem] font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            {showTable ? "Hide table" : "Table"}
          </button>
        )}
      </div>

      <div className="mt-3">
        {series.blockedReason ? <BlockedFigure reason={series.blockedReason} /> : children}
      </div>

      {showTable && !series.blockedReason ? (
        <TableView series={series} valueLabel={valueLabel} />
      ) : null}
    </section>
  );
}

/** Area chart. One series, so the title carries identity and no legend is needed. */
function AreaFigure({ series }: { series: InsightSeries }) {
  const gradientId = useId();
  const width = 640;
  const height = 160;
  const padding = { top: 10, right: 8, bottom: 22, left: 28 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const max = Math.max(1, series.max);
  const step = series.points.length > 1 ? plotW / (series.points.length - 1) : 0;

  const coords = series.points.map((point, index) => ({
    ...point,
    x: padding.left + index * step,
    y: padding.top + plotH - (point.value / max) * plotH,
  }));

  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const area = `${line} L${coords[coords.length - 1].x.toFixed(1)},${(padding.top + plotH).toFixed(
    1
  )} L${coords[0].x.toFixed(1)},${(padding.top + plotH).toFixed(1)} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-40 w-full"
      role="img"
      aria-label={`Analysis runs per month. ${series.points
        .map((p) => `${p.label}: ${p.value}`)
        .join(", ")}.`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <line
        x1={padding.left}
        y1={padding.top + plotH}
        x2={width - padding.right}
        y2={padding.top + plotH}
        stroke="var(--border)"
        strokeWidth="1"
      />
      <path d={area} fill={`url(#${gradientId})`} />
      {/* 2px line, per the mark spec — thin enough to stay recessive against the grid. */}
      <path d={line} fill="none" stroke="var(--chart-1)" strokeWidth="2" strokeLinejoin="round" />
      {coords.map((c) => (
        <g key={c.label}>
          {/* Markers are >=8px of hit area even though the dot is small. */}
          <circle cx={c.x} cy={c.y} r="3.5" fill="var(--chart-1)" />
          <circle cx={c.x} cy={c.y} r="10" fill="transparent">
            <title>{c.detail ?? `${c.label}: ${c.value}`}</title>
          </circle>
        </g>
      ))}
      {coords.map((c, index) =>
        index === 0 || index === coords.length - 1 || coords.length <= 6 ? (
          <text
            key={`label-${c.label}`}
            x={c.x}
            y={height - 6}
            textAnchor={index === 0 ? "start" : index === coords.length - 1 ? "end" : "middle"}
            className="fill-[color:var(--muted-foreground)] text-[9px]"
          >
            {c.label}
          </text>
        ) : null
      )}
      <text x={4} y={padding.top + 8} className="fill-[color:var(--muted-foreground)] text-[9px]">
        {max}
      </text>
    </svg>
  );
}

/** Vertical bars, single series, 4px rounded tops anchored to the baseline. */
function BarFigure({ series, unit }: { series: InsightSeries; unit: string }) {
  const width = 640;
  const height = 160;
  const padding = { top: 10, right: 8, bottom: 22, left: 28 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const max = Math.max(1, series.max);
  const slot = plotW / series.points.length;
  // 2px surface gap between adjacent fills, per the mark spec.
  const barW = Math.max(4, Math.min(38, slot - 2));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-40 w-full"
      role="img"
      aria-label={`${unit}. ${series.points.map((p) => `${p.label}: ${p.value}`).join(", ")}.`}
    >
      <line
        x1={padding.left}
        y1={padding.top + plotH}
        x2={width - padding.right}
        y2={padding.top + plotH}
        stroke="var(--border)"
        strokeWidth="1"
      />
      {series.points.map((point, index) => {
        const barH = (point.value / max) * plotH;
        const x = padding.left + index * slot + (slot - barW) / 2;
        const y = padding.top + plotH - barH;
        return (
          <g key={`${point.label}-${index}`}>
            <rect x={x} y={y} width={barW} height={Math.max(barH, 1)} rx="4" fill="var(--chart-1)">
              <title>{point.detail ?? `${point.label}: ${point.value}`}</title>
            </rect>
            {series.points.length <= 8 ? (
              <text
                x={x + barW / 2}
                y={height - 6}
                textAnchor="middle"
                className="fill-[color:var(--muted-foreground)] text-[9px]"
              >
                {point.label}
              </text>
            ) : null}
          </g>
        );
      })}
      <text x={4} y={padding.top + 8} className="fill-[color:var(--muted-foreground)] text-[9px]">
        {max}
      </text>
    </svg>
  );
}

/** Horizontal bars — the right form when the categories are named things, not a sequence. */
function LaneFigure({ series }: { series: InsightSeries }) {
  const max = Math.max(1, series.max);
  return (
    <ul className="space-y-2">
      {series.points.map((point) => (
        <li key={point.label} className="grid grid-cols-[8.5rem_1fr_2.5rem] items-center gap-2">
          <span className="truncate text-xs text-foreground/85">{point.label}</span>
          <span className="h-3 overflow-hidden rounded-full bg-secondary" title={point.detail}>
            <span
              className="block h-full rounded-full"
              style={{
                width: `${Math.max(point.value === 0 ? 0 : 3, (point.value / max) * 100)}%`,
                background: "var(--chart-1)",
              }}
            />
          </span>
          <span className="text-right text-xs tabular-nums text-foreground">{point.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function DashboardInsights({
  tiles,
  runsPerMonth,
  recentScores,
  lanePressure,
}: DashboardInsightsProps) {
  return (
    <div className="space-y-4" data-testid="dashboard-insights">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-2xl border border-border/70 bg-card/70 p-4">
            <p className="flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {toneIcon(tile.tone)}
              {tile.label}
            </p>
            <p className="mt-2 font-display text-3xl font-semibold tabular-nums text-foreground">
              {tile.value}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{tile.detail}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Figure
          title="Analysis runs per month"
          caption="Every corridor run recorded in this workspace, by the month it was launched."
          series={runsPerMonth}
          valueLabel="Runs"
        >
          <AreaFigure series={runsPerMonth} />
        </Figure>

        <Figure
          title="Composite score by run"
          caption="Screening-grade composite for each scored run, oldest first. Not a forecast, and not comparable across different study areas."
          series={recentScores}
          valueLabel="Composite"
        >
          <BarFigure series={recentScores} unit="Composite score by run" />
        </Figure>
      </div>

      <Figure
        title="Where attention is queued"
        caption="Open items by lane, from the same workspace summary the command board reads."
        series={lanePressure}
        valueLabel="Open items"
      >
        <LaneFigure series={lanePressure} />
      </Figure>
    </div>
  );
}
