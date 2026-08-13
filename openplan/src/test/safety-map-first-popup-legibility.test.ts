/**
 * A MAP POPUP IS A SURFACE, AND IT HAS TO BE READABLE IN BOTH MODES.
 *
 * ═══ THE DEFECT, AND WHY THE EXISTING GUARD WAS BLIND TO IT ═══
 *
 * The Safety crash popup was unreadable in dark mode and fine in light. Measured
 * in Chrome on `/safety` on 2026-08-13: text computed to rgb(240,237,230) on a
 * `.mapboxgl-popup-content` background of rgb(255,255,255) — about 1.1:1 —
 * because the popup carried a font size and nothing else, so Mapbox's own
 * stylesheet supplied the white card and the page supplied the near-white ink.
 *
 * `surface-text-stays-legible.test.ts` could not see it, and this is the precise
 * reason rather than a guess: it reads `globals.css`, finds the rule blocks that
 * declare `--panel`, and measures `--muted` and `--ink` composited over that
 * panel. It renders no component and reads no other stylesheet. A Mapbox popup
 * is not a React child at all — Mapbox appends it to the map container — it is
 * painted by `mapbox-gl.css`, and its background is `--panel-solid` (not
 * `--panel`) once a popup opts into OpenPlan's themed family. Three separate
 * reasons the arithmetic in that file was measuring somewhere else.
 *
 * ═══ WHAT THIS FILE ADDS ═══
 *
 * 1. THE POPUP'S OWN BACKGROUND, MEASURED. `--panel-solid` is opaque, so there
 *    is no compositing to do and no worst case to assume: the numbers here are
 *    the real ones a planner sees. Every palette, both modes, all three text
 *    colours the popup family uses.
 *
 * 2. A RATCHET OVER EVERY POPUP BUILDER. Nine components construct a
 *    `mapboxgl.Popup`. Two are themed today; the rest still wear the library's
 *    default chrome and are listed by name below. The list may only SHRINK — a
 *    new popup that skips the themed family fails this test, and the fix is one
 *    class name. This is the mechanism part: a one-off colour fix on Safety
 *    would have left the same defect in seven other files with nothing watching.
 *
 * WHAT THIS CANNOT PROVE: that a browser paints what the stylesheet says. That
 * was checked by hand, in Chrome, in both modes, and the measured figures are in
 * the paragraph above.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripSourceComments } from "./helpers/source-text";

/** Small text needs 4.5:1. Every string in a popup is small text. */
const CONTRAST_FLOOR = 4.5;

function parseHex(hex: string): [number, number, number] {
  const value = hex.trim().replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

type PopupPalette = {
  selector: string;
  panelSolid: string;
  inks: Array<{ name: string; hex: string }>;
};

/**
 * Every palette block that declares a `--panel-solid`, with the three text
 * colours the popup family paints on it: the card's own colour (`--ink`), the
 * body lines and the caveat note (`--ink-2`), and the kicker (`--muted`).
 */
function readPopupPalettesFrom(rawCss: string): PopupPalette[] {
  const css = stripSourceComments(rawCss);
  const palettes: PopupPalette[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*?--panel-solid:[^{}]*?)\}/g)) {
    const selector = match[1].trim().split("\n").pop()?.trim() ?? match[1].trim();
    const body = match[2];
    const solid = body.match(/--panel-solid:\s*(#[0-9a-fA-F]{3,8})/);
    if (!solid) continue;
    const inks: Array<{ name: string; hex: string }> = [];
    for (const name of ["--ink", "--ink-2", "--muted"]) {
      const found = body.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})`));
      if (found) inks.push({ name, hex: found[1] });
    }
    if (inks.length === 0) continue;
    palettes.push({ selector, panelSolid: solid[1], inks });
  }
  return palettes;
}

function readPopupPalettes(): PopupPalette[] {
  return readPopupPalettesFrom(
    readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8")
  );
}

/** Every text colour that does not clear the floor on its own popup card. */
function paletteFailures(palettes: PopupPalette[]): string[] {
  const failures: string[] = [];
  for (const palette of palettes) {
    // No compositing: `--panel-solid` is opaque, which is exactly why the popup
    // family uses it — the tip is a CSS triangle and cannot carry a backdrop
    // filter, so a translucent body would sit above an opaque arrow.
    const background = parseHex(palette.panelSolid);
    for (const ink of palette.inks) {
      const ratio = contrast(parseHex(ink.hex), background);
      if (ratio < CONTRAST_FLOOR) {
        failures.push(
          `${palette.selector}: ${ink.name} ${ink.hex} on --panel-solid ${palette.panelSolid} ` +
            `measures ${ratio.toFixed(2)}:1, under the ${CONTRAST_FLOOR}:1 floor.`
        );
      }
    }
  }
  return failures;
}

describe("a map popup stays readable in every palette", () => {
  const palettes = readPopupPalettes();

  /**
   * NEGATIVE CONTROL. Every assertion below loops over this list, so an empty or
   * half-read one would pass while measuring nothing. Ten is five light palettes
   * and five dark ones, and each must carry all three ink colours — a palette
   * read without its `--ink-2` would silently stop measuring the popup's body
   * text, which is most of the words in it.
   */
  it("finds every palette a popup can open over", () => {
    expect(palettes.length).toBeGreaterThanOrEqual(10);
    for (const palette of palettes) {
      expect(palette.inks.map((ink) => ink.name).sort()).toEqual(["--ink", "--ink-2", "--muted"]);
    }
  });

  /**
   * THE MEASUREMENT PATH, PROVED ABLE TO FAIL — against a fabricated stylesheet
   * rather than by breaking the real one, so this stays a pure read.
   *
   * A guard that only ever runs over passing input is not evidence that it could
   * catch anything. This feeds `readPopupPalettesFrom` a palette whose body text
   * is one shade off its own card and asserts the whole chain — parse, ink list,
   * contrast — reports it.
   */
  it("would catch an unreadable palette", () => {
    const broken = readPopupPalettesFrom(`
      :root.dark[data-palette="probe"] {
        --panel-solid: #1c2225;
        --ink: #f0ede6;
        --ink-2: #23292c;
        --muted: #c4beb1;
      }
    `);
    expect(broken).toHaveLength(1);
    const failures = paletteFailures(broken);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("--ink-2");
  });

  it("keeps every line of popup text above the body-text floor", () => {
    const failures = paletteFailures(palettes);

    expect(
      failures,
      "A map popup would be unreadable in one of the palettes.\n\n" + failures.join("\n")
    ).toEqual([]);
  });

  /**
   * THE ARITHMETIC, and the DEFECT ITSELF as a fixed pair of numbers.
   *
   * Without the second half, a bug that made every ratio come out large would
   * turn the sweep above into a green light that could never go red. The
   * unthemed pair is what the crash popup really computed to in Chrome in dark
   * mode, and it has to keep measuring as a failure for the sweep to mean
   * anything.
   */
  it("measures what it claims to measure", () => {
    expect(contrast([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);

    // Dark-palette ink on Mapbox's own white popup card — the shipped defect.
    const unthemed = contrast(parseHex("#f0ede6"), [255, 255, 255]);
    expect(unthemed).toBeLessThan(1.2);
    expect(unthemed).toBeLessThan(CONTRAST_FLOOR);

    // The same ink on the themed card, in the same palette.
    const themed = contrast(parseHex("#f0ede6"), parseHex("#1c2225"));
    expect(themed).toBeGreaterThan(12);
  });
});

/**
 * THE RATCHET. Every component that builds a `mapboxgl.Popup` should hand it
 * content wearing `op-map-popup`, which is what makes the card theme-aware.
 *
 * These entries are a debt list, not a design: each one is a popup that still
 * renders in Mapbox's white default chrome and will have the same dark-mode
 * problem the crash popup had. Remove a name when you theme it. NEVER add one.
 */
const KNOWN_UNTHEMED_POPUPS = [
  "src/components/engagement/location-display-map.tsx",
  "src/components/engagement/public-map-stage.tsx",
  "src/components/engagement/participation-heatmap-map.tsx",
  "src/components/models/traffic-volume-map.tsx",
  "src/components/rtp/rtp-cycle-project-map.tsx",
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("every map popup opts into the themed family", () => {
  const root = process.cwd();
  const builders = sourceFiles(path.join(root, "src/components"))
    .map((file) => ({ file: path.relative(root, file), text: readFileSync(file, "utf8") }))
    // The comments are stripped for the SAME reason five guards in this repo
    // learned the hard way: a file that only mentions `mapboxgl.Popup` in a
    // paragraph about popups is not a popup builder, and a file that names
    // `op-map-popup` in a comment has not applied it.
    .map((entry) => ({ file: entry.file, text: stripSourceComments(entry.text) }))
    .filter((entry) => /new\s+mapboxgl\.Popup\(/.test(entry.text));

  /** NEGATIVE CONTROL: the sweep has to be finding files at all. */
  it("finds the popup builders", () => {
    expect(builders.length).toBeGreaterThanOrEqual(6);
    expect(builders.map((entry) => entry.file)).toContain(
      "src/components/safety/safety-crash-map.tsx"
    );
  });

  it("themes every popup that is not on the shrink-only debt list", () => {
    /*
      THE ROOT CLASS, AS A WHOLE TOKEN — and the first draft of this line was
      wrong in a way worth recording. It asked for `includes("op-map-popup")`,
      which the element classes satisfy as a substring: a popup carrying only
      `op-map-popup__title` on its children passed while its card wore no theme
      at all. Deleting the root class from the crash map left this test green,
      which is the "matched the import, not the call" failure this repo has hit
      before. `(?![\w-])` is what makes it the family class and not a prefix of
      one, because `.mapboxgl-popup-content:has(.op-map-popup)` — the rule that
      actually paints the card — matches nothing else.
    */
    const unthemed = builders
      .filter((entry) => !/\bop-map-popup(?![\w-])/.test(entry.text))
      .map((entry) => entry.file);

    const unexpected = unthemed.filter((file) => !KNOWN_UNTHEMED_POPUPS.includes(file));
    expect(
      unexpected,
      "A map popup renders in Mapbox's default white chrome, which is unreadable in the dark " +
        "palettes (measured 1.1:1). Give its content the `op-map-popup` class family from " +
        "cartographic.css — that is the whole fix.\n\n" +
        unexpected.join("\n")
    ).toEqual([]);

    // And the list may only shrink. A name left behind after a file is themed
    // (or deleted) would quietly re-open the hole for the next popup added there.
    const stale = KNOWN_UNTHEMED_POPUPS.filter((file) => !unthemed.includes(file));
    expect(
      stale,
      "These files are on the unthemed-popup debt list but are not unthemed any more. " +
        "Delete them from KNOWN_UNTHEMED_POPUPS.\n\n" + stale.join("\n")
    ).toEqual([]);
  });
});
