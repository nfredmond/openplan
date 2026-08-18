/**
 * The chart palette, and why these exact values.
 *
 * Validated with the data-viz validator (six checks, light and dark) rather
 * than chosen by eye: the three categorical slots below clear the all-pairs
 * gates in both modes — worst pair CVD ΔE 9.2, normal-vision ΔE 27.6 — which
 * is what a scatter needs, since every pair of series can appear side by side.
 *
 * THE THREE-SLOT CAP IS DELIBERATE. A fourth slot puts yellow beside orange,
 * and that pair fails the all-pairs floor. A model chart that needs more than
 * three categories folds the rest into "other" or becomes small multiples.
 *
 * Aqua sits below 3:1 on the light surface, so anything drawn in it also
 * carries a visible label or a table row — the relief rule, applied rather
 * than noted.
 */
export const CHART_PALETTE = {
  light: {
    surface: "#fcfcfb",
    textPrimary: "#0b0b0b",
    textSecondary: "#52514e",
    grid: "#e3e2de",
    series: ["#2a78d6", "#eb6834", "#1baf7a"] as const,
    good: "#0ca30c",
    critical: "#d03b3b",
    reference: "#52514e",
  },
  dark: {
    surface: "#1a1a19",
    textPrimary: "#ffffff",
    textSecondary: "#c3c2b7",
    grid: "#383835",
    series: ["#3987e5", "#d95926", "#199e70"] as const,
    good: "#0ca30c",
    critical: "#d03b3b",
    reference: "#c3c2b7",
  },
} as const;

export type ChartMode = keyof typeof CHART_PALETTE;
