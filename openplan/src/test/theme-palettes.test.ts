import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DEFAULT_PALETTE, PALETTES, normalizePalette } from "@/lib/theme/palettes";

/**
 * Comments are stripped before anything is scanned.
 *
 * The first version of this guard failed on a palette id of "x" — which exists
 * nowhere in the product. It came from the explanatory comment above the
 * palette blocks, which spells out `[data-palette="x"]` while describing the
 * specificity rule. A guard that reads prose as if it were code is the defect
 * this repo has hit before in the other direction, where a comment made a check
 * PASS. Same root cause: match the artifact, not the paragraph about it.
 */
const GLOBALS_CSS = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

/**
 * A PALETTE THAT IS IN THE MENU AND NOT IN THE STYLESHEET CHANGES NOTHING.
 *
 * The registry drives the picker; `globals.css` does the actual theming. They
 * are two files that must agree, which is the shape that drifts. The failure is
 * quiet in the worst way: selecting the palette sets `data-palette`, no rule
 * matches, every seed token falls back to `:root`, and the product looks like
 * the default — so the picker appears to work and simply does nothing.
 *
 * Both directions are checked, because CSS with no registry entry is the same
 * bug seen from the other end: a palette nobody can select.
 */
function paletteBlocksIn(css: string): Set<string> {
  const ids = new Set<string>();
  for (const match of css.matchAll(/\[data-palette="([a-z-]+)"\]/g)) ids.add(match[1]);
  return ids;
}

describe("theme palettes", () => {
  it("gives every palette a light and a dark block", () => {
    for (const palette of PALETTES) {
      if (palette.id === DEFAULT_PALETTE) continue; // the default IS :root / .dark
      expect(
        GLOBALS_CSS.includes(`:root:not(.dark)[data-palette="${palette.id}"]`),
        `${palette.id} has no light block`
      ).toBe(true);
      expect(
        GLOBALS_CSS.includes(`.dark[data-palette="${palette.id}"]`),
        `${palette.id} has no dark block`
      ).toBe(true);
    }
  });

  it("has no CSS block for a palette nobody can select", () => {
    const registered = new Set(PALETTES.map((palette) => palette.id));
    for (const id of paletteBlocksIn(GLOBALS_CSS)) {
      expect(registered.has(id), `globals.css styles "${id}" but no palette declares it`).toBe(true);
    }
  });

  /**
   * The light blocks MUST carry `:not(.dark)`. Without it,
   * `:root[data-palette="slate"]` (0,2,0) outranks `.dark` (0,1,0) and drags the
   * light seed tokens into dark mode — a white page in dark mode for every
   * non-default palette. Specificity, not source order, is what decides this.
   */
  it("scopes light palette blocks away from dark mode", () => {
    for (const match of GLOBALS_CSS.matchAll(/(^|\})\s*(:root[^{]*\[data-palette="[a-z-]+"\])\s*\{/gm)) {
      const selector = match[2];
      expect(selector, `${selector} would also match dark mode`).toContain(":not(.dark)");
    }
  });

  it("declares the default palette, and it is the one the product already looked like", () => {
    expect(PALETTES.some((palette) => palette.id === DEFAULT_PALETTE)).toBe(true);
    expect(DEFAULT_PALETTE).toBe("cartographic");
  });

  it("offers a near-neutral option in both modes", () => {
    // Requested explicitly: a palette with hardly any colour. Asserted on the
    // definition rather than the name, so renaming it does not lose the option.
    const slate = PALETTES.find((palette) => palette.id === "slate");
    expect(slate).toBeDefined();
    expect(GLOBALS_CSS).toContain(':root:not(.dark)[data-palette="slate"]');
    expect(GLOBALS_CSS).toContain('.dark[data-palette="slate"]');
  });

  it("falls back rather than applying an unknown palette", () => {
    expect(normalizePalette("not-a-palette")).toBe(DEFAULT_PALETTE);
    expect(normalizePalette(null)).toBe(DEFAULT_PALETTE);
    expect(normalizePalette(undefined)).toBe(DEFAULT_PALETTE);
    expect(normalizePalette("slate")).toBe("slate");
  });

  it("gives every palette both mode swatches for the picker preview", () => {
    for (const palette of PALETTES) {
      for (const mode of ["light", "dark"] as const) {
        const swatch = palette.swatch[mode];
        for (const key of ["bg", "panel", "accent", "accent2"] as const) {
          expect(swatch[key], `${palette.id}.${mode}.${key}`).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    }
  });
});

/**
 * STATUS COLOUR IS NOT DECORATION.
 *
 * `--urgent`, `--warn` and `--ok` mean failing, needs-review and ok. A planner
 * who learns that red means a blocked gate must not have to relearn it because
 * a colleague preferred a cooler workspace, and a screenshot of a red flag in a
 * board packet must mean the same thing in every palette. They stay on the base
 * tokens; no palette block may set them.
 */
describe("palette blocks leave status colours alone", () => {
  it("sets no status token inside any palette block", () => {
    const blocks = GLOBALS_CSS.matchAll(
      /\[data-palette="([a-z-]+)"\]\s*\{([^}]*)\}/g
    );
    for (const [, id, body] of blocks) {
      for (const token of ["--urgent", "--warn", "--ok"]) {
        expect(
          new RegExp(`^\\s*${token}\\s*:`, "m").test(body),
          `palette "${id}" overrides ${token}; status colour must not depend on a colour preference`
        ).toBe(false);
      }
    }
  });
});
