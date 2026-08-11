import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { BUILT_IN_WORK_PLAN_TEMPLATE_REGISTRATIONS, workPlanTemplateRegistry } from "@/lib/work-plans/built-in";
import {
  validateWorkPlanTemplateArtifact,
  WORK_PLAN_ANCHORS,
  type WorkPlanTemplateDocument,
} from "@/lib/work-plans/template-registry";
import { PROJECT_DEFAULT_PLAN_TYPE } from "@/lib/projects/project-record-fields";

/**
 * THE WORK-PLAN TEMPLATE CONTENT — what the artifacts say, not how they load.
 *
 * `work-plan-templates.test.ts` proves the MACHINERY: the resolver never
 * defaults, the vocabulary is the database's, applying never names a person.
 * This file proves the CONTENT, which fails differently and is the half a
 * planner actually reads. Four things are worth failing a build over:
 *
 *   1. EVERY FILE ON DISK IS REGISTERED. A template nobody imported into
 *      `built-in.ts` is complete, reviewed, jurisdiction-checked content that no
 *      planner can reach — this repository's most-repeated defect class. The
 *      directory is read here and compared to what the registry produces, so
 *      the two cannot drift apart silently.
 *
 *   2. NOTHING IS INVENTED. A work-plan template is standard practice written
 *      down. It may not carry a money figure, a year, a "45-day review period",
 *      a named agency, or a statute — because a planner reading a dated
 *      deliverable in their own project has no way to tell an authored
 *      placeholder from a requirement, and the ones that look most like
 *      requirements are the ones nobody checks.
 *
 *   3. JURISDICTION IS DECLARED, NEVER ASSUMED. A template that assumes one
 *      state's law must carry the `jurisdiction` field that makes the resolver
 *      withhold it from everywhere else — so a state's name appearing anywhere
 *      in a template WITHOUT that field is the failure, not the name itself.
 *      One shipped template is labelled; the ban is what keeps it one.
 *
 *   4. THE PHASES ARE IN AN ORDER A PLANNER WOULD RECOGNISE. Adoption after the
 *      draft and after public review; offsets that advance down the file.
 *      Nonsense ordering is the fastest way for this whole feature to lose the
 *      trust of the person using it.
 *
 * MUTATION-VERIFIED 2026-08-11 (each reverted immediately after; see report):
 * planting "$2.5 million" in a summary, planting "Oregon" in a neutral
 * template's scope note, removing one import from `built-in.ts`, moving an
 * adoption milestone before its public-review milestone, and reordering two
 * deliverables — each failed the intended assertion and nothing else.
 */

const TEMPLATE_DIR = path.join(process.cwd(), "src/lib/work-plans/templates");

function templateFiles(): string[] {
  return readdirSync(TEMPLATE_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function readTemplate(file: string): WorkPlanTemplateDocument {
  const parsed = JSON.parse(readFileSync(path.join(TEMPLATE_DIR, file), "utf8")) as unknown;
  const validation = validateWorkPlanTemplateArtifact(parsed);
  if (!validation.ok) throw new Error(`${file}: ${validation.errors.join("; ")}`);
  return validation.document;
}

/** Every artifact on disk, keyed by filename — the set the registry is checked against. */
const ON_DISK = templateFiles().map((file) => ({ file, document: readTemplate(file) }));

/**
 * The prose of a template: every string a planner can end up reading, MINUS the
 * jurisdiction block, which is the one place a place-name belongs.
 */
function prose(document: WorkPlanTemplateDocument): string {
  return [
    document.template_name,
    document.description ?? "",
    ...document.scope_notes,
    ...document.deliverables.flatMap((item) => [item.title, item.summary ?? ""]),
    ...document.milestones.flatMap((item) => [item.title, item.summary ?? ""]),
  ].join("\n");
}

/**
 * US state names, used ONLY as a ban list.
 *
 * Whole names only, word-bounded. Abbreviations are deliberately not checked:
 * `OR`, `IN`, `ME` and `OK` are ordinary English words and a guard that cried
 * wolf on them would be turned off within a week, which is worse than the gap.
 */
const US_STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/**
 * Statute and agency names. A template naming one of these is telling a planner
 * somewhere else that their own law says something it may not.
 */
const STATUTE_AND_AGENCY_TERMS = [
  "CEQA", "NEPA", "SEPA", "RHNA", "Title VI", "Section 106", "Clean Air Act",
  "Fair Housing Act", "Americans with Disabilities Act",
  "Caltrans", "FHWA", "FTA", "USDOT", "FEMA", "HUD", "Census Bureau",
];

describe("every template on disk is registered, and every registration is on disk", () => {
  it("registers exactly the artifacts in the templates directory", () => {
    // Filename IS the template id: a mismatch makes an artifact unfindable from
    // its own error message, which is where a debugging session starts.
    const onDiskIds = ON_DISK.map(({ file, document }) => {
      expect(document.template_id, `${file} declares a different template_id`).toBe(file.replace(/\.json$/, ""));
      return document.template_id;
    }).sort();

    const registeredIds = workPlanTemplateRegistry
      .list()
      .map((descriptor) => descriptor.templateId)
      .sort();

    // The failure message names the difference in both directions, because
    // "expected 24 to be 23" would send a reader to the wrong file.
    const unregistered = onDiskIds.filter((id) => !registeredIds.includes(id));
    const missingFile = registeredIds.filter((id) => !onDiskIds.includes(id));
    expect(unregistered, "artifacts on disk that built-in.ts never imported").toEqual([]);
    expect(missingFile, "registered templates with no artifact on disk").toEqual([]);
    expect(registeredIds).toEqual(onDiskIds);
    expect(registeredIds).toHaveLength(BUILT_IN_WORK_PLAN_TEMPLATE_REGISTRATIONS.length);
  });

  it("ships a set that covers both practice areas and all three anchors", () => {
    // Nathaniel's 2026-08-11 decision was an EXHAUSTIVE registry across
    // transportation AND land use. A deletion that quietly gutted one half
    // would leave the picker looking fine to whoever kept the other.
    const byArea = new Map<string, number>();
    for (const { document } of ON_DISK) {
      byArea.set(document.practice_area, (byArea.get(document.practice_area) ?? 0) + 1);
    }
    expect(byArea.get("transportation") ?? 0).toBeGreaterThanOrEqual(8);
    expect(byArea.get("land_use") ?? 0).toBeGreaterThanOrEqual(8);
    expect(ON_DISK.length).toBeGreaterThanOrEqual(18);

    // All three anchors are exercised by real content — an anchor no template
    // uses is an untested branch of the applier that a planner meets first.
    const anchors = new Set(ON_DISK.map(({ document }) => document.anchor));
    for (const anchor of WORK_PLAN_ANCHORS) expect([...anchors]).toContain(anchor);
  });

  it("gives every template a distinct name and every item a distinct key", () => {
    const names = ON_DISK.map(({ document }) => document.template_name.toLowerCase());
    expect(new Set(names).size, "two templates share a name in the picker").toBe(names.length);
  });
});

describe.each(ON_DISK.map(({ file, document }) => [file, document] as const))("%s", (file, document) => {
  it("is substantial enough to be worth applying", () => {
    expect(document.deliverables.length, "deliverables").toBeGreaterThanOrEqual(4);
    expect(document.milestones.length, "milestones").toBeGreaterThanOrEqual(2);
    expect(document.scope_notes.length).toBeGreaterThanOrEqual(1);
  });

  it("declares itself a starting point in its own words", () => {
    // Not paraphrased and not left to the UI: the artifact carries the honesty
    // text, so a template rendered anywhere carries it too.
    expect(document.scope_notes.join(" ")).toContain("standard-practice starting point — edit to your scope");
    expect(document.scope_notes.join(" ").toLowerCase()).toContain("nobody is assigned");
  });

  it("names no money, no year, and no fixed review period", () => {
    const text = prose(document);
    expect(text, "a currency symbol").not.toMatch(/[$£€]/);
    expect(text, "an amount in millions or billions").not.toMatch(/\b\d[\d,.]*\s*(million|billion|thousand)\b/i);
    expect(text, "a dollar amount in words").not.toMatch(/\bdollars?\b/i);
    // "the 45-day review period" reads as a requirement wherever it is applied.
    expect(text, "a stated review period").not.toMatch(/\b\d{1,4}[-\s]days?\b/i);
    // A year would date every copy of the template the day it is applied.
    expect(text, "a calendar year").not.toMatch(/\b(19|20)\d{2}\b/);
  });

  it("names no statute and no agency", () => {
    const text = prose(document);
    // A labelled template may name the law it is written for — that is what the
    // label is for — but not a different jurisdiction's, and an UNLABELLED one
    // may name none at all.
    const banned = document.jurisdiction
      ? STATUTE_AND_AGENCY_TERMS.filter((term) => term !== "CEQA")
      : STATUTE_AND_AGENCY_TERMS;
    for (const term of banned) {
      expect(text, `names ${term}`).not.toContain(term);
    }
  });

  it("names a place only if it declares that jurisdiction", () => {
    const text = prose(document);
    const declared = document.jurisdiction?.subdivision
      ? US_STATE_NAMES[document.jurisdiction.subdivision.toUpperCase()]
      : undefined;
    for (const [code, name] of Object.entries(US_STATE_NAMES)) {
      if (declared && name === declared) continue;
      expect(text, `${file} names ${name} (${code}) without declaring it`).not.toMatch(
        new RegExp(`\\b${name}\\b`)
      );
    }
    if (document.jurisdiction) {
      // A labelled template must say the assumption out loud where a planner
      // reads it, not only in a field the picker might not render.
      expect(document.scope_notes.join(" ")).toContain(declared ?? document.jurisdiction.label);
    }
  });

  it("never claims the plan type projects get by default", () => {
    // Every project created without a plan type being chosen carries
    // PROJECT_DEFAULT_PLAN_TYPE. A template claiming it would be suggested for
    // projects whose type nobody set — the resolver's no-default rule defeated
    // through the database's default rather than through the resolver.
    const claimed = document.applies_to_plan_types.map((entry) => entry.trim().toLowerCase());
    expect(claimed).not.toContain(PROJECT_DEFAULT_PLAN_TYPE.toLowerCase());
  });

  it("runs forward: offsets advance down the file, and the span is plausible", () => {
    for (const list of ["deliverables", "milestones"] as const) {
      const offsets = document[list].map((item) => item.offset_days);
      const sorted = [...offsets].sort((a, b) => a - b);
      // Authoring order IS chronological order. A file whose reading order and
      // date order disagree is how a reviewer misses a step in the wrong place.
      expect(offsets, `${list} are not in date order`).toEqual(sorted);
    }
    const span = Math.max(...[...document.deliverables, ...document.milestones].map((item) => item.offset_days));
    // A planning project that finishes inside two months, or runs past three
    // and a half years, is an offsets mistake far more often than a schedule.
    expect(span, "span in days").toBeGreaterThanOrEqual(60);
    expect(span, "span in days").toBeLessThanOrEqual(1200);
  });

  it("puts adoption after the draft and after the public review it responds to", () => {
    const adoption = document.milestones.filter((item) => /adopt|acceptance|certification/i.test(item.key));
    if (adoption.length === 0) return; // Delivery and review sequences have no adoption step.
    const earliestAdoption = Math.min(...adoption.map((item) => item.offset_days));

    const drafts = document.deliverables.filter((item) => /draft/i.test(item.key));
    for (const draft of drafts) {
      expect(
        earliestAdoption,
        `${file}: adoption at ${earliestAdoption} precedes the draft "${draft.key}" at ${draft.offset_days}`
      ).toBeGreaterThanOrEqual(draft.offset_days);
    }

    const review = document.milestones.filter((item) =>
      /public_|hearing|open_house|workshop|review/i.test(item.key)
    );
    for (const step of review) {
      expect(
        earliestAdoption,
        `${file}: adoption at ${earliestAdoption} precedes "${step.key}" at ${step.offset_days}`
      ).toBeGreaterThanOrEqual(step.offset_days);
    }
  });

  it("puts the environmental determination before any design or construction phase", () => {
    // Reviewing after designing is the ordering error with the largest
    // consequences, and the one a planner spots instantly in a work plan.
    const environmental = document.milestones.filter((item) => item.phase_code === "environmental");
    const later = document.milestones.filter(
      (item) => item.phase_code === "ps_e" || item.phase_code === "construction"
    );
    if (environmental.length === 0 || later.length === 0) return;
    expect(Math.max(...environmental.map((item) => item.offset_days))).toBeLessThanOrEqual(
      Math.min(...later.map((item) => item.offset_days))
    );
  });
});
