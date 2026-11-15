// @vitest-environment node
/**
 * The second proven job, engagement-campaign-review-and-response-in-three-places:
 * the checker accepts its synthetic example and refuses each way a record can
 * fall short of the job's definition. The synthetic "PDFs" and "workbooks"
 * are text files read by fake readers, as in capability-evidence.test.ts; a
 * real workbook built by the product's own review export is read with the
 * checker's default SheetJS reader at the end.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizePlaceGeoid, type PlaceKind } from "@/lib/api/place-geographies";
import { buildCampaignReviewWorkbook, type EngagementReviewSnapshot } from "@/lib/engagement/review-export";
import { validateProvenJobRecord, xlsxSheets } from "../../scripts/ops/capability-evidence.mjs";

const read = (path: string) => JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"));
const EXAMPLE = read("../../../schemas/examples/proven_job_record.v1.engagement.synthetic.json");
const SAFETY_EXAMPLE = read("../../../schemas/examples/proven_job_record.v1.synthetic.json");
const DEFINITIONS = read("../../../schemas/proven_job_definitions.v1.json");
const RECORD_SCHEMA = read("../../../schemas/proven_job_record.v1.schema.json");

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a record under test is deliberately untyped JSON
type Json = any;
type Sheets = Record<string, unknown[][]>;

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ROLES = ["county", "city-or-town", "tribal-area"];

/** The ids the example uses for one journey, by its index. */
function idsFor(index: number) {
  const base = 100 * (index + 1);
  return {
    campaign: id(base + 1), project: id(base + 2),
    a: id(base + 3), b: id(base + 4), c: id(base + 5), d: id(base + 6),
    review: id(base + 7), response: id(base + 8),
  };
}

/** Each journey's rejected comment, as the example records it (rejectedTexts). */
const rejectedText = (role: string) => `Please fix my synthetic water bill (${role}). A test entry that represents no one.`;
const LEFT_OUT = "This public copy holds approved contributions only. Withheld, pending and flagged contributions are left out, so it does not count them.";
const INTERNAL_COUNTS = "Received 4 contributions.\nApproved 3 contributions.\nWithheld 1 contribution.\nPending 0 contributions.\nPublished 1 staff response.";

/** The internal review PDF: its counts, its answered count, and a register page that prints the rejected comment and its id. */
function reviewPdf(role: string, page1 = `INTERNAL REVIEW COPY\nReview counts\n${INTERNAL_COUNTS}`, page2 = "Reviewed staff responses\nAnswered 2 contributions with a published staff response."): string {
  return [
    `%PDF-1.4 synthetic test file for the proven job checker, not a real PDF\ncampaign-review for the ${role} journey\n${page1}`,
    page2,
    `Contribution register\n${ids(role).d} withheld\n${rejectedText(role)}`,
  ].join("\f");
}

/** The public review copy: approved comments only, and a sentence saying what it leaves out. */
function publicPdf(role: string, counts = "Approved 3 contributions.\nPublished 1 staff response.\nAnswered 2 contributions with a published staff response."): string {
  return `%PDF-1.4 synthetic test file for the proven job checker, not a real PDF\ncampaign-review-public for the ${role} journey\nPUBLIC REVIEW COPY\nReview counts\n${LEFT_OUT}\n${counts}`;
}

function reviewSheets(role: string, ids: ReturnType<typeof idsFor>): Sheets {
  return {
    "Read me": [["Field", "Value"], ["Campaign", `Synthetic ${role} campaign`], ["Scope", "internal"]],
    Contributions: [
      ["id", "status", "title"],
      [ids.a, "approved", "Synthetic map point"],
      [ids.b, "approved", "Synthetic comment"],
      [ids.c, "approved", "Synthetic keyboard comment"],
      [ids.d, "rejected", rejectedText(role)],
    ],
    "Staff responses": [
      ["id", "theme_title", "you_said", "we_did", "source_item_ids", "published_at"],
      [ids.response, "Synthetic theme", "Synthetic", "Synthetic", JSON.stringify([ids.a, ids.b]), "2026-11-20T10:30:00Z"],
    ],
    "Long text": [["Record type", "Record ID", "Field", "Part", "Text"]],
    Summary: [
      ["Record set", "Count"], ["Contributions", 4], ["Received", 4], ["Approved", 3], ["Withheld", 1], ["Pending", 0],
      ["Flagged for review", 0], ["Published staff responses", 1], ["Answered by a published staff response", 2],
    ],
  };
}

function publicSheets(role: string, ids: ReturnType<typeof idsFor>): Sheets {
  const sheets = reviewSheets(role, ids);
  sheets["Read me"][2][1] = "public";
  sheets.Contributions.pop();
  sheets.Summary = [
    ["Record set", "Count"], ["Contributions", 3], ["Approved", 3], ["Withheld, pending and flagged", "Not in the public copy"],
    ["Published staff responses", 1], ["Answered by a published staff response", 2],
  ];
  return sheets;
}

const workbookText = (sheets: Sheets) =>
  `PK\u0003\u0004 synthetic test file for the proven job checker, not a real workbook\n${JSON.stringify(sheets)}`;

const jobRoot = mkdtempSync(join(tmpdir(), "openplan-proven-engagement-"));
const fakePdfPages = (path: string) => readFileSync(path, "utf8").replace(/^[^\n]*\n/, "").split("\f");
const fakeWorkbook = (path: string): Sheets => JSON.parse(readFileSync(path, "utf8").replace(/^[^\n]*\n/, ""));

const ids = (role: string) => idsFor(ROLES.indexOf(role));
/** The four synthetic files of one journey, by the record entry's kind. */
const syntheticFiles = (role: string): Record<string, [string, string]> => ({
  pdf: [`campaign-review`, reviewPdf(role)],
  publicPdf: [`campaign-review-public`, publicPdf(role)],
  workbook: [`campaign-review`, workbookText(reviewSheets(role, ids(role)))],
  publicWorkbook: [`campaign-review-public`, workbookText(publicSheets(role, ids(role)))],
});

EXAMPLE.journeys.forEach((entry: Json) => {
  const files = syntheticFiles(entry.role);
  const writes: Array<[Json, string]> = [
    [entry.pdfs.find((pdf: Json) => pdf.kind === files.pdf[0]), files.pdf[1]],
    [entry.pdfs.find((pdf: Json) => pdf.kind === files.publicPdf[0]), files.publicPdf[1]],
    [entry.workbooks.find((book: Json) => book.kind === files.workbook[0]), files.workbook[1]],
    [entry.workbooks.find((book: Json) => book.kind === files.publicWorkbook[0]), files.publicWorkbook[1]],
  ];
  for (const [file, text] of writes) {
    mkdirSync(join(jobRoot, dirname(file.path)), { recursive: true });
    writeFileSync(join(jobRoot, file.path), text);
  }
});

const proven = (): Json => structuredClone(EXAMPLE);
const journey = (record: Json, role: string) => record.journeys.find((entry: Json) => entry.role === role);
const check = (record: Json) =>
  validateProvenJobRecord(record, { repoRoot: jobRoot, readPdfPages: fakePdfPages, readWorkbook: fakeWorkbook });

/** Write a new artifact file under a new name and re-pin its hash and size, so only the rule under test can refuse it. */
function rewrite(entry: Json, text: string) {
  const digest = sha(text);
  entry.path = entry.path.replace(/(\.\w+)$/, `-${digest.slice(0, 8)}$1`);
  writeFileSync(join(jobRoot, entry.path), text);
  entry.sha256 = digest;
  entry.bytes = Buffer.byteLength(text);
}
const rewritePdf = (record: Json, role: string, text: string) => rewrite(journey(record, role).pdfs[0], text);
function rewriteSheets(record: Json, role: string, change: (sheets: Sheets) => void) {
  const sheets = reviewSheets(role, ids(role));
  change(sheets);
  rewrite(journey(record, role).workbooks[0], workbookText(sheets));
}

describe("the engagement job's synthetic example", () => {
  it("is accepted on its synthetic bytes", () => {
    expect(() => check(proven())).not.toThrow();
  });

  it("accepts a city place, a campaign page that answers 404 without the 200 limit, and a 403 participant refusal", () => {
    const record = proven();
    Object.assign(journey(record, "city-or-town").place, { kind: "city", geoid: "2599812" });
    record.crossWorkspace.checks[3] = { journey: "county", target: "staff-campaign", request: "campaign-page", kind: "page", status: 404, contentReturned: false };
    record.limits = record.limits.filter((limit: Json) => limit.id !== "campaign-page-answers-200-with-not-found-screen");
    record.participantChecks.refusals[0].status = 403;
    expect(() => check(record)).not.toThrow();
  });
});

describe("the engagement job refuses", () => {
  it.each<[string, (record: Json) => void, RegExp]>([
    // Places and executors
    ["a missing journey", (r) => { r.journeys = r.journeys.filter((e: Json) => e.role !== "city-or-town"); }, /exactly one city-or-town journey, found 0/],
    ["a town journey run on a county", (r) => { Object.assign(journey(r, "city-or-town").place, { kind: "county", geoid: "25998" }); }, /city-or-town journey must be a place of kind city or cousub, found county/],
    ["a town with a city id", (r) => { journey(r, "city-or-town").place.geoid = "2599812"; }, /geoid 2599812 is not a cousub Census id/],
    ["a tribal journey run on a cdp", (r) => { Object.assign(journey(r, "tribal-area").place, { kind: "cdp", geoid: "0499812" }); }, /tribal-area journey must be a place of kind aiannh, found cdp/],
    ["a journey without a public participant", (r) => { journey(r, "county").executors[1].role = "staff"; }, /county journey needs exactly one staff executor, found 2/],
    ["an unnamed participant", (r) => { journey(r, "county").executors[1].agent = " "; }, /executors\[1\]\.agent is blank/],
    ["a single executor", (r) => { journey(r, "county").executors.pop(); }, /executors needs at least 2 entries/],
    // The job's field rules
    ["an AI feature used", (r) => { journey(r, "county").campaign.aiFeaturesUsed = true; }, /county journey used an AI feature/],
    ["a staff review not approved", (r) => { journey(r, "county").campaign.staffReview.approved = false; }, /county journey staff review was not approved/],
    ["a response left in draft", (r) => { journey(r, "county").campaign.response.status = "draft"; }, /county journey response is draft, not published/],
    ["a response drafted with AI", (r) => { journey(r, "county").campaign.response.aiAssisted = true; }, /drafted with AI assistance/],
    // Contributions and moderation
    ["no map point", (r) => { journey(r, "county").campaign.contributions[0].kind = "no-map-point"; }, /county journey has no map-point contribution/],
    ["no comment without a map point", (r) => { for (const c of journey(r, "county").campaign.contributions) c.kind = "map-point"; }, /has no no-map-point contribution/],
    ["no keyboard-only contribution", (r) => { journey(r, "county").campaign.contributions[2].input = "pointer"; }, /no contribution made with the keyboard only at 390 px/],
    ["the keyboard contribution made at desktop width", (r) => { journey(r, "county").campaign.contributions[2].viewportWidth = 1440; }, /no contribution made with the keyboard only at 390 px/],
    ["a contribution listed twice", (r) => { const c = journey(r, "county").campaign.contributions; c[3].commentId = c[0].commentId; }, /lists contribution .* twice/],
    ["a moderated comment that was never recorded", (r) => { journey(r, "county").campaign.moderation[3].commentId = id(999); }, /moderated 00000000-0000-4000-8000-000000000999, which is not a recorded contribution/],
    ["a comment moderated twice", (r) => { const m = journey(r, "county").campaign.moderation; m[2].commentId = m[1].commentId; }, /moderated .* twice/],
    ["no rejection", (r) => { journey(r, "county").campaign.moderation[3].outcome = "approved"; }, /county journey rejected 0 comments; at least 1 required/],
    ["a rejection without a reason", (r) => { journey(r, "county").campaign.moderation[3].reasonRecorded = false; }, /rejected 00000000-0000-4000-8000-000000000106 without a reason/],
    // Themes and the response
    ["a theme holding a rejected comment", (r) => { journey(r, "county").campaign.staffReview.themes[1].commentIds.push(ids("county").d); }, /theme crossings lists 00000000-0000-4000-8000-000000000106, which is not an approved comment/],
    ["a theme holding an unknown comment", (r) => { journey(r, "county").campaign.staffReview.themes[0].commentIds.push(id(998)); }, /lists 00000000-0000-4000-8000-000000000998, which is not an approved comment/],
    ["a response answering a comment no theme holds", (r) => { const c = journey(r, "county").campaign; c.staffReview.themes.pop(); c.response.sourceCommentIds = [ids("county").c]; }, /response answers 00000000-0000-4000-8000-000000000105, which no staff review theme holds/],
    ["a response decision on another project", (r) => { journey(r, "county").campaign.response.projectId = id(997); }, /response decision is on project 00000000-0000-4000-8000-000000000997, not the campaign's project/],
    // The review PDF
    ["a review PDF whose approved count disagrees", (r) => { rewritePdf(r, "county", reviewPdf("county", "INTERNAL REVIEW COPY\nApproved 4\nWithheld 1")); journey(r, "county").pdfs[0].items[1].text = "Approved 4"; }, /campaign-review PDF approved-count reads "Approved 4", but the journey's approved count gives "Approved 3"/],
    ["a review PDF whose rejected count disagrees", (r) => { rewritePdf(r, "county", reviewPdf("county", "INTERNAL REVIEW COPY\nApproved 3\nWithheld 0")); journey(r, "county").pdfs[0].items[2].text = "Withheld 0"; }, /rejected-count reads "Withheld 0", but the journey's rejected count gives "Withheld 1"/],
    ["a review PDF whose responded count disagrees", (r) => { rewritePdf(r, "county", reviewPdf("county", undefined, "Answered 3")); journey(r, "county").pdfs[0].items[3].text = "Answered 3"; }, /responded-count reads "Answered 3", but the journey's responded count gives "Answered 2"/],
    ["a count phrase that is not on its page", (r) => { journey(r, "county").pdfs[0].items[3].page = 1; }, /responded-count text is not on page 1/],
    ["a count read across a column gap", (r) => { rewritePdf(r, "county", reviewPdf("county", "INTERNAL REVIEW COPY\nApproved      3\nWithheld 1")); }, /approved-count text is not on page 1/],
    ["a public review copy", (r) => { rewritePdf(r, "county", reviewPdf("county", "PUBLIC REVIEW COPY\nApproved 3\nWithheld 1")); journey(r, "county").pdfs[0].items[0].text = "Public review copy"; }, /scope-badge must read "Internal review copy"/],
    ["a review PDF without a responded count", (r) => { const pdf = journey(r, "county").pdfs[0]; pdf.items = pdf.items.filter((i: Json) => i.item !== "responded-count"); }, /must find responded-count exactly once, found 0/],
    ["a review PDF stamped DRAFT", (r) => { rewritePdf(r, "county", reviewPdf("county", undefined, "Answered 2\nDRAFT")); }, /campaign-review PDF page 2 carries a DRAFT stamp/],
    ["a review PDF holding an email address", (r) => { rewritePdf(r, "county", reviewPdf("county", undefined, "Answered 2\nSubmitted by resident@example.org")); }, /campaign-review PDF page 2 contains an email address/],
    // The review workbook, read by cell
    ["a workbook whose rejected comment reads approved", (r) => rewriteSheets(r, "county", (s) => { s.Contributions[4][1] = "approved"; }), /Contributions row for 00000000-0000-4000-8000-000000000106 has status approved, not rejected/],
    ["a workbook missing a moderated comment", (r) => rewriteSheets(r, "county", (s) => { s.Contributions.splice(2, 1); }), /row for 00000000-0000-4000-8000-000000000104 has status missing, not approved/],
    ["a workbook with an approved row the journey did not moderate", (r) => rewriteSheets(r, "county", (s) => { s.Contributions.push([id(996), "approved", "Extra"]); }), /workbook has 4 approved contributions; the journey's approved count is 3/],
    ["a workbook with an unpublished response", (r) => rewriteSheets(r, "county", (s) => { s["Staff responses"][1][5] = ""; }), /answers 0 contributions in published responses; the journey's responded count is 2/],
    ["a workbook response answering a third comment", (r) => rewriteSheets(r, "county", (s) => { s["Staff responses"][1][4] = JSON.stringify([ids("county").a, ids("county").b, ids("county").c]); }), /answers 3 contributions in published responses; the journey's responded count is 2/],
    ["a workbook response that is not a list", (r) => rewriteSheets(r, "county", (s) => { s["Staff responses"][1][4] = "see notes"; }), /source_item_ids for 00000000-0000-4000-8000-000000000108 is not a list/],
    ["a public-scope workbook", (r) => rewriteSheets(r, "county", (s) => { s["Read me"][2][1] = "public"; }), /workbook Read me Scope must be internal/],
    ["a workbook without its responses sheet", (r) => rewriteSheets(r, "county", (s) => { delete s["Staff responses"]; }), /workbook has no Staff responses sheet/],
    ["a workbook without its status column", (r) => rewriteSheets(r, "county", (s) => { s.Contributions[0][1] = "state"; }), /sheet Contributions has no status column/],
    ["a workbook cell holding an email address", (r) => rewriteSheets(r, "county", (s) => { s.Contributions[1][2] = "From resident@example.org"; }), /workbook sheet Contributions cell C2 contains an email address/],
    ["a workbook that is not an XLSX file", (r) => rewrite(journey(r, "county").workbooks[0], "synthetic\n{}"), /campaign-review workbook is not an XLSX file/],
    ["a changed workbook hash", (r) => { journey(r, "county").workbooks[0].sha256 = "0".repeat(64); }, /evidence hash changed/],
    ["a missing workbook", (r) => { journey(r, "county").workbooks[0].kind = "survey-export"; }, /needs exactly one campaign-review workbook, found 0/],
    ["one workbook used for two journeys", (r) => { Object.assign(journey(r, "tribal-area").workbooks[0], journey(r, "county").workbooks[0]); }, /reuses another file/],
    // The public response page
    ["a public page showing a different approved count", (r) => { journey(r, "county").publicPage.readings[3].approvedShown = 2; }, /public response page at 390 px dark shows 2 approved comments; the journey's approved count is 3/],
    ["a public page showing a different answered count", (r) => { journey(r, "county").publicPage.readings[0].respondedShown = 3; }, /at 1440 px light shows 3 answered comments; the journey's responded count is 2/],
    ["a rejected comment's text on the public page", (r) => { journey(r, "county").publicPage.readings[2].rejectedTextFound = true; }, /public response page at 390 px light shows a rejected comment's text/],
    ["a public page searched for fewer rejected texts", (r) => { journey(r, "county").publicPage.readings[1].rejectedTextSearched = 0; }, /searched 0 rejected texts, not 1/],
    ["a public page not read at 390 px dark", (r) => { journey(r, "county").publicPage.readings.pop(); }, /public response page has no reading at 390 px dark/],
    ["a public page reading recorded twice", (r) => { const p = journey(r, "county").publicPage.readings; p[1] = { ...p[0] }; }, /at 1440 px light is recorded twice/],
    ["no hash for the rejected comment's text", (r) => { journey(r, "county").campaign.rejectedTextSha256 = []; }, /one distinct hash per rejected comment's text/],
    // Screens
    ["no staff campaign screen", (r) => { const j = journey(r, "county"); j.screens = j.screens.filter((s: Json) => s.screen !== "staff-campaign"); }, /county journey has no check of the staff-campaign screen/],
    ["a serious accessibility violation on the portal", (r) => { journey(r, "county").screens[3].axe.serious = 1; }, /portal at 390 px dark has 1 serious/],
    // Cross-workspace
    ["a workbook download answering 200", (r) => { r.crossWorkspace.checks[1].status = 200; }, /review-xlsx-download for another workspace's campaign-review-workbook answered status 200, which is inconclusive/],
    ["a staff campaign held only by its page", (r) => { r.crossWorkspace.checks = r.crossWorkspace.checks.filter((c: Json) => c.request !== "campaign-read"); }, /checks for staff-campaign need its campaign-read refused as a data check/],
    ["a staff campaign without its page check", (r) => { r.crossWorkspace.checks = r.crossWorkspace.checks.filter((c: Json) => c.request !== "campaign-page"); }, /checks for staff-campaign need its campaign-page checked as a page check/],
    // Each check names its journey, and each journey has each required request once (lane 45).
    ["a cross-workspace check that names no journey", (r) => { delete r.crossWorkspace.checks[0].journey; }, /review-pdf-download for another workspace's campaign-review-pdf does not name the journey that made it/],
    ["one journey's campaign read standing for another's", (r) => { r.crossWorkspace.checks[6].journey = "county"; }, /the county journey needs exactly one campaign-read data check for staff-campaign, found 2/],
    ["a tribal journey without its review download check", (r) => { r.crossWorkspace.checks = r.crossWorkspace.checks.filter((c: Json) => !(c.journey === "tribal-area" && c.request === "review-pdf-download")); }, /the tribal-area journey needs exactly one review-pdf-download data check for campaign-review-pdf, found 0/],
    ["a cross-workspace check naming a journey the record does not hold", (r) => { r.crossWorkspace.checks[4].journey = "borough"; }, /names the borough journey, which the record does not hold/],
    ["a campaign page answering 200 without its limit", (r) => { r.limits = r.limits.filter((l: Json) => l.id !== "campaign-page-answers-200-with-not-found-screen"); }, /does not state the campaign-page-answers-200-with-not-found-screen limit/],
    // The public participant
    ["the campaign export served to the public participant", (r) => { r.participantChecks.refusals[1] = { request: "campaign-export-read", status: 200, contentReturned: true }; }, /public participant request campaign-export-read returned content \(status 200\)/],
    ["a participant request that failed on the server", (r) => { r.participantChecks.refusals[3].status = 500; }, /review-pdf-download answered status 500, which is inconclusive/],
    ["a missing participant request", (r) => { r.participantChecks.refusals.pop(); }, /public participant check review-xlsx-download is missing/],
    ["a public read carrying a staff-only field", (r) => { r.participantChecks.publicRead.staffFieldsFound = true; }, /public-portal-read carried a staff-only field/],
    ["a public read not searched for review reasons", (r) => { r.participantChecks.publicRead.staffFieldsSearched = ["moderation_notes"]; }, /was not searched for the staff-only field review_reason/],
    ["a public read that failed", (r) => { r.participantChecks.publicRead.status = 503; }, /answered status 503; the public read must answer 200/],
    // Record shape and limits
    ["a missing limit", (r) => { r.limits = r.limits.filter((l: Json) => l.id !== "test-comments-represent-no-one"); }, /does not state the test-comments-represent-no-one limit/],
    ["a response that speaks for an agency", (r) => { r.limits = r.limits.filter((l: Json) => l.id !== "response-speaks-for-no-agency"); }, /response-speaks-for-no-agency limit/],
    ["no participant checks", (r) => { delete r.participantChecks; }, /record is missing participantChecks/],
    ["a crash source check on an engagement record", (r) => { r.sourceCheck = SAFETY_EXAMPLE.sourceCheck; }, /record has unknown field sourceCheck/],
    ["a safety field on an engagement journey", (r) => { journey(r, "county").bcaSaved = true; }, /record\.journeys\[0\] has unknown field bcaSaved/],
    ["a portal address in place of its kind", (r) => { journey(r, "county").campaign.portalAddressKind = "abcdefgh12345678"; }, /portalAddressKind must be one of share-token, printable-slug/],
    ["a local origin", (r) => { r.baseUrl = "https://localhost:3450"; }, /not the hosted origin/],
    ["a health readback from another commit", (r) => { journey(r, "tribal-area").health[1].commit = "fedcba987654"; }, /tribal-area journey end health readback reports commit fedcba987654/],
  ])("%s", (_name, mutate, reason) => {
    const record = proven();
    mutate(record);
    expect(() => check(record)).toThrow(reason);
  });

  it("refuses a safety record that carries participant checks, so each job's fields stay its own", () => {
    const record = structuredClone(SAFETY_EXAMPLE);
    record.participantChecks = EXAMPLE.participantChecks;
    expect(() => validateProvenJobRecord(record, { repoRoot: jobRoot, readPdfPages: fakePdfPages })).toThrow(/record has unknown field participantChecks/);
  });
});

describe("the definitions and the record schema agree", () => {
  it("gives every defined job exactly one sub-schema, chosen by its id, and no other", () => {
    const branches = RECORD_SCHEMA.allOf.map((part: Json) => part.if.properties.jobId.const).sort();
    expect(branches).toEqual(DEFINITIONS.jobs.map((job: Json) => job.id).sort());
  });

  it("reads Census ids for every place kind a job uses the way the place resolver does", () => {
    const patterns: Array<[string, string]> = [];
    for (const source of [DEFINITIONS.geoidPatterns, ...DEFINITIONS.jobs.map((job: Json) => job.geoidPatterns ?? {})]) {
      for (const [kind, pattern] of Object.entries(source)) if (kind !== "source") patterns.push([kind, pattern as string]);
    }
    const used = DEFINITIONS.jobs.flatMap((job: Json) => job.journeys.flatMap((rule: Json) => rule.placeKinds ?? [rule.placeKind]));
    for (const kind of used) expect(patterns.map(([name]) => name), kind).toContain(kind);
    for (const [kind, pattern] of patterns) {
      for (const sample of ["06001", "0600", "060011", "2430R", "2430T", "2430X", "2430r", "0644000", "064400", "06440001", "2501307000", "250130700", "25013070001"]) {
        expect(new RegExp(pattern).test(sample), `${kind} ${sample}`).toBe(normalizePlaceGeoid(kind as PlaceKind, sample) === sample);
      }
    }
  });
});

/**
 * The product's own review workbook (buildCampaignReviewWorkbook), read with
 * the checker's default SheetJS reader: the sheet and column names in the
 * engagement job's definition are the ones the export writes.
 */
describe("a real review workbook from the product's export", () => {
  const role = "county";
  const ids = idsFor(0);
  function snapshot(sources: string[], rejectedStatus = "rejected"): EngagementReviewSnapshot {
    const item = (itemId: string, status: string, title: string) => ({ id: itemId, status, title, body: title, configuration_version_id: null, created_at: "2026-11-20T10:05:00Z" });
    return {
      schema: 1, capturedAt: "2026-11-20T10:40:00Z", scope: "internal", filters: {},
      campaign: { id: ids.campaign, title: "Synthetic county campaign", summary: null, configurationVersionId: null },
      items: [item(ids.a, "approved", "Map point"), item(ids.b, "approved", "Comment"), item(ids.c, "approved", "Keyboard comment"), item(ids.d, rejectedStatus, rejectedText(role))],
      sessions: [], answers: [], definitions: [],
      responses: [{ id: ids.response, theme_title: "Access", you_said: "Synthetic", we_did: "Synthetic", source_item_ids: sources, published_at: "2026-11-20T10:30:00Z" }],
    };
  }
  async function recordWithRealWorkbook(sources: string[], rejectedStatus = "rejected") {
    const bytes = await buildCampaignReviewWorkbook(snapshot(sources, rejectedStatus), "checksum");
    const record = proven();
    const entry = journey(record, role).workbooks[0];
    const digest = createHash("sha256").update(bytes).digest("hex");
    entry.path = entry.path.replace(/\.xlsx$/, `-real-${digest.slice(0, 8)}.xlsx`);
    writeFileSync(join(jobRoot, entry.path), bytes);
    entry.sha256 = digest;
    entry.bytes = bytes.length;
    return record;
  }
  // Only the county journey's workbook is real; the others stay synthetic.
  const realOrFake = (path: string) => (path.includes("-real-") ? xlsxSheets(path) : fakeWorkbook(path));
  const checkReal = (record: Json) =>
    validateProvenJobRecord(record, { repoRoot: jobRoot, readPdfPages: fakePdfPages, readWorkbook: realOrFake });

  it("agrees with the journey's counts", async () => {
    const record = await recordWithRealWorkbook([ids.a, ids.b]);
    expect(() => checkReal(record)).not.toThrow();
  });

  it("reads a sources list the export split into the Long text sheet", async () => {
    // Twenty identifiers run past the export's 500-character cell, so the
    // Staff responses cell points at Long text rows instead.
    const extra = Array.from({ length: 18 }, (_, index) => id(9000 + index));
    const bytes = await buildCampaignReviewWorkbook(snapshot([ids.a, ids.b, ...extra]), "checksum");
    const path = join(jobRoot, "long-text.xlsx");
    writeFileSync(path, bytes);
    const sheets = xlsxSheets(path);
    expect(String(sheets["Staff responses"][1][4])).toMatch(/\[Full value: Long text \/ .* \/ source_item_ids\]$/);
    const record = await recordWithRealWorkbook([ids.a, ids.b, ...extra]);
    // The workbook answers 20 comments; the journey's response answers 2.
    expect(() => checkReal(record)).toThrow(/answers 20 contributions in published responses; the journey's responded count is 2/);
  });

  it("refuses a real workbook whose rejected comment reads approved", async () => {
    const record = await recordWithRealWorkbook([ids.a, ids.b], "approved");
    expect(() => checkReal(record)).toThrow(/Contributions row for 00000000-0000-4000-8000-000000000106 has status approved, not rejected/);
  });
});
