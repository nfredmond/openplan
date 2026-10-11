import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
  CORRIDOR ANALYSIS FOLLOWS THE COLOUR MODE (October 11, 2026, KI-2026-10-11-001).

  Its surfaces were listed in the rules that force dark tokens inside a light
  page, so the page stayed a dark slab when everything else followed the
  device. This keeps them out of those rules and keeps the light-mode block
  that maps its hard-coded colours to theme tokens. Blind category: a new
  hard-coded colour in an analysis rule written after the block was
  generated, which renders in its dark colour in light mode.
*/
const css = readFileSync("src/app/globals.css", "utf8");

describe("corridor analysis follows the colour mode", () => {
  it("is not in the rules that force dark tokens in light mode", () => {
    const variant = css.match(/@custom-variant dark \(([^;]*)\);/)?.[1] ?? "";
    expect(variant).toContain(".dark *");
    expect(variant).not.toMatch(/\.analysis-/);

    const forcedDark = [...css.matchAll(/:root:not\(\.dark\) :is\(([^)]*)\)/g)].map((match) => match[1]);
    expect(forcedDark.length).toBeGreaterThan(0);
    for (const list of forcedDark) expect(list).not.toMatch(/\.analysis-/);
  });

  it("maps its surfaces and text to theme tokens in light mode", () => {
    const surface = css.match(/:root:not\(\.dark\) \.analysis-studio-surface \{([^}]*)\}/)?.[1] ?? "";
    expect(surface).toMatch(/background:\s*var\(--panel-solid\)/);
    const title = css.match(/:root:not\(\.dark\) \.analysis-sidepanel-title \{([^}]*)\}/)?.[1] ?? "";
    expect(title).toMatch(/color:\s*var\(--foreground\)/);
  });
});
