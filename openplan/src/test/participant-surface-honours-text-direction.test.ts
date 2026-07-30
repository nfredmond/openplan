import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PORTAL_LOCALE_DIRECTION, PORTAL_LOCALES } from "@/lib/engagement/portal-i18n/locales";

/**
 * A STYLESHEET CAN UNDO A `dir` ATTRIBUTE, SILENTLY, AND NO COMPONENT TEST SEES IT.
 *
 * The participant portal resolves the reader's language, sets `dir="rtl"` on its
 * own wrapper, and marks every run of text with the language it is really in.
 * All of that is asserted elsewhere and all of it passes. None of it survives a
 * rule that says `border-left`.
 *
 * `dir` flips the INLINE axis. A physical property does not participate: on an
 * Arabic page, text runs right-to-left while `padding-left`/`border-left` keep
 * painting the same physical edge, so every accent bar and indent lands on the
 * far side of the text it belongs to. The page is not subtly off — the rails
 * that group a fact with its label now sit against the wrong paragraph.
 *
 * TWO OF THE ELEVEN OFFERED LANGUAGES ARE RTL, so this is not a hypothetical
 * axis: it is the difference between offering Arabic and Farsi and appearing to.
 * The test derives that from the direction map rather than asserting "two", so
 * adding a twelfth language does not need this file edited.
 *
 * WHY A FILE SCAN RATHER THAN A RENDER TEST. jsdom does not do layout, so no
 * amount of rendering will notice a border on the wrong edge. The fact that is
 * checkable is textual and it is the one that matters: a `.public-*` rule — the
 * participant surface's own namespace — must not name a physical inline side.
 *
 * SCOPED TO `.public-*` DELIBERATELY. The operator console is not translated,
 * never flips, and has hundreds of physical rules whose conversion would be
 * churn with no reader on the other end. `.chapter-markdown` is in that group.
 * If a console surface is ever translated, widen this scan rather than adding a
 * second one.
 */

const CSS_PATH = join(process.cwd(), "src/app/globals.css");

/** The physical inline-axis declarations. Block-axis (`top`/`bottom`) is fine. */
const PHYSICAL_INLINE = [
  "padding-left",
  "padding-right",
  "border-left",
  "border-right",
  "margin-left",
  "margin-right",
] as const;

/**
 * Every rule whose selector list mentions a `.public-*` class, as
 * `[selector, body]`. A hand-rolled split rather than a CSS parser because the
 * file has no nested at-rules inside these blocks and a dependency for one
 * assertion is a worse trade.
 */
function publicSurfaceRules(css: string): Array<{ selector: string; body: string; line: number }> {
  const rules: Array<{ selector: string; body: string; line: number }> = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) {
    const selector = match[1].trim();
    if (!/\.public-[\w-]+/.test(selector)) continue;
    rules.push({
      selector,
      body: match[2],
      line: css.slice(0, match.index).split("\n").length,
    });
  }
  return rules;
}

describe("the participant surface honours the direction it declares", () => {
  const css = readFileSync(CSS_PATH, "utf8");

  it("offers at least one right-to-left language, so the axis is real", () => {
    const rtl = PORTAL_LOCALES.filter((locale) => PORTAL_LOCALE_DIRECTION[locale] === "rtl");
    expect(rtl.length).toBeGreaterThan(0);
  });

  it("finds the participant rules it is supposed to be scanning", () => {
    // Non-vacuity. A selector rename that emptied this scan would otherwise
    // turn the assertion below into a test that passes by finding nothing.
    expect(publicSurfaceRules(css).length).toBeGreaterThan(20);
  });

  it("uses no physical inline property in a .public-* rule", () => {
    const offenders = publicSurfaceRules(css).flatMap(({ selector, body, line }) =>
      PHYSICAL_INLINE.filter((property) =>
        new RegExp(`(^|[;{\\s])${property}(-color|-width|-style)?\\s*:`).test(body)
      ).map((property) => `${CSS_PATH}:${line} — ${selector} uses ${property}`)
    );

    expect(
      offenders,
      [
        "A `.public-*` rule names a physical inline side. On an Arabic or Farsi",
        "portal `dir=\"rtl\"` flips the text but not this rule, so the rail lands",
        "on the wrong edge. Use the logical equivalent:",
        "  padding-left  -> padding-inline-start",
        "  border-left   -> border-inline-start",
        "  margin-left   -> margin-inline-start",
        "(and `-right` -> `-inline-end`).",
      ].join("\n")
    ).toEqual([]);
  });
});
