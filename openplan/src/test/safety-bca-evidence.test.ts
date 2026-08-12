import { describe, expect, it } from "vitest";
import { buildBcaCrashInputSuggestion } from "@/lib/safety/bca-evidence";
import {
  buildSafetyCrashEvidence,
  type SafetyCrashEvidenceIngest,
  type SafetyCrashSeverityCounts,
} from "@/lib/safety/crash-evidence";
import { CRASH_SEVERITIES } from "@/lib/safety/vocabulary";

/**
 * The benefit-cost prefill is now a PROJECTION of the shared crash-evidence
 * shape rather than a second assembly of the same numbers, so every fixture here
 * is built through `buildSafetyCrashEvidence`. That is deliberate: a fixture
 * hand-written in the projection's own shape would pass while the projection
 * read a field the shared builder never sets.
 */

function ingest(over: Partial<SafetyCrashEvidenceIngest> = {}): SafetyCrashEvidenceIngest {
  return {
    id: "ingest-1",
    projectId: "project-1",
    status: "ready",
    sourceLabel: "Statewide crash reporting system",
    attribution: "Source agency (public domain).",
    severityCompleteness: "kabco_full",
    crashCount: 1180,
    geocodedCount: 1089,
    truncated: false,
    yearsRequested: [2021, 2022, 2023, 2024, 2025],
    createdAt: "2026-08-11T00:00:00.000Z",
    dimensionCoverage: {},
    partyCompleteness: "not_supported",
    partyCount: null,
    involvementBasis: null,
    ...over,
  };
}

function counts(over: Partial<SafetyCrashSeverityCounts> = {}): SafetyCrashSeverityCounts {
  return {
    fatal: 10,
    severe_injury: 25,
    injury: 400,
    pdo: 654,
    unknown: 0,
    ...over,
  };
}

function suggestionFor(
  over: Partial<SafetyCrashEvidenceIngest> = {},
  severity: SafetyCrashSeverityCounts | null = counts()
) {
  return buildBcaCrashInputSuggestion(
    buildSafetyCrashEvidence(ingest(over), { severity, role: null })
  );
}

describe("buildBcaCrashInputSuggestion", () => {
  it("maps observed severity counts onto the BCA crash dimensions as annual averages", () => {
    const suggestion = suggestionFor();
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
    const suggestion = suggestionFor();
    expect(suggestion!.citationText).toContain("Statewide crash reporting system");
    expect(suggestion!.citationText).toContain("1,180 crashes reported, 1,089 geocoded");
    expect(suggestion!.citationText).toContain("years 2021–2025");
    expect(suggestion!.citationText).toContain("Source ingest ingest-1");
    expect(suggestion!.citationText).toContain("Source agency (public domain).");
  });

  it("carries a geocoding-gap caveat when geocoded < reported", () => {
    const suggestion = suggestionFor();
    const gapCaveat = suggestion!.caveats.find((caveat) => /1,089 of 1,180/.test(caveat));
    expect(gapCaveat).toBeDefined();
    expect(gapCaveat).toMatch(/understate the reported burden/i);
  });

  it("omits the geocoding-gap caveat when every reported crash was geocoded", () => {
    const suggestion = suggestionFor({ crashCount: 1089, geocodedCount: 1089 });
    expect(suggestion!.caveats.some((caveat) => /understate the reported burden/i.test(caveat))).toBe(
      false
    );
  });

  it("returns no suggestion for a zero-crash ingest — an honest empty, not zeros", () => {
    expect(
      suggestionFor(
        { crashCount: 0, geocodedCount: 0 },
        counts({ fatal: 0, severe_injury: 0, injury: 0, pdo: 0 })
      )
    ).toBeNull();
  });

  it("returns no suggestion when the stored points carry no severity evidence", () => {
    // Reported crashes exist, but none were geocoded, so nothing was stored
    // and there is no severity mix to map. Suggesting zeros would misread
    // "unmappable" as "no crashes".
    expect(
      suggestionFor({ geocodedCount: 0 }, counts({ fatal: 0, severe_injury: 0, injury: 0, pdo: 0 }))
    ).toBeNull();
  });

  it("returns no suggestion for a non-ready ingest", () => {
    expect(suggestionFor({ status: "failed" })).toBeNull();
    expect(suggestionFor({ status: "no_coverage" })).toBeNull();
  });

  it("flags severity incompleteness and truncation when present", () => {
    const suggestion = suggestionFor(
      { severityCompleteness: "fatal_injury_only", truncated: true },
      counts({ severe_injury: 0 })
    );
    expect(suggestion!.caveats.some((caveat) => /could not separate/i.test(caveat))).toBe(true);
    expect(suggestion!.caveats.some((caveat) => /record cap/i.test(caveat))).toBe(true);
  });

  it("treats an unknown year list as a single year rather than inventing a span", () => {
    const suggestion = suggestionFor({ yearsRequested: [] });
    expect(suggestion!.suggestedInputs.fatal).toBe(10);
    expect(suggestion!.citationText).not.toContain("years");
  });

  it("offers nothing at all when a count read failed — a lookup failure is not a safe road", () => {
    // `severityCounts: null` is what the loader produces when the grouped-count
    // RPC errored. Three zeros in a benefit-cost screening is the claim that
    // nobody was hurt, made on the strength of a broken query.
    expect(suggestionFor({}, null)).toBeNull();
  });

  it("excludes unclassified collisions from the monetized dimensions and says so", () => {
    // The `unknown` band is a collision the source reported no casualty count
    // for. Folding it into property-damage-only is exactly the defect the band
    // was created to end, so it enters none of the three frequencies — and the
    // gap between the three and the total is disclosed rather than left for a
    // reader to fill in with "property damage".
    const suggestion = suggestionFor({}, counts({ pdo: 554, unknown: 100 }));
    expect(suggestion!.suggestedInputs.propertyDamageOnly).toBe(110.8);
    const gap = suggestion!.caveats.find((caveat) => /no casualty count/i.test(caveat));
    expect(gap).toBeDefined();
    expect(gap).toContain("100 of the 1,089 stored collisions");
    expect(gap).toMatch(/unknown outcomes rather than property damage/i);
  });

  it("offers nothing when every stored collision is unclassified", () => {
    // Not "zero fatal, zero injury, zero property damage". The acquisition
    // stored 300 real collisions and knows the outcome of none of them.
    expect(
      suggestionFor({}, counts({ fatal: 0, severe_injury: 0, injury: 0, pdo: 0, unknown: 300 }))
    ).toBeNull();
  });

  it("reads every band the vocabulary declares, so a new band cannot be silently dropped", () => {
    // The four-band hard-coded count this replaced could not see `unknown` when
    // it arrived, and nothing failed. This asserts the fixture covers the whole
    // vocabulary, so the next band added forces this file to be looked at.
    expect(Object.keys(counts()).sort()).toEqual([...CRASH_SEVERITIES].sort());
  });
});
