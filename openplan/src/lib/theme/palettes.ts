/**
 * The colour palettes a workspace can choose between, and the one rule that
 * governs all of them.
 *
 * HOW THEMING WORKS HERE, BECAUSE IT DECIDES WHAT A PALETTE IS ALLOWED TO BE.
 * `globals.css` defines about twenty raw SEED tokens (`--bg`, `--ink`,
 * `--accent`, `--map-*`, …) and derives roughly sixty semantic tokens from them
 * (`--background`, `--primary`, `--card`, `--sidebar-*`, the copilot rail, the
 * chart series). Every surface in the app reads the derived tokens. So a
 * palette is nothing more than a different set of SEEDS, and it re-themes the
 * whole product without touching a single component.
 *
 * A palette is NOT a mode. Light and dark remain the mode; each palette
 * supplies both, so "slate" in light and "slate" in dark are the same choice
 * seen under different lighting rather than two separate themes.
 *
 * THE RULE THAT IS NOT NEGOTIABLE: STATUS COLOUR IS NOT DECORATION.
 * `--urgent`, `--warn` and `--ok` are deliberately absent from every palette
 * block. A red that means "this is failing" may not become teal because someone
 * preferred a cooler workspace, and a planner who learns that amber means
 * "needs review" must not have to relearn it per palette. Those three stay on
 * the base tokens in `:root` / `.dark`. `palette-status-colours-are-fixed.test`
 * fails if a palette block ever sets one.
 *
 * ADDING A PALETTE: add an entry here AND the two CSS blocks in `globals.css`
 * (`:root:not(.dark)[data-palette="id"]` and `.dark[data-palette="id"]`).
 * `theme-palettes.test` fails if a registry entry has no CSS, or CSS has no
 * registry entry — the drift that otherwise ships a palette which appears in
 * the menu and changes nothing.
 */

export type PaletteId = "cartographic" | "slate" | "harbor" | "meadow" | "plum";

export type PaletteSwatch = {
  /** Page background. */
  bg: string;
  /** Panel/card surface, for the contrast step against `bg`. */
  panel: string;
  /** The primary accent — buttons, active states. */
  accent: string;
  /** The secondary accent, used for focus rings and the second chart series. */
  accent2: string;
};

export type PaletteDefinition = {
  id: PaletteId;
  label: string;
  /** One line a planner reads in the picker. Says what it is, not how it feels. */
  description: string;
  /** Representative colours for the picker's preview, per mode. Presentation only. */
  swatch: { light: PaletteSwatch; dark: PaletteSwatch };
};

/**
 * The default is `cartographic` because it is what the product already looked
 * like. A theme chooser that silently restyles every existing workspace on
 * first deploy is a change nobody asked for.
 */
export const DEFAULT_PALETTE: PaletteId = "cartographic";

export const PALETTES: readonly PaletteDefinition[] = [
  {
    id: "cartographic",
    label: "Cartographic",
    description: "The OpenPlan default — parchment and ink, with copper and pine accents.",
    swatch: {
      light: { bg: "#f4f1ec", panel: "#ffffff", accent: "#e45635", accent2: "#1f6b5e" },
      dark: { bg: "#111618", panel: "#1c2225", accent: "#ff7a58", accent2: "#6dc6b5" },
    },
  },
  {
    id: "slate",
    label: "Slate",
    description: "Almost no colour. Neutral greys throughout, so only status and data carry hue.",
    swatch: {
      light: { bg: "#f5f6f7", panel: "#ffffff", accent: "#475569", accent2: "#334155" },
      dark: { bg: "#121417", panel: "#1e2227", accent: "#94a3b8", accent2: "#cbd5e1" },
    },
  },
  {
    id: "harbor",
    label: "Harbor",
    description: "Cool blues and teal — a civic, technical register.",
    swatch: {
      light: { bg: "#f2f5f8", panel: "#ffffff", accent: "#1d4ed8", accent2: "#0e7490" },
      dark: { bg: "#0f1520", panel: "#1a2130", accent: "#8ab0f9", accent2: "#67e8f9" },
    },
  },
  {
    id: "meadow",
    label: "Meadow",
    description: "Greens and moss — reads well alongside parks, land use and open space.",
    swatch: {
      light: { bg: "#f3f6f1", panel: "#ffffff", accent: "#15803d", accent2: "#4d7c0f" },
      dark: { bg: "#101613", panel: "#1a231d", accent: "#86efac", accent2: "#bef264" },
    },
  },
  {
    id: "plum",
    label: "Plum",
    description: "Violet and magenta — the highest contrast against map greens and blues.",
    swatch: {
      light: { bg: "#f6f3f7", panel: "#ffffff", accent: "#7e22ce", accent2: "#a21caf" },
      dark: { bg: "#15111a", panel: "#201a26", accent: "#d8b4fe", accent2: "#f0abfc" },
    },
  },
] as const;

const PALETTE_IDS = new Set<string>(PALETTES.map((palette) => palette.id));

/**
 * Read a stored or attribute value as a palette id.
 *
 * An unknown value falls back rather than being applied: a palette id reaches
 * `document.documentElement` as an attribute, and a stale or hand-edited
 * `localStorage` entry would otherwise leave the app on a `data-palette` no
 * stylesheet answers — every seed token back to its `:root` value, which looks
 * like the default but is not a state the user chose.
 */
export function normalizePalette(value: string | null | undefined): PaletteId {
  return value && PALETTE_IDS.has(value) ? (value as PaletteId) : DEFAULT_PALETTE;
}

export function paletteById(id: PaletteId): PaletteDefinition {
  return PALETTES.find((palette) => palette.id === id) ?? PALETTES[0];
}
