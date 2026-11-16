// @vitest-environment node
/**
 * The third proven job, california-atp-application-in-three-places: the
 * checker accepts its synthetic example and refuses each way a record can
 * fall short of the job's definition, each for that rule's own reason.
 *
 * The synthetic "PDFs" are text files read by a stand-in reader, written by
 * fixtures/proven-job-atp-application.mjs from the definition entry and the
 * example record. They name no real place, run or file. A real PDF built by
 * the product's own export code is read with Poppler in
 * proven-job-atp-application-real-pdf.test.ts.
 *
 * The second half is the false records a hostile reviewer would try (reviews
 * 59, 62, 64 and 71 of the second job are the catalogue): a place id changed
 * with its label kept, one PDF standing for three, a stamp count that
 * disagrees, a limit that says the opposite of its id, a second account that
 * was never signed in, an owner control missing, sections reordered, an
 * appendix heading with its facts absent, and the missing-reports sentence
 * in the wrong PDFs.
 *
 * Only the checker's own message counts as a refusal: every case must throw
 * "proven job record refused:" followed by its rule's reason.
 *
 * Blind category: these are text files, so nothing here shows what Poppler
 * reads from a PDF Chrome printed on the hosted site, where a line can wrap
 * elsewhere. The checker reads words; no test here can show a section says
 * anything true.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GRANT_PROGRAM_CATALOG } from "@/lib/grants/program-catalog";
import { ATP_CENSUS_TRIBAL_AREA_NOTE } from "@/lib/grants/atp-evidence-appendices";
import { ATP_APPENDIX_TITLES } from "@/lib/grants/evidence-appendix-keys";
import { validateProvenJobRecord } from "../../scripts/ops/capability-evidence.mjs";
import { syntheticApplicationItems, syntheticApplicationPages, syntheticApplicationPdfText, syntheticPdfPages, SYNTHETIC_PDF_HEADER } from "./fixtures/proven-job-atp-application.mjs";

const read = (path: string) => JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"));
const EXAMPLE = read("../../../schemas/examples/proven_job_record.v1.atp-application.synthetic.json");
const DEFINITIONS = read("../../../schemas/proven_job_definitions.v1.json");
const JOB_ID = "california-atp-application-in-three-places";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a record under test is deliberately untyped JSON
type Json = any;
const JOB: Json = DEFINITIONS.jobs.find((job: Json) => job.id === JOB_ID);
const RULE = JOB.application;

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const jobRoot = mkdtempSync(join(tmpdir(), "openplan-proven-atp-"));
const fakePdfPages = (path: string) => syntheticPdfPages(readFileSync(path, "utf8"));

function writeFile(path: string, text: string) {
  mkdirSync(join(jobRoot, dirname(path)), { recursive: true });
  writeFileSync(join(jobRoot, path), text);
}
for (const entry of EXAMPLE.journeys) writeFile(entry.pdfs[0].path, syntheticApplicationPdfText(entry, JOB));

const proven = (): Json => structuredClone(EXAMPLE);
const journey = (record: Json, role: string) => record.journeys.find((entry: Json) => entry.role === role);
const check = (record: Json, options: { censusNames?: boolean } = {}) =>
  validateProvenJobRecord(record, { repoRoot: jobRoot, readPdfPages: fakePdfPages, ...options });

/** Write a PDF's new text under a new name and re-pin its hash and size, so only the rule under test can refuse it. */
function repin(pdf: Json, text: string) {
  const digest = sha(text);
  pdf.path = pdf.path.replace(/(-[0-9a-f]{8})?\.pdf$/, `-${digest.slice(0, 8)}.pdf`);
  writeFile(pdf.path, text);
  pdf.sha256 = digest;
  pdf.bytes = Buffer.byteLength(text);
}

/** Change the PDF's text only: the record keeps what it said. */
function editPdf(record: Json, role: string, change: (text: string) => string) {
  const entry = journey(record, role);
  const before = syntheticApplicationPdfText(entry, JOB);
  const after = change(before);
  expect(after, "the edit must change the PDF's text").not.toBe(before);
  repin(entry.pdfs[0], after);
}

/** Change the journey's record and write the PDF the fixture gives for it, so the two agree. */
function editBoth(record: Json, role: string, change: (entry: Json) => void) {
  const entry = journey(record, role);
  change(entry);
  repin(entry.pdfs[0], syntheticApplicationPdfText(entry, JOB));
  entry.pdfs[0].items = syntheticApplicationItems(entry, JOB);
}

const swap = (text: string, from: string, to: string) => {
  expect(text.includes(from), `the synthetic PDF holds "${from.slice(0, 60)}"`).toBe(true);
  return text.replace(from, to);
};
/** Insert lines after the first line that is exactly `anchor`. */
const after = (text: string, anchor: string, ...lines: string[]) => swap(text, `\n${anchor}\n`, `\n${anchor}\n${lines.join("\n")}\n`);

const PLACE_LINE = (entry: Json) => `Study place: ${entry.place.label} (${RULE.placeLine.kindWords[entry.place.kind]}, GEOID ${entry.place.geoid})`;
const SECTION_TEXT = `${RULE.demonstrationLabel.text}. This synthetic text describes no real project and makes no claim about any`;
const Q2 = "Part B, Question 2: Potential to Increase Walking,";
const [MISSING_REPORTS, TRIBAL_NOTE] = RULE.appendices.roleFacts.map((fact: Json) => fact.phrase);
const ROLES = ["county", "city", "tribal-area"];
/** The last line of the words that open the evidence appendices, a place to print a line outside any appendix. */
const FRAME_END = "package meets the current call for projects.";
const REFUSED = "proven job record refused: ";

type Case = [string, (record: Json) => void, RegExp];
/** Each changed copy is refused with the checker's own message and the rule's reason. */
function refuses(cases: Case[]) {
  it.each(cases)("%s", (_name, change, reason) => {
    const record = proven();
    change(record);
    let message = "";
    try {
      check(record);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message.startsWith(REFUSED), `expected the checker's own refusal, got: ${message || "accepted"}`).toBe(true);
    expect(message.slice(REFUSED.length)).toMatch(reason);
  });
}

describe("the definition entry follows the product", () => {
  const atp = GRANT_PROGRAM_CATALOG.find((entry) => entry.key === "atp")!;

  it("names the catalog key and the template the product seeds", () => {
    expect(atp.applicationTemplateKey).toBe("atp-2027");
    const fields = Object.fromEntries(JOB.journeyFields.map((field: Json) => [field.field, field.equals]));
    expect(fields["application.catalogKey"]).toBe(atp.key);
    expect(fields["application.templateKey"]).toBe(atp.applicationTemplateKey);
  });

  it("lists the template's ten sections by key and title, in order", () => {
    expect(RULE.sections.list.map(({ key, title }: Json) => ({ key, title }))).toEqual(atp.applicationSections!.map(({ key, title }) => ({ key, title })));
    expect(RULE.sections.list).toHaveLength(10);
    // Questions 5 and 7 are the two the application asks no question for.
    expect(RULE.sections.list.filter((section: Json) => section.disposition === "fixed-note").map((section: Json) => section.title)).toEqual([
      "Part B, Question 5: Scope and Plan Layout Consistency",
      "Part B, Question 7: Performance on Past ATP Projects",
    ]);
  });

  it("lists the template's 26 checklist rows by key, title and requirement, in order", () => {
    const requirement = (row: { required: boolean; ifApplicable?: boolean }) => (!row.required ? "optional" : row.ifApplicable ? "if-applicable" : "required");
    expect(RULE.rows.list).toEqual(atp.requiredAttachments!.map((row) => ({ key: row.key, title: row.title, requirement: requirement(row) })));
    expect(RULE.rows.list).toHaveLength(26);
    expect(RULE.rows.list.filter((row: Json) => row.requirement === "required")).toHaveLength(13);
  });

  it("names the six appendix headings and the tribal area note the export prints", () => {
    const headings = Object.values(JOB.itemHeadings["atp-application"]);
    expect(headings).toEqual(Object.values(ATP_APPENDIX_TITLES).map((title, index) => `Appendix ${"ABCDEF"[index]}. ${title}`));
    expect(TRIBAL_NOTE).toBe(ATP_CENSUS_TRIBAL_AREA_NOTE);
  });

  it("words every limit it requires, and the page limit", () => {
    for (const id of [...JOB.requiredLimits, JOB.crossWorkspace.pageAnsweredOkLimit]) expect(typeof JOB.limitTexts[id], id).toBe("string");
    expect(JOB.requiredLimits).toHaveLength(13);
  });

  it("refuses none of the product's own disclaimers and no em dash", () => {
    const disclaimers = [...RULE.requiredPhrases, "OpenPlan does not decide ATP eligibility.", "A community qualifies by meeting at least one.", TRIBAL_NOTE, MISSING_REPORTS,
      "No row above is a determination that a community is disadvantaged or that the project benefits one.", atp.summary];
    for (const phrase of RULE.refusedPhrases.phrases) {
      for (const text of disclaimers) expect(text.toLowerCase().includes(phrase.toLowerCase()), `"${phrase}" in "${text.slice(0, 50)}"`).toBe(false);
    }
    expect(JSON.stringify(JOB)).not.toContain("—");
  });
});

describe("the ATP application job's synthetic example", () => {
  it("is accepted on its synthetic bytes, and says it is synthetic", () => {
    expect(() => check(proven())).not.toThrow();
    expect(EXAMPLE.limits[0].id).toBe("synthetic-example");
    expect(syntheticApplicationPdfText(EXAMPLE.journeys[0], JOB).startsWith(SYNTHETIC_PDF_HEADER)).toBe(true);
    // Made-up Census ids, so the example names no real place: the name rule refuses them.
    expect(() => check(proven(), { censusNames: true })).toThrow(/geoid 06998 is not a county id in the Census Bureau's 2026 Gazetteer/);
  });

  it("has three PDFs that differ, each stamped DRAFT with 15 rows outstanding", () => {
    expect(new Set(EXAMPLE.journeys.map((entry: Json) => entry.pdfs[0].sha256)).size).toBe(3);
    for (const entry of EXAMPLE.journeys) {
      expect(entry.application.outstandingRequiredCount).toBe(15);
      expect(syntheticApplicationPages(entry, JOB)[0]).toContain("DRAFT: 15 required attachment(s) outstanding");
    }
  });

  it("accepts a project page that answers 404 without the 200 limit, and sideways scroll at desktop width", () => {
    const record = proven();
    for (const item of record.crossWorkspace.checks.filter((entry: Json) => entry.kind === "page")) {
      Object.assign(item, { status: 404 });
      for (const key of ["notFoundRendered", "recordTextFound", "searchedStringSha256", "searchedStringCount"]) delete item[key];
    }
    record.limits = record.limits.filter((limit: Json) => limit.id !== "project-page-answers-200-with-not-found-screen");
    journey(record, "county").screens.find((row: Json) => row.width === 1440).horizontalScroll = true;
    expect(() => check(record)).not.toThrow();
  });

  it("accepts a run that retrieved tract data, a missing cost appendix and a numbered equity score under its own label", () => {
    const record = proven();
    editBoth(record, "county", (entry) => { entry.application.tractDataRetrieved = true; });
    editPdf(record, "city", (text) => swap(text, "Planning-level estimate: USD 1,850,000.00\n\nPrice year: 2026", "  Missing. No planning-level estimate is recorded on the project."));
    editPdf(record, "tribal-area", (text) => swap(text, "Equity, OpenPlan screening score (not a CTC score): Not recorded. Equity is withheld\nbecause required demographic inputs are unavailable.", "Equity, OpenPlan screening score (not a CTC score): 62.5")
      .replace("Equity screening score (OpenPlan, not a CTC score): Not recorded. Equity is withheld\nbecause required demographic inputs are unavailable.", "Equity screening score (OpenPlan, not a CTC score): 62.5"));
    expect(() => check(record)).not.toThrow();
  });

  it("accepts a long place name whose line wraps, a section whose text starts on the next page, and every conditional row left outstanding", () => {
    const record = proven();
    editBoth(record, "tribal-area", (entry) => { entry.place.label = "Synthetic Rancheria and Off-Reservation Trust Land of the Synthetic Valley, CA"; });
    editPdf(record, "tribal-area", (text) => text.replaceAll("Off-Reservation Trust Land of the Synthetic Valley, CA (Census", "Off-Reservation Trust Land of the\nSynthetic Valley, CA (Census"));
    // The page ends right after a title: the footer and the page break fall between the title and its text.
    editPdf(record, "county", (text) => swap(text, `Part A6: Screening criteria\n\n${SECTION_TEXT}`, `Part A6: Screening criteria\n\n${" ".repeat(60)}Active Transportation Program (ATP) · Page 2 of 7\f${SECTION_TEXT}`));
    journey(record, "county").pdfs[0].pages += 1;
    for (const item of journey(record, "county").pdfs[0].items) item.page += 1;
    editBoth(record, "city", (entry) => {
      entry.application.rows = entry.application.rows.map((row: Json) => ({ key: row.key, disposition: "outstanding" }));
      entry.application.outstandingRequiredCount = 25;
    });
    expect(() => check(record)).not.toThrow();
  });

  it("accepts three places the Census Bureau lists when each label is the Bureau's name", () => {
    const record = proven();
    editBoth(record, "county", (entry) => Object.assign(entry.place, { geoid: "06105", label: "Trinity County, CA" }));
    editBoth(record, "city", (entry) => Object.assign(entry.place, { geoid: "0686944", label: "Yreka, CA" }));
    editBoth(record, "tribal-area", (entry) => Object.assign(entry.place, { geoid: "1490R", label: "Hoopa Valley Reservation, CA" }));
    expect(() => check(record, { censusNames: true })).not.toThrow();
  });
});

describe("the ATP application job refuses a run that is not one hosted proof on one commit", () => {
  refuses([
    ["a preview origin", (r) => { r.baseUrl = "https://openplan-preview.vercel.app"; }, /is not the hosted origin/],
    ["an end health readback on another commit", (r) => { journey(r, "city").health[1].commit = "fedcba987654"; }, /city journey end health readback reports commit fedcba987654/],
    ["a rehearsal run", (r) => { journey(r, "county").mode = "rehearsal"; }, /county journey ran in rehearsal mode; only a proof run is proof/],
    ["a harness checkout with uncommitted changes", (r) => { journey(r, "tribal-area").harness.clean = false; }, /tribal-area journey names no clean harness checkout/],
    ["journeys run from two harness checkouts", (r) => { journey(r, "city").harness.commit = "f".repeat(40); }, /the city journey ran from harness checkout f{40}, but the county journey ran from 89abcdef.*one checkout/],
    ["a health readback that is not ok", (r) => { journey(r, "county").health[1].status = "degraded"; }, /county journey end health readback reports status degraded, not ok/],
    ["a start readback after the account was created", (r) => { journey(r, "county").health[0].checkedAt = "2026-11-20T10:00:30Z"; }, /start health readback .* comes after the account was created/],
    ["an end readback before the export", (r) => { journey(r, "county").health[1].checkedAt = "2026-11-20T10:30:00Z"; }, /end health readback \(2026-11-20T10:30:00Z\) comes before its application\.exportedAt time/],
    ["an account created after the export", (r) => { Object.assign(journey(r, "county"), { accountCreatedAt: "2026-11-20T10:41:00Z" }); journey(r, "county").health[0].checkedAt = "2026-11-20T10:00:05Z"; }, /account was created \(2026-11-20T10:41:00Z\) after its application\.exportedAt time/],
    ["an end readback on another version", (r) => { journey(r, "county").health[1].version = "0.76.0"; }, /end health readback reports version 0\.76\.0, but the start one reports 0\.75\.0/],
    ["two start readbacks and no end", (r) => { journey(r, "county").health[1].point = "start"; }, /needs exactly one start health readback/],
    ["an export time that cannot be read", (r) => { journey(r, "county").application.exportedAt = "2026-13-45T99:00:00Z"; }, /holds a time that cannot be read/],
    ["a record dated before its runs", (r) => { r.recordedOn = "2026-11-18"; }, /recordedOn 2026-11-18 is before the last journey ended/],
    ["a person as the executor", (r) => { journey(r, "county").executor.agent = "A planner"; }, /executor is "A planner", not an agent harness/],
    ["an account confirmed by a generated link", (r) => { journey(r, "county").confirmationMethod = "admin_generate_link"; }, /confirmed its account by admin_generate_link/],
  ]);
});

describe("the ATP application job refuses the wrong places", () => {
  refuses([
    ["a missing city journey", (r) => { r.journeys = r.journeys.filter((entry: Json) => entry.role !== "city"); }, /exactly one city journey, found 0/],
    ["two county journeys", (r) => { journey(r, "city").role = "county"; }, /exactly one county journey, found 2/],
    ["a county in Nevada", (r) => { Object.assign(journey(r, "county").place, { geoid: "32998", stateFips: ["32"] }); }, /county journey must be in the state with FIPS 06/],
    ["a county id in California with another state's code beside it", (r) => { journey(r, "county").place.stateFips = ["41"]; }, /county journey must be in the state with FIPS 06/],
    ["a Census designated place in the city journey", (r) => { journey(r, "city").place.kind = "cdp"; }, /city journey must be a place of kind city, found cdp/],
    ["a city id that is not seven digits", (r) => { journey(r, "city").place.geoid = "06998"; }, /city journey geoid 06998 is not a city Census id/],
    ["a county in the tribal area journey", (r) => { Object.assign(journey(r, "tribal-area").place, { kind: "county", geoid: "06997" }); }, /tribal-area journey must be a place of kind aiannh, found county/],
    ["a tribal area the Bureau lists in California and Oregon", (r) => { journey(r, "tribal-area").place.stateFips = ["06", "41"]; }, /tribal-area journey states the Census states with FIPS 06, 41 for its place; this journey's place must lie in exactly 06/],
    ["a tribal area in another state", (r) => { journey(r, "tribal-area").place.stateFips = ["04"]; }, /must lie in exactly 06/],
    ["a tribal area with California listed twice", (r) => { journey(r, "tribal-area").place.stateFips = ["06", "06"]; }, /must lie in exactly 06/],
  ]);

  it("refuses a label that is not the Bureau's name for the id, when the files agree with the record", () => {
    const record = proven();
    editBoth(record, "county", (entry) => Object.assign(entry.place, { geoid: "06105", label: "Shasta County, CA" }));
    expect(() => check(record, { censusNames: true })).toThrow(/proven job record refused: county journey label "Shasta County, CA" is not the Census Bureau's name for county 06105, which the 2026 Gazetteer calls "Trinity County" in CA/);
  });
});

describe("the ATP application job refuses PDFs that are not three committed files", () => {
  refuses([
    ["one file named by two journeys", (r) => { journey(r, "city").pdfs[0] = structuredClone(journey(r, "county").pdfs[0]); }, /journey's atp-application PDF is the same bytes as the county journey's/],
    ["a changed file under a stale hash", (r) => {
      const pdf = journey(r, "county").pdfs[0];
      pdf.path = pdf.path.replace(".pdf", "-stale.pdf");
      writeFile(pdf.path, `${syntheticApplicationPdfText(journey(r, "county"), JOB)}\nOne more line.`);
    }, /county journey atp-application PDF evidence hash changed/],
    ["a file that is missing", (r) => { journey(r, "county").pdfs[0].path = "docs/product/capability-evidence/synthetic-example/none.pdf"; }, /evidence file is missing/],
    ["a byte count that is not the file's", (r) => { journey(r, "county").pdfs[0].bytes += 1; }, /county journey atp-application PDF is \d+ bytes, record says \d+/],
    ["a page count that is not the file's", (r) => { journey(r, "county").pdfs[0].pages = 8; }, /county journey atp-application PDF has 7 pages, record says 8/],
    ["a second PDF the job does not define", (r) => { journey(r, "county").pdfs.push({ ...structuredClone(journey(r, "county").pdfs[0]), kind: "atp-packet" }); }, /is the same bytes|has PDFs this job does not define/],
    ["a PDF the export's fallback writer typeset", (r) => editPdf(r, "county", (text) => swap(text, "OPENPLAN GRANTS: APPLICATION PACKET", "Typeset by OpenPlan's built-in PDF writer because this deployment has no browser rendering engine.\n\nOPENPLAN GRANTS: APPLICATION PACKET")),
      /county journey atp-application PDF was typeset by OpenPlan's built-in writer, not the browser engine/],
    ["a PDF with an email address on a page", (r) => editPdf(r, "county", (text) => after(text, RULE.applicant.line, "Contact: planner@example.org")), /atp-application PDF page 1 contains an email address/],
    ["an appendix heading the record places on the wrong page", (r) => { journey(r, "county").pdfs[0].items[3].page = 2; }, /appendix-d text is not on page 2/],
    ["an appendix heading missing from the record's items", (r) => { journey(r, "county").pdfs[0].items.pop(); }, /must find appendix-f exactly once, found 0/],
  ]);
});

describe("the ATP application job refuses a PDF that does not state the record's study place and applicant", () => {
  refuses([
    ["another place on the cover", (r) => editPdf(r, "county", (text) => swap(text, `\n${PLACE_LINE(journey(r, "county"))}\n\n${RULE.applicant.line}\n\nThe study place`, `\nStudy place: Another County, CA (county, GEOID 06997)\n\n${RULE.applicant.line}\n\nThe study place`)),
      /county journey atp-application PDF cover does not state "Study place: Synthetic County, CA \(county, GEOID 06998\)"/],
    ["no place line in Appendix A", (r) => editPdf(r, "county", (text) => swap(text, `Project: ${journey(r, "county").projectName}\n\n${PLACE_LINE(journey(r, "county"))}\n`, `Project: ${journey(r, "county").projectName}\n`)),
      /"Appendix A\. ATP screening packet" does not state "Study place: Synthetic County, CA \(county, GEOID 06998\)"/],
    ["another place typed into a section, beside the right lines", (r) => editPdf(r, "city", (text) => swap(text, "An agency would write its own answer here.", "An agency would write its own answer here.\nStudy place: Another city, CA (city, GEOID 0699700)")),
      /city journey atp-application PDF prints "Study place:" with another place than the record's/],
    ["the same place under another kind", (r) => editPdf(r, "tribal-area", (text) => text.replaceAll("(Census tribal area, GEOID 9998R)", "(county, GEOID 9998R)")), /cover does not state "Study place: Synthetic Reservation, CA \(Census tribal area, GEOID 9998R\)"/],
    ["a study place that is not recorded", (r) => editPdf(r, "county", (text) => after(text, RULE.applicant.line, RULE.placeLine.notRecorded)), /prints "Study place not recorded in OpenPlan"/],
    ["no applicant line on the cover", (r) => editPdf(r, "county", (text) => swap(text, `\n${RULE.applicant.line}\n\nThe study place`, "\n\nThe study place")), /cover does not print "Applicant not entered in OpenPlan"/],
    ["the workspace's name as the applicant", (r) => editPdf(r, "county", (text) => after(text, RULE.applicant.line, `Applicant: ${journey(r, "county").workspaceName}`)), /prints the workspace's name with "Applicant"; the workspace is not the applicant/],
    ["the workspace's name as the lead agency, wrapped", (r) => editPdf(r, "county", (text) => swap(text, "Program page:", `Lead agency: Synthetic county demonstration\nworkspace\n\nProgram page:`)), /prints the workspace's name with "Lead agency"/],
    ["a workspace named as an applicant", (r) => editBoth(r, "county", (entry) => { entry.workspaceName = "Synthetic applicant workspace"; }), /workspace name holds the words "Applicant"/],
    ["a workspace name the cover does not print", (r) => { journey(r, "county").workspaceName = "Another demonstration workspace"; }, /cover does not print workspaceName "Another demonstration workspace"/],
    ["a project name the cover does not print", (r) => { journey(r, "county").projectName = `Another project (${RULE.demonstrationLabel.text})`; }, /cover does not print projectName/],
    ["a project name without the demonstration label", (r) => editBoth(r, "county", (entry) => { entry.projectName = "Main Street sidewalk gap closure"; }), /county journey project name does not carry the demonstration label "Demonstration by an automated OpenPlan proof run"/],
    ["another program", (r) => editPdf(r, "county", (text) => swap(text, "Program: Active Transportation Program (ATP)", "Program: Safe Streets and Roads for All")), /does not state "Program: Active Transportation Program \(ATP\)"/],
  ]);
});

describe("the ATP application job refuses sections that are not the template's ten, final and labeled", () => {
  const block = (text: string, title: string) => {
    const start = text.indexOf(`\n${title}`) + 1;
    const end = text.indexOf("community.", start);
    return text.slice(start, text.indexOf("\n\n", end) + 2);
  };
  refuses([
    ["a section title that is missing", (r) => editPdf(r, "county", (text) => swap(text, "Part A5: Project funding\n", "Project funding\n")), /must print the section title "Part A5: Project funding" exactly once as a heading before "Attachment checklist", found 0/],
    ["a section title printed twice", (r) => editPdf(r, "county", (text) => swap(text, "Part A6: Screening criteria\n", "Part A6: Screening criteria\n\nPart A6: Screening criteria\n")), /"Part A6: Screening criteria" exactly once .* found 2/],
    ["a section title that is words in a sentence", (r) => editPdf(r, "county", (text) => swap(text, "\nPart A5: Project funding\n", "\nSee Part A5: Project funding for the table.\n")), /"Part A5: Project funding" exactly once .* found 0/],
    ["sections out of the template's order", (r) => editPdf(r, "county", (text) => {
      const a5 = block(text, "Part A5: Project funding");
      const a6 = block(text, "Part A6: Screening criteria");
      return text.replace(a5 + a6, a6 + a5);
    }), /prints the section "Part A6: Screening criteria" before "Part A5: Project funding"; the template's sections are out of order/],
    ["a section that is not final", (r) => editPdf(r, "city", (text) => swap(text, `Part A5: Project funding\n\n${SECTION_TEXT}`, "Part A5: Project funding\n\n Not finalized: this section is still in “Not started”. It is listed here as an")), /city journey atp-application PDF section "Part A5: Project funding" is not final/],
    ["a section whose text does not open with the demonstration label", (r) => editPdf(r, "city", (text) => swap(text, `${Q2}\nBiking and Rolling\n\n${SECTION_TEXT}`, `${Q2}\nBiking and Rolling\n\nThe city will close three sidewalk gaps. ${RULE.demonstrationLabel.text}.`)), /section "Part B, Question 2: Potential to Increase Walking, Biking and Rolling" text does not begin with the demonstration label/],
    ["Question 5 without the fixed note", (r) => editPdf(r, "county", (text) => swap(text, `agency, place or community. ${RULE.sections.fixedNote}`, "agency, place or community. The layouts agree with the estimate.")), /section "Part B, Question 5: Scope and Plan Layout Consistency" does not carry the fixed note "The application asks no question here\."/],
    ["a question section answered with the fixed note", (r) => editPdf(r, "county", (text) => swap(text, "An agency would write its own answer here.", RULE.sections.fixedNote)), /section "Part A1 to A4: Applicant and project information" carries the fixed note .* but the application asks a question there/],
    ["a section that holds the label and nothing else", (r) => editPdf(r, "county", (text) => swap(text, `Part A5: Project funding\n\n${SECTION_TEXT}\nagency, place or community. An agency would write its own answer here.`, `Part A5: Project funding\n\n${RULE.demonstrationLabel.text}.`)), /section "Part A5: Project funding" holds no text after the demonstration label/],
    ["no attachment checklist heading where the sections end", (r) => editPdf(r, "county", (text) => swap(text, `\n${RULE.sections.end}\n`, "\nChecklist\n")), /has no "Attachment checklist" heading, where its sections end/],
    ["a record that gives Question 5 typed text", (r) => { journey(r, "county").application.sections[7].disposition = "text"; }, /section atp-2027-b5-scope-plan-layout-consistency has the disposition text; this job's definition gives it fixed-note/],
    ["a record with nine sections", (r) => { journey(r, "county").application.sections.pop(); }, /lists 9 sections; the template this job names has 10/],
    ["a record whose sections are another template's", (r) => { journey(r, "county").application.sections[0].key = "project-narrative"; }, /section 1 is project-narrative; the template's is atp-2027-part-a-project-information/],
    ["the earlier template", (r) => { journey(r, "county").application.templateKey = "atp-pre-2027"; }, /application is identified as template atp-pre-2027, not atp-2027/],
    ["another catalog program", (r) => { journey(r, "county").application.catalogKey = "ss4a"; }, /seeded its application from catalog key ss4a, not atp/],
    ["AI drafting", (r) => { journey(r, "county").application.aiDraftingUsed = true; }, /used AI drafting/],
  ]);
});

describe("the ATP application job requires the DRAFT stamp and a disposition for every checklist row", () => {
  const STAMP = "DRAFT: 15 required attachment(s) outstanding";
  refuses([
    ["a PDF with no stamp while the record leaves rows outstanding", (r) => editPdf(r, "county", (text) => swap(text, `  ${STAMP}\n`, "")), /county journey atp-application PDF carries no DRAFT stamp, but the record leaves 15 required attachments outstanding; the stamp is required/],
    ["a stamp whose count is not the record's", (r) => editPdf(r, "county", (text) => swap(text, STAMP, "DRAFT: 14 required attachment(s) outstanding")), /carries a DRAFT line that is not the stamp the record's rows give \("DRAFT: 15 required attachment\(s\) outstanding"\): "DRAFT: 14/],
    ["a record count that is not its rows'", (r) => { journey(r, "county").application.outstandingRequiredCount = 14; }, /county journey says 14 required attachments are outstanding; its checklist rows give 15/],
    ["a record and a stamp that agree on a count the rows do not give", (r) => editBoth(r, "county", (entry) => { entry.application.outstandingRequiredCount = 13; }), /says 13 required attachments are outstanding; its checklist rows give 15/],
    ["a record that says the PDF is not stamped", (r) => { journey(r, "county").pdfs[0].draftStamp = false; }, /atp-application PDF is not recorded as stamped DRAFT; this job requires the stamp/],
    ["a second stamp for unverified items in section text", (r) => editPdf(r, "county", (text) => after(text, `  ${STAMP}`, "  DRAFT: 2 unverified items remain in 1 section")), /carries a DRAFT line that is not the stamp .*: "DRAFT: 2 unverified items remain in 1 section"/],
    ["a letter-spaced DRAFT mark beside the stamp", (r) => editPdf(r, "county", (text) => after(text, `  ${STAMP}`, "  D R A F T")), /carries a DRAFT line that is not the stamp/],
    ["the stamp typed into a section, not printed on the cover", (r) => editPdf(r, "county", (text) => swap(swap(text, `  ${STAMP}\n`, ""), "An agency would write its own answer here.", `An agency would write its own answer here.\n${STAMP}`)), /cover does not carry the stamp "DRAFT: 15 required attachment\(s\) outstanding"/],
    ["a row attached", (r) => { journey(r, "county").application.rows[16].disposition = "attached"; }, /checklist row signature-page is attached; an agent-run proof attaches no stand-in document/],
    ["a row every application needs marked not applicable", (r) => { Object.assign(journey(r, "county").application.rows[16], { disposition: "not-applicable", reason: "Synthetic example: no officer signs a demonstration." }); }, /checklist row signature-page is marked not applicable, but the template requires it of every application/],
    ["a row marked not applicable without a reason", (r) => { delete journey(r, "county").application.rows[0].reason; }, /checklist row partnering-agency-letter-of-intent is marked not applicable without a reason of at least 20 characters/],
    ["a row marked not applicable with a two-letter reason", (r) => { journey(r, "county").application.rows[0].reason = "NA"; }, /without a reason of at least 20 characters/],
    ["a row with no disposition the schema knows", (r) => { journey(r, "county").application.rows[4].disposition = "waived"; }, /rows\[4\]\.disposition must be one of outstanding, not-applicable, attached/],
    ["a record with 25 rows", (r) => { journey(r, "county").application.rows.pop(); }, /lists 25 checklist rows; the template this job names has 26/],
    ["rows out of the template's order", (r) => { const rows = journey(r, "county").application.rows; [rows[4], rows[7]] = [rows[7], rows[4]]; }, /checklist row 5 is regional-transportation-plan-pages; the template's is project-programming-request/],
    ["every row marked not applicable or optional, so nothing is outstanding", (r) => editBoth(r, "county", (entry) => {
      entry.application.rows = entry.application.rows.map((row: Json) => ({ key: row.key, disposition: "not-applicable", reason: "Synthetic example: marked away to drop the stamp." }));
      entry.application.outstandingRequiredCount = 0;
    }), /is marked not applicable, but the template requires it of every application/],
    ["a PDF that prints an attached document", (r) => editPdf(r, "county", (text) => after(text, FRAME_END, "", "Attached for Signature Page: Knowledge Base document: Demonstration signature page")), /prints "Attached for Signature Page:", but the record attaches nothing/],
    ["a PDF that prints an attached document whose title ends in a bracket", (r) => editPdf(r, "county", (text) => after(text, FRAME_END, "", "Attached for Project Programming Request (PPR): Knowledge Base document: Demonstration\nrequest")), /prints "Attached for Project Programming Request \(PPR\):", but the record attaches nothing/],
  ]);
});

describe("the ATP application job refuses appendices that are missing, out of order or without their facts", () => {
  const D = "Appendix D. Engagement summary\n\n  Missing. No public engagement campaign is linked to the project.\n\n";
  const C = "Appendix C. Cost estimate\n\nPlanning-level estimate: USD 1,850,000.00\n\nPrice year: 2026\n\n";
  refuses([
    ["an appendix heading that is not in the PDF", (r) => editPdf(r, "county", (text) => swap(text, "Appendix D. Engagement summary\n", "Engagement\n")), /atp-application PDF appendix-d text is not on page 6/],
    ["an appendix heading that is words in a sentence", (r) => editPdf(r, "county", (text) => swap(text, "\nAppendix D. Engagement summary\n", "\nSee Appendix D. Engagement summary below.\n")), /appendix-d heading "Appendix D\. Engagement summary" is not a line of its own on page 6/],
    ["an appendix heading printed twice", (r) => editPdf(r, "county", (text) => after(text, FRAME_END, "", "Appendix B. Crash summary")), /must print the heading "Appendix B\. Crash summary" exactly once as a line of its own, found 2/],
    ["appendices out of order", (r) => editPdf(r, "county", (text) => swap(text, C + D, D + C)), /prints "Appendix D\. Engagement summary" before "Appendix C\. Cost estimate"; the appendices are out of order/],
    ["no provenance heading where the appendices end", (r) => editPdf(r, "county", (text) => swap(text, `\n${RULE.appendices.end}\n`, "\nProvenance\n")), /has no "Provenance appendix" heading after "Appendix F\. Benefit-cost summary"/],
    ["the crash appendix's heading with its facts absent", (r) => editPdf(r, "county", (text) => swap(text, "Source: California Crash Reporting System (CCRS)\n\nYears requested: 2022–2025\n\nCrashes reported: 1,234\n", "")), /"Appendix B\. Crash summary" does not state "Source: California Crash Reporting System \(CCRS\)"/],
    ["the crash facts printed under another appendix", (r) => editPdf(r, "county", (text) => swap(swap(text, "Source: California Crash Reporting System (CCRS)\n\nYears requested: 2022–2025\n\nCrashes reported: 1,234\n", ""), "Price year: 2026\n", "Price year: 2026\n\nSource: California Crash Reporting System (CCRS)\n\nYears requested: 2022–2025\n\nCrashes reported: 1,234\n")), /"Appendix B\. Crash summary" does not state "Source: California Crash Reporting System \(CCRS\)"/],
    ["the national fatal crash file", (r) => editPdf(r, "tribal-area", (text) => swap(text, "Source: California Crash Reporting System (CCRS)", "Source: NHTSA Fatality Analysis Reporting System (FARS)")), /tribal-area journey atp-application PDF "Appendix B\. Crash summary" does not state "Source: California Crash Reporting System \(CCRS\)"/],
    ["a crash count that is not the record's", (r) => editPdf(r, "county", (text) => swap(text, "Crashes reported: 1,234", "Crashes reported: 995")), /"Appendix B\. Crash summary" does not state "Crashes reported: 1,234"/],
    ["a record count that is not the PDF's", (r) => { journey(r, "city").crashes.reportedCount = 213; }, /city journey atp-application PDF "Appendix B\. Crash summary" does not state "Crashes reported: 213"/],
    ["crash years that are not the record's", (r) => editPdf(r, "county", (text) => text.replaceAll("2022–2025", "2021–2024")), /does not state "Years requested: 2022–2025"/],
    ["crash years written with a hyphen", (r) => { journey(r, "county").crashes.years = "2022-2025"; }, /crashes\.years is not in the expected form/],
    ["crashes from the national file in the record", (r) => { journey(r, "tribal-area").crashes.sourceId = "fars-national"; }, /tribal-area journey crashes come from fars-national, not ccrs, California's crash file/],
    ["no stored crash", (r) => { journey(r, "county").crashes.storedCount = 0; }, /county journey stored 0 crashes; every journey of this job stores at least 1/],
    ["the engagement appendix's heading with nothing under it", (r) => editPdf(r, "county", (text) => swap(text, "  Missing. No public engagement campaign is linked to the project.\n", "")), /"Appendix D\. Engagement summary" carries neither its fact "Source: Engagement campaign" nor "Missing\." under its heading/],
    ["an appendix that was not selected for the export", (r) => editPdf(r, "county", (text) => swap(text, "  Missing. No benefit-cost analysis or screening is saved for the linked project.", "  Omitted. Not selected for this export.")), /"Appendix F\. Benefit-cost summary" carries neither its fact "Benefit-cost ratio" nor "Missing\."/],
    ["Appendix E without a Guidelines criterion row", (r) => editPdf(r, "county", (text) => swap(text, "Guidelines criterion, CalEnviroScreen: Not recorded in OpenPlan", "Guidelines criterion, CalEnviroScreen: Yes")), /does not state "Guidelines criterion, CalEnviroScreen: Not recorded in OpenPlan"/],
    ["Appendix E without the sentence that no row is a determination", (r) => editPdf(r, "county", (text) => swap(text, "      No row above is a determination that a community is disadvantaged or that the\n      project benefits one.", "      The rows above are OpenPlan's.")), /does not state "No row above is a determination/],
    ["a record that says tract data was retrieved when Appendix E says none was", (r) => { journey(r, "county").application.tractDataRetrieved = true; }, /says "no tract data was retrieved for this run", but the record says its run retrieved tract data/],
    ["a record that says no tract data when Appendix E lists tracts", (r) => editPdf(r, "county", (text) => swap(text, "Demographic source: ACS 5-Year 2023: no tract data was retrieved for this run", "Demographic source: ACS 5-Year 2023, 4 tracts, clipped to the corridor")), /does not say "no tract data was retrieved for this run", but the record says its run retrieved no tract data/],
  ]);
});

describe("the ATP application job holds the tribal area's two sentences to the tribal area's PDF", () => {
  refuses([
    ["the tribal PDF without the missing-reports sentence", (r) => editPdf(r, "tribal-area", (text) => swap(text, `      ${MISSING_REPORTS}\n`, "")), /tribal-area journey atp-application PDF "Appendix B\. Crash summary" does not carry the missing-reports sentence, which the tribal-area journey's PDF must/],
    ["the tribal PDF with the missing-reports sentence under another appendix", (r) => editPdf(r, "tribal-area", (text) => swap(swap(text, `      ${MISSING_REPORTS}\n`, ""), "Price year: 2026\n", `Price year: 2026\n\n      ${MISSING_REPORTS}\n`)), /"Appendix B\. Crash summary" does not carry the missing-reports sentence/],
    ["the county PDF with the missing-reports sentence", (r) => editPdf(r, "county", (text) => swap(text, "      modeled estimates.\n", `      modeled estimates.\n\n      ${MISSING_REPORTS}\n`)), /county journey atp-application PDF carries the missing-reports sentence, which only the tribal-area journey's PDF prints/],
    ["the city PDF with the missing-reports sentence, wrapped as a PDF wraps it", (r) => editPdf(r, "city", (text) => swap(text, "      modeled estimates.\n", `      modeled estimates.\n\n      ${MISSING_REPORTS.replace("because a tribal", "because\n      a tribal").replace("and OpenPlan", "and\n      OpenPlan")}\n`)), /city journey atp-application PDF carries the missing-reports sentence, which only the tribal-area journey's PDF prints/],
    ["the tribal PDF without the Census tribal area note", (r) => editPdf(r, "tribal-area", (text) => swap(text, `      ${TRIBAL_NOTE}\n`, "")), /"Appendix E\. Disadvantaged-community and equity inputs" does not carry the Census tribal area note/],
    ["the city PDF with the Census tribal area note", (r) => editPdf(r, "city", (text) => swap(text, "The applicant shows that in the application.\n", `The applicant shows that in the application.\n\n      ${TRIBAL_NOTE}\n`)), /city journey atp-application PDF carries the Census tribal area note, which only the tribal-area journey's PDF prints/],
  ]);
});

describe("the ATP application job refuses placeholders, determinations and scores under another label", () => {
  const typed = (words: string) => (r: Json) => editPdf(r, "county", (text) => swap(text, "An agency would write its own answer here.", words));
  refuses([
    ["a recorded fact printed as to be provided", (r) => editPdf(r, "county", (text) => after(text, RULE.applicant.line, "Location to be provided by lead agency")), /prints "to be provided", which this job refuses anywhere in the PDF/],
    ["an eligibility finding", typed("The project is eligible for ATP funding."), /prints "(is eligible for|project is eligible|eligible for ATP funding)"/],
    ["an eligibility finding in capitals, wrapped", typed("THE APPLICANT IS\nELIGIBLE under the Guidelines."), /prints "applicant is eligible"/],
    ["a disadvantaged community determination", typed("The community qualifies as a disadvantaged community."), /prints "qualifies as a disadvantaged community"/],
    ["a located-within determination", typed("The project is located within a disadvantaged community."), /prints "is located within a disadvantaged community"/],
    ["a benefit determination", typed("The project benefits a disadvantaged community."), /prints "benefits a disadvantaged community"/],
    ["a screening determination", typed("The application meets the screening criteria."), /prints "meets the screening criteria"/],
    ["a screening determination in the Commission's name", typed("This package passes the Commission's screening."), /prints "passes the Commission's screening"/],
    ["a yes in a disadvantaged community row", (r) => editPdf(r, "county", (text) => after(text, "Guidelines criterion, Other: Not recorded in OpenPlan", "", "Disadvantaged community: Yes")), /prints "Disadvantaged community: Yes"/],
    ["a safety score under no screening label", (r) => editPdf(r, "county", (text) => swap(text, "Safety, OpenPlan screening score (not a CTC score): 80.0", "Safety score: 80.0")), /prints a score that is not labeled an OpenPlan screening score: ".*safety score: 80/],
    ["a score called a CTC score", typed("CTC score: 85"), /prints a score that is not labeled an OpenPlan screening score: ".*ctc score: 85/],
    ["a point total", typed("Total points: 92 of 100"), /prints a score that is not labeled an OpenPlan screening score: ".*total points: 92/],
    ["a score whose label is cut short and wrapped", (r) => editPdf(r, "county", (text) => swap(text, "Safety, OpenPlan screening score (not a CTC score): 80.0", "Safety, OpenPlan screening\nscore: 80.0")), /prints a score that is not labeled an OpenPlan screening score/],
    ["no sentence that the scores are OpenPlan's", (r) => editPdf(r, "county", (text) => swap(text, "Scores are OpenPlan screening\nscores, not CTC scores.", "Scores are shown below.")), /does not print "Scores are OpenPlan screening scores, not CTC scores\."/],
    ["no sentence that the appendices establish no eligibility", (r) => editPdf(r, "county", (text) => swap(text, "These appendices do not establish ATP eligibility or that this\npackage meets the current call for projects.", "These appendices are OpenPlan's.")), /does not print "These appendices do not establish ATP eligibility/],
    ["no sentence that OpenPlan decides no eligibility", (r) => editPdf(r, "county", (text) => swap(text, "      OpenPlan does not decide ATP eligibility.\n", "")), /"Appendix A\. ATP screening packet" does not state "OpenPlan does not decide ATP eligibility\."/],
  ]);
});

describe("the ATP application job refuses screens that fail its checks", () => {
  const row = (r: Json, screen: string, width: number, mode: string) => journey(r, "county").screens.find((entry: Json) => entry.screen === screen && entry.width === width && entry.mode === mode);
  refuses([
    ["a serious accessibility finding", (r) => { row(r, "corridor-analysis", 1440, "light").axe.serious = 1; }, /screen corridor-analysis at 1440 px light has 1 serious and 0 critical accessibility violations/],
    ["another accessibility engine version", (r) => { row(r, "safety", 390, "dark").axe.version = "4.10.2"; }, /ran accessibility engine 4\.10\.2 .* this job's definition names 4\.11\.1/],
    ["a narrower set of rule tags", (r) => { row(r, "safety", 390, "dark").axe.tags = ["wcag2a"]; }, /with tags wcag2a; this job's definition names 4\.11\.1 with wcag2a, wcag2aa, wcag21a, wcag21aa/],
    ["a console error on a required screen", (r) => { row(r, "grants-application", 1440, "dark").consoleErrors = 1; }, /screen grants-application at 1440 px dark logged 1 console errors/],
    ["sideways scroll at 390 px", (r) => { row(r, "project", 390, "light").horizontalScroll = true; }, /screen project at 390 px light scrolls sideways/],
    ["a required screen with no checks", (r) => { journey(r, "county").screens = journey(r, "county").screens.filter((entry: Json) => entry.screen !== "corridor-analysis"); }, /county journey has no check of the corridor-analysis screen/],
    ["a screen not checked in dark mode at 390 px", (r) => { journey(r, "county").screens = journey(r, "county").screens.filter((entry: Json) => !(entry.screen === "safety" && entry.width === 390 && entry.mode === "dark")); }, /screen safety has no check at 390 px dark/],
  ]);
});

describe("the ATP application job refuses a second account's refusal that has no control", () => {
  const checkOf = (r: Json, role: string, request: string) => r.crossWorkspace.checks.find((entry: Json) => entry.journey === role && entry.request === request);
  refuses([
    ["a second account that read the application", (r) => { checkOf(r, "county", "application-read").status = 200; }, /cross-workspace data request application-read for another workspace's atp-application answered status 200, which is inconclusive/],
    ["a second account that was not signed in (401)", (r) => { checkOf(r, "city", "application-pdf-download").status = 401; }, /application-pdf-download for another workspace's atp-application-pdf answered status 401, which is inconclusive/],
    ["a refusal that returned content", (r) => { checkOf(r, "county", "application-pdf-download").contentReturned = true; }, /returned content \(status 404\)/],
    ["no second-account checks for the city journey", (r) => { r.crossWorkspace.checks = r.crossWorkspace.checks.filter((entry: Json) => entry.journey !== "city"); }, /the city journey needs exactly one application-read data check for atp-application, found 0/],
    ["the county's checks relabeled as the tribal area's", (r) => { for (const entry of r.crossWorkspace.checks) if (entry.journey === "tribal-area") entry.journey = "county"; }, /the county journey needs exactly one application-read data check for atp-application, found 2/],
    ["no project page check", (r) => { r.crossWorkspace.checks = r.crossWorkspace.checks.filter((entry: Json) => entry.request !== "project-page"); }, /cross-workspace checks for atp-application need its project-page checked as a page check/],
    ["a project page that answered 200 without the not-found screen", (r) => { checkOf(r, "county", "project-page").notFoundRendered = false; }, /project-page .* answered 200 without the journey reading the not-found screen on it/],
    ["a project page that answered 200 and showed the first account's text", (r) => { checkOf(r, "county", "project-page").recordTextFound = true; }, /answered 200 and the journey found the first account's text on it/],
    ["a project page that answered 200 with the limit not stated", (r) => { r.limits = r.limits.filter((limit: Json) => limit.id !== "project-page-answers-200-with-not-found-screen"); }, /record does not state the project-page-answers-200-with-not-found-screen limit/],
    ["no owner checks at all", (r) => { delete r.crossWorkspace.ownerChecks; }, /record\.crossWorkspace is missing ownerChecks/],
    ["no owner control for the tribal area journey", (r) => { r.crossWorkspace.ownerChecks = r.crossWorkspace.ownerChecks.filter((entry: Json) => entry.journey !== "tribal-area"); }, /the tribal-area journey needs exactly one owner application-read check, found 0; a second account's refusal counts only beside the owner's own answer in the same run/],
    ["an owner control for the read but not the download", (r) => { r.crossWorkspace.ownerChecks = r.crossWorkspace.ownerChecks.filter((entry: Json) => !(entry.journey === "city" && entry.request === "application-pdf-download")); }, /the city journey needs exactly one owner application-pdf-download check, found 0/],
    ["an owner who was refused too", (r) => { r.crossWorkspace.ownerChecks[0].status = 404; }, /the county journey's owner received status 404 for application-read, not 200/],
    ["an owner control for a request the job does not define", (r) => { r.crossWorkspace.ownerChecks.push({ journey: "county", request: "dashboard-read", status: 200 }); }, /owner check dashboard-read of the county journey is not a request this job's control defines/],
    ["no second account entries at all", (r) => { delete r.crossWorkspace.secondAccounts; }, /record\.crossWorkspace is missing secondAccounts/],
    ["no second account entry for the city journey", (r) => { r.crossWorkspace.secondAccounts = r.crossWorkspace.secondAccounts.filter((entry: Json) => entry.journey !== "city"); }, /the city journey needs exactly one second account entry, found 0/],
    ["a second account that was never confirmed", (r) => { r.crossWorkspace.secondAccounts[1].confirmed = false; }, /the city journey's second account was not confirmed/],
    ["a second account that was never signed in", (r) => { r.crossWorkspace.secondAccounts[2].ownStatus = 401; }, /the tribal-area journey's second account received status 401 for its own own-workspace-read, not 200 for own-workspace-read; an account that is not signed in is refused everything/],
    ["a second account whose own read is another request", (r) => { r.crossWorkspace.secondAccounts[0].ownRequest = "sign-in-page"; }, /second account received status 200 for its own sign-in-page, not 200 for own-workspace-read/],
  ]);
});

describe("the ATP application job holds every limit to its definition's words", () => {
  const worded: string[] = [...JOB.requiredLimits, JOB.crossWorkspace.pageAnsweredOkLimit];
  it.each(JOB.requiredLimits as string[])("refuses a record that does not state the %s limit", (id) => {
    const record = proven();
    record.limits = record.limits.filter((limit: Json) => limit.id !== id);
    expect(() => check(record)).toThrow(`proven job record refused: record does not state the ${id} limit`);
  });
  it.each(worded)("refuses a %s limit that says something else", (id) => {
    const record = proven();
    record.limits.find((limit: Json) => limit.id === id).text = "Every check was made, and a planner approved the result.";
    expect(() => check(record)).toThrow(`proven job record refused: record's ${id} limit does not carry its definition's words`);
  });
  it("refuses a limit with a trailing sentence, and a secret in a limit", () => {
    const record = proven();
    record.limits[5].text += " The Commission scored it.";
    expect(() => check(record)).toThrow(/proven job record refused: record's attachments-not-produced limit does not carry its definition's words/);
    const other = proven();
    other.limits[0].text = "Ask planner@example.org.";
    expect(() => check(other)).toThrow(/proven job record refused: record\.limits\[0\]\.text contains an email address/);
  });
  it("names every role in the hostile cases above", () => {
    expect(EXAMPLE.journeys.map((entry: Json) => entry.role)).toEqual(ROLES);
  });
});
