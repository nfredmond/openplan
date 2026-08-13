/**
 * THE PAGE PANEL MAY NOT BE MADE MORE TRANSPARENT TO SHOW THE MAP THROUGH IT.
 *
 * ═══ WHY THIS TEST EXISTS ═══
 *
 * "Uploaded layers are invisible on Safety and Aerial" has one obvious fix and
 * it is wrong. `.op-cart-surface` covers roughly three quarters of the window at
 * `--panel`, so lowering that alpha looks like it would let the map show
 * through. It does not — 18px of `backdrop-filter: blur()` spreads a 2px line
 * across ~36px, and what reaches the eye is on the order of one part in 255 —
 * and while failing to help it takes the shell's secondary text below the point
 * where anyone can read it.
 *
 * That second half is what this file measures, because it is the half a future
 * change cannot see. `--muted` carries kickers, meta rows, chips and
 * placeholders at 10.5–12px throughout the cartographic shell. Against a
 * worst-case background it measures 3.37:1 in the default light palette and
 * 3.45:1 in the default dark one — already under the 4.5:1 body floor and only
 * just over the 3:1 large-text floor. At `--panel` alpha 0.85 that becomes
 * 2.84 / 2.72; at 0.80, 2.57 / 2.28.
 *
 * So the answer to "can the map be seen" is a MODE that takes the panel off the
 * screen entirely (`reading-the-map-uncovers-it.test.tsx`), and this is the
 * mechanism that stops the next model reaching for the opacity slider instead.
 * A convention would not survive a model handoff. A failing number does.
 *
 * ═══ WHAT "WORST CASE" MEANS HERE ═══
 *
 * A light panel composites toward the colour beneath it, so the darkest
 * possible thing under it — black — is what drags a light panel furthest from
 * the white its text was chosen against. A dark panel is the mirror: white
 * beneath it is the worst case. Both are reachable in practice; a dark polygon
 * on a light basemap or a bright ortho tile under a dark one is an ordinary
 * Tuesday. The figures are compositing arithmetic over sRGB relative luminance,
 * not photographs, and the conclusion does not depend on their last decimal.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripSourceComments } from "./helpers/source-text";

/**
 * The floor, RAISED 2026-08-12 from 3.0 to 4.5 — and the reason the old number
 * was wrong is worth keeping, because it is an easy mistake to repeat.
 *
 * 3:1 is WCAG's minimum for LARGE text (>=24px, or >=18.66px bold). `--muted`
 * is not large anywhere in this product: it carries kickers, meta rows, chips,
 * form hints, every `.module-note`, and — the reason this matters more here
 * than in most apps — every honesty caveat OpenPlan writes, much of it at
 * 11.5px. Small text needs 4.5:1, so the old floor licensed exactly what it
 * was written to prevent, and all five LIGHT palettes were under it: 3.33,
 * 3.82, 4.05, 4.13 and 4.30. An app-wide UX audit found the default one; the
 * other four were found by measuring the rest rather than trusting that the
 * default was special.
 *
 * Raising this number further is a fine thing to do. Lowering it to make a
 * change pass is the move this file exists to catch.
 */
const MUTED_CONTRAST_FLOOR = 4.5;

/** Body ink has to clear the real body-text floor, in every palette. */
const INK_CONTRAST_FLOOR = 4.5;

type Palette = {
  selector: string;
  isDark: boolean;
  panel: { r: number; g: number; b: number; a: number };
  muted: string;
  ink: string;
};

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

/** `panel` painted over `under`, per the standard source-over alpha rule. */
function composite(
  panel: { r: number; g: number; b: number; a: number },
  under: [number, number, number]
): [number, number, number] {
  return [
    panel.r * panel.a + under[0] * (1 - panel.a),
    panel.g * panel.a + under[1] * (1 - panel.a),
    panel.b * panel.a + under[2] * (1 - panel.a),
  ];
}

/**
 * Which mode a palette block is for.
 *
 * `:not(...)` IS REMOVED FIRST, and skipping that step is a live bug this test
 * caught in its own first draft. The light palettes are written
 * `:root:not(.dark)[data-palette="slate"]`, so a bare `includes(".dark")` reads
 * nine of the ten blocks as dark — and every light palette would then be
 * measured against a white background instead of a black one, which is its BEST
 * case rather than its worst. The guard would have gone green on an alpha that
 * makes the light palettes unreadable.
 */
function isDarkSelector(selector: string): boolean {
  return selector.replace(/:not\([^)]*\)/g, "").includes(".dark");
}

function readPalettes(): Palette[] {
  const css = stripSourceComments(
    readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8")
  );
  const palettes: Palette[] = [];
  // Every rule block that declares a `--panel`. The cartographic palettes are
  // exactly those blocks, so the list cannot go stale when a sixth is added.
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*?--panel:[^{}]*?)\}/g)) {
    const selector = match[1].trim().split("\n").pop()?.trim() ?? match[1].trim();
    const body = match[2];
    const panelMatch = body.match(
      /--panel:\s*rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/
    );
    const mutedMatch = body.match(/--muted:\s*(#[0-9a-fA-F]{3,8})/);
    const inkMatch = body.match(/--ink:\s*(#[0-9a-fA-F]{3,8})/);
    if (!panelMatch || !mutedMatch || !inkMatch) continue;
    palettes.push({
      selector,
      isDark: isDarkSelector(selector),
      panel: {
        r: Number(panelMatch[1]),
        g: Number(panelMatch[2]),
        b: Number(panelMatch[3]),
        a: panelMatch[4] === undefined ? 1 : Number(panelMatch[4]),
      },
      muted: mutedMatch[1],
      ink: inkMatch[1],
    });
  }
  return palettes;
}

describe("the shell surface stays legible in every palette", () => {
  const palettes = readPalettes();

  /**
   * NEGATIVE CONTROL. Every assertion below runs inside a loop over this list;
   * an empty or half-read list would make all of them pass while measuring
   * nothing. Ten is five light palettes and five dark ones.
   */
  it("finds every palette to measure", () => {
    expect(palettes.length).toBeGreaterThanOrEqual(10);
    expect(palettes.filter((p) => p.isDark).length).toBeGreaterThanOrEqual(5);
    expect(palettes.filter((p) => !p.isDark).length).toBeGreaterThanOrEqual(5);
  });

  it("keeps secondary text above the contrast floor over the worst background", () => {
    const failures: string[] = [];
    for (const palette of palettes) {
      // Black under a light panel, white under a dark one — see the header.
      const under: [number, number, number] = palette.isDark ? [255, 255, 255] : [0, 0, 0];
      const background = composite(palette.panel, under);
      const ratio = contrast(parseHex(palette.muted), background);
      if (ratio < MUTED_CONTRAST_FLOOR) {
        failures.push(
          `${palette.selector}: --muted ${palette.muted} on the panel at alpha ${palette.panel.a} ` +
            `measures ${ratio.toFixed(2)}:1 against the worst-case background, under the ` +
            `${MUTED_CONTRAST_FLOOR}:1 floor.`
        );
      }
    }

    expect(
      failures,
      "The page panel has been made transparent enough to break its own text.\n\n" +
        "This is the change `reading-the-map-uncovers-it.test.tsx` and the map-reading mode exist " +
        "to make unnecessary: lowering --panel's alpha does NOT reveal a map layer through an 18px " +
        "backdrop blur (a 2px line contributes on the order of 1/255), and it DOES take the shell's " +
        "secondary text below the point where it can be read. If the goal is seeing the map, use the " +
        "mode — it takes the panel off the screen entirely and changes no colour at all.\n\n" +
        failures.join("\n")
    ).toEqual([]);
  });

  it("keeps body ink above the body-text floor over the worst background", () => {
    const failures: string[] = [];
    for (const palette of palettes) {
      const under: [number, number, number] = palette.isDark ? [255, 255, 255] : [0, 0, 0];
      const background = composite(palette.panel, under);
      const ratio = contrast(parseHex(palette.ink), background);
      if (ratio < INK_CONTRAST_FLOOR) {
        failures.push(
          `${palette.selector}: --ink ${palette.ink} measures ${ratio.toFixed(2)}:1 ` +
            `against the worst-case background.`
        );
      }
    }
    expect(failures).toEqual([]);
  });

  /**
   * The arithmetic itself, checked against values computed by hand. Without
   * this, a bug in `composite` or `contrast` that made every ratio come out
   * huge would turn both assertions above into a green light that could never
   * go red — the "verify your verification" case.
   */
  it("measures what it claims to measure", () => {
    // White on white is 1:1; black on white is 21:1.
    expect(contrast([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
    // A 94%-opaque white panel over black composites to ~240.
    expect(composite({ r: 255, g: 255, b: 255, a: 0.94 }, [0, 0, 0])[0]).toBeCloseTo(239.7, 1);

    // And the headline figure. This assertion used to pin the DEFECT — it
    // required the default light palette to measure between 3.0 and 3.8,
    // which is where `--muted` sat when this file was written. That reading
    // was correct at the time and is the reason the number was recorded, but
    // an assertion shaped that way fails the moment someone fixes the thing
    // it describes, which is the wrong way round for a guard.
    //
    // The palettes were corrected on 2026-08-12 (all ten now clear 4.5:1
    // composited against the worst case), so what is worth pinning is the
    // FLOOR, not a snapshot of one palette's distance from it. The sweep
    // above already enforces that for every palette; this keeps the
    // arithmetic honest by checking the default one is a real measurement in
    // a plausible range rather than a constant someone typed.
    const light = readPalettes().find((p) => !p.isDark);
    expect(light).toBeTruthy();
    if (!light) return;
    const ratio = contrast(parseHex(light.muted), composite(light.panel, [0, 0, 0]));
    expect(ratio).toBeGreaterThanOrEqual(MUTED_CONTRAST_FLOOR);
    expect(ratio).toBeLessThan(21);
  });
});
