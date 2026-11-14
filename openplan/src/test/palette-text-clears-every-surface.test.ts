/**
 * SMALL TEXT CLEARS 4.5:1 ON EVERY SURFACE IT SITS ON, IN EVERY PALETTE.
 *
 * WHY THIS EXISTS
 *
 * `surface-text-stays-legible.test.ts` measures muted text on the page panel.
 * It could not see the November 3 failures, because none of them was on the
 * panel. Axe 4.11.1 reported serious colour-contrast violations on four
 * screens of the first proven job:
 *
 *   - inactive project tabs: `text-foreground/60` on the page, 4.39:1;
 *   - the "Active project" label on Safety: muted text on a 6 percent primary
 *     tint, 4.29:1, and the "Return to project" link in the accent, 4.31:1;
 *   - muted labels on sign-up and on campaign pages, on `--secondary`.
 *
 * Every one was small text a few hundredths under the floor, and four of the
 * five light palettes had the same gap on the same two surfaces. So this file
 * measures the pairs, not the screens: each text ink against each surface a
 * component is allowed to put it on, for six palettes in light and dark.
 *
 * WHAT THE ACCENT IS ALLOWED TO DO
 *
 * The accent is link text on the page and on a panel, where it passes. It is
 * not link text on a tinted surface: in Cartographic and Meadow it measures
 * 4.32:1 and 4.26:1 on the 6 percent tint. The seed stays (it is the brand
 * colour) and the link on the tint uses the foreground ink with an accent
 * underline. `planning-context-strip.test.tsx` holds that half.
 *
 * WHAT THIS CANNOT SEE
 *
 * A component that paints its own background (an arbitrary hex, a status
 * tint, an image) is outside these pairs. Axe on the rendered screens is the
 * check for those. The numbers are sRGB compositing arithmetic, the same
 * formula axe uses for a flat background.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

import { PALETTES } from "@/lib/theme/palettes";
import { stripSourceComments } from "./helpers/source-text";

/** WCAG 2 AA for text under 24px regular or 18.66px bold. */
const SMALL_TEXT_FLOOR = 4.5;

/** The strength of `bg-primary/[0.06]`, the active-project strip. */
const PRIMARY_TINT_ALPHA = 0.06;

type Rgb = [number, number, number];
type Tokens = Record<string, string>;

const sheet = postcss.parse(
  readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8"),
);

/** Custom properties of every top-level rule whose selector list includes `selector`. */
function seedsOf(selector: string): Tokens {
  const tokens: Tokens = {};
  sheet.each((node) => {
    if (node.type !== "rule") return;
    const selectors = node.selector
      .replace(/\s+/g, " ")
      .split(/,(?![^()]*\))/)
      .map((part) => part.trim());
    if (!selectors.includes(selector)) return;
    node.walkDecls((decl) => {
      if (decl.prop.startsWith("--")) tokens[decl.prop] = decl.value.trim();
    });
  });
  return tokens;
}

function parseHex(value: string): Rgb {
  const hex = value.replace("#", "");
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

function resolve(token: string, tokens: Tokens, depth = 0): Rgb {
  const value = tokens[token];
  if (value === undefined) throw new Error(`${token} is not declared`);
  if (depth > 8) throw new Error(`${token} does not resolve to a colour`);
  const reference = value.match(/^var\((--[\w-]+)\)$/);
  if (reference) return resolve(reference[1], tokens, depth + 1);
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return parseHex(value);
  throw new Error(`${token} is "${value}", which this test cannot measure`);
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/** `ink` at `alpha` painted over `under`, source-over. */
function over(ink: Rgb, alpha: number, under: Rgb): Rgb {
  return ink.map((channel, i) => channel * alpha + under[i] * (1 - alpha)) as Rgb;
}

type Combination = { palette: string; mode: "light" | "dark"; tokens: Tokens };

function combinations(): Combination[] {
  const light = seedsOf(":root");
  const dark = { ...light, ...seedsOf(".dark") };
  return PALETTES.flatMap(({ id }) => [
    {
      palette: id,
      mode: "light" as const,
      tokens: { ...light, ...seedsOf(`:root:not(.dark)[data-palette="${id}"]`) },
    },
    {
      palette: id,
      mode: "dark" as const,
      tokens: { ...dark, ...seedsOf(`.dark[data-palette="${id}"]`) },
    },
  ]);
}

type Surface = { name: string; colour: (tokens: Tokens) => Rgb };

const SURFACES: Surface[] = [
  { name: "the page", colour: (t) => resolve("--background", t) },
  { name: "a panel", colour: (t) => resolve("--card", t) },
  { name: "--secondary", colour: (t) => resolve("--secondary", t) },
  {
    name: "the 6% primary tint on the page",
    colour: (t) => over(resolve("--primary", t), PRIMARY_TINT_ALPHA, resolve("--background", t)),
  },
  {
    name: "the 6% primary tint on a panel",
    colour: (t) => over(resolve("--primary", t), PRIMARY_TINT_ALPHA, resolve("--card", t)),
  },
];

/** Inks a component may put on any of the surfaces above. */
const TEXT_INKS = ["--muted-foreground", "--ink-2", "--foreground"];

/** The accent as link text: the page and a panel only. See the header. */
const LINK_SURFACES = SURFACES.slice(0, 2);

type Measurement = { label: string; ratio: number };

function measure({ palette, mode, tokens }: Combination): Measurement[] {
  const where = `${palette} ${mode}`;
  const rows: Measurement[] = [];
  for (const ink of TEXT_INKS) {
    for (const surface of SURFACES) {
      rows.push({
        label: `${where}: ${ink} on ${surface.name}`,
        ratio: contrast(resolve(ink, tokens), surface.colour(tokens)),
      });
    }
  }
  for (const surface of LINK_SURFACES) {
    rows.push({
      label: `${where}: --primary as link text on ${surface.name}`,
      ratio: contrast(resolve("--primary", tokens), surface.colour(tokens)),
    });
  }
  rows.push({
    label: `${where}: --primary-foreground on --primary`,
    ratio: contrast(resolve("--primary-foreground", tokens), resolve("--primary", tokens)),
  });
  return rows;
}

describe("small text clears 4.5:1 on every surface, in every palette", () => {
  const all = combinations();

  /**
   * NEGATIVE CONTROL. A selector that stopped matching would leave a palette
   * measured with the default seeds, and every row would pass while measuring
   * the wrong colours. Each non-default block must restate its own text seeds.
   */
  it("reads twelve palette and mode combinations from the stylesheet", () => {
    expect(all.map(({ palette, mode }) => `${palette} ${mode}`)).toEqual(
      PALETTES.flatMap(({ id }) => [`${id} light`, `${id} dark`]),
    );
    expect(all).toHaveLength(12);
    for (const { id } of PALETTES) {
      if (id === "cartographic") continue;
      for (const selector of [`:root:not(.dark)[data-palette="${id}"]`, `.dark[data-palette="${id}"]`]) {
        const block = seedsOf(selector);
        for (const seed of ["--bg", "--ink", "--ink-2", "--muted", "--accent"]) {
          expect(block[seed], `${selector} ${seed}`).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    }
    expect(all.flatMap(measure)).toHaveLength(12 * (TEXT_INKS.length * SURFACES.length + LINK_SURFACES.length + 1));
  });

  it.each(all.map((combination) => [`${combination.palette} ${combination.mode}`, combination] as const))(
    "%s",
    (_name, combination) => {
      const failures = measure(combination)
        .filter(({ ratio }) => ratio < SMALL_TEXT_FLOOR)
        .map(({ label, ratio }) => `${label} measures ${ratio.toFixed(2)}:1`);
      expect(
        failures,
        `Small text needs ${SMALL_TEXT_FLOOR}:1. Darken (light mode) or lighten (dark mode) the seed in ` +
          "globals.css, or stop placing that ink on that surface. Do not lower the floor.",
      ).toEqual([]);
    },
  );
});

/**
 * TAB LABELS ARE NOT DIMMED WITH OPACITY.
 *
 * `text-foreground/60` composites the ink toward whatever is behind it, so its
 * contrast depends on the surface and no token records it: 4.39:1 on the
 * Cartographic page and 4.19:1 on `--secondary`. A tab label takes a token
 * ink, which the test above measures.
 */
describe("tab labels use a token ink", () => {
  const OPACITY_REDUCED_TEXT = /\btext-(?:foreground|muted-foreground|primary)\/\[?[\d.]+\]?/;
  const files = ["src/components/ui/tabs.tsx", "src/components/ui/page-tab-nav.tsx"];

  it.each(files)("%s has no opacity-reduced text colour", (file) => {
    const code = stripSourceComments(readFileSync(path.join(process.cwd(), file), "utf8"));
    expect(code).toContain("text-muted-foreground");
    expect(code.match(OPACITY_REDUCED_TEXT)?.[0]).toBeUndefined();
  });

  it("still recognises the class it forbids", () => {
    expect(OPACITY_REDUCED_TEXT.test('"text-foreground/60 hover:text-foreground"')).toBe(true);
    expect(OPACITY_REDUCED_TEXT.test('"text-foreground/[0.6]"')).toBe(true);
    expect(OPACITY_REDUCED_TEXT.test('"text-foreground hover:text-foreground"')).toBe(false);
  });

  /**
   * `--color-muted` is the muted TEXT seed in this token system, so `bg-muted`
   * paints a mid-grey block. The default tab list sits on `--secondary`, a
   * surface the test above measures.
   */
  it("puts the default tab list on a measured surface", () => {
    const code = stripSourceComments(readFileSync(path.join(process.cwd(), files[0]), "utf8"));
    expect(code).toContain('default: "bg-secondary"');
    expect(code).not.toMatch(/default:\s*"bg-muted"/);
  });
});

/**
 * `bg-muted` IS THE MUTED TEXT COLOUR, SO IT HOLDS NO TEXT.
 *
 * shadcn's `bg-muted` is a soft surface. Here `--color-muted` maps to the seed
 * `--muted`, the grey that secondary text is drawn in. At full strength it is
 * a mid-grey block: ink on it measures about 2.9:1 in Cartographic, and
 * `text-muted-foreground` on it is the same colour as its background. Found
 * 2026-11-14 on the public portal's "closed for comments" chip, the team
 * panel's role badge, the integration keys panel and the published plan pages.
 *
 * A text surface is `bg-secondary`, which the palette test above measures.
 * Full-strength `bg-muted` stays only where nothing is read: loading
 * skeletons and the empty track of a bar.
 *
 * Blind spot, stated: tints such as `bg-muted/20` are not checked here. Muted
 * text on one measures 4.10:1 on the Cartographic page. See KI-2026-11-14-111.
 */
describe("a full-strength bg-muted holds no text", () => {
  const ROOTS = ["src/components", "src/app"];
  const FULL_STRENGTH_MUTED_FILL = /(?<![\w:-])bg-muted(?![\w/-])/;

  /** Files whose full-strength fills are skeletons or bar tracks, with no text inside. */
  const DECORATIVE_ONLY = new Set([
    "src/app/(app)/projects/[projectId]/_components/project-spine-board.tsx",
    "src/app/(app)/projects/[projectId]/_components/project-spine-crosslink-board.tsx",
    "src/components/aerial/aerial-processing-jobs-panel.tsx",
    "src/components/invoicing/contracts/schedule-timeline.tsx",
    "src/components/models/model-run-manager.tsx",
  ]);

  /**
   * Text on a full-strength fill that is still open. An entry leaves this list
   * when its line is fixed; nothing is added to it.
   */
  const STILL_OPEN = new Set([
    // The selected contribution in the moderation list. KI-2026-11-14-111.
    "src/components/engagement/engagement-item-registry.tsx",
  ]);

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) return sourceFiles(full);
      return /\.tsx$/.test(entry) ? [full] : [];
    });
  }

  function filesWithTheFill(): string[] {
    const found = new Set<string>();
    for (const root of ROOTS) {
      for (const file of sourceFiles(path.join(process.cwd(), root))) {
        const code = stripSourceComments(readFileSync(file, "utf8"));
        if (code.split("\n").some((line) => FULL_STRENGTH_MUTED_FILL.test(line))) {
          found.add(path.relative(process.cwd(), file).split(path.sep).join("/"));
        }
      }
    }
    return [...found].sort();
  }

  it("uses the fill only for skeletons and bar tracks", () => {
    const unexpected = filesWithTheFill().filter((file) => !DECORATIVE_ONLY.has(file) && !STILL_OPEN.has(file));
    expect(
      unexpected,
      "bg-muted is the muted text colour in this token system. Put text on bg-secondary.",
    ).toEqual([]);
  });

  /** A list entry that no longer matches would excuse a file nobody is reading. */
  it("lists no file that has stopped using the fill", () => {
    const using = new Set(filesWithTheFill());
    for (const file of [...DECORATIVE_ONLY, ...STILL_OPEN]) expect(using.has(file), file).toBe(true);
  });

  it("recognises the fill and leaves tints and hover states alone", () => {
    expect(FULL_STRENGTH_MUTED_FILL.test('className="rounded bg-muted px-1"')).toBe(true);
    expect(FULL_STRENGTH_MUTED_FILL.test('? "border-primary bg-muted" : ""')).toBe(true);
    for (const line of ['"bg-muted/20 p-3"', '"hover:bg-muted"', '"bg-muted-foreground"', '"text-muted-foreground"']) {
      expect(FULL_STRENGTH_MUTED_FILL.test(line), line).toBe(false);
    }
  });
});
