"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";

import type { InsightBlockedKind, InsightSeries } from "@/lib/dashboard/insights";

/**
 * THE CHART PRIMITIVES — hand-rolled SVG, no charting library.
 *
 * WHY NO LIBRARY. This app has never had a charting dependency and is not
 * getting one for four figures. A library brings a bundle, a theming layer that
 * fights the palette, and — the real cost — a default behaviour where missing
 * data plots as zero. Everything below refuses that by construction.
 *
 * WHY THESE LIVE IN `ui/` AND NOT IN THE DASHBOARD. They were written for the
 * dashboard, and the second surface that wants a small figure will otherwise
 * reimplement them — badly, and without the refusals. A shared capability
 * living inside one of its callers is a defect class this repo has hit
 * repeatedly. Anything dashboard-specific stays in `components/dashboard/`.
 *
 * COLOUR, DECIDED BY MEASUREMENT. Every plot here is SINGLE-SERIES and drawn in
 * `--chart-1`. That is not taste: the palette is user-selectable across five
 * colour families and two modes, so a multi-series categorical scheme would
 * have to hold CVD separation across ten combinations, and it does not. The
 * obvious two-colour encoding — succeeded green against failed red — was
 * measured with the palette validator and FAILS: ΔE 5.4 in light and 3.1 in
 * dark for deuteranopia, against a floor of 6. So outcomes are never a colour;
 * they are words and icons, and the plots stay one series each. One series
 * needs no legend — the figure's title names it.
 *
 * MEASURED, NOT GUESSED, AT EVERY WIDTH. The SVG's viewBox is set from the
 * container's real pixel width, so one SVG unit is one CSS pixel and a 10px
 * axis label renders at 10px on a phone as well as on a monitor. A fixed
 * viewBox scaled down — the obvious version — renders those same labels at
 * about five pixels at 390px wide, which is a chart with unreadable axes
 * pretending to have axes.
 *
 * WHAT THIS FILE CANNOT PROVE. jsdom applies no stylesheet, has no box model
 * and no ResizeObserver, so no unit test here can establish that any of this is
 * legible, correctly coloured, or the right shape. Tests cover the refusals and
 * the text alternatives; legibility was measured in a real browser.
 */

const PLOT_HEIGHT = 168;
const FALLBACK_WIDTH = 640;
const PADDING = { top: 12, right: 10, bottom: 26, left: 34 };
/** Below this, an axis label collides with its neighbour and both become noise. */
const MIN_LABEL_SPACING_PX = 68;

/**
 * The container's real width in CSS pixels. `null` until measured — the caller
 * draws at `FALLBACK_WIDTH` in the meantime, which is what the server rendered,
 * so hydration has nothing to correct.
 */
function useMeasuredWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // jsdom has no ResizeObserver. The fallback width is a fine answer there,
    // and the tests that run there do not assert on layout.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;
      if (measured > 0) setWidth(measured);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, width: width && width > 0 ? width : FALLBACK_WIDTH };
}

/** The sentence a reader sees instead of a figure, drawn by what kind of nothing it is. */
function blockedLead(kind: InsightBlockedKind | null): { lead: string; warn: boolean } {
  switch (kind) {
    case "unreadable":
      return { lead: "Could not be read", warn: true };
    case "truncated":
      return { lead: "Too much to count here", warn: true };
    // A number arrived that cannot exist. It is a warning rather than an
    // information note because the reader has to know the figure is FAULTY, not
    // merely unavailable — the sentence names the lane and the impossible value.
    case "impossible":
      return { lead: "Something is counted wrong", warn: true };
    case "pending":
      return { lead: "Not switched on yet", warn: false };
    case "insufficient":
      return { lead: "Not enough to draw yet", warn: false };
    default:
      return { lead: "Nothing here yet", warn: false };
  }
}

/**
 * A FAILED READ AND AN EMPTY WORKSPACE MUST NOT LOOK ALIKE.
 *
 * This is the single most important component in the file. "No comments yet"
 * and "we asked and the database would not answer" are opposite facts, and the
 * second one rendered as the first is how a broken query becomes a confident
 * zero on a screen somebody makes a decision from. They differ in wording, in
 * lead, in icon and in tone — four ways, because one is easy to miss.
 */
export function ChartBlockedNote({
  reason,
  kind,
}: {
  reason: string;
  kind: InsightBlockedKind | null;
}) {
  const { lead, warn } = blockedLead(kind);
  const Icon = warn ? AlertTriangle : Info;
  return (
    <div
      data-testid="chart-blocked"
      data-blocked-kind={kind ?? "empty"}
      className={
        warn
          ? "flex items-start gap-2 rounded-xl border border-[color:var(--warn)]/45 bg-[color:var(--warn)]/8 px-4 py-4 text-sm text-foreground/90"
          : "flex items-start gap-2 rounded-xl border border-dashed border-border/70 bg-background/40 px-4 py-4 text-sm text-muted-foreground"
      }
    >
      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 ${warn ? "text-[color:var(--warn)]" : ""}`}
        aria-hidden="true"
      />
      <p className="leading-6">
        <span className="font-semibold text-foreground">{lead}.</span> {reason}
      </p>
    </div>
  );
}

function TableView({ series, valueLabel }: { series: InsightSeries; valueLabel: string }) {
  const hasReference = series.points.some((point) => point.reference !== undefined);
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th scope="col" className="py-1 font-medium">
              Item
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              {valueLabel}
            </th>
            {hasReference ? (
              <th scope="col" className="py-1 text-right font-medium">
                Out of
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {series.points.map((point, index) => (
            <tr key={`${point.label}-${index}`} className="border-t border-border/50">
              <th scope="row" className="py-1 font-normal text-foreground/85">
                {point.label}
              </th>
              <td className="py-1 text-right tabular-nums text-foreground">
                {point.formattedValue ?? point.value}
              </td>
              {hasReference ? (
                <td className="py-1 text-right tabular-nums text-muted-foreground">
                  {point.reference === undefined ? "—" : point.reference}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The shell every figure wears: heading, the caveat sentence, the table toggle,
 * and — when the series cannot be drawn — the reason in its place.
 *
 * THE TABLE IS NOT OPTIONAL POLISH. A chart nobody can read with a screen
 * reader has simply not reported its numbers, so every drawable figure carries
 * one behind a toggle, and the plot itself carries a full `aria-label`.
 */
export function ChartFigure({
  title,
  caption,
  series,
  valueLabel,
  action,
  children,
}: {
  title: string;
  caption: string;
  series: InsightSeries;
  valueLabel: string;
  /** Optional control in the figure's header (the picker uses it on the first figure). */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const drawable = series.blockedReason === null;

  return (
    <section className="rounded-2xl border border-border/70 bg-card/70 p-4">
      {/* No wrapping here: with a caption two lines long, a wrapping header
          drops the table toggle onto a line of its own under the text, which
          reads as a stray button rather than as this figure's control. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{caption}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          {drawable ? (
            <button
              type="button"
              onClick={() => setShowTable((open) => !open)}
              aria-expanded={showTable}
              className="rounded-lg border border-border/70 px-2 py-1 text-[0.68rem] font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              {showTable ? "Hide numbers" : "Numbers"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-3">
        {drawable ? (
          children
        ) : (
          <ChartBlockedNote reason={series.blockedReason ?? ""} kind={series.blockedKind} />
        )}
      </div>

      {series.footnote ? (
        <p className="mt-3 text-[0.7rem] leading-5 text-muted-foreground">{series.footnote}</p>
      ) : null}

      {showTable && drawable ? <TableView series={series} valueLabel={valueLabel} /> : null}
    </section>
  );
}

/**
 * Which point labels fit at this width without colliding. Always the two ends —
 * an axis whose first and last labels are missing is not an axis.
 *
 * The subtlety, found by looking at the thing in a browser rather than by
 * reasoning about it: the LAST label is pinned, so a strided label landing one
 * step before it overlaps it ("Aug 3 Aug 10" printed as one smudge). Any
 * strided label closer than a full stride to either end is therefore dropped in
 * favour of the end it crowds.
 */
function labelVisibility(count: number, plotWidth: number): boolean[] {
  if (count === 0) return [];
  const fits = Math.max(2, Math.floor(plotWidth / MIN_LABEL_SPACING_PX));
  if (count <= fits) return Array.from({ length: count }, () => true);
  const stride = Math.ceil((count - 1) / (fits - 1));
  return Array.from({ length: count }, (_, index) => {
    if (index === 0 || index === count - 1) return true;
    if (index % stride !== 0) return false;
    return index >= stride && count - 1 - index >= stride;
  });
}

/**
 * Line + area. The form for a quantity moving through time; the fill is a
 * gradient at low opacity so the LINE, not the wash, carries the value.
 */
export function ChartAreaPlot({
  series,
  ariaLabel,
}: {
  series: InsightSeries;
  ariaLabel: string;
}) {
  const gradientId = useId();
  const { ref, width } = useMeasuredWidth();
  const plotW = Math.max(80, width - PADDING.left - PADDING.right);
  const plotH = PLOT_HEIGHT - PADDING.top - PADDING.bottom;
  const max = Math.max(1, series.max);
  const step = series.points.length > 1 ? plotW / (series.points.length - 1) : 0;

  const coords = series.points.map((point, index) => ({
    ...point,
    x: PADDING.left + index * step,
    y: PADDING.top + plotH - (point.value / max) * plotH,
  }));

  const line = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");
  const baseline = (PADDING.top + plotH).toFixed(1);
  const area =
    coords.length > 0
      ? `${line} L${coords[coords.length - 1].x.toFixed(1)},${baseline} L${coords[0].x.toFixed(1)},${baseline} Z`
      : "";
  const showLabel = labelVisibility(coords.length, plotW);

  return (
    <div ref={ref} className="w-full">
      <svg
        viewBox={`0 0 ${width} ${PLOT_HEIGHT}`}
        width={width}
        height={PLOT_HEIGHT}
        className="block max-w-full"
        role="img"
        aria-label={`${ariaLabel} ${series.points.map((p) => `${p.label}: ${p.value}`).join(", ")}.`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line
          x1={PADDING.left}
          y1={PADDING.top + plotH}
          x2={width - PADDING.right}
          y2={PADDING.top + plotH}
          stroke="var(--border)"
          strokeWidth="1"
        />
        <path d={area} fill={`url(#${gradientId})`} />
        {/* 2px line, per the mark spec — thin enough to stay recessive against the grid. */}
        <path d={line} fill="none" stroke="var(--chart-1)" strokeWidth="2" strokeLinejoin="round" />
        {coords.map((c, index) => (
          <g key={`point-${index}`}>
            <circle cx={c.x} cy={c.y} r="3" fill="var(--chart-1)" />
            {/* The hit area is far bigger than the dot, so a tooltip is reachable
                with a finger as well as a mouse. */}
            <circle cx={c.x} cy={c.y} r="14" fill="transparent">
              <title>{c.detail ?? `${c.label}: ${c.value}`}</title>
            </circle>
          </g>
        ))}
        {coords.map((c, index) =>
          showLabel[index] ? (
            <text
              key={`label-${index}`}
              x={c.x}
              y={PLOT_HEIGHT - 8}
              textAnchor={index === 0 ? "start" : index === coords.length - 1 ? "end" : "middle"}
              className="fill-[color:var(--muted-foreground)] text-[10px]"
            >
              {c.label}
            </text>
          ) : null
        )}
        <text x={2} y={PADDING.top + 8} className="fill-[color:var(--muted-foreground)] text-[10px]">
          {max}
        </text>
      </svg>
    </div>
  );
}

/** Vertical bars, single series, 4px rounded tops anchored to the baseline. */
export function ChartBarPlot({
  series,
  ariaLabel,
}: {
  series: InsightSeries;
  ariaLabel: string;
}) {
  const { ref, width } = useMeasuredWidth();
  const plotW = Math.max(80, width - PADDING.left - PADDING.right);
  const plotH = PLOT_HEIGHT - PADDING.top - PADDING.bottom;
  const max = Math.max(1, series.max);
  const slot = plotW / Math.max(1, series.points.length);
  // 2px surface gap between adjacent fills, per the mark spec.
  const barW = Math.max(3, Math.min(38, slot - 2));
  const showLabel = labelVisibility(series.points.length, plotW);

  return (
    <div ref={ref} className="w-full">
      <svg
        viewBox={`0 0 ${width} ${PLOT_HEIGHT}`}
        width={width}
        height={PLOT_HEIGHT}
        className="block max-w-full"
        role="img"
        aria-label={`${ariaLabel} ${series.points.map((p) => `${p.label}: ${p.value}`).join(", ")}.`}
      >
        <line
          x1={PADDING.left}
          y1={PADDING.top + plotH}
          x2={width - PADDING.right}
          y2={PADDING.top + plotH}
          stroke="var(--border)"
          strokeWidth="1"
        />
        {series.points.map((point, index) => {
          const barH = (point.value / max) * plotH;
          const x = PADDING.left + index * slot + (slot - barW) / 2;
          const y = PADDING.top + plotH - barH;
          return (
            <g key={`${point.label}-${index}`}>
              <rect x={x} y={y} width={barW} height={Math.max(barH, 1)} rx="4" fill="var(--chart-1)">
                <title>{point.detail ?? `${point.label}: ${point.value}`}</title>
              </rect>
              {showLabel[index] ? (
                <text
                  x={x + barW / 2}
                  y={PLOT_HEIGHT - 8}
                  textAnchor="middle"
                  className="fill-[color:var(--muted-foreground)] text-[10px]"
                >
                  {point.label}
                </text>
              ) : null}
            </g>
          );
        })}
        <text x={2} y={PADDING.top + 8} className="fill-[color:var(--muted-foreground)] text-[10px]">
          {max}
        </text>
      </svg>
    </div>
  );
}

/**
 * Horizontal bars — the right form when the categories are named things rather
 * than a sequence, because the name gets a whole line to be read on.
 */
export function ChartRowBars({ series }: { series: InsightSeries }) {
  const max = Math.max(1, series.max);
  return (
    <ul className="space-y-2">
      {series.points.map((point, index) => (
        <li
          key={`${point.label}-${index}`}
          className="grid grid-cols-[minmax(5rem,8.5rem)_1fr_2.75rem] items-center gap-2"
        >
          <span className="truncate text-xs text-foreground/85" title={point.label}>
            {point.label}
          </span>
          <span className="h-3 overflow-hidden rounded-full bg-secondary" title={point.detail}>
            <span
              className="block h-full rounded-full"
              style={{
                // A zero stays a zero. A minimum-width sliver for an empty lane
                // would draw "a little" where the measurement said "none".
                width: `${point.value === 0 ? 0 : Math.max(3, (point.value / max) * 100)}%`,
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

/**
 * A part inside its whole, one row per thing — the form for "how much of what
 * we were allowed have we used".
 *
 * NOT TWO BARS. Drawn and authorised are not two series: one is inside the
 * other, and side-by-side bars invite comparing one award's authorised figure
 * against another's draw, which means nothing. The track is the whole, the fill
 * is the part, and the percentage is written out in words next to it — so the
 * reading never depends on judging a length.
 *
 * OVER 100% IS SHOWN AS OVER 100%. The fill stops at the end of the track (it
 * cannot escape the row) but the number beside it says the real figure and the
 * row is marked, because an over-drawn award is a finding a planner has to see
 * rather than a rendering bug to smooth over.
 */
export function ChartMeterRows({ series }: { series: InsightSeries }) {
  return (
    <ul className="space-y-3">
      {series.points.map((point, index) => {
        const whole = point.reference ?? 0;
        const percent = whole > 0 ? Math.round((point.value / whole) * 100) : 0;
        const over = percent > 100;
        return (
          /*
            `data-over-award` is not decoration. Until 2026-08-13 the whole
            over-award warning — the colour, the icon and the words — hung on
            `percent > 100` with NOTHING asserting it: mutating that to
            `percent > 1000` left all 84 dashboard tests green while a meter
            showing money drawn beyond what the funder authorised lost every
            marking that said so. The attribute gives the guard a stable hook
            that does not depend on a stylesheet jsdom has never had.
          */
          <li key={`${point.label}-${index}`} data-over-award={over ? "true" : "false"}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="min-w-0 truncate text-xs font-medium text-foreground" title={point.label}>
                {point.label}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                <span className="font-semibold text-foreground">{percent}%</span> drawn
              </span>
            </div>
            <div
              className="mt-1 h-3 overflow-hidden rounded-full bg-secondary"
              title={point.detail}
              role="img"
              aria-label={point.detail ?? `${point.label}: ${percent}% drawn`}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${point.value === 0 ? 0 : Math.max(2, Math.min(100, percent))}%`,
                  background: over ? "var(--warn)" : "var(--chart-1)",
                }}
              />
            </div>
            <p className="mt-1 text-[0.7rem] leading-5 text-muted-foreground">
              {over ? (
                <span className="inline-flex items-center gap-1 font-semibold text-[color:var(--warn)]">
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                  Over the award —
                </span>
              ) : null}{" "}
              {point.detail}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
