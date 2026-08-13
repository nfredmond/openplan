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

/* ════════════════════════════════════════════════════════════════════════════
   THE SURFACE REACT DOES NOT RENDER — a map popup, and why the file above was
   blind to it.

   ═══ THE DEFECT ═══

   Crash popup text was reported unreadable in dark mode and fine in light. The
   popup card was Mapbox's own white box and the ink was the dark palette's
   near-white: measured in Chrome on 2026-08-13, rgb(240,237,230) on
   rgb(255,255,255) — 1.17:1 for the title, 1.85:1 for a body line. Not "poor";
   invisible. The fix was one declaration in `cartographic.css`:
   `.mapboxgl-popup-content:has(.op-map-popup) { background: var(--panel-solid) }`.

   ═══ WHY NOTHING CAUGHT IT, CONFIRMED RATHER THAN GUESSED ═══

   Three guards could plausibly have seen this and each misses for its own
   reason, so fixing one would not have covered the others:

   1. The block above reads ONLY `globals.css`, finds rule blocks declaring
      `--panel`, and measures `--muted`/`--ink` composited over it. A popup is
      painted from `cartographic.css` against `--panel-solid`, which that scan
      never looks at. (The hypothesis handed to me was that the popup escapes
      because Mapbox injects the chrome outside the React tree. That is true of
      the DOM and it is why no RENDER test sees it — but it is not why THIS file
      missed it: this file renders nothing at all. It missed it by reading the
      wrong stylesheet for the wrong token.)
   2. `themed-surfaces-pair-their-ink.test.ts` fires on an inverting token
      background carrying LITERAL ink. This defect is the mirror image — a
      LITERAL background carrying token ink — and that direction was unguarded.
   3. `safety-map-first-popup-legibility.test.ts` measures the popup's inks
      against `--panel-solid` per palette, but it ASSUMES the card is painted
      `--panel-solid`; it never reads the rule that decides. Reinstating
      `background: #ffffff` left it green (mutation M4).

   ═══ WHAT THIS BLOCK DOES ═══

   It reads the declarations themselves: whatever `cartographic.css` actually
   paints behind Mapbox-owned popup chrome, and whatever colour it actually puts
   on the text inside it — token or literal, resolved per palette out of
   `globals.css` — and measures the pair in all ten palettes. A literal
   background stops following the palette, so the dark ones fail immediately,
   which is precisely the shape of the shipped defect.

   ═══ WHAT IT CANNOT PROVE ═══

   That a browser paints what the stylesheet says: no stylesheet is applied
   anywhere in vitest, there is no box model and Mapbox never runs. It also does
   not model cascade or specificity — it reads declarations, not computed style
   — so a later `!important` from another file would be invisible to it. Those
   were checked by hand in Chrome at 3200 on 2026-08-13, probing the real popup
   DOM under the real stylesheet across all five palettes in both modes: the
   worst of the forty combinations is the kicker at 5.21:1 (slate, light), the
   best 18.63:1. Hover and focus states are excluded here, because their
   background is a `color-mix` over the card and this arithmetic would be
   claiming a precision it does not have.
   ════════════════════════════════════════════════════════════════════════════ */

/** Text in a popup is small text, everywhere in this product. */
const POPUP_CONTRAST_FLOOR = 4.5;

type Rule = { selector: string; body: string };

function rules(css: string): Rule[] {
  const out: Rule[] = [];
  for (const match of stripSourceComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: match[1].trim().replace(/\s+/g, " "), body: match[2] });
  }
  return out;
}

/** Every `--token: value` in a rule body, values left as written. */
function declaredTokens(body: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+)/gi)) {
    tokens.set(match[1], match[2].trim());
  }
  return tokens;
}

/**
 * The ten palettes as a browser would have them: each `[data-palette]` block
 * merged OVER the base it inherits from, plus the two bases themselves. Without
 * the merge a palette block that declares `--panel-solid` but inherits `--ink`
 * would resolve to nothing and quietly drop out of the sweep.
 */
function readResolvedPalettes(globalsCss: string): Array<{ name: string; isDark: boolean; tokens: Map<string, string> }> {
  const all = rules(globalsCss);
  const baseLight = new Map<string, string>();
  const baseDark = new Map<string, string>();
  for (const rule of all) {
    if (rule.selector === ":root") for (const [k, v] of declaredTokens(rule.body)) baseLight.set(k, v);
  }
  for (const [k, v] of baseLight) baseDark.set(k, v);
  for (const rule of all) {
    if (rule.selector === ".dark" || rule.selector === ":root.dark")
      for (const [k, v] of declaredTokens(rule.body)) baseDark.set(k, v);
  }

  const palettes = [
    { name: ":root (default light)", isDark: false, tokens: baseLight },
    { name: ".dark (default dark)", isDark: true, tokens: baseDark },
  ];
  for (const rule of all) {
    if (!rule.selector.includes("data-palette")) continue;
    if (!/--panel-solid\s*:/.test(rule.body)) continue;
    const isDark = isDarkSelector(rule.selector);
    const merged = new Map(isDark ? baseDark : baseLight);
    for (const [k, v] of declaredTokens(rule.body)) merged.set(k, v);
    palettes.push({ name: rule.selector, isDark, tokens: merged });
  }
  return palettes;
}

/**
 * A CSS colour as written in a rule, resolved in one palette. `null` = not a
 * flat colour this arithmetic can handle (`color-mix`, a gradient, a keyword).
 *
 * ALPHA IS CARRIED, not dropped. A text colour at 60% opacity contrasts far
 * less than its hex suggests, and a resolver that returned only the three
 * channels would report the opaque figure and pass a defect through.
 */
type Rgba = { rgb: [number, number, number]; a: number };

function resolveColor(value: string, tokens: Map<string, string>, depth = 0): Rgba | null {
  const raw = value.trim();
  if (depth > 8) return null;
  const varMatch = raw.match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]+))?\)$/i);
  if (varMatch) {
    const token = tokens.get(varMatch[1]);
    if (token) return resolveColor(token, tokens, depth + 1);
    return varMatch[2] ? resolveColor(varMatch[2], tokens, depth + 1) : null;
  }
  if (/^#[0-9a-f]{3,8}$/i.test(raw)) {
    const digits = raw.replace("#", "");
    const alpha =
      digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : digits.length === 4 ? parseInt(digits[3] + digits[3], 16) / 255 : 1;
    return { rgb: parseHex(digits.length === 4 ? digits.slice(0, 3) : digits.slice(0, 6)), a: alpha };
  }
  const rgb = raw.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?/i);
  if (rgb) {
    return {
      rgb: [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])],
      a: rgb[4] === undefined ? 1 : Number(rgb[4]),
    };
  }
  if (raw.toLowerCase() === "white") return { rgb: [255, 255, 255], a: 1 };
  if (raw.toLowerCase() === "black") return { rgb: [0, 0, 0], a: 1 };
  return null;
}

/**
 * Selectors that reach OpenPlan's themed popup family, in either direction.
 *
 * `[\w-]*` and NOT the whole-token `(?![\w-])` this repo uses elsewhere: here
 * the element classes are exactly what has to be found. The first draft used
 * the whole-token form and collected two of the five text rules — the kicker,
 * the body line and the caveat note all went unmeasured, which is most of the
 * words in a popup. A negative control asserting the count caught it.
 */
function touchesPopupFamily(selector: string): boolean {
  return /\.op-map-popup[\w-]*/.test(selector);
}

function isStateSelector(selector: string): boolean {
  return /:hover|:focus|:active/.test(selector);
}

type ChromeSurface = { selector: string; value: string };

/** What the stylesheet paints BEHIND text sitting inside Mapbox-owned chrome. */
function popupCardBackgrounds(cartographicCss: string): ChromeSurface[] {
  return rules(cartographicCss)
    .filter((rule) => rule.selector.includes("mapboxgl-popup-content"))
    .filter((rule) => touchesPopupFamily(rule.selector) && !isStateSelector(rule.selector))
    .map((rule) => {
      const found = rule.body.match(/(?:^|[\s;])background(?:-color)?\s*:\s*([^;]+)/i);
      return found ? { selector: rule.selector, value: found[1].trim() } : null;
    })
    .filter((entry): entry is ChromeSurface => entry !== null);
}

/** Every colour the stylesheet puts on text inside that chrome. */
function popupTextColors(cartographicCss: string): ChromeSurface[] {
  return rules(cartographicCss)
    .filter((rule) => touchesPopupFamily(rule.selector) && !isStateSelector(rule.selector))
    .map((rule) => {
      const found = rule.body.match(/(?:^|[\s;])color\s*:\s*([^;]+)/i);
      return found ? { selector: rule.selector, value: found[1].trim() } : null;
    })
    .filter((entry): entry is ChromeSurface => entry !== null);
}

function popupFailures(cartographicCss: string, globalsCss: string): string[] {
  const backgrounds = popupCardBackgrounds(cartographicCss);
  const texts = popupTextColors(cartographicCss);
  const failures: string[] = [];
  for (const palette of readResolvedPalettes(globalsCss)) {
    for (const background of backgrounds) {
      const card = resolveColor(background.value, palette.tokens);
      if (!card) {
        failures.push(
          `${palette.name}: the popup card's background \`${background.value}\` (${background.selector}) ` +
            `is not a colour this guard can resolve, so nothing below it can be measured.`
        );
        continue;
      }
      if (card.a < 1) {
        // A popup body may not be translucent: the tip is a CSS triangle with
        // no backdrop filter, so a see-through card would sit above an opaque
        // arrow AND put the map's own colours behind the words.
        failures.push(
          `${palette.name}: the popup card's background \`${background.value}\` is translucent ` +
            `(alpha ${card.a}) — the map shows through the words and through the tip.`
        );
        continue;
      }
      const bg = card.rgb;
      for (const text of texts) {
        const ink = resolveColor(text.value, palette.tokens);
        if (!ink) continue;
        // Translucent ink composites toward the card it sits on.
        const fg: [number, number, number] = composite(
          { r: ink.rgb[0], g: ink.rgb[1], b: ink.rgb[2], a: ink.a },
          bg
        );
        const ratio = contrast(fg, bg);
        if (ratio < POPUP_CONTRAST_FLOOR) {
          failures.push(
            `${palette.name}: \`${text.selector}\` colour ${text.value} on the popup card ` +
              `background ${background.value} measures ${ratio.toFixed(2)}:1, under the ` +
              `${POPUP_CONTRAST_FLOOR}:1 floor.`
          );
        }
      }
    }
  }
  return failures;
}

describe("text inside Mapbox-owned popup chrome stays legible in every palette", () => {
  const cartographic = readFileSync(path.join(process.cwd(), "src/app/cartographic.css"), "utf8");
  const globals = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

  /**
   * NEGATIVE CONTROL. The sweep loops over three lists; an empty one anywhere
   * makes it pass while measuring nothing — the failure mode this repo keeps
   * meeting. Five text rules is the popup family's own four plus the close
   * button, and ten palettes is five light and five dark.
   */
  it("finds the chrome it claims to measure", () => {
    expect(popupCardBackgrounds(cartographic).length).toBeGreaterThanOrEqual(1);
    expect(popupTextColors(cartographic).length).toBeGreaterThanOrEqual(5);
    const palettes = readResolvedPalettes(globals);
    expect(palettes.length).toBeGreaterThanOrEqual(10);
    expect(palettes.filter((p) => p.isDark).length).toBeGreaterThanOrEqual(5);
    for (const palette of palettes) {
      for (const token of ["--panel-solid", "--ink", "--ink-2", "--muted"]) {
        expect(resolveColor(`var(${token})`, palette.tokens), `${palette.name} ${token}`).not.toBeNull();
      }
    }
  });

  /**
   * THE MEASUREMENT PATH, PROVED ABLE TO FAIL, against a fabricated stylesheet
   * rather than by breaking the real one — so this stays a pure read. The two
   * halves are the two ways this goes wrong: a literal card that cannot follow
   * the palette (the shipped defect), and a token pairing that is simply too
   * close together.
   */
  it("would catch a popup card that stopped following the palette", () => {
    const literalCard = `
      .mapboxgl-popup-content:has(.op-map-popup) { background: #ffffff; }
      .op-map-popup { color: var(--ink); }
    `;
    const failures = popupFailures(literalCard, globals);
    expect(failures.length).toBeGreaterThanOrEqual(5);
    expect(failures.join("\n")).toContain(".dark (default dark)");
    // And the light palettes are fine with a white card, so this is a real
    // measurement rather than a blanket objection to hex.
    expect(failures.some((line) => line.includes("(default light)"))).toBe(false);
  });

  it("would catch ink too close to its own themed card, in every palette", () => {
    const tooClose = `
      .mapboxgl-popup-content:has(.op-map-popup) { background: var(--panel-solid); }
      .op-map-popup__line { color: var(--panel-solid); }
    `;
    expect(popupFailures(tooClose, globals).length).toBeGreaterThanOrEqual(10);
  });

  /** And ink that fades out is measured as it renders, not as it is written. */
  it("would catch ink faded into its own card", () => {
    const faded = `
      .mapboxgl-popup-content:has(.op-map-popup) { background: var(--panel-solid); }
      .op-map-popup__note { color: rgba(0, 0, 0, 0.18); }
    `;
    // Measured in the LIGHT palettes, where opaque black on a white card is
    // 21:1 and cannot fail for any reason except the alpha. (Black on a DARK
    // card fails either way, which would prove nothing about the resolver.)
    // The light palettes by NAME, taken from the resolver rather than by
    // looking for "dark" in the string — every light palette's selector is
    // written `:root:not(.dark)[data-palette=…]`, so a substring test reads
    // nine blocks out of ten as dark. That is the same trap `isDarkSelector`
    // exists for, hit a second time in this file.
    const lightNames = readResolvedPalettes(globals)
      .filter((palette) => !palette.isDark)
      .map((palette) => palette.name);
    const light = (source: string) =>
      popupFailures(source, globals).filter((line) =>
        lightNames.some((name) => line.startsWith(`${name}:`))
      );
    expect(light(faded).length).toBeGreaterThanOrEqual(5);
    expect(light(faded.replace("rgba(0, 0, 0, 0.18)", "#000000"))).toEqual([]);
  });

  it("keeps every line of popup text above the body-text floor", () => {
    const failures = popupFailures(cartographic, globals);

    expect(
      failures,
      "A map popup would be unreadable in one of the palettes.\n\n" +
        "This is the defect Nathaniel reported on 2026-08-13: the popup card was Mapbox's own white " +
        "box while the ink came from the dark palette, measured at 1.17:1 in Chrome. The card must be " +
        "painted from a palette token (`--panel-solid`) so it moves with the ink — a literal colour " +
        "cannot follow a value that changes underneath it.\n\n" +
        failures.join("\n")
    ).toEqual([]);
  });
});
