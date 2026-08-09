import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripSourceComments } from "./helpers/source-text";

/**
 * A THEMED BACKGROUND MAY NOT CARRY HARDCODED INK.
 *
 * `--pine` is the active palette's secondary accent, and it INVERTS with the
 * mode: a dark teal/green/violet in light mode, a light mint/lime/lilac in dark
 * mode. `.public-primary-link` set `background: var(--pine); color: white`,
 * which was legible in exactly one of the ten mode/palette combinations the
 * product now ships.
 *
 * Measured in Chrome on the landing page, dark mode with the Meadow palette:
 * white on #bef264 is 1.31:1, against a 4.5:1 floor for body text. That was the
 * front door's primary sign-up button — the single most important control on
 * the public site, effectively unreadable. It was already wrong before palettes
 * existed (white on cartographic dark's #6dc6b5 is roughly 1.9:1); palettes only
 * made it obvious. After the fix, the same measurement reads 13.68:1.
 *
 * The rule this encodes is general: if a rule paints a themed token as its
 * background, its text colour must be a token too. A literal cannot follow a
 * value that changes underneath it. It is the same defect as `bg-accent` with
 * `text-foreground` in the Tailwind guard — this one catches the raw-CSS form,
 * which that guard cannot see.
 */

const CSS_FILES = ["src/app/globals.css", "src/app/cartographic.css"];

/** Background tokens whose value inverts between light and dark. */
const INVERTING_BACKGROUND_TOKENS = ["--pine", "--accent", "--accent-2", "--primary"];

const LITERAL_INK = /(?:^|[\s;{])color:\s*(?:#[0-9a-f]{3,8}|white|black|rgb|rgba)/i;

/** Split a stylesheet into `selector { body }` pairs, comments already gone. */
function declarationBlocks(css: string): Array<{ selector: string; body: string }> {
  const blocks: Array<{ selector: string; body: string }> = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    blocks.push({ selector: match[1].trim().replace(/\s+/g, " "), body: match[2] });
  }
  return blocks;
}

describe("themed surfaces pair their ink", () => {
  it("never paints a mode-inverting background with a hardcoded text colour", () => {
    const offenders: string[] = [];

    for (const file of CSS_FILES) {
      const css = stripSourceComments(readFileSync(path.join(process.cwd(), file), "utf8"));
      for (const { selector, body } of declarationBlocks(css)) {
        const background = /(?:^|[\s;{])(?:background|background-color)\s*:\s*var\((--[a-z0-9-]+)/i.exec(
          body
        );
        if (!background) continue;
        if (!INVERTING_BACKGROUND_TOKENS.includes(background[1])) continue;
        if (!LITERAL_INK.test(body)) continue;
        offenders.push(`${file}: ${selector.slice(0, 70)} paints var(${background[1]}) with a literal color`);
      }
    }

    expect(
      offenders,
      "a background that changes with the palette needs ink that changes with it — use a paired token such as --pine-ink or --primary-foreground"
    ).toEqual([]);
  });

  /**
   * Non-vacuity. If the block parser or either pattern stopped matching, the
   * assertion above would pass by finding nothing — the failure mode this repo
   * keeps meeting.
   */
  it("still recognises the pairing it forbids", () => {
    const sample = ".x { background: var(--pine); color: white; }";
    const blocks = declarationBlocks(sample);
    expect(blocks).toHaveLength(1);
    expect(/(?:^|[\s;{])(?:background|background-color)\s*:\s*var\((--[a-z0-9-]+)/i.test(blocks[0].body)).toBe(true);
    expect(LITERAL_INK.test(blocks[0].body)).toBe(true);
  });

  it("leaves a token-paired surface alone", () => {
    const sample = ".x { background: var(--pine); color: var(--pine-ink); }";
    const body = declarationBlocks(sample)[0].body;
    expect(LITERAL_INK.test(body)).toBe(false);
  });

  it("declares an ink token for --pine in both modes", () => {
    const css = stripSourceComments(readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8"));
    // One per mode is enough for every palette, because all five put a dark
    // secondary accent in light mode and a light one in dark mode.
    expect(css).toMatch(/:root\s*\{[\s\S]*?--pine-ink:/);
    expect(css).toMatch(/\.dark\s*\{[\s\S]*?--pine-ink:/);
  });
});
