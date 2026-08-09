import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripSourceComments } from "./helpers/source-text";

/**
 * `bg-accent` IS THE BRAND COLOUR HERE, NOT A MUTED SURFACE.
 *
 * shadcn's convention is that `--accent` is a soft hover/selected tint and
 * `bg-accent text-foreground` is a normal pairing. This product does not follow
 * that convention: `globals.css` maps `--color-accent` to the SEED `--accent`,
 * which is the saturated brand colour — copper on cartographic, light green on
 * meadow, violet on plum. Its legible partner is `--accent-foreground`, which
 * is near-black in dark palettes and white in light ones.
 *
 * So `bg-accent` + `text-foreground` puts page-body text on a saturated brand
 * fill. Measured in Chrome on the workspace overview, Meadow palette: the
 * current row of the section nav rendered #eaf1e9 on #86efac — a contrast
 * ratio of about 1.3:1, where 4.5:1 is the floor for body text. It was the most
 * prominent card on the page and its least readable text, and it read as a
 * full-width slab rather than a selected row. The default cartographic palette
 * was only ~2:1, so this was already wrong before palettes existed; palettes
 * made it obvious.
 *
 * The guard is deliberately narrow. Fractional opacities (`bg-accent/30`) are a
 * legitimate tint and are left alone — the failure is a FULL-strength brand
 * fill used as a text background.
 */

const ROOTS = ["src/components", "src/app"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx$/.test(entry) ? [full] : [];
  });
}

/** Full-strength `bg-accent` — not `bg-accent/40`, and not `bg-accent-foreground`. */
const FULL_STRENGTH_BRAND_FILL = /\bbg-accent\b(?!\/)(?!-)/;

describe("the brand accent is not used as a text background", () => {
  it("never pairs a full-strength bg-accent with text-foreground", () => {
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of sourceFiles(path.join(process.cwd(), root))) {
        // Comments are stripped through the shared helper: a comment explaining
        // this very rule names both class strings, and prose about a violation
        // must not register as one.
        const code = stripSourceComments(readFileSync(file, "utf8"));
        for (const line of code.split("\n")) {
          if (FULL_STRENGTH_BRAND_FILL.test(line) && /\btext-foreground\b/.test(line)) {
            offenders.push(`${path.relative(process.cwd(), file)}: ${line.trim().slice(0, 120)}`);
          }
        }
      }
    }

    expect(
      offenders,
      "bg-accent is the saturated brand colour in this token system; pair it with " +
        "text-accent-foreground, or use bg-secondary for a selected surface"
    ).toEqual([]);
  });

  /**
   * Non-vacuity. If the pattern stopped matching anything at all — a rename, a
   * regex typo — the assertion above would pass by finding nothing, which is
   * the failure mode this repo keeps meeting.
   */
  it("still recognises the pairing it forbids", () => {
    const line = '<div className="bg-accent text-foreground rounded" />';
    expect(FULL_STRENGTH_BRAND_FILL.test(line) && /\btext-foreground\b/.test(line)).toBe(true);
  });

  it("leaves fractional tints and the foreground token alone", () => {
    for (const line of [
      '<li className="hover:bg-accent/60 text-foreground" />',
      '<div className="bg-accent/30 text-foreground" />',
      '<div className="bg-accent text-accent-foreground" />',
      '<div className="bg-accent-foreground text-foreground" />',
    ]) {
      const flagged = FULL_STRENGTH_BRAND_FILL.test(line) && /\btext-foreground\b/.test(line);
      expect(flagged, line).toBe(false);
    }
  });
});
