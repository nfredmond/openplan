import { describe, expect, it } from "vitest";
import {
  GRANT_PROGRAM_CATALOG,
  isGrantProgramTracked,
} from "@/lib/grants/program-catalog";

describe("grant program catalog", () => {
  it("contains at least 15 curated programs", () => {
    expect(GRANT_PROGRAM_CATALOG.length).toBeGreaterThanOrEqual(15);
  });

  it("has unique keys and unique names", () => {
    const keys = GRANT_PROGRAM_CATALOG.map((program) => program.key);
    const names = GRANT_PROGRAM_CATALOG.map((program) => program.name.trim().toLowerCase());

    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has complete entries for every program", () => {
    for (const program of GRANT_PROGRAM_CATALOG) {
      expect(program.key, `key for ${program.name}`).toMatch(/^[a-z0-9-]+$/);
      expect(program.name.trim().length, `name for ${program.key}`).toBeGreaterThan(0);
      expect(program.administeringAgency.trim().length, `agency for ${program.key}`).toBeGreaterThan(0);
      expect(["federal", "state"], `level for ${program.key}`).toContain(program.level);
      expect(program.typicalApplicants.trim().length, `applicants for ${program.key}`).toBeGreaterThan(0);
      expect(program.eligibleProjectTypes.length, `eligible types for ${program.key}`).toBeGreaterThan(0);
      for (const projectType of program.eligibleProjectTypes) {
        expect(projectType.trim().length, `eligible type entry for ${program.key}`).toBeGreaterThan(0);
      }
      expect(program.cycleNote.trim().length, `cycle note for ${program.key}`).toBeGreaterThan(0);
      expect(program.matchRequirement.trim().length, `match note for ${program.key}`).toBeGreaterThan(0);
      expect(program.summary.trim().length, `summary for ${program.key}`).toBeGreaterThan(80);
    }
  });

  it("uses https URLs to official government program pages", () => {
    for (const program of GRANT_PROGRAM_CATALOG) {
      expect(program.url, `url for ${program.key}`).toMatch(/^https:\/\//);
      const host = new URL(program.url).hostname;
      expect(host.endsWith(".gov") || host.endsWith(".ca.gov"), `gov host for ${program.key} (${host})`).toBe(true);
    }
  });

  it("phrases cycle timing as verification guidance instead of hard deadlines", () => {
    for (const program of GRANT_PROGRAM_CATALOG) {
      expect(program.cycleNote.toLowerCase(), `cycle note guidance for ${program.key}`).toContain("verify");
      // No hard date-like strings (e.g. "June 22, 2026" or "6/22/2026").
      expect(program.cycleNote, `cycle note has no hard date for ${program.key}`).not.toMatch(
        /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/
      );
    }
  });

  it("fits the funding-opportunity creation schema limits", () => {
    for (const program of GRANT_PROGRAM_CATALOG) {
      expect(program.name.length, `title length for ${program.key}`).toBeLessThanOrEqual(160);
      expect(program.administeringAgency.length, `agency length for ${program.key}`).toBeLessThanOrEqual(160);
      expect(program.cycleNote.length, `cadence length for ${program.key}`).toBeLessThanOrEqual(160);
      expect(program.summary.length, `summary length for ${program.key}`).toBeLessThanOrEqual(4000);
    }
  });

  it("covers the expected program set", () => {
    const keys = new Set(GRANT_PROGRAM_CATALOG.map((program) => program.key));
    for (const expected of [
      "atp",
      "hsip",
      "ss4a",
      "raise",
      "infra",
      "cmaq",
      "stip-rtip",
      "lpp",
      "tircp",
      "fta-5310",
      "fta-5311",
      "sb1-lsr",
      "clean-california",
      "crp",
      "protect",
    ]) {
      expect(keys.has(expected), `catalog includes ${expected}`).toBe(true);
    }
  });

  it("carries benefit-cost guidance on the BCA-scored programs and phrases it as screening guidance", () => {
    for (const expected of ["hsip", "raise", "infra"]) {
      const program = GRANT_PROGRAM_CATALOG.find((entry) => entry.key === expected)!;
      expect(program.bcaNote?.trim().length, `bcaNote for ${expected}`).toBeGreaterThan(40);
      expect(program.bcaNote!.toLowerCase(), `bcaNote mentions screening for ${expected}`).toContain("screening");
    }
  });

  it("matches tracked titles case-insensitively", () => {
    const atp = GRANT_PROGRAM_CATALOG.find((program) => program.key === "atp")!;

    expect(isGrantProgramTracked(atp, [])).toBe(false);
    expect(isGrantProgramTracked(atp, ["Some other opportunity"])).toBe(false);
    expect(isGrantProgramTracked(atp, [atp.name])).toBe(true);
    expect(isGrantProgramTracked(atp, [`  ${atp.name.toUpperCase()}  `])).toBe(true);
  });
});
