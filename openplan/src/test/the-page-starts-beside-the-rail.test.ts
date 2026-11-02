import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stripSourceComments } from "@/test/helpers/source-text";

/**
 * THE PAGE STARTS WHERE THE RAIL STOPS.
 *
 * Seen in Chrome on 2026-11-02 at 1440 by 900: /safety's page began at x=0
 * while the solid 60px nav rail sat on top of it, so the "Active project"
 * strip read "ive project" and the no-key map notice lost its first letters.
 * The cause was one declaration, `left: 0` on the full-bleed surface, written
 * when the rail was a translucent strip floating over the map. The October 10
 * frame made the rail solid and left that `left: 0` in place.
 *
 * Measured after the fix (same browser, same sizes): rail right edge 60, page
 * left edge 60 on /safety at 1440 and 1280; every other page already started
 * at or past the rail (240 beside the open rail, 60 beside the collapsed one).
 *
 * WHAT THIS READS. Every rule in `cartographic.css` whose subject is the page
 * surface (`.op-cart-surface`) and that sets `left`, outside the phone block.
 * Each value must be the rail's own variable or a pixel literal at least as
 * wide as the collapsed rail. A literal `0`, a 16px inset or an unrecognised
 * expression fails and has to be answered for.
 *
 * WHAT IT CANNOT SEE. jsdom has no box model, so this is source, not layout:
 * a page that pushes its own content left with a negative margin or a
 * transform, a rail that widens without its variable changing, or a rule
 * written in another stylesheet. The browser check that sees the rendered
 * boxes is `chromeOverlapInPage` in
 * `qa-harness/openplan-local-control-hit-test-audit.js`, which no longer
 * exempts the full-bleed map page.
 */

const CSS_PATH = path.join(process.cwd(), "src", "app", "cartographic.css");

type Rule = { media: string; selector: string; body: string };

/** Flat list of style rules with the @media prelude that encloses each one. */
function readRules(css: string): Rule[] {
  const source = stripSourceComments(css);
  const rules: Rule[] = [];
  const mediaStack: string[] = [];
  let cursor = 0;
  let prelude = "";
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "{") {
      const head = prelude.trim();
      if (head.startsWith("@")) {
        mediaStack.push(head);
        prelude = "";
        cursor += 1;
        continue;
      }
      const close = source.indexOf("}", cursor);
      rules.push({ media: mediaStack.join(" "), selector: head, body: source.slice(cursor + 1, close) });
      prelude = "";
      cursor = close + 1;
      continue;
    }
    if (char === "}") {
      mediaStack.pop();
      prelude = "";
      cursor += 1;
      continue;
    }
    if (char === ";" && prelude.trim().startsWith("@")) {
      prelude = "";
      cursor += 1;
      continue;
    }
    prelude += char;
    cursor += 1;
  }
  return rules;
}

/** The phone layout puts the rail at the bottom, so `left: 0` is right there. */
function isPhoneOnly(media: string): boolean {
  const max = /max-width:\s*(\d+)px/.exec(media);
  return max !== null && Number(max[1]) <= 720;
}

/** A selector part whose last compound targets the page surface itself. */
function targetsSurface(selector: string): boolean {
  return selector.split(",").some((part) => /\.op-cart-surface(:[\w-]+(\([^)]*\))?)*\s*$/.test(part.trim()));
}

function leftValues(body: string): string[] {
  return [...body.matchAll(/(?<![-\w])left:\s*([^;]+);/g)].map((match) => match[1].trim());
}

describe("the page surface never starts under the nav rail on a desktop", () => {
  const css = readFileSync(CSS_PATH, "utf8");
  const rules = readRules(css);
  const railWidth = Number(/--op-cart-rail-width:\s*(\d+)px/.exec(css)?.[1]);
  const placements = rules
    .filter((rule) => targetsSurface(rule.selector) && !isPhoneOnly(rule.media))
    .flatMap((rule) => leftValues(rule.body).map((value) => ({ ...rule, value })));

  it("reads the stylesheet it claims to read", () => {
    // Negative controls: a parser that found nothing would pass every
    // assertion below while proving nothing.
    expect(railWidth).toBe(60);
    expect(rules.length).toBeGreaterThan(200);
    expect(placements.length).toBeGreaterThan(5);
    // The full-bleed map page is the one that broke; it must be in the set.
    expect(placements.some((p) => p.selector.includes('data-map-fills-surface="true"'))).toBe(true);
    // And the phone rule that legitimately sets `left: 0` must be the thing the
    // media filter removed, not something the parser never saw.
    const phoneZero = rules.filter(
      (rule) => targetsSurface(rule.selector) && isPhoneOnly(rule.media) && leftValues(rule.body).includes("0")
    );
    expect(phoneZero.length).toBeGreaterThan(0);
  });

  it("starts every desktop page at or past the rail's edge", () => {
    for (const placement of placements) {
      const literal = /^(\d+)px$/.exec(placement.value);
      const allowed =
        /^var\(--op-cart-rail-(width|edge)\)$/.test(placement.value) ||
        (literal !== null && Number(literal[1]) >= railWidth);
      expect(
        allowed,
        `${placement.selector} sets left: ${placement.value}${placement.media ? ` inside ${placement.media}` : ""}. ` +
          `The nav rail is ${railWidth}px wide and solid on a desktop, so a page that starts left of ` +
          `it is drawn underneath it. Use var(--op-cart-rail-edge) or var(--op-cart-rail-width).`
      ).toBe(true);
    }
  });
});
