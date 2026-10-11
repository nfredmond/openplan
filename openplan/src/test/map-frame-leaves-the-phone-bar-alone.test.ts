import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
  THE MAP FRAME LEAVES THE PHONE BAR ALONE.

  The October 10, 2026 map frame collapses the rail to its 60px icon strip on
  Safety, Aerial and Corridor Analysis. Below 721px the rail is the phone's
  bottom navigation bar, and two of those rules were first written outside a
  media query: the bar shrank to 60px with its icons in a heap (seen at 390px
  on Corridor Analysis). Every rule in the map-frame block that sizes the
  rail must sit inside a min-width media query.

  Blind category: rail sizing written elsewhere in the stylesheet.
*/
const css = readFileSync("src/app/cartographic.css", "utf8");
const MARKER = "ONE FRAME FOR MAP PAGES";

/** Top-level rules in `source`, with whether each sits inside a min-width media block. */
function rules(source: string): Array<{ selector: string; body: string; desktopOnly: boolean }> {
  const out: Array<{ selector: string; body: string; desktopOnly: boolean }> = [];
  const stack: string[] = [];
  let buffer = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      stack.push(buffer.trim());
      buffer = "";
    } else if (char === "}") {
      const selector = stack.pop() ?? "";
      if (!selector.startsWith("@")) {
        out.push({ selector, body: buffer, desktopOnly: stack.some((outer) => /@media[^{]*min-width/.test(outer)) });
      }
      buffer = "";
    } else {
      buffer += char;
    }
  }
  return out;
}

describe("the map frame leaves the phone bar alone", () => {
  const start = css.indexOf(MARKER);
  const block = css.slice(css.indexOf("*/", start) + 2);

  it("finds the map-frame block and rules in it that size the rail", () => {
    expect(start).toBeGreaterThan(0);
    const sizing = rules(block).filter((rule) => /\.op-cart-rail(?![\w-])/.test(rule.selector) && /(?<![-\w])width\s*:/.test(rule.body));
    expect(sizing.length).toBeGreaterThan(2);
  });

  it("sizes the rail only inside a min-width media query", () => {
    const unscoped = rules(block)
      .filter((rule) => /\.op-cart-rail(?![\w-])/.test(rule.selector) && /(?<![-\w])width\s*:/.test(rule.body))
      .filter((rule) => !rule.desktopOnly)
      .map((rule) => rule.selector.replace(/\s+/g, " ").slice(0, 140));
    expect(unscoped).toEqual([]);
  });
});
