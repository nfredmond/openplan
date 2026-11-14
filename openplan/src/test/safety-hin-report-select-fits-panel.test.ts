/**
 * THE SAFETY "SAVE TO REPORT" SELECT STAYS INSIDE ITS PANEL (KI-2026-11-14-116).
 *
 * A select is as wide as its longest option. At 390 px a long report title
 * pushed it past the panel's edge. The select may now shrink and is capped at
 * the panel's width.
 *
 * Blind category: jsdom has no layout, so this checks the classes that allow
 * the shrink and set the cap, not the rendered width. The lead's 390 px look
 * at Safety is the evidence that it fits.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripSourceComments } from "@/test/helpers/source-text";

const SOURCE = stripSourceComments(readFileSync("src/components/safety/high-injury-network-panel.tsx", "utf8"));

/**
 * The class list of the select whose id is given, as written in the component:
 * the first className between that id and the select's first option.
 */
function selectClasses(id: string): string[] {
  const start = new RegExp(`<select\\s+id="${id}"`).exec(SOURCE)?.index ?? -1;
  if (start < 0) return [];
  const tag = SOURCE.slice(start, SOURCE.indexOf("<option", start));
  return /className="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? [];
}

describe("the Save to report select", () => {
  it("is found, so the check below can fail", () => {
    expect(selectClasses("safety-hin-report")).toContain("rounded-md");
  });

  it("may shrink below its longest option and never grows past the panel", () => {
    const classes = selectClasses("safety-hin-report");
    expect(classes).toContain("min-w-0");
    expect(classes).toContain("max-w-full");
  });
});
