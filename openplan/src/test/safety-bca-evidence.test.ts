import { describe, expect, it } from "vitest";
import {
  buildBcaCrashInputSuggestion,
  type BcaCrashEvidenceIngest,
  type BcaCrashSeverityCounts,
} from "@/lib/safety/bca-evidence";

function ingest(over: Partial<BcaCrashEvidenceIngest> = {}): BcaCrashEvidenceIngest {
  return {
    id: "ingest-1",
    status: "ready",
    sourceLabel: "Statewide crash reporting system",
    attribution: "Source agency (public domain).",
    severityCompleteness: "kabco_full",
    crashCount: 1180,
    geocodedCount: 1089,
    truncated: false,
    yearsRequested: [2021, 2022, 2023, 2024, 2025],
    ...over,
  };
}

function counts(over: Partial<BcaCrashSeverityCounts> = {}): BcaCrashSeverityCounts {
  return { fatal: 10, severeInjury: 25, injury: 400, pdo: 654, ...over };
}

describe("buildBcaCrashInputSuggestion", () => {
  it("maps observed severity counts onto the BCA crash dimensions as annual averages", () => {
    const suggestion = buildBcaCrashInputSuggestion(ingest(), counts());
    expect(suggestion).not.toBeNull();
    // Five distinct requested years → totals divided by 5; severe-injury rows
    // fold into the single non-fatal injury dimension.
    expect(suggestion!.suggestedInputs).toEqual({
      fatal: 2,
      injury: 85,
      propertyDamageOnly: 130.8,
    });
    // Every suggestion says observed is not avoided.
    expect(suggestion!.caveats.some((caveat) => /not crashes avoided/i.test(caveat))).toBe(true);
  });

  it("names the source, the reported-vs-geocoded counts, the years, and the ingest id in the citation", () => {
    const suggestion = buildBcaCrashInputSuggestion(ingest(), counts());
    expect(suggestion!.citationText).toContain("Statewide crash reporting system");
    expect(suggestion!.citationText).toContain("1,180 crashes ingested, 1,089 geocoded");
    expect(suggestion!.citationText).toContain("years 2021–2025");
    expect(suggestion!.citationText).toContain("Source ingest ingest-1");
    expect(suggestion!.citationText).toContain("Source agency (public domain).");
  });

  it("carries a geocoding-gap caveat when geocoded < reported", () => {
    const suggestion = buildBcaCrashInputSuggestion(ingest(), counts());
    const gapCaveat = suggestion!.caveats.find((caveat) => /1,089 of 1,180/.test(caveat));
    expect(gapCaveat).toBeDefined();
    expect(gapCaveat).toMatch(/understate the reported burden/i);
  });

  it("omits the geocoding-gap caveat when every reported crash was geocoded", () => {
    const suggestion = buildBcaCrashInputSuggestion(
      ingest({ crashCount: 1089, geocodedCount: 1089 }),
      counts()
    );
    expect(suggestion!.caveats.some((caveat) => /geocoded/.test(caveat))).toBe(false);
  });

  it("returns no suggestion for a zero-crash ingest — an honest empty, not zeros", () => {
    expect(
      buildBcaCrashInputSuggestion(
        ingest({ crashCount: 0, geocodedCount: 0 }),
        counts({ fatal: 0, severeInjury: 0, injury: 0, pdo: 0 })
      )
    ).toBeNull();
  });

  it("returns no suggestion when the stored points carry no severity evidence", () => {
    // Reported crashes exist, but none were geocoded, so nothing was stored
    // and there is no severity mix to map. Suggesting zeros would misread
    // "unmappable" as "no crashes".
    expect(
      buildBcaCrashInputSuggestion(
        ingest({ geocodedCount: 0 }),
        counts({ fatal: 0, severeInjury: 0, injury: 0, pdo: 0 })
      )
    ).toBeNull();
  });

  it("returns no suggestion for a non-ready ingest", () => {
    expect(buildBcaCrashInputSuggestion(ingest({ status: "failed" }), counts())).toBeNull();
    expect(buildBcaCrashInputSuggestion(ingest({ status: "no_coverage" }), counts())).toBeNull();
  });

  it("flags severity incompleteness and truncation when present", () => {
    const suggestion = buildBcaCrashInputSuggestion(
      ingest({ severityCompleteness: "fatal_injury_only", truncated: true }),
      counts({ severeInjury: 0 })
    );
    expect(suggestion!.caveats.some((caveat) => /could not separate/i.test(caveat))).toBe(true);
    expect(suggestion!.caveats.some((caveat) => /record cap/i.test(caveat))).toBe(true);
  });

  it("treats an unknown year list as a single year rather than inventing a span", () => {
    const suggestion = buildBcaCrashInputSuggestion(ingest({ yearsRequested: [] }), counts());
    expect(suggestion!.suggestedInputs.fatal).toBe(10);
    expect(suggestion!.citationText).not.toContain("years");
  });
});
