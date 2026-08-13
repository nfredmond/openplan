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
 *
 * ═══ WHAT THIS FILE NO LONGER CLAIMS TO GUARD (2026-08-13) ═══
 *
 * Decision 2 above — the door — used to be asserted here by forbidding two
 * spellings in the rail's rules: `display: none` and `visibility: hidden`.
 * That was not a guard, it was a list. Adding `opacity: 0; pointer-events: none`
 * to the same rule left all 26 tests in this file green and left /safety, in
 * Chrome, a full-screen map with no visible clickable way off it. A guard that
 * enumerates spellings loses to the next spelling, and there is always a next
 * spelling: a transform that parks the rail off-window, a `clip-path`, a
 * z-index that puts the map canvas over it, an ancestor's opacity.
 *
 * The door is now guarded by its PROPERTY, in a real browser, where the
 * property exists:
 *
 *   qa-harness/openplan-local-escape-hatch-audit.js   (the live measurement)
 *   qa-harness/pointer-reachability.js                (the shared hit-test)
 *   qa-harness/pointer-reachability.test.js           (its verdict, pure)
 *
 * From the rendered page it asks whether at least one control is painted, big
 * enough, inside the window, not covered — `getBoundingClientRect` plus
 * accumulated computed opacity plus `document.elementFromPoint` at the
 * control's own centre — and then performs a REAL Playwright click that has to
 * change the URL. All four hiding spellings above were applied to this
 * stylesheet on 2026-08-13 and it failed on all four; the two this file used to
 * name were among them.
 *
 * NONE OF THAT IS POSSIBLE HERE. jsdom loads no stylesheet, has no box model,
 * and implements no `elementFromPoint`: an overlay, a click interception and a
 * layout are all invisible to it, and `el.click()` in jsdom bypasses hit-testing
 * entirely, so a test written this side of the line would report success on a
 * button no human could press.
 *
 * What survives here is what this side of the line can honestly do: keep the
 * two spellings out of the gate cheaply (labelled as the list it is, not as the
 * guard), and assert the browser check still EXISTS and is still runnable — a
 * mechanical cross-reference, which is the one kind of document-shaped
 * assertion this repository allows, because there the packaging is the artifact.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
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
   * THE TWO SPELLINGS WE HAVE ACTUALLY SEEN — not the door guard.
   *
   * Read the file header before trusting this. It is cheap to "improve" the
   * measurement above by deleting the rail: the map would grow by nothing at all
   * (it already runs underneath) and the planner would lose every route out of
   * the page. This catches the two crudest ways of doing that, inside the gate,
   * for nothing. It cannot catch the third, and one of the third's spellings has
   * already been shipped past it in a mutation. The check that can is
   * `qa-harness/openplan-local-escape-hatch-audit.js`.
   */
  it("keeps the two crudest ways of deleting the nav rail out of the gate", () => {
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
          `hiding it buys the map no pixels and strands the planner. Collapse it, do not remove it. ` +
          `(And if you are here because you found another way to hide it that this did not catch: ` +
          `that is expected — run qa-harness/openplan-local-escape-hatch-audit.js, which will.)`
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

  /**
   * THE DOOR GUARD IS SOMEWHERE ELSE, AND IT HAS TO STILL BE THERE.
   *
   * This is the only kind of claim about the browser check that this side of the
   * line can make honestly: not that /safety has a door — that is a measurement
   * and it happens in Chrome — but that the thing which measures it still exists,
   * still shares its hit-test with the overlap audit rather than growing a second
   * copy, and is still reachable by a documented command. A browser check nobody
   * can run is not evidence, and one that was quietly deleted is worse than one
   * that was never written, because this file's header would go on describing it.
   *
   * The paths are asserted, not the prose: if the audit is renamed, this fails
   * and whoever renamed it updates the header in the same change.
   */
  const harness = (relative: string) => path.join(process.cwd(), "..", "qa-harness", relative);

  it("still has the browser check that this file's header points at", () => {
    const audit = harness("openplan-local-escape-hatch-audit.js");
    const helper = harness("pointer-reachability.js");
    const helperTest = harness("pointer-reachability.test.js");

    for (const file of [audit, helper, helperTest]) {
      expect(existsSync(file), `${path.basename(file)} is gone — the door on /safety is now unguarded`).toBe(
        true
      );
    }

    // The audit must USE the shared hit-test, not carry its own copy. Two
    // copies of a hit test drift, and the one that drifts is always the one
    // nobody is currently looking at.
    const auditSource = readFileSync(audit, "utf8");
    expect(auditSource, "the escape-hatch audit no longer uses the shared hit-test").toMatch(
      /require\(['"]\.\/pointer-reachability['"]\)/
    );
    expect(auditSource, "the escape-hatch audit no longer performs a real click").toMatch(
      /\.click\(/
    );

    // And it must be runnable by name. `node some-file.js` that nobody has
    // written down is a file, not a check.
    const scripts = JSON.parse(readFileSync(harness("package.json"), "utf8")).scripts as Record<
      string,
      string
    >;
    const commands = Object.values(scripts).join("\n");
    expect(commands, "no npm script runs the escape-hatch audit").toContain(
      "openplan-local-escape-hatch-audit.js"
    );
    expect(commands, "no npm script runs the hit-test's own verification").toContain(
      "pointer-reachability.test.js"
    );
  });
});
