import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
  THE PLANNER AGENT PANEL FOLLOWS THE COLOUR MODE (October 11, 2026).

  The panel carried `surface-dark`, which forces dark tokens inside a light
  page, and about 500 hard-coded dark colour utilities (text-white, slate
  text, white-alpha borders and fills, dark gradients), so it stayed a dark
  slab in light mode. It now uses theme tokens. This keeps the class off and
  the dark utilities out. Blind category: colours set through inline styles
  or CSS rules elsewhere, and the two dimming backdrops, which stay dark in
  both modes on purpose.
*/
const source = readFileSync("src/components/assistant/app-copilot.tsx", "utf8");

describe("the Planner Agent panel follows the colour mode", () => {
  it("does not force dark tokens", () => {
    expect(source).not.toMatch(/\bsurface-dark\b/);
  });

  it("uses no hard-coded dark-theme colour utilities", () => {
    const darkOnly = /\b(?:text-(?:white|slate-(?:50|100|200|300|400|500))|(?:bg|border)-white\/|bg-black\/|(?:text|bg|border)-(?:emerald|violet|sky|amber|rose|fuchsia|pink|purple|indigo|blue|cyan|teal|green|lime|yellow|orange|red)-\d{2,3})\b/g;
    expect(source.match(darkOnly) ?? []).toEqual([]);
    expect(source).not.toMatch(/bg-\[linear-gradient\(180deg,rgba\((?:6|9|10|8),/);
  });
});
