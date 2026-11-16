import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  attachmentRequirementLabel,
  buildCatalogAttachmentSeeds,
  buildCatalogSectionSeeds,
  findGrantProgramCatalogEntry,
} from "@/lib/grants/application";
import { buildGrantApplicationHtml } from "@/lib/grants/application-html";
import { ifApplicableAttachmentKeys, listGrantApplicationTemplates } from "@/lib/grants/application-templates";
import { identifySeededCatalogKey, identifySeededTemplate, isAtpApplication } from "@/lib/grants/atp-packet";
import { evidenceAppendixProgramFor } from "@/lib/grants/evidence-appendix-keys";
import { GRANT_PROGRAM_CATALOG } from "@/lib/grants/program-catalog";
import { usCaPrograms } from "@/lib/grants/programs/us-ca";

/**
 * THE ATP TEMPLATE FOLLOWS THE COMMISSION'S 2027 APPLICATION, AND EVERY FACT
 * IN IT NAMES ITS SOURCE.
 *
 * A planner who drafts in OpenPlan and then opens the Commission's application
 * should find the same questions in the same order (KI-2026-11-16-033). The
 * tables below are the Commission's documents read into a test: each section,
 * each point value and each attachment, with the document and place it came
 * from. The catalog must agree with them line for line.
 *
 * Sources, all published by the California Transportation Commission under
 * "2027 ATP (Cycle 8)" at
 * https://catc.ca.gov/programs/active-transportation-program and read on
 * November 15, 2026 (the files were downloaded again that day and matched the
 * copies read, byte for byte):
 *   G  2027 Active Transportation Program Guidelines, Resolution G-26-31,
 *      adopted March 19, 2026.
 *   C  2027 ATP Application Checklist (PDF dated March 18, 2026).
 *   Q  List of All Application Questions, Small Infrastructure and
 *      Infrastructure/Non-Infrastructure Application (Word file, undated;
 *      read with its tracked deletions dropped).
 *   R  2027 ATP Small Infrastructure and Small Infrastructure +
 *      Non-Infrastructure Scoring Rubric (PDF dated March 30, 2026).
 *
 * The template serves the Small Infrastructure application (total project
 * cost of $3.5 million or less, G section 13). Medium and Large applications
 * add questions it has no section for (KI-2026-11-16-070).
 *
 * Blind category: whether the Commission has changed a document since the
 * date read; a wrong sentence in guidance that no phrase below pins; the
 * Medium, Large, Non-infrastructure and Plan applications; and the screen.
 */

const atp = GRANT_PROGRAM_CATALOG.find((entry) => entry.key === "atp")!;
const templates = listGrantApplicationTemplates();
const template2027 = templates.find((template) => template.templateKey === "atp-2027")!;
const templateEarlier = templates.find((template) => template.templateKey === "atp-pre-2027")!;

type SectionFact = {
  key: string;
  title: string;
  /** Phrases the guidance must carry: the points, labeled as maximums. */
  points: string[];
  source: string;
};

/** The Small application's parts and questions, in the order of Q. */
const SECTIONS: SectionFact[] = [
  {
    key: "atp-2027-part-a-project-information",
    title: "Part A1 to A4: Applicant and project information",
    points: [],
    source: "Q Part A1 to A4 (project name 10 words, scope 300 words, outcomes 35 words, FTIP description and location 180 characters); G section 13 (the air pollution and Class III items are not scored).",
  },
  {
    key: "atp-2027-part-a5-project-funding",
    title: "Part A5: Project funding",
    points: [],
    source: "Q Part A5; C Part A5 (\"All amounts must be represented in thousands.\"); G section 14 (minimum request $250,000).",
  },
  {
    key: "atp-2027-part-a6-screening-criteria",
    title: "Part A6: Screening criteria",
    points: [],
    source: "Q Part A6; G section 16.",
  },
  {
    key: "atp-2027-b1-disadvantaged-communities",
    title: "Part B, Question 1: Disadvantaged Communities (DAC)",
    points: ["Rubric maximum for a Small application: 10 points.", "direct benefit, up to 4 points", "project location, up to 2, and severity, up to 4"],
    source: "Q Part B question 1; R \"QUESTION #1: DISADVANTAGED COMMUNITIES (0-10 POINTS)\", C. Direct Benefit (0 - 4 points), D. Project Location (0 - 2 points), E. Severity (0-4 points).",
  },
  {
    key: "atp-2027-b2-walking-biking-rolling",
    title: "Part B, Question 2: Potential to Increase Walking, Biking and Rolling",
    points: ["Rubric maximum for a Small application: 52 of the application's 100 points.", "is up to 26 and Part B, how the project addresses the need, is up to 26", "40 points in a Medium application and 38 in a Large one"],
    source: "Q Part B question 2; R \"QUESTION #2 ... (0-52 POINTS)\", A (0-26 points), B (0-26 points); G section 18 table, Need: Large 38, Medium 40, Small 52.",
  },
  {
    key: "atp-2027-b3-fatalities-and-injuries",
    title: "Part B, Question 3: Potential for Reducing the Number and/or Rate of Active Transportation User Fatalities and Injuries",
    points: ["Rubric maximum for a Small application: 25 points.", "is up to 12 and Part B, safety countermeasures, is up to 13", "25 points in a Medium application and 20 in a Large one"],
    source: "Q Part B question 3; R \"QUESTION #3 ... (0-25 POINTS)\", A (0-12 points), B. Safety Countermeasures (13 points max); G section 18 table, Safety: Large 20, Medium 25, Small 25.",
  },
  {
    key: "atp-2027-b4-public-participation-planning",
    title: "Part B, Question 4: Public Participation and Planning",
    points: ["Rubric maximum for a Small application: 10 points."],
    source: "Q Part B question 4; R \"QUESTION #4: PUBLIC PARTICIPATION and PLANNING (0-10 POINTS)\".",
  },
  {
    key: "atp-2027-b5-scope-plan-layout-consistency",
    title: "Part B, Question 5: Scope and Plan Layout Consistency",
    points: ["Rubric maximum for a Small application: 3 points, 1 each for the layouts and maps, the engineer's estimate and the project schedule.", "5 points in a Medium application", "together with cost effectiveness, 7 points"],
    source: "Q Part B question 5 (\"No application questions\"); R \"QUESTION #5: SCOPE AND PLAN CONSISTENCY (0-3 POINTS)\" and its three 1-point tables; G section 18 table, Scope and Plan Layout Consistency: Medium 5, Small 3; with Cost Effectiveness: Large 7.",
  },
  {
    key: "atp-2027-b6-conservation-corps",
    title: "Part B, Question 6: Use of California Conservation Corps (CCC) or Certified Local Community Conservation Corps (CALCC)",
    points: ["Points in the guidelines' table: 0 or minus 5."],
    source: "Q Part B question 6; G section 18 table, Corps Use \"(0 or -5)\", and section 18.L. R has no Corps question.",
  },
  {
    key: "atp-2027-b7-past-performance",
    title: "Part B, Question 7: Performance on Past ATP Projects",
    points: ["Points in the guidelines' table: 0 to minus 10."],
    source: "Q Part B question 7 (\"No application questions\"); G section 18 table, Past Performance \"0 to -10\", and section 18.M. R has no past performance question.",
  },
];

type Requirement = "Required" | "Required if applicable" | "Optional";
type AttachmentFact = { key: string; title: string; requirement: Requirement; source: string };

/**
 * The attachment list, in the order of C: Part A, Part B, then "Application
 * Attachments". C marks an item "if applicable", limits it to named project
 * types, or marks it "if desired"; an item with no mark is among "the
 * information and documentation needed to complete" the application (C, first
 * paragraph), so it reads Required here.
 */
const ATTACHMENTS: AttachmentFact[] = [
  { key: "partnering-agency-letter-of-intent", title: "Letter of Intent with partnering agency", requirement: "Required if applicable", source: "C Part A1: \"Letter of Intent with partnering agency, if applicable\"." },
  { key: "safe-routes-school-map-and-statements", title: "School enrollment area map and statements of support (Safe Routes to School projects only)", requirement: "Required if applicable", source: "C Part A3: \"(Safe Routes to School projects only)\"; Q Part A3." },
  { key: "state-highway-project-impact-assessment-form", title: "State Highway Project Impact Assessment Form (projects on Caltrans right of way only)", requirement: "Required if applicable", source: "C Part A4: \"(Projects on Caltrans R/W only)\"; Q Part A4." },
  { key: "railroad-and-agency-letters", title: "Letters of support or neutrality from railroads and other governmental agencies", requirement: "Required if applicable", source: "C Part A4: \"If applicable, ... letters of support or neutrality from each impacted entity\"." },
  { key: "project-programming-request", title: "Project Programming Request (PPR)", requirement: "Required", source: "C Part A5: \"A completed Project Programming Request (PPR)\"; Q Part A5 (Exhibit 25-I)." },
  { key: "ceqa-nepa-signature-pages", title: "CEQA and NEPA signature pages (applications showing PA&ED complete)", requirement: "Required if applicable", source: "Q Part A5: \"Applications showing the PA&ED phase as complete must attach ...\". Not on C." },
  { key: "right-of-way-certification", title: "Caltrans-approved Right of Way Certification (applications showing right of way complete)", requirement: "Required if applicable", source: "Q Part A5: \"Applications showing the R/W phase as complete must attach ...\". Not on C." },
  { key: "regional-transportation-plan-pages", title: "Regional Transportation Plan pages showing the project is consistent", requirement: "Required", source: "C Part A6, no mark; G section 16; Q Part A6." },
  { key: "caltrans-need-for-atp-funds", title: "Caltrans-implemented projects: need to use ATP funds", requirement: "Required if applicable", source: "C Part A6: \"For Caltrans-implemented projects, ...\"." },
  { key: "caltrans-local-coordination", title: "Caltrans-implemented projects: coordination with local and regional agencies", requirement: "Required if applicable", source: "C Part A6: \"For Caltrans-implemented projects, ...\"." },
  { key: "disadvantaged-community-map", title: "Disadvantaged community map", requirement: "Required if applicable", source: "C Part B: \"(Projects that benefit disadvantaged communities only)\"; R Question 1.A \"Required\"." },
  { key: "disadvantaged-community-identifier-data", title: "Disadvantaged community identifier data", requirement: "Required if applicable", source: "C Part B, Disadvantaged community identifier, under the same limit." },
  { key: "gap-closure-and-route-maps", title: "Maps of gap closures, new routes, barriers to mobility and other improvements", requirement: "Required", source: "C Part B, Potential to Increase Walking and Biking, no mark; Q question 2 Part B." },
  { key: "collision-data", title: "Bicycle and pedestrian collision data or other safety data", requirement: "Required", source: "C Part B, Potential for Reducing ... Fatalities and Injuries, no mark; Q question 3 Part A." },
  { key: "public-participation-documentation", title: "Documentation of public participation and planning", requirement: "Required", source: "C Part B, Public Participation and Planning, no mark; Q question 4." },
  { key: "corps-consultation-responses", title: "Responses from the CCC, CALCC and Tribal Corps (if applicable)", requirement: "Required", source: "C Part B, Use of CCC or CALCC \"(All Infrastructure, Combination, and Non-Infrastructure projects)\"; Q question 6 marks only the Tribal Corps response \"if applicable\"." },
  { key: "signature-page", title: "Signature Page", requirement: "Required", source: "C Application Attachments, no mark; G section 13." },
  { key: "engineers-checklist", title: "Engineer's Checklist", requirement: "Required", source: "C Application Attachments: \"(All Infrastructure and Combination projects)\"." },
  { key: "project-location-map", title: "Project Location Map", requirement: "Required", source: "C Application Attachments, no mark; C Part A2." },
  { key: "project-layouts-and-plans", title: "Project Layouts/Plans with Existing and Proposed Conditions", requirement: "Required", source: "C Application Attachments: \"(All Infrastructure and Combination projects)\"." },
  { key: "photos-of-existing-conditions", title: "Photos of Existing Conditions", requirement: "Required", source: "C Application Attachments, no mark; Q Part C, no \"(Optional)\"." },
  { key: "project-estimate", title: "Project Estimate", requirement: "Required", source: "C Application Attachments: \"(All Infrastructure and Combination projects)\"." },
  { key: "non-infrastructure-work-plan", title: "Non-Infrastructure Work Plan (Exhibit 25-R)", requirement: "Required if applicable", source: "C Application Attachments: \"(All Non-Infrastructure and Combination projects)\"." },
  { key: "letters-of-support", title: "Letters of Support", requirement: "Required", source: "C Application Attachments, no mark; Q Part C, no \"(Optional)\"." },
  { key: "state-only-funds-request", title: "State-Only Funds Request (Exhibit 25-F)", requirement: "Required if applicable", source: "C Part A5 and Application Attachments: \"State-Only Funds Request (Exhibit 25-F), if applicable\"." },
  { key: "additional-attachments", title: "Additional attachments", requirement: "Optional", source: "C Application Attachments: \"Additional attachments, if desired\"; Q Part C \"Other Attachments (Optional)\"." },
];

/** Checklist items C limits to other application types. They must stay out of a Small template. */
const NOT_IN_A_SMALL_APPLICATION = [
  /25-PLAN|plan scope of work/i, // C: "(Plan projects only)"
  /community support/i, // C: "(Medium and Large Infrastructure and Combination Projects Only)"
  /active transportation plan/i, // C: "(Large Infrastructure and Combination Projects Only)"
  /transformative/i, // C: "(Large Infrastructure and Combination projects only)"
  /leverag/i, // C: "(Medium and Large Infrastructure and Combination projects only)"
];

const catalogRows = (keys: readonly string[]) => keys.map((section_key) => ({ section_key, source: "catalog" }));

function requirementOf(attachment: { key: string; required: boolean }, ifApplicable: ReadonlySet<string>): Requirement {
  return attachmentRequirementLabel({ attachment_key: attachment.key, required: attachment.required }, ifApplicable);
}

describe("the 2027 ATP template, against the Commission's documents", () => {
  it("has each part and question of the Small application as its own section, in the application's order", () => {
    expect(atp.applicationTemplateKey).toBe("atp-2027");
    expect(atp.applicationSections!.map(({ key, title }) => ({ key, title }))).toEqual(
      SECTIONS.map(({ key, title }) => ({ key, title }))
    );
    // Every fact in the table names where it came from.
    for (const fact of SECTIONS) expect(fact.source, fact.key).toMatch(/\b[QRGC] /);
  });

  it("states each question's points as the source gives them, labeled as maximums", () => {
    for (const fact of SECTIONS) {
      const guidance = atp.applicationSections!.find((section) => section.key === fact.key)!.guidance;
      for (const phrase of fact.points) expect(guidance, `${fact.key} (${fact.source})`).toContain(phrase);
      // A section that names points opens by saying whose maximum they are.
      if (/\bpoints?\b/i.test(guidance)) {
        expect(guidance, fact.key).toMatch(/^(Rubric maximum for a Small application: |Points in the guidelines' table: )/);
      }
    }
    // G section 18 table, Small column: 10 + 52 + 25 + 10 + 3 = 100, before the two deductions.
    const maximums = SECTIONS.flatMap((fact) => {
      const match = /^Rubric maximum for a Small application: (\d+)/.exec(fact.points[0] ?? "");
      return match ? [Number(match[1])] : [];
    });
    expect(maximums).toEqual([10, 52, 25, 10, 3]);
    expect(maximums.reduce((sum, value) => sum + value, 0)).toBe(100);
  });

  it("prints no score, eligibility finding or screening result", () => {
    const text = [...atp.applicationSections!.map((section) => section.guidance), ...atp.requiredAttachments!.map((item) => item.guidance)].join("\n");
    expect(text).not.toMatch(/\b(will|should|is likely to) (score|receive full|earn)\b|\bis eligible\b|\bqualifies\b|\bmeets the (commission's )?screening\b|\bcompetitive\b/i);
    expect(text).toContain("OpenPlan makes no disadvantaged-community determination.");
    expect(text).toContain("OpenPlan does not screen, and nothing in this workspace is a finding that an application passes.");
    // Titles are what the exported PDF prints: they carry no number of points.
    for (const section of atp.applicationSections!) expect(section.title).not.toMatch(/\bpoints?\b|\d+\s*(of|\/)\s*100/i);
  });

  it("never offers AI drafting for the funding figures", () => {
    const funding = atp.applicationSections!.find((section) => section.key === "atp-2027-part-a5-project-funding")!;
    expect(funding.aiDraftingEnabled).toBe(false);
    expect(funding.guidance).toContain("never from AI drafting");
  });

  it("lists the checklist's attachments in its order, each required, required if applicable or optional as the checklist has it", () => {
    const ifApplicable = ifApplicableAttachmentKeys(template2027);
    expect(
      atp.requiredAttachments!.map((item) => ({ key: item.key, title: item.title, requirement: requirementOf(item, ifApplicable) }))
    ).toEqual(ATTACHMENTS.map(({ key, title, requirement }) => ({ key, title, requirement })));
    for (const fact of ATTACHMENTS) expect(fact.source, fact.key).toMatch(/\b[QRGC] /);
    // The seven items KI-2026-11-16-033 said were missing, and the photos it said were wrongly optional.
    const required = new Set(ATTACHMENTS.filter((fact) => fact.requirement === "Required").map((fact) => fact.key));
    for (const key of ["signature-page", "engineers-checklist", "project-layouts-and-plans", "project-programming-request", "collision-data", "corps-consultation-responses", "photos-of-existing-conditions"]) {
      expect(required.has(key), key).toBe(true);
    }
    expect(requirementOf({ key: "disadvantaged-community-map", required: true }, ifApplicable)).toBe("Required if applicable");
  });

  it("leaves out the checklist items other application types attach", () => {
    for (const pattern of NOT_IN_A_SMALL_APPLICATION) {
      expect(atp.requiredAttachments!.filter((item) => pattern.test(item.title)).map((item) => item.title), String(pattern)).toEqual([]);
    }
    // The first section says which questions a Medium or Large application adds.
    const first = atp.applicationSections![0].guidance;
    expect(first).toContain("Medium and Large applications add scored questions this template does not carry: Context Sensitive Bikeways/Walkways and Innovative Project Elements and Leveraging Funds in both, and Transformative Projects in the Large application.");
    expect(first).toContain("total cost of $3.5 million or less");
  });

  it("marks an item if applicable only when it is also required, in every template", () => {
    for (const template of templates) {
      for (const item of template.requiredAttachments) {
        if (item.ifApplicable) expect(item.required, `${template.templateKey}/${item.key}`).toBe(true);
      }
    }
  });
});

describe("one ATP program, two templates", () => {
  it("keeps one ATP entry in the catalog and gives every template its own key", () => {
    // California's bundle holds one Active Transportation Program, and no catalog key starts with "atp" but its own.
    expect(usCaPrograms.programs.filter((entry) => /active transportation program/i.test(entry.name)).map((entry) => entry.key)).toEqual(["atp"]);
    expect(GRANT_PROGRAM_CATALOG.filter((entry) => entry.key.startsWith("atp")).map((entry) => entry.key)).toEqual(["atp"]);
    const keys = templates.map((template) => template.templateKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(templates.filter((template) => template.catalogKey === "atp").map((template) => template.templateKey)).toEqual(["atp-2027", "atp-pre-2027"]);
  });

  it("gives each template key its own sections: the earlier key the seven, the 2027 key the ten", () => {
    // Varying the template key must vary what comes back.
    const byKey = Object.fromEntries(templates.filter((template) => template.catalogKey === "atp").map((template) => [template.templateKey, template]));
    expect(byKey["atp-pre-2027"].applicationSections.map((section) => section.key)).toEqual([
      "project-narrative", "need-and-safety", "disadvantaged-communities", "community-engagement",
      "cost-effectiveness-leverage", "implementation-schedule", "budget-narrative",
    ]);
    expect(byKey["atp-2027"].applicationSections.map((section) => section.key)).toEqual(SECTIONS.map((fact) => fact.key));
    expect(byKey["atp-pre-2027"].requiredAttachments).toHaveLength(5);
    expect(byKey["atp-2027"].requiredAttachments).toHaveLength(ATTACHMENTS.length);
    // No 2027 section key is shared with any other template, the earlier ATP one included.
    for (const key of SECTIONS.map((fact) => fact.key)) {
      expect(templates.filter((template) => template.applicationSections.some((section) => section.key === key)).map((template) => template.templateKey), key).toEqual(["atp-2027"]);
    }
  });

  it("reads back the template an application was seeded from, and the ATP program either way", () => {
    const earlier = catalogRows(templateEarlier.applicationSections.map((section) => section.key));
    const current = catalogRows(template2027.applicationSections.map((section) => section.key));
    expect(identifySeededTemplate(earlier)?.templateKey).toBe("atp-pre-2027");
    expect(identifySeededTemplate(current)?.templateKey).toBe("atp-2027");
    for (const rows of [earlier, current]) {
      expect(identifySeededCatalogKey(rows)).toBe("atp");
      expect(isAtpApplication(rows)).toBe(true);
      // Both carry the six evidence appendices, declared by program, not by template.
      expect(evidenceAppendixProgramFor(identifySeededCatalogKey(rows))?.keys).toHaveLength(6);
    }
    // One 2027 section left after the rest were removed still identifies it.
    expect(identifySeededTemplate(catalogRows(["atp-2027-b6-conservation-corps"]))?.templateKey).toBe("atp-2027");
    // Sections from both templates in one application identify neither.
    expect(identifySeededTemplate([...earlier, ...current])).toBeNull();
  });

  it("seeds a new ATP application from the 2027 template", () => {
    const entry = findGrantProgramCatalogEntry("atp", { country: "US", subdivision: "CA" })!;
    const sections = buildCatalogSectionSeeds(entry);
    expect(sections.map((section) => section.section_key)).toEqual(SECTIONS.map((fact) => fact.key));
    expect(sections.map((section) => section.sort_order)).toEqual(SECTIONS.map((_, index) => index));
    expect(sections.filter((section) => !section.ai_drafting_enabled).map((section) => section.section_key)).toEqual(["atp-2027-part-a5-project-funding"]);
    const attachments = buildCatalogAttachmentSeeds(entry);
    expect(attachments.map((item) => [item.attachment_key, item.required])).toEqual(
      ATTACHMENTS.map((fact) => [fact.key, fact.requirement !== "Optional"])
    );
    // No template key is a catalog key a planner could seed by.
    expect(findGrantProgramCatalogEntry("atp-2027")).toBeNull();
    expect(findGrantProgramCatalogEntry("atp-pre-2027")).toBeNull();
  });
});

describe("applications seeded from the earlier ATP template", () => {
  // Both hashes were produced by this same code on cd7727736, the commit
  // before the 2027 template, where the seven sections were the ATP entry's
  // only template.
  const EARLIER_TEMPLATE_SHA256 = "4bd343c3500df15fb117ede6eb5c41cd76cd5c0cdb8fb50838e737d6a4cf35ee";
  const BASE_IDENTIFICATION_SHA256 = "efe6debcaed6b5adcdd9fc5003cb0f50c591d79da1b575ee2a96fe31e9dc2039";

  it("still hold the same seven sections and five attachments, word for word", () => {
    const json = JSON.stringify({
      applicationSections: templateEarlier.applicationSections,
      requiredAttachments: templateEarlier.requiredAttachments,
    });
    expect(createHash("sha256").update(json).digest("hex")).toBe(EARLIER_TEMPLATE_SHA256);
  });

  it("are identified exactly as before, and so is every other program's application", () => {
    // 293 identifications on the base commit: each program's full seed, each
    // seed with one section removed, and each section key alone. The same
    // 293, with the earlier template standing in for ATP, must answer alike.
    const identified: Record<string, string | null> = {};
    const allKeys = new Set<string>();
    for (const program of GRANT_PROGRAM_CATALOG) {
      const sections = program.key === "atp" ? templateEarlier.applicationSections : program.applicationSections ?? [];
      const keys = sections.map((section) => section.key);
      keys.forEach((key) => allKeys.add(key));
      identified[`full:${program.key}`] = identifySeededCatalogKey(catalogRows(keys));
      for (const drop of keys) {
        identified[`minus:${program.key}:${drop}`] = identifySeededCatalogKey(catalogRows(keys.filter((key) => key !== drop)));
      }
    }
    for (const key of allKeys) identified[`one:${key}`] = identifySeededCatalogKey(catalogRows([key]));

    expect(Object.keys(identified)).toHaveLength(293);
    expect(identified["full:atp"]).toBe("atp");
    expect(identified["one:need-and-safety"]).toBeNull(); // Washington's program shares it.
    expect(identified["one:disadvantaged-communities"]).toBe("atp");
    expect(createHash("sha256").update(JSON.stringify(identified)).digest("hex")).toBe(BASE_IDENTIFICATION_SHA256);
  });

  it("keep Required and Optional on their checklist: the earlier template has no if-applicable item", () => {
    expect([...ifApplicableAttachmentKeys(templateEarlier)]).toEqual([]);
    expect(attachmentRequirementLabel({ attachment_key: "letters-of-support", required: false }, ifApplicableAttachmentKeys(template2027))).toBe("Optional");
    // Review 73: the row's own answer comes first. An if-applicable item the planner made optional reads Optional.
    expect(ifApplicableAttachmentKeys(template2027).has("state-only-funds-request")).toBe(true);
    expect(attachmentRequirementLabel({ attachment_key: "state-only-funds-request", required: false }, ifApplicableAttachmentKeys(template2027))).toBe("Optional");
  });
});

describe("the application packet for a 2027 application", () => {
  const sections = buildCatalogSectionSeeds(atp).map((seed, index) => ({
    section: {
      id: `section-${index}`, workspace_id: "w", opportunity_id: "o", section_key: seed.section_key, title: seed.title,
      guidance: seed.guidance, sort_order: seed.sort_order, source: seed.source, suggested_evidence: seed.suggested_evidence,
      ai_drafting_enabled: seed.ai_drafting_enabled, status: index === 4 ? ("final" as const) : ("not_started" as const),
      final_markdown: index === 4 ? "Demonstration text for Question 2." : null, finalized_from_draft_id: null,
      finalized_by: null, finalized_at: null, updated_by: null, created_at: "", updated_at: "",
    },
    provenance: { origin: index === 4 ? ("operator_authored" as const) : ("none" as const), model: null, groundedSentenceCount: null, totalSentenceCount: null, finalizedBy: null, finalizedAt: null },
  }));
  const attachments = buildCatalogAttachmentSeeds(atp).map((seed, index) => ({
    id: `attachment-${index}`, workspace_id: "w", opportunity_id: "o", attachment_key: seed.attachment_key, title: seed.title,
    guidance: seed.guidance, required: seed.required, status: "missing" as const, kb_document_id: null, report_artifact_id: null,
    note: null, sort_order: seed.sort_order, updated_by: null, created_at: "", updated_at: "",
  }));
  const opportunity = { id: "o", title: "ATP application", agency_name: null, summary: null, expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null };
  const html = (keys?: ReadonlySet<string>) =>
    buildGrantApplicationHtml({ opportunity, programTitle: null, sections, attachments, generatedAt: "2026-11-16T04:00:00.000Z", ifApplicableAttachmentKeys: keys });

  it("prints the sections in the application's order and each checklist row's requirement", () => {
    const document = html(ifApplicableAttachmentKeys(template2027));
    const headings = [...document.matchAll(/<h2 class="section-title">([^<]*)<\/h2>/g)].map((match) => match[1].replaceAll("&#39;", "'").replaceAll("&amp;", "&"));
    expect(headings.slice(0, SECTIONS.length + 1)).toEqual([...SECTIONS.map((fact) => fact.title), "Attachment checklist"]);
    const rows = [...document.matchAll(/<tr>\s*<td>([^<]*)<\/td>\s*<td>(Required if applicable|Required|Optional)<\/td>/g)].map((match) => [
      match[1].replaceAll("&#39;", "'").replaceAll("&amp;", "&"),
      match[2],
    ]);
    expect(rows).toEqual(ATTACHMENTS.map((fact) => [fact.title, fact.requirement]));
    // 13 required items are outstanding, and 12 more count until the planner marks them not applicable.
    expect(ATTACHMENTS.filter((fact) => fact.requirement === "Required")).toHaveLength(13);
    expect(ATTACHMENTS.filter((fact) => fact.requirement === "Required if applicable")).toHaveLength(12);
    expect(document).toContain("DRAFT: 25 required attachment(s) outstanding");
    // Guidance, where the points are stated, is not printed.
    expect(document).not.toContain("Rubric maximum");
  });

  it("prints plain Required when the template's if-applicable keys are not passed", () => {
    // The label comes from the keys handed in, not from the row.
    expect(html()).not.toContain("Required if applicable");
    expect(html(new Set(["signature-page"]))).toContain("<td>Signature Page</td>\n          <td>Required if applicable</td>");
  });
});
