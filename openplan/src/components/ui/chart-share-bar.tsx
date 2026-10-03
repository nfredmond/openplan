import * as React from "react";

/**
 * One labelled bar: a track and a fill, for a part of a whole or a count
 * against the largest in its group. The engagement panels drew five of these
 * by hand, in fixed sky, slate, emerald, amber and rose classes that ignored
 * the user's palette; one of them drew a zero as a 4% sliver.
 *
 * - A zero is drawn as no fill. A minimum sliver would show "a little" where
 *   the count said "none".
 * - An unknown value (`null`) draws no fill and says so in `valueText`; an
 *   empty track would otherwise read as zero.
 * - The fill is `--chart-1`, or `--muted-foreground` for a comparison row (an
 *   area baseline against respondents), or a colour the data itself carries
 *   (a category colour a planner chose). Meaning never rests on the colour:
 *   the label and the number say it.
 */
export function ChartShareBar({
  label,
  valueText,
  fraction,
  tone = "series",
  colorHex,
  layout = "stacked",
}: {
  label: string;
  /** The figure written beside the bar. Required: the bar is never the only reading. */
  valueText: string;
  /** 0 to 1, or null when the value is not known. Clamped to 0..1. */
  fraction: number | null;
  tone?: "series" | "reference";
  /** A data-supplied colour, used only when it is a valid six-digit hex. */
  colorHex?: string | null;
  /** `inline` puts a short label left of the bar, for paired rows. */
  layout?: "stacked" | "inline";
}) {
  const known = fraction !== null && Number.isFinite(fraction);
  const width = known ? Math.max(0, Math.min(1, fraction as number)) * 100 : 0;
  const hex = colorHex?.trim();
  const fill = hex && /^#[0-9a-f]{6}$/i.test(hex)
    ? hex
    : tone === "reference"
      ? "var(--muted-foreground)"
      : "var(--chart-1)";
  const track = (
    // A faint track: `bg-muted` drew as a solid grey bar, so a zero row looked full.
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.08]" aria-hidden="true">
      {known && width > 0 ? (
        <span className="block h-full rounded-full" style={{ width: `${width}%`, background: fill, opacity: tone === "reference" ? 0.55 : 0.85 }} />
      ) : null}
    </span>
  );

  if (layout === "inline") {
    return (
      <div className="flex items-center gap-2 text-xs" data-chart-share-bar={known ? "known" : "unknown"}>
        <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
        <span className="min-w-0 flex-1">{track}</span>
        <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">{valueText}</span>
      </div>
    );
  }
  return (
    <div className="space-y-1" data-chart-share-bar={known ? "known" : "unknown"}>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className={tone === "reference" ? "text-muted-foreground" : "text-foreground"}>{label}</span>
        <span className="tabular-nums text-muted-foreground">{valueText}</span>
      </div>
      {track}
    </div>
  );
}
