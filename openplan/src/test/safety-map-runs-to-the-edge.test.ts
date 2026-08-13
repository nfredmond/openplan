/**
 * THE SAFETY MAP RUNS TO THE LEFT EDGE, AND THE DOOR OUT STAYS ON SCREEN.
 *
 * ═══ WHAT WAS MEASURED, AND WHERE ═══
 *
 * Chrome, this tree's dev server, signed in, /safety. Nothing below is provable
 * in this file or in any other file in this repository: jsdom loads no
 * stylesheet, has no box model — every `getBoundingClientRect()` is zero — and
 * runs no Mapbox GL. These numbers came from driving the real app, and
 * re-measuring is the only way to confirm them again.
 *
 *   1600×900   before  crash map 876×796 at (274, 86) = 48.4% of the window
 *                      · nav rail column 272px · right inset 16px · bottom 16px
 *              after   crash map 1150×813 at (1, 86) = 64.9%, canvas matching
 *                      · rail floating at 60px · sidebar 432px docked right
 *    390×844   before  crash map 354×256 = 27.5%
 *              after   crash map 354×380 = 40.9%
 *
 * Identical in light and dark at both sizes; exactly one `mapboxgl.Map` on the
 * page in every case.
 *
 * ═══ WHAT THIS FILE ACTUALLY GUARDS ═══
 *
 * The two decisions behind those numbers, both of which live in CSS and in one
 * inline style, and both of which a later edit could silently undo:
 *
 *   1. On this route the surface gives up its insets, so the map reaches the
 *      window's edge.
 *   2. The nav rail is NOT removed to buy them. It collapses and floats. A
 *      planner is not a member of the public with one errand — they came from
 *      another module and are going to another module — and a full-screen map
 *      with no visible way off it is a room with no door. `display: none` on
 *      the rail would measure exactly the same and be a different product.
 *
 * The rail's collapsed geometry is also the offset Safety's own map controls
 * use, so the third assertion is that the module measures from the shell's
 * derived variable rather than from a copy of the number.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");

const CSS_PATH = "src/app/cartographic.css";
const FULL_BLEED_ATTRIBUTE = 'body[data-map-fills-surface="true"]';

/** Every rule block whose selector list mentions the full-bleed attribute. */
function fullBleedRules(css: string): { selector: string; body: string }[] {
  const rules: { selector: string; body: string }[] = [];
  const pattern = /([^{}]*)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css))) {
    const selector = match[1].trim();
    if (!selector.includes(FULL_BLEED_ATTRIBUTE)) continue;
    rules.push({ selector, body: match[2].trim() });
  }
  return rules;
}

describe("safety's map reaches the edge of the window", () => {
  const css = read(CSS_PATH);
  const rules = fullBleedRules(css);

  it("has a full-bleed rule set at all", () => {
    // Negative control for every assertion below: a parser that matched nothing
    // would let a "does not contain" check pass while proving nothing, and an
    // unreadable file would do the same.
    expect(css.length).toBeGreaterThan(5000);
    expect(rules.length).toBeGreaterThan(3);
    expect(css).toContain(".op-cart-surface");
  });

  it("releases the surface's left, right and bottom insets", () => {
    const surfaceRules = rules.filter((rule) => rule.selector.includes(".op-cart-surface"));
    expect(surfaceRules.length).toBeGreaterThan(0);

    const combined = surfaceRules.map((rule) => rule.body).join("\n");
    /*
      `(?<![-\w])` IS LOAD-BEARING. Without it, `border-left: 0` satisfies a
      search for `left: 0` — and the same rule sets both. The first version of
      this assertion passed with the inset restored to 92px, because the border
      reset next to it answered for it. A mutation that changes nothing means
      the test proves nothing, and this one proved nothing until the lookbehind
      was added.
    */
    // The left inset is the 272px the nav column used to reserve — the single
    // largest thing between the map and the window.
    expect(combined, "the surface never gives up its left inset on this route").toMatch(
      /(?<![-\w])left:\s*0(px)?\s*;/
    );
    expect(combined, "the surface never gives up its bottom inset").toMatch(
      /(?<![-\w])bottom:\s*0(px)?\s*;/
    );
    // Not `right: 0`: the Planner Agent panel widens `--cp-reserved` when it
    // docks, and a literal here would open the agent on top of the sidebar.
    expect(combined, "the right edge must follow --cp-reserved, not a literal").toMatch(
      /right:\s*var\(--cp-reserved/
    );
  });

  /**
   * THE DOOR. This is the assertion that is really worth having: it is cheap to
   * "improve" the measurement by deleting the rail, the map would grow by
   * nothing at all (it already runs underneath), and the planner would lose
   * every route out of the page except a search box they have to know about.
   */
  it("never hides the navigation rail to buy that space", () => {
    /*
      Rules that STYLE THE RAIL, not rules that merely name it. Several of the
      full-bleed rules read `… .op-cart-rail:hover ~ .op-cart-surface` — they
      mention the rail and target the surface, and counting them as rail rules
      made this test read a `left: 0` and report that the rail never expands.
      The subject of a CSS rule is the last compound in each selector part.
    */
    const railRules = rules.filter((rule) =>
      rule.selector
        .split(",")
        .some((part) => /\.op-cart-rail[\w-]*(:[\w-]+)?\s*$/.test(part.trim()))
    );
    expect(railRules.length, "the route does not restyle the rail at all").toBeGreaterThan(0);

    for (const rule of railRules) {
      expect(
        rule.body,
        `${rule.selector} takes the nav rail off /safety. The rail is the only always-visible way ` +
          `from a full-screen map to any other module; the surface already runs underneath it, so ` +
          `hiding it buys the map no pixels and strands the planner. Collapse it, do not remove it.`
      ).not.toMatch(/display:\s*none/);
      expect(rule.body).not.toMatch(/visibility:\s*hidden/);
    }

    // And it is genuinely collapsed-with-expansion rather than simply left at
    // the desktop width: both halves, because either alone is a different page.
    const restRule = railRules.find(
      (rule) => !rule.selector.includes(":hover") && !rule.selector.includes(":focus-within")
    );
    expect(restRule?.body, "the rail is not collapsed at rest on this route").toMatch(
      /width:\s*var\(--op-cart-rail-width\)/
    );
    const expandRule = railRules.find((rule) => rule.selector.includes(":hover"));
    expect(
      expandRule?.body,
      "the collapsed rail never expands, so its labels are unreachable on this route"
    ).toMatch(/width:\s*240px/);
  });

  it("derives the rail's edge from the rail's own geometry, in one place", () => {
    // The shell owns the number; nothing else may restate it.
    expect(css).toMatch(/--op-cart-rail-inset:\s*16px/);
    expect(css).toMatch(/--op-cart-rail-width:\s*60px/);
    expect(css).toMatch(
      /--op-cart-rail-edge:\s*calc\(var\(--op-cart-rail-inset\)\s*\+\s*var\(--op-cart-rail-width\)\)/
    );
    // The rail itself must USE them, or the derived edge is a number that
    // describes nothing and the two can drift apart silently.
    const railRule = /\.op-cart-rail\s*\{([^}]*)\}/.exec(css);
    expect(railRule).not.toBeNull();
    expect(railRule![1]).toMatch(/left:\s*var\(--op-cart-rail-inset\)/);
    expect(railRule![1]).toMatch(/width:\s*var\(--op-cart-rail-width\)/);
  });

  it("offsets safety's own map controls by that edge rather than by a copy of it", () => {
    const workspace = read("src/components/safety/safety-workspace.tsx");
    // The background picker sits over the map's top-left corner, which is now
    // underneath a rail painted at a higher z-index than the whole surface. A
    // literal offset here would be correct today and wrong the first time the
    // rail changed width — with the only symptom being a control nobody can see.
    // The LEFT specifically, not merely "the variable appears somewhere in the
    // file": it appears twice (the offset and the width that pays for it), so a
    // hardcoded `left: "92px"` left the looser check green.
    expect(
      workspace,
      "the map control stack's left offset is not derived from the rail's own edge"
    ).toMatch(/left:\s*"calc\(var\(--op-cart-rail-edge/);
    // The severity key moved out of the bottom-left corner, which on a
    // full-bleed map is where the account card floats.
    expect(workspace).toMatch(/absolute bottom-8 right-3[^"]*safety|bottom-8 right-3/);
    expect(workspace.length).toBeGreaterThan(1000);
  });
});
