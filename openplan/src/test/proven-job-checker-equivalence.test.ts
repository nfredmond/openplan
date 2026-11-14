// @vitest-environment node
/**
 * Lane 39 moved the first proven job's own rules (a saved benefit-cost
 * analysis, the Nevada crash source and count, the crash source check) out
 * of the checker's code and into that job's definition entry. This test is
 * the guard that nothing moved for the first job: it runs the committed
 * synthetic example and every case capability-evidence.test.ts runs through
 * main's checker at 1fbfe95ed (frozen, with main's schema and definitions, in
 * fixtures/proven-job-checker-main-1fbfe95ed) and through the current one,
 * and requires the same verdict and the same refusal text from both.
 *
 * The cases are copied from capability-evidence.test.ts; the last test here
 * fails if that file gains or loses a case this one does not have.
 *
 * Lane 45 (November 14, 2026) made the current checker refuse changes main's
 * accepts: cross-workspace checks from every journey, every required screen,
 * each text item's own heading, the words printed with the map, a matched
 * source check's address and note, and crashes, segments, countermeasures,
 * approved comments and a staff review in every journey. Those cases are in
 * proven-job-checker-gaps.test.ts, where main accepts and the current
 * checker refuses. The synthetic example was brought up to those rules and
 * main's checker still accepts it, so every case here keeps one verdict.
 *
 * Blind category: only the first job's example and these single-fault cases
 * are compared. A record with two faults may be refused for a different one
 * of them, because the per-job sub-schema is checked after the common fields.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ppmWithRed } from "./helpers/ppm";
import { stripSourceComments } from "./helpers/source-text";
import * as current from "../../scripts/ops/capability-evidence.mjs";
import * as main from "./fixtures/proven-job-checker-main-1fbfe95ed/openplan/scripts/ops/capability-evidence.mjs";

const EXAMPLE = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../schemas/examples/proven_job_record.v1.synthetic.json", import.meta.url)), "utf8"),
);
const jobRoot = mkdtempSync(join(tmpdir(), "openplan-proven-job-equivalence-"));
const fakePdfPages = (path: string) => readFileSync(path, "utf8").replace(/^[^\n]*\n/, "").split("\f");
// Since lane 49 the current checker renders each map page; main's renders none and ignores a renderer.
const fakeRenderPage = () => ppmWithRed(100);

// The headings and map-page words the first job's definition names
// (itemHeadings, mapPageText), one heading to a line as the exports print them.
const HEADINGS: Record<string, string[]> = {
  "safety-action-plan": ["Crash summary", "Countermeasures", "Benefit-cost summary", "Engagement summary"],
  "ss4a-application": ["Appendix B. Crash summary", "Appendix C. Countermeasures", "Appendix D. Benefit-cost summary", "Appendix E. Engagement summary"],
};
const MAP_TEXT: Record<string, string> = { "safety-action-plan": "High-injury network map", "ss4a-application": "Source severity coverage" };

function syntheticPdf(role: string, kind: string, extra = ""): string {
  const [crash, countermeasures, bca, engagement] = HEADINGS[kind];
  return [
    `%PDF-1.4 synthetic test file for the proven job checker, not a real PDF\n${kind} for the ${role} journey\n${crash}\nSynthetic counts`,
    MAP_TEXT[kind],
    `${countermeasures}\n${bca}\n${engagement}${extra}`,
  ].join("\f");
}

for (const entry of EXAMPLE.journeys) {
  for (const pdf of entry.pdfs) {
    mkdirSync(join(jobRoot, dirname(pdf.path)), { recursive: true });
    writeFileSync(join(jobRoot, pdf.path), syntheticPdf(entry.role, pdf.kind));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a record under test is deliberately untyped JSON
type Json = any;
const proven = (): Json => structuredClone(EXAMPLE);
const journey = (record: Json, role: string) => record.journeys.find((entry: Json) => entry.role === role);

function rewritePdf(record: Json, role: string, kind: string, text: string) {
  const pdf = journey(record, role).pdfs.find((entry: Json) => entry.kind === kind);
  const sha256 = createHash("sha256").update(text).digest("hex");
  pdf.path = pdf.path.replace(/\.pdf$/, `-${sha256.slice(0, 8)}.pdf`);
  writeFileSync(join(jobRoot, pdf.path), text);
  pdf.sha256 = sha256;
  pdf.bytes = Buffer.byteLength(text);
}
const withPage3 = (role: string, kind: string, page3: string) => syntheticPdf(role, kind).replace(/[^\f]*$/, page3);

/** The verdict of one checker call: "accepted", or the refusal text. */
function verdict(run: () => void): string {
  try {
    run();
    return "accepted";
  } catch (error) {
    return (error as Error).message;
  }
}

type Checker = Pick<typeof current, "validateProvenJobRecord">;
const recordVerdict = (checker: Checker, record: Json) =>
  verdict(() => checker.validateProvenJobRecord(structuredClone(record), { repoRoot: jobRoot, readPdfPages: fakePdfPages, renderPdfPage: fakeRenderPage }));

/** Both checkers' verdicts on one record. */
function bothOnRecord(record: Json) {
  return { main: recordVerdict(main, record), current: recordVerdict(current, record) };
}

const caseNames: string[] = [];
const named = <T extends unknown[]>(rows: T[]): T[] => {
  for (const row of rows) caseNames.push(row[0] as string);
  return rows;
};

describe("the first job's verdicts are the same before and after the rules moved into its definition", () => {
  it("accepts the committed synthetic example in both", () => {
    expect(bothOnRecord(proven())).toEqual({ main: "accepted", current: "accepted" });
  });

  it("accepts a report page that answers 404, without the 200 limit, in both", () => {
    const record = proven();
    record.crossWorkspace.checks[0] = { target: "safety-action-plan", request: "report-page", kind: "page", status: 404, contentReturned: false };
    record.limits = record.limits.filter((limit: Json) => limit.id !== "report-page-answers-200-with-not-found-screen");
    expect(bothOnRecord(record)).toEqual({ main: "accepted", current: "accepted" });
  });

  it.each(named<[string, (record: Json) => void, RegExp]>([
    ["a preview origin", (r) => { r.baseUrl = "https://openplan-git-work-natford.vercel.app"; }, /not the hosted origin/],
    ["a local origin", (r) => { r.baseUrl = "https://localhost:3450"; }, /not the hosted origin/],
    ["a short commit", (r) => { r.commit = "0123456789ab"; }, /record\.commit is not in the expected form/],
    ["a health readback from another commit", (r) => { journey(r, "tribal-area").health[1].commit = "fedcba987654"; }, /tribal-area journey end health readback reports commit fedcba987654/],
    ["a health readback shorter than 12 characters", (r) => { journey(r, "nevada-county").health[0].commit = "0123456"; }, /nevada-county journey start health readback/],
    ["a journey without an end readback", (r) => { journey(r, "nevada-county").health[1].point = "start"; }, /exactly one start health readback/],
    ["a missing PDF", (r) => { journey(r, "nevada-county").pdfs[0].path = "docs/product/capability-evidence/missing.pdf"; }, /evidence file is missing/],
    ["a changed PDF hash", (r) => { journey(r, "nevada-county").pdfs[1].sha256 = "0".repeat(64); }, /evidence hash changed/],
    ["a PDF missing from a journey", (r) => { journey(r, "california-county").pdfs.pop(); }, /needs exactly one ss4a-application PDF, found 0/],
    ["a PDF the record calls DRAFT", (r) => { journey(r, "california-county").pdfs[0].draftStamp = true; }, /stamped DRAFT/],
    ["a PDF whose text carries a DRAFT stamp", (r) => rewritePdf(r, "california-county", "ss4a-application", syntheticPdf("california-county", "ss4a-application", "\nDRAFT: 2 required attachment(s) outstanding")), /ss4a-application PDF page 3 carries a DRAFT stamp/],
    ["a missing required item", (r) => { const pdf = journey(r, "tribal-area").pdfs[0]; pdf.items = pdf.items.filter((item: Json) => item.item !== "bca"); }, /must find bca exactly once, found 0/],
    ["an item whose text is not on its page", (r) => { journey(r, "tribal-area").pdfs[1].items[4].page = 1; }, /engagement-summary text is not on page 1/],
    ["a map found by text instead of a page image", (r) => { const map = journey(r, "tribal-area").pdfs[1].items[0]; Object.assign(map, { method: "pdftotext", text: "map" }); delete map.imageSha256; }, /high-injury-map must be found by page-image/],
    ["a wrong page count", (r) => { journey(r, "tribal-area").pdfs[0].pages = 4; }, /has 3 pages, record says 4/],
    ["one serious accessibility violation", (r) => { journey(r, "nevada-county").screens[3].axe.serious = 1; }, /safety at 390 px dark has 1 serious and 0 critical/],
    ["one critical violation at desktop width", (r) => { journey(r, "california-county").screens[0].axe.critical = 1; }, /safety at 1440 px light has 0 serious and 1 critical/],
    ["a screen not checked at 390 px in dark mode", (r) => { journey(r, "nevada-county").screens.splice(3, 1); }, /safety has no check at 390 px dark/],
    ["zero stored crashes in Nevada", (r) => { journey(r, "nevada-county").crashes.storedCount = 0; }, /nevada-county journey stored 0 crashes; at least 1 required/],
    ["Nevada crashes from a California source", (r) => { journey(r, "nevada-county").crashes.sourceId = "ccrs-ca"; }, /nevada-county journey crashes come from ccrs-ca, not fars-national/],
    ["a tribal journey run on a county", (r) => { Object.assign(journey(r, "tribal-area").place, { kind: "county", geoid: "32997" }); }, /tribal-area journey must be a place of kind aiannh, found county/],
    ["a California journey run in Nevada", (r) => { Object.assign(journey(r, "california-county").place, { geoid: "32997", stateFips: ["32"] }); }, /california-county journey must be in the state with FIPS 06/],
    ["a tribal area with a county id", (r) => { journey(r, "tribal-area").place.geoid = "32997"; }, /geoid 32997 is not a aiannh Census id/],
    ["a missing journey", (r) => { r.journeys = r.journeys.filter((entry: Json) => entry.role !== "tribal-area"); }, /exactly one tribal-area journey, found 0/],
    ["an unnamed executor", (r) => { journey(r, "california-county").executor.model = "  "; }, /executor\.model is blank/],
    ["an unknown confirmation method", (r) => { journey(r, "california-county").confirmationMethod = "magic_link"; }, /must be one of email_link, operator_relay, admin_generate_link/],
    ["an unknown journey field", (r) => { journey(r, "california-county").confirmationLink = "kept out"; }, /has unknown field confirmationLink/],
    ["an unknown top-level field", (r) => { r.cookies = []; }, /record has unknown field cookies/],
    ["an unsaved benefit-cost analysis", (r) => { journey(r, "california-county").bcaSaved = false; }, /did not save a benefit-cost analysis/],
    ["another workspace's report served", (r) => { r.crossWorkspace.checks[1] = { target: "safety-action-plan", request: "report-pdf-download", kind: "data", status: 200, contentReturned: true }; }, /returned content \(status 200\)/],
    ["a missing cross-workspace check", (r) => { r.crossWorkspace.checks = r.crossWorkspace.checks.filter((c: Json) => c.target !== "ss4a-application"); }, /cross-workspace check for ss4a-application is missing/],
    ["a server error counted as a cross-workspace refusal", (r) => { r.crossWorkspace.checks[0].status = 500; }, /safety-action-plan answered status 500, which is inconclusive/],
    ["an unavailable service counted as a cross-workspace refusal", (r) => { r.crossWorkspace.checks[3].status = 503; }, /ss4a-application answered status 503, which is inconclusive/],
    // KI-2026-11-14-060, the lead's decision: page and data checks differ.
    ["a page answering 200 without the not-found screen", (r) => { r.crossWorkspace.checks[0].notFoundRendered = false; }, /report-page for another workspace's safety-action-plan answered 200 without the journey reading the not-found screen/],
    ["a page answering 200 that carries the first account's text", (r) => { r.crossWorkspace.checks[0].recordTextFound = true; }, /answered 200 and the journey found the first account's text on it/],
    ["a page answering 200 whose text was not searched", (r) => { delete r.crossWorkspace.checks[0].recordTextFound; }, /answered 200 and the journey found the first account's text on it, or did not look/],
    ["a page answering 200 with two strings searched", (r) => { const page = r.crossWorkspace.checks[0]; page.searchedStringSha256 = page.searchedStringSha256.slice(0, 2); page.searchedStringCount = 2; }, /searched 2 identifying strings; at least 3 required/],
    ["a page answering 200 with one string hashed twice", (r) => { const page = r.crossWorkspace.checks[0]; page.searchedStringSha256[3] = page.searchedStringSha256[0]; }, /one distinct hash per identifying string/],
    ["a page answering 200 whose hash list disagrees with its count", (r) => { r.crossWorkspace.checks[0].searchedStringCount = 5; }, /one distinct hash per identifying string/],
    ["a data request answering 200 with no content", (r) => { r.crossWorkspace.checks[3].status = 200; }, /data request application-pdf-download for another workspace's ss4a-application answered status 200, which is inconclusive/],
    ["a data request answering 200 that claims the not-found screen", (r) => { Object.assign(r.crossWorkspace.checks[1], { status: 200, notFoundRendered: true, recordTextFound: false, searchedStringSha256: r.crossWorkspace.checks[0].searchedStringSha256, searchedStringCount: 4 }); }, /data request report-pdf-download .* answered status 200, which is inconclusive/],
    ["a target held only by a page check", (r) => { r.crossWorkspace.checks = r.crossWorkspace.checks.filter((c: Json) => c.target !== "safety-action-plan" || c.kind === "page"); }, /checks for safety-action-plan need its report-pdf-download refused as a data check/],
    ["an application held only by its read, not its download", (r) => { r.crossWorkspace.checks = r.crossWorkspace.checks.filter((c: Json) => c.request !== "application-pdf-download"); }, /checks for ss4a-application need its application-pdf-download refused as a data check/],
    ["a download recorded as a page check", (r) => { for (const c of r.crossWorkspace.checks) if (c.request === "report-pdf-download") c.kind = "page"; }, /need its report-pdf-download refused as a data check/],
    ["a page answering 200 without its stated limit", (r) => { r.limits = r.limits.filter((limit: Json) => limit.id !== "report-page-answers-200-with-not-found-screen"); }, /does not state the report-page-answers-200-with-not-found-screen limit/],
    ["a check without a kind", (r) => { delete r.crossWorkspace.checks[2].kind; }, /record\.crossWorkspace\.checks\[2\] is missing kind/],
    ["a signed-out second account counted as a cross-workspace refusal", (r) => { r.crossWorkspace.checks[0].status = 401; }, /answered status 401, which is inconclusive/],
    ["a rejected export payload counted as a cross-workspace refusal", (r) => { r.crossWorkspace.checks[1].status = 422; }, /answered status 422, which is inconclusive/],
    ["a source check that found different counts", (r) => { r.sourceCheck = { status: "differs", checkedOn: "2026-11-21", url: "https://example.gov/query", note: "Counts differ." }; }, /finding, not a pass/],
    ["an unstated limit", (r) => { r.limits = r.limits.filter((limit: Json) => limit.id !== "fars-is-fatal-only"); }, /does not state the fars-is-fatal-only limit/],
    ["an unconfirmed crash count without its limit", (r) => { r.limits = r.limits.filter((limit: Json) => limit.id !== "crash-counts-not-independently-confirmed"); }, /crash-counts-not-independently-confirmed limit/],
  ]))("refuses %s the same way in both", (_name, mutate, reason) => {
    const record = proven();
    mutate(record);
    const result = bothOnRecord(record);
    expect(result.main).toMatch(reason);
    expect(result.current).toBe(result.main);
  });

  it.each(named<[string, string, RegExp]>([
    ["an email address", "Prepared by planner@example.org", /contains an email address/],
    ["a plus-address", "Account planner+journey3@example.org", /contains a plus-address/],
    ["a JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJl", /contains a JWT/],
    ["a provider token", "sk-ant-api03-SYNTHETICSYNTHETIC", /contains a token/],
    ["an OpenAI project key", "sk-proj-SYNTHETICSYNTHETIC0123", /contains a token/],
    ["a bare sk- key", "sk-SYNTHETICSYNTHETIC0123", /contains a token/],
    ["a sign-in link", "https://project.supabase.co/auth/v1/verify?type=signup", /contains a token or sign-in link/],
    ["a password", "password: correct-horse", /contains a password/],
    ["a cookie", "sb-project-auth-token", /contains a cookie/],
  ]))("refuses a text field holding %s the same way in both", (_name, value, reason) => {
    const record = proven();
    record.limits[0].text = value;
    const result = bothOnRecord(record);
    expect(result.main).toMatch(reason);
    expect(result.current).toBe(result.main);
  });

  it("finds an item heading that reads back letter-spaced in both", () => {
    const record = proven();
    rewritePdf(record, "tribal-area", "safety-action-plan", withPage3("tribal-area", "safety-action-plan",
      "C O U N T E R M E A S U R E S\nB E N E F I T- C O S T S U M M A RY\nE N G A G E M E N T S U M M A RY"));
    expect(bothOnRecord(record)).toEqual({ main: "accepted", current: "accepted" });
  });

  it.each(named<[string, string]>([
    ["part of a longer word", "Countermeasures\nBenefit-cost summary\nEngagement summaryless"],
    ["two cells across a column gap", "Countermeasures\nBenefit-cost summary\nEngagement      summary"],
    ["a phrase split by a blank line", "Countermeasures\nBenefit-cost summary\nEngagement\n\nsummary"],
  ]))("refuses item text found only as %s the same way in both", (_name, page3) => {
    const record = proven();
    rewritePdf(record, "tribal-area", "safety-action-plan", withPage3("tribal-area", "safety-action-plan", page3));
    const result = bothOnRecord(record);
    expect(result.main).toMatch(/tribal-area journey safety-action-plan PDF engagement-summary text is not on page 3/);
    expect(result.current).toBe(result.main);
  });

  it("refuses a DRAFT stamp that reads back letter-spaced the same way in both", () => {
    const record = proven();
    rewritePdf(record, "california-county", "ss4a-application", syntheticPdf("california-county", "ss4a-application", "\nD R A F T: 2 required attachment(s) outstanding"));
    const result = bothOnRecord(record);
    expect(result.main).toMatch(/ss4a-application PDF page 3 carries a DRAFT stamp/);
    expect(result.current).toBe(result.main);
  });

  it("refuses a PDF page holding an email address the same way in both", () => {
    const record = proven();
    rewritePdf(record, "tribal-area", "ss4a-application", syntheticPdf("tribal-area", "ss4a-application", "\nFinalized by planner@example.org"));
    const result = bothOnRecord(record);
    expect(result.main).toMatch(/tribal-area journey ss4a-application PDF page 3 contains an email address/);
    expect(result.current).toBe(result.main);
  });

  it.each(named<[string, string]>([
    ["an OpenAI project key", "sk-proj-SYNTHETICSYNTHETIC0123"],
    ["a bare sk- key", "sk-SYNTHETICSYNTHETIC0123"],
  ]))("refuses a PDF page holding %s the same way in both", (_name, value) => {
    const record = proven();
    rewritePdf(record, "nevada-county", "safety-action-plan", syntheticPdf("nevada-county", "safety-action-plan", `\nModel key ${value}`));
    const result = bothOnRecord(record);
    expect(result.main).toMatch(/nevada-county journey safety-action-plan PDF page 3 contains a token/);
    expect(result.current).toBe(result.main);
  });

  it("refuses every token prefix the error-report sanitizer scrubs the same way in both", () => {
    const source = stripSourceComments(
      readFileSync(fileURLToPath(new URL("../lib/observability/error-report.ts", import.meta.url)), "utf8"),
    );
    const prefixesFor = (label: string): string[] => {
      const group = source.split("\n").find((line) => line.includes(`"[${label}]"`))?.match(/\(\?:([^)]*)\)/)?.[1];
      if (!group) throw new Error(`no sanitizer prefix group for [${label}]`);
      return group.split("|");
    };
    const samples = [
      ...prefixesFor("secret").map((prefix) => `${prefix}SYNTHETIC0123456789`),
      ...prefixesFor("mapbox-token").map((prefix) => `${prefix}.eyJSYNTHETIC0123.SYNTHETIC0123`),
    ];
    expect(samples.length).toBeGreaterThanOrEqual(9);
    for (const sample of samples) {
      const record = proven();
      record.limits[0].text = `Value ${sample}`;
      const result = bothOnRecord(record);
      expect(result.main, sample).toMatch(/record\.limits\[0\]\.text contains a token/);
      expect(result.current, sample).toBe(result.main);
    }
  });
});

describe("the first job's registry verdicts are the same in both checkers", () => {
  const recordPath = "docs/product/capability-evidence/synthetic-example/record.json";

  function registryWith(record: Json) {
    const text = `${JSON.stringify(record, null, 2)}\n`;
    mkdirSync(join(jobRoot, dirname(recordPath)), { recursive: true });
    writeFileSync(join(jobRoot, recordPath), text);
    return {
      reviewedAt: "2026-11-01",
      dimensions: { planner: [{ id: "unproven", status: "partial" }] },
      provenJobs: [{
        jobId: record.jobId,
        places: record.journeys.map(({ place }: Json) => ({ kind: place.kind, geoid: place.geoid, stateFips: place.stateFips })),
        commit: record.commit,
        reviewedAt: "2026-11-20",
        evidence: [{ path: recordPath, sha256: createHash("sha256").update(text).digest("hex") }],
      }],
    };
  }
  const both = (registry: Json) => ({
    main: verdict(() => main.validateCapabilityEvidence(structuredClone(registry), jobRoot, "2026-11-21", { readPdfPages: fakePdfPages })),
    current: verdict(() => current.validateCapabilityEvidence(structuredClone(registry), jobRoot, "2026-11-21", { readPdfPages: fakePdfPages, renderPdfPage: fakeRenderPage })),
  });

  it("accepts an empty list and an entry whose record passes, in both", () => {
    expect(both({ reviewedAt: "2026-11-01", dimensions: {}, provenJobs: [] })).toEqual({ main: "accepted", current: "accepted" });
    expect(both(registryWith(proven()))).toEqual({ main: "accepted", current: "accepted" });
  });

  it.each(named<[string, (registry: Json) => void, RegExp]>([
    ["a list that is not a list", (g) => { g.provenJobs = {}; }, /provenJobs must be a list/],
    ["an unknown entry field", (g) => { g.provenJobs[0].status = "proven"; }, /has unknown field status/],
    ["a commit other than the record's", (g) => { g.provenJobs[0].commit = "f".repeat(40); }, /commit does not match its record/],
    ["places other than the record's", (g) => { g.provenJobs[0].places.reverse(); }, /places do not match/],
    ["a future review date", (g) => { g.provenJobs[0].reviewedAt = "2026-11-22"; }, /valid review date/],
    ["a changed record", (g) => { g.provenJobs[0].evidence[0].sha256 = "0".repeat(64); }, /evidence hash changed/],
    ["no record among the evidence", (g) => { g.provenJobs[0].evidence = [{ path: EXAMPLE.journeys[0].pdfs[0].path, sha256: EXAMPLE.journeys[0].pdfs[0].sha256 }]; }, /exactly one openplan\.proven_job_record\.v1 record among its evidence, found 0/],
    ["a job listed twice", (g) => { g.provenJobs.push({ ...g.provenJobs[0] }); }, /is listed twice/],
  ]))("refuses %s the same way in both", (_name, mutate, reason) => {
    const registry = registryWith(proven());
    mutate(registry);
    const result = both(registry);
    expect(result.main).toMatch(reason);
    expect(result.current).toBe(result.main);
  });

  it("refuses an entry whose record the checker refuses, the same way in both", () => {
    const record = proven();
    record.baseUrl = "https://openplan-git-work-natford.vercel.app";
    const result = both(registryWith(record));
    expect(result.main).toMatch(/not the hosted origin/);
    expect(result.current).toBe(result.main);
  });
});

describe("the frozen comparison stays complete", () => {
  // Every row of every case table in capability-evidence.test.ts, by name.
  // A case added there and not here fails this test.
  it("compares every case capability-evidence.test.ts runs", () => {
    const source = stripSourceComments(readFileSync(fileURLToPath(new URL("./capability-evidence.test.ts", import.meta.url)), "utf8"));
    const theirs = [...source.matchAll(/^\s*\["([^"]+)",/gm)].map((match) => match[1]).sort();
    expect(theirs.length).toBeGreaterThanOrEqual(70);
    expect([...caseNames].sort()).toEqual(theirs);
  });

  it("holds main's checker, schema and definitions byte for byte as they were at 1fbfe95ed", () => {
    const sha = (path: string) =>
      createHash("sha256").update(readFileSync(fileURLToPath(new URL(path, import.meta.url)))).digest("hex");
    const frozen = "./fixtures/proven-job-checker-main-1fbfe95ed/";
    expect({
      checker: sha(`${frozen}openplan/scripts/ops/capability-evidence.mjs`),
      schema: sha(`${frozen}schemas/proven_job_record.v1.schema.json`),
      definitions: sha(`${frozen}schemas/proven_job_definitions.v1.json`),
    }).toEqual({
      checker: "4504f61021bb4782963c6a5bc51b74c17b137b384563afbf038bcd43f29d5b94",
      schema: "1ef83f1ec0292fe71767895623fa27d5ff37eb5025922f83e6e64bf010f8b139",
      definitions: "502a5cce19c0f4facfc8e6bd7e42f6ffc67740991d164ec0704d208dc9f393ea",
    });
  });
});
