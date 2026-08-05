import { describe, expect, it } from "vitest";
import {
  GRANT_APPLICATION_EVIDENCE_KINDS,
  GRANT_PROGRAM_CATALOG,
  isGrantProgramTracked,
} from "@/lib/grants/program-catalog";

// Hard date-like strings (e.g. "June 22, 2026" or "6/22/2026") — cycle timing
// and template guidance must be verification guidance, never a baked deadline.
const HARD_DATE_PATTERN =
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/;

// Section families a model must never draft: budget figures, cost estimates,
// fee schedules, certifications, funding plans/exhibits, revenue
// demonstrations, and expenditure reports are operator/finance work products.
const NEVER_AI_SECTION_KEY_PATTERN =
  /(budget|fee|certification|cost-estimate|benefit-cost-calculation|funding-plan|sources-uses|revenue|expenditure)/;

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
      // Washington
      "wa-tib-uap",
      "wa-tib-scap",
      "wa-tib-small-city-atp",
      "wa-tib-complete-streets",
      "wa-wsdot-ped-bike",
      "wa-wsdot-srts",
      "wa-fmsib-freight",
      // Oregon
      "or-odot-srts",
      "or-community-paths",
      "or-connect-oregon",
      "or-small-city-allotment",
      "or-great-streets",
      "or-tgm-planning",
      // Colorado (Revitalizing Main Streets and "CDOT planning grants" are
      // deliberately absent — defunded and nonexistent respectively; see
      // src/lib/grants/programs/us-co.ts)
      "co-mmof",
      "co-srts",
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

describe("application section and attachment templates", () => {
  it("every program carries application sections and an attachment checklist", () => {
    for (const program of GRANT_PROGRAM_CATALOG) {
      expect(program.applicationSections?.length ?? 0, `sections for ${program.key}`).toBeGreaterThan(0);
      expect(program.requiredAttachments?.length ?? 0, `attachments for ${program.key}`).toBeGreaterThan(0);
    }
  });

  it("uses kebab-case keys, unique within each entry", () => {
    for (const program of GRANT_PROGRAM_CATALOG) {
      const sectionKeys = (program.applicationSections ?? []).map((section) => section.key);
      const attachmentKeys = (program.requiredAttachments ?? []).map((attachment) => attachment.key);

      for (const key of [...sectionKeys, ...attachmentKeys]) {
        expect(key, `template key for ${program.key}`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      }
      expect(new Set(sectionKeys).size, `unique section keys for ${program.key}`).toBe(sectionKeys.length);
      expect(new Set(attachmentKeys).size, `unique attachment keys for ${program.key}`).toBe(
        attachmentKeys.length
      );
    }
  });

  it("phrases every template guidance as verify-the-current-call guidance with no hard dates", () => {
    for (const program of GRANT_PROGRAM_CATALOG) {
      for (const section of program.applicationSections ?? []) {
        expect(section.guidance.toLowerCase(), `verify language in ${program.key}/${section.key}`).toContain(
          "verify"
        );
        expect(section.guidance, `no hard date in ${program.key}/${section.key}`).not.toMatch(
          HARD_DATE_PATTERN
        );
        expect(section.title.trim().length, `title for ${program.key}/${section.key}`).toBeGreaterThan(0);
      }
      for (const attachment of program.requiredAttachments ?? []) {
        expect(
          attachment.guidance.toLowerCase(),
          `verify language in ${program.key}/${attachment.key}`
        ).toContain("verify");
        expect(attachment.guidance, `no hard date in ${program.key}/${attachment.key}`).not.toMatch(
          HARD_DATE_PATTERN
        );
        expect(attachment.title.trim().length, `title for ${program.key}/${attachment.key}`).toBeGreaterThan(
          0
        );
      }
    }
  });

  it("never enables AI drafting on budget, fee, certification, or financial-exhibit sections", () => {
    let neverAiSections = 0;
    for (const program of GRANT_PROGRAM_CATALOG) {
      for (const section of program.applicationSections ?? []) {
        if (NEVER_AI_SECTION_KEY_PATTERN.test(section.key)) {
          neverAiSections += 1;
          expect(section.aiDraftingEnabled, `${program.key}/${section.key} must not be AI-draftable`).toBe(
            false
          );
        }
      }
    }
    // The rule must actually be exercised — every program carries at least one
    // finance/certification section, so a vanishing count means the templates
    // quietly stopped naming them.
    expect(neverAiSections).toBeGreaterThanOrEqual(GRANT_PROGRAM_CATALOG.length);
  });

  it("suggests only known evidence families", () => {
    const known = new Set<string>(GRANT_APPLICATION_EVIDENCE_KINDS);
    for (const program of GRANT_PROGRAM_CATALOG) {
      for (const section of program.applicationSections ?? []) {
        expect(section.suggestedEvidence.length, `evidence for ${program.key}/${section.key}`).toBeGreaterThan(0);
        for (const kind of section.suggestedEvidence) {
          expect(known.has(kind), `evidence kind "${kind}" in ${program.key}/${section.key}`).toBe(true);
        }
      }
    }
  });

  it("fits the application schema limits so every entry seeds cleanly", () => {
    for (const program of GRANT_PROGRAM_CATALOG) {
      for (const section of program.applicationSections ?? []) {
        expect(section.key.length, `section key length for ${program.key}`).toBeLessThanOrEqual(120);
        expect(section.title.length, `section title length for ${program.key}`).toBeLessThanOrEqual(160);
        expect(section.guidance.length, `section guidance length for ${program.key}`).toBeLessThanOrEqual(4000);
      }
      for (const attachment of program.requiredAttachments ?? []) {
        expect(attachment.key.length, `attachment key length for ${program.key}`).toBeLessThanOrEqual(120);
        expect(attachment.title.length, `attachment title length for ${program.key}`).toBeLessThanOrEqual(160);
        expect(attachment.guidance.length, `attachment guidance length for ${program.key}`).toBeLessThanOrEqual(4000);
        expect(typeof attachment.required, `attachment required flag for ${program.key}`).toBe("boolean");
      }
    }
  });
});
