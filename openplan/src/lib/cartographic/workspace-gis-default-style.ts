/**
 * How a workspace's uploaded layer draws the first time anybody sees it.
 *
 * ═══ WHY THIS FILE EXISTS ═══
 *
 * v0.19.0 shipped the layer library and a planner's first upload was invisible
 * twice over: the database default is `default_visible = FALSE`, so the layer
 * arrived switched OFF, and the database default colour is `#94a3b8` at 1.5px,
 * so switching it on drew a slate-grey hairline over a grey basemap. Both
 * defaults are defensible in the SCHEMA — a column default is what a row gets
 * when nobody chose, and the row an ingest script writes should not switch
 * itself on. Neither is defensible in the UPLOAD WIZARD, where a person has just
 * said "add this layer" and meant "show me this layer".
 *
 * So the schema keeps its cautious defaults (no migration, nothing destructive)
 * and the wizard states its intent explicitly, from here.
 *
 * ═══ THE SEAM ═══
 *
 * This module is SEAM B between the shell lane (which authors it and sends
 * these values at creation) and the map-painting lane (which imports the casing
 * constants so the ink on the map matches the swatch in the panel). Neither
 * lane edits the other's half; both read one definition of "how a workspace
 * layer looks", which is the only way the legend and the map can be guaranteed
 * to agree.
 *
 * NOTHING HERE NAMES A PLACE, AN AGENCY, OR A DATA SOURCE. These are drawing
 * values for whatever a planner anywhere uploads.
 */

/**
 * The colours a new layer is assigned from, in order.
 *
 * Derived from the Okabe-Ito qualitative palette, which is designed to stay
 * distinguishable under the three common forms of colour-vision deficiency —
 * that is the whole reason it is used here rather than a set of pleasant hues.
 * Every entry was chosen to hold up on BOTH basemaps this product ships: dark
 * enough to read on Mapbox light-v11 and the parchment fallback, saturated
 * enough to read on dark-v11.
 *
 * Deliberately NOT a random hue: two layers a planner cannot tell apart is the
 * same defect as one layer they cannot see.
 */
export const WORKSPACE_GIS_COLOR_CYCLE = [
  "#d55e00", // vermilion
  "#0072b2", // blue
  "#009e73", // bluish green
  "#cc79a7", // reddish purple
  "#e69f00", // orange
  "#56b4e9", // sky blue
  "#7b3294", // violet
] as const;

/**
 * The first cycle colour this workspace is not already using.
 *
 * Falls back to cycling by count once every colour is taken — an eighth layer
 * gets vermilion again, which is honest: the palette is exhausted and the
 * planner can pick their own colour in the layer's style controls. Comparison
 * is case-insensitive because a colour that arrived from the `<input
 * type="color">` control is lower-case and one typed into a fixture may not be.
 */
export function nextWorkspaceGisColor(existingColors: Iterable<string>): string {
  const taken = new Set<string>();
  let count = 0;
  for (const color of existingColors) {
    if (typeof color !== "string") continue;
    taken.add(color.trim().toLowerCase());
    count += 1;
  }
  const unused = WORKSPACE_GIS_COLOR_CYCLE.find((color) => !taken.has(color));
  if (unused) return unused;
  return WORKSPACE_GIS_COLOR_CYCLE[count % WORKSPACE_GIS_COLOR_CYCLE.length];
}

/**
 * What the upload wizard sends for a layer whose style nobody has chosen yet.
 *
 * `lineWidth` is 2.5 rather than the column's 1.5 for one measured reason: a
 * 1.5px line is a hairline at any zoom, and over a basemap that already carries
 * roads at similar weights it reads as part of the basemap rather than as the
 * agency's own data. 2.5 with a casing (below) is the narrowest line that still
 * announces itself as an overlay.
 *
 * `defaultVisible` is true because uploading IS asking to see it. The column
 * stays FALSE so that a row created any other way still arrives switched off,
 * and a planner's own later choice — stored per browser — still beats this.
 */
export const WORKSPACE_GIS_DEFAULT_STYLE = {
  lineWidth: 2.5,
  defaultVisible: true,
} as const;

/**
 * The casing drawn UNDER a workspace layer's line, per theme.
 *
 * A coloured line with no casing is unreadable over a busy basemap in one theme
 * or the other — vermilion disappears into a warm parchment road, blue
 * disappears into dark-v11 water. A halo in the theme's own background ink
 * separates the layer from whatever is beneath it without changing the layer's
 * colour, which is what keeps the panel swatch and the drawn line the same
 * colour. The crash layer already uses this glow/core idiom, so this is the
 * house pattern rather than a new invention.
 *
 * Consumed by the map-painting lane. Kept here so there is ONE answer to "what
 * colour is the halo", rather than one per map instance.
 */
export const WORKSPACE_GIS_CASING_COLOR = {
  light: "#ffffff",
  dark: "#11181c",
} as const;

/** Added to the layer's own line width to get the casing's width. */
export const WORKSPACE_GIS_CASING_EXTRA_WIDTH = 2;
