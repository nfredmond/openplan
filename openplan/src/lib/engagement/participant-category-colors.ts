/**
 * The colour each topic is drawn in on the resident's map.
 *
 * Operators rarely set a colour (every category in the local demo stack has
 * none), and the map-first surface used to pass no colour at all, so every pin
 * was the same blue and the topic a pin belonged to could not be seen. A topic
 * the operator coloured keeps that colour; the rest take the next colour from a
 * fixed palette in the operator's own topic order, so a topic keeps its colour
 * for as long as the topic list does not change.
 *
 * The palette is drawn from Okabe and Ito's colour-blind-safe set with orange
 * removed, because orange is the resident's own mark on this map. It has no sky
 * blue either: that is the colour of a comment with no topic.
 */

export const UNCATEGORIZED_MAP_COLOR = "#38bdf8";

export const PARTICIPANT_CATEGORY_PALETTE = [
  "#0072B2",
  "#009E73",
  "#CC79A7",
  "#6A3D9A",
  "#8C510A",
  "#B8860B",
  "#C0392B",
] as const;

function validHex(value: string | null | undefined): string | null {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : null;
}

/** Topic id → the colour its pins, shapes and filter swatch use. */
export function resolveParticipantCategoryColors(
  categories: ReadonlyArray<{ id: string; color?: string | null }>
): Map<string, string> {
  const colors = new Map<string, string>();
  let next = 0;
  for (const category of categories) {
    const own = validHex(category.color);
    if (own) {
      colors.set(category.id, own);
      continue;
    }
    colors.set(category.id, PARTICIPANT_CATEGORY_PALETTE[next % PARTICIPANT_CATEGORY_PALETTE.length]);
    next += 1;
  }
  return colors;
}
