import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  publishedValidationCeiling,
  worstPublishedRecord,
  PUBLISHED_VALIDATION_RECORDS,
} from "@/lib/examples/published-ceiling";
import { NEVADA_COUNTY_MAX_APE_PERCENT } from "@/lib/examples/nevada-county-2026-03-24";
import LegalPage from "@/app/(public)/legal/page";

/**
 * /legal's "worst published validation figure" is COMPUTED from the example
 * records, never restated. The page previously hardcoded "237.62" as "the
 * current published ceiling" — a sentence that silently becomes false the
 * moment a new example record publishes (2026-08-03 review). Nathaniel's
 * call (2026-08-04): live ceiling + guard, computed from PUBLISHED records
 * only — a public page must never aggregate tenant validation data.
 */

describe("published validation ceiling", () => {
  it("picks the worst record (computation, checked with a synthetic set)", () => {
    const worst = worstPublishedRecord([
      { label: "a", runDate: "2026-01-01", maxApePercent: 12.5 },
      { label: "b", runDate: "2026-02-01", maxApePercent: 300.1 },
      { label: "c", runDate: "2026-03-01", maxApePercent: 55 },
    ]);
    expect(worst.label).toBe("b");
    expect(() => worstPublishedRecord([])).toThrow(/cannot state a ceiling/);
  });

  it("today's ceiling is the Nevada County figure, dated", () => {
    const ceiling = publishedValidationCeiling();
    expect(ceiling.maxApePercent).toBe(NEVADA_COUNTY_MAX_APE_PERCENT);
    expect(ceiling.runDate).toBe("2026-03-24");
    expect(PUBLISHED_VALIDATION_RECORDS.length).toBeGreaterThan(0);
  });

  it("/legal renders the computed figure with its source and date", () => {
    render(<LegalPage />);
    const ceiling = publishedValidationCeiling();
    const sentence = screen.getByText(
      new RegExp(`max APE ${String(ceiling.maxApePercent).replace(".", "\\.")}%.*${ceiling.runDate}`)
    );
    expect(sentence.textContent).toContain(ceiling.label);
  });

  it("no page restates the figure as a literal — the fixture is the only source", () => {
    // If a new example ships with a worse figure, every surface must follow
    // the computation. A page that hardcodes the number would keep telling
    // the public the old ceiling.
    const pages = [
      path.join(process.cwd(), "src", "app", "(public)", "legal", "page.tsx"),
      path.join(process.cwd(), "src", "app", "(public)", "examples", "page.tsx"),
    ];
    for (const page of pages) {
      expect(
        readFileSync(page, "utf8").includes("237.62"),
        `${path.relative(process.cwd(), page)} restates the ceiling as a literal`
      ).toBe(false);
    }
    // ...while the fixture, the single source, still carries it.
    const fixture = readFileSync(
      path.join(process.cwd(), "src", "lib", "examples", "nevada-county-2026-03-24.ts"),
      "utf8"
    );
    expect(fixture).toContain("NEVADA_COUNTY_MAX_APE_PERCENT = 237.62");
  });
});
