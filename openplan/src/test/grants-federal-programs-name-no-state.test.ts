import { describe, expect, it } from "vitest";
import {
  buildCatalogAttachmentSeeds,
  buildCatalogSectionSeeds,
  findGrantProgramCatalogEntry,
} from "@/lib/grants/application";
import {
  GRANT_PROGRAM_BUNDLES,
  describeGrantProgramCoverage,
  listStateAdministrationFor,
  resolveGrantProgramForJurisdiction,
  type GrantProgramCatalogEntry,
} from "@/lib/grants/program-catalog";
import { usFederalPrograms } from "@/lib/grants/programs/us-federal";

/**
 * A FEDERAL PROGRAM IS READ IN EVERY STATE, SO IT NAMES NO STATE.
 *
 * The federal catalog used to name Caltrans 44 times, including the HSIP
 * benefit/cost tool, so a planner in Ohio was told to check with Caltrans and
 * to attach output from a California tool. California's administration now
 * lives in the California bundle and reaches only a California workspace.
 *
 * Blind spots, stated: the forbidden list below names California's agencies
 * and tools and every registered state's own name. A state agency this list
 * does not know (another state's DOT acronym typed into the federal text)
 * would pass. It reads catalog data, not rendered pages.
 */

/** Every string a planner can read from one entry, sections and attachments included. */
function readableText(program: GrantProgramCatalogEntry): string {
  return [
    program.name,
    program.administeringAgency,
    program.typicalApplicants,
    ...program.eligibleProjectTypes,
    program.cycleNote,
    program.matchRequirement,
    program.url,
    program.summary,
    program.bcaNote ?? "",
    ...(program.applicationSections ?? []).flatMap((section) => [section.title, section.guidance]),
    ...(program.requiredAttachments ?? []).flatMap((attachment) => [attachment.title, attachment.guidance]),
  ].join("\n");
}

const STATE_SPECIFIC = [
  "Caltrans",
  "LRSM",
  "Local Roadway Safety Manual",
  "RTPA",
  "DRMT",
  "dot.ca.gov",
  "88.53%",
  ...GRANT_PROGRAM_BUNDLES.filter((bundle) => bundle.jurisdiction.subdivision !== undefined).map(
    (bundle) => bundle.jurisdiction.label
  ),
];

const CALIFORNIA = { country: "US", subdivision: "CA" };
const OHIO = { country: "US", subdivision: "OH" };

function coverageEntry(query: { country: string; subdivision?: string | null } | null, key: string) {
  const entry = describeGrantProgramCoverage(query).programs.find(({ program }) => program.key === key);
  if (!entry) throw new Error(`no ${key} in the coverage list`);
  return entry.program;
}

describe("federal grant programs name no state", () => {
  it("keeps every federal entry free of any one state's agency, tool or name", () => {
    for (const program of usFederalPrograms.programs) {
      const text = readableText(program);
      for (const term of STATE_SPECIFIC) {
        expect(text, `federal "${program.key}" names "${term}"`).not.toContain(term);
      }
    }
  });

  it("shows an Ohio workspace, and one with no stated state, the federal text", () => {
    for (const query of [OHIO, { country: "US", subdivision: null }, null]) {
      for (const program of usFederalPrograms.programs) {
        const shown = coverageEntry(query, program.key);
        expect(shown, `${program.key} for ${JSON.stringify(query)}`).toEqual(program);
      }
    }
    const ohioSeeds = findGrantProgramCatalogEntry("hsip", OHIO)!;
    expect(JSON.stringify([...buildCatalogSectionSeeds(ohioSeeds), ...buildCatalogAttachmentSeeds(ohioSeeds)])).not.toContain(
      "Caltrans"
    );
  });
});

describe("California's administration still reaches California", () => {
  it("shows a California workspace Caltrans's HSIP call and the LRSM benefit/cost tool", () => {
    const hsip = coverageEntry(CALIFORNIA, "hsip");

    expect(hsip.administeringAgency).toBe("FHWA, administered by Caltrans Division of Local Assistance");
    expect(hsip.cycleNote).toContain("Caltrans Local Assistance");
    expect(hsip.url).toBe(
      "https://dot.ca.gov/programs/local-assistance/fed-and-state-programs/highway-safety-improvement-program"
    );
    expect(hsip.bcaNote).toContain("Caltrans Local Roadway Safety Manual");
    expect(hsip.applicationSections?.find((section) => section.key === "benefit-cost-calculation")?.title).toBe(
      "Benefit/cost calculation (LRSM tool)"
    );
    expect(hsip.requiredAttachments?.find((attachment) => attachment.key === "lrsm-bc-tool-output")?.guidance).toContain(
      "Caltrans LRSM B/C tool"
    );
  });

  it("keeps California's match rate, DRMT and RTPA wording for the programs that carried them", () => {
    expect(coverageEntry(CALIFORNIA, "cmaq").matchRequirement).toContain("88.53% federal / 11.47% local in California");
    expect(coverageEntry(CALIFORNIA, "cmaq").typicalApplicants).toContain("MPO/RTPA");
    expect(coverageEntry(CALIFORNIA, "crp").url).toContain("dot.ca.gov");
    expect(coverageEntry(CALIFORNIA, "fta-5310").administeringAgency).toContain(
      "Caltrans Division of Rail and Mass Transportation"
    );
    expect(coverageEntry(CALIFORNIA, "fta-5311").cycleNote).toContain("Caltrans DRMT");
    expect(coverageEntry(CALIFORNIA, "protect").summary).toContain("rural California agencies");
    expect(coverageEntry(CALIFORNIA, "infra").summary).toContain("partnership with Caltrans");
  });

  it("seeds a California application with California's guidance", () => {
    const hsip = findGrantProgramCatalogEntry("hsip", CALIFORNIA)!;
    const sections = buildCatalogSectionSeeds(hsip);
    const attachments = buildCatalogAttachmentSeeds(hsip);

    expect(sections.find((seed) => seed.section_key === "crash-history-analysis")?.guidance).toContain(
      "Caltrans Local Assistance"
    );
    expect(attachments.find((seed) => seed.attachment_key === "lrsm-bc-tool-output")?.title).toBe(
      "LRSM benefit/cost tool output"
    );
    // A state changes the words, never the structure: same keys, same order,
    // and the B/C section is still never AI-drafted.
    const federal = usFederalPrograms.programs.find((program) => program.key === "hsip")!;
    expect(sections.map((seed) => seed.section_key)).toEqual(federal.applicationSections!.map((section) => section.key));
    expect(attachments.map((seed) => seed.attachment_key)).toEqual(
      federal.requiredAttachments!.map((attachment) => attachment.key)
    );
    expect(sections.find((seed) => seed.section_key === "benefit-cost-calculation")?.ai_drafting_enabled).toBe(false);
  });
});

describe("a state's administration matches the federal entry it describes", () => {
  it("names only federal programs, sections and attachments that exist", () => {
    for (const bundle of GRANT_PROGRAM_BUNDLES) {
      const administrations = bundle.federalProgramAdministration ?? [];
      if (administrations.length > 0) {
        expect(bundle.jurisdiction.subdivision, `${bundle.key} administers federal programs without a state`).toBeDefined();
      }
      for (const administration of administrations) {
        const federal = usFederalPrograms.programs.find((program) => program.key === administration.programKey);
        expect(federal, `${bundle.key} administers unknown program "${administration.programKey}"`).toBeDefined();
        const sectionKeys = new Set((federal?.applicationSections ?? []).map((section) => section.key));
        const attachmentKeys = new Set((federal?.requiredAttachments ?? []).map((attachment) => attachment.key));
        for (const key of Object.keys(administration.sections ?? {})) {
          expect(sectionKeys.has(key), `${bundle.key}/${administration.programKey} section "${key}"`).toBe(true);
        }
        for (const key of Object.keys(administration.attachments ?? {})) {
          expect(attachmentKeys.has(key), `${bundle.key}/${administration.programKey} attachment "${key}"`).toBe(true);
        }
      }
    }
  });

  it("holds the catalog's verification and official-page rules for every state's version", () => {
    for (const bundle of GRANT_PROGRAM_BUNDLES) {
      if (!bundle.jurisdiction.subdivision) continue;
      const query = { country: bundle.jurisdiction.country, subdivision: bundle.jurisdiction.subdivision };
      for (const program of usFederalPrograms.programs) {
        if (listStateAdministrationFor(program.key).length === 0) continue;
        const resolved = resolveGrantProgramForJurisdiction(program, query);
        expect(resolved.cycleNote.toLowerCase(), `${bundle.key}/${program.key} cycle note`).toContain("verify");
        // Tracking a program posts these two as the opportunity's agency and
        // cadence, which the creation schema caps at 160 characters.
        expect(resolved.administeringAgency.length, `${bundle.key}/${program.key} agency`).toBeLessThanOrEqual(160);
        expect(resolved.cycleNote.length, `${bundle.key}/${program.key} cadence`).toBeLessThanOrEqual(160);
        expect(new URL(resolved.url).hostname.endsWith(".gov"), `${bundle.key}/${program.key} url`).toBe(true);
        for (const section of resolved.applicationSections ?? []) {
          expect(section.guidance.toLowerCase(), `${bundle.key}/${program.key}/${section.key}`).toContain("verify");
        }
      }
    }
  });
});
