// @vitest-environment node
/**
 * Lane 65 (November 16, 2026): a first-job record dated on or after
 * 2026-11-16 must carry, for each journey, the run's mode (proof), the close
 * of its public comment campaign (read the way the engagement job's close is
 * read) and the harness checkout it ran from (clean). The rule is the first
 * job's `newRecordRules` in schemas/proven_job_definitions.v1.json, read by
 * checkNewRecordRules in scripts/ops/capability-evidence.mjs. The record of
 * November 14 predates these fields and stays accepted
 * (first-proven-job-record-accepted.test.ts); the synthetic example is dated
 * that day too.
 *
 * Each case changes one thing in a copy of the synthetic example, read with
 * the same stand-in PDFs capability-evidence.test.ts writes. The last case
 * runs the committed record itself, re-dated, with its real PDFs.
 *
 * Blind category: recordedOn is the assembler's statement. A new record
 * given an earlier date escapes the rule; the registry's pinned bytes and
 * review date are what tie a record to when it was made. The close values
 * are the journey's readings of live screens, which the checker cannot read
 * again.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ppmWithRed } from "./helpers/ppm";
import { validateProvenJobRecord } from "../../scripts/ops/capability-evidence.mjs";
import { pdfToolVersion } from "../../scripts/lib/poppler-text.mjs";

const EXAMPLE = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../schemas/examples/proven_job_record.v1.synthetic.json", import.meta.url)), "utf8"),
);
const DEFINITIONS = JSON.parse(readFileSync(fileURLToPath(new URL("../../../schemas/proven_job_definitions.v1.json", import.meta.url)), "utf8"));
const jobRoot = mkdtempSync(join(tmpdir(), "openplan-first-job-new-rules-"));
const fakePdfPages = (path: string) => readFileSync(path, "utf8").replace(/^[^\n]*\n/, "").split("\f");
const fakeRenderPage = () => ppmWithRed(100);

const HEADINGS: Record<string, string[]> = {
  "safety-action-plan": ["Crash summary", "Countermeasures", "Benefit-cost summary", "Engagement summary"],
  "ss4a-application": ["Appendix B. Crash summary", "Appendix C. Countermeasures", "Appendix D. Benefit-cost summary", "Appendix E. Engagement summary"],
};
const MAP_TEXT: Record<string, string> = { "safety-action-plan": "High-injury network map", "ss4a-application": "Source severity coverage" };

function syntheticPdf(role: string, kind: string): string {
  const [crash, countermeasures, bca, engagement] = HEADINGS[kind];
  return [
    `%PDF-1.4 synthetic test file for the proven job checker, not a real PDF\n${kind} for the ${role} journey\n${crash}\nSynthetic counts`,
    MAP_TEXT[kind],
    `${countermeasures}\n${bca}\n${engagement}`,
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
const check = (record: Json) => validateProvenJobRecord(record, { repoRoot: jobRoot, readPdfPages: fakePdfPages, renderPdfPage: fakeRenderPage });
const journey = (record: Json, role: string) => record.journeys.find((entry: Json) => entry.role === role);

const CLOSE = {
  attempted: true,
  closed: true,
  saveStatus: 200,
  statusAfter: "closed",
  addresses: [
    { name: "portal", status: 200, endedNoticeShown: true, campaignTextFound: false },
    { name: "about", status: 200, endedNoticeShown: true, campaignTextFound: false },
  ],
  publicReadAfter: { status: 404 },
  endedAt: "2026-11-16T18:05:00Z",
};

/** The example as a record assembled on 2026-11-16 from runs that carry the new fields. */
function newRecord(): Json {
  const record = structuredClone(EXAMPLE);
  record.recordedOn = "2026-11-16";
  record.journeys = record.journeys.map((entry: Json) => {
    const { role, ...rest } = entry;
    return { role, mode: "proof", ...rest, close: structuredClone(CLOSE), harness: { commit: "c".repeat(40), clean: true } };
  });
  return record;
}

describe("the first job's rules for records dated from 2026-11-16", () => {
  it("names the date and the three fields in the job's definition", () => {
    const job = DEFINITIONS.jobs.find((entry: Json) => entry.id === "safety-action-plan-and-ss4a-in-three-places");
    expect(job.newRecordRules.recordedOnOrAfter).toBe("2026-11-16");
    expect(job.newRecordRules.checkClose).toBe(true);
    expect(job.newRecordRules.journeyFields.map((rule: Json) => rule.field)).toEqual(["mode", "close.closed", "harness.clean"]);
  });

  it("accepts the example dated before the rule without the fields, and dated from it with them", () => {
    expect(EXAMPLE.recordedOn < "2026-11-16").toBe(true);
    expect(() => check(structuredClone(EXAMPLE))).not.toThrow();
    expect(() => check({ ...structuredClone(EXAMPLE), recordedOn: "2026-11-15" })).not.toThrow();
    expect(() => check(newRecord())).not.toThrow();
  });

  it("accepts the fields on a record dated before the rule, checked by the schema", () => {
    expect(() => check({ ...newRecord(), recordedOn: "2026-11-14" })).not.toThrow();
    const record = { ...newRecord(), recordedOn: "2026-11-14" };
    journey(record, "tribal-area").harness.commit = "abc";
    expect(() => check(record)).toThrow(/record\.journeys\[2\]\.harness\.commit is not in the expected form/);
  });

  it.each<[string, (record: Json) => void, RegExp]>([
    ["a journey with none of the fields", (r) => { for (const key of ["mode", "close", "harness"]) delete journey(r, "nevada-county")[key]; }, /nevada-county journey ran in undefined mode; only a proof run is proof/],
    ["a rehearsal run", (r) => { journey(r, "california-county").mode = "rehearsal"; }, /california-county journey ran in rehearsal mode; only a proof run is proof/],
    ["no close", (r) => { delete journey(r, "tribal-area").close; }, /tribal-area journey did not take its campaign offline at the end \(close\.closed is undefined\)/],
    ["a campaign left open", (r) => { journey(r, "tribal-area").close.closed = false; }, /tribal-area journey did not take its campaign offline at the end \(close\.closed is false\)/],
    ["a close whose save failed", (r) => { journey(r, "nevada-county").close.saveStatus = 500; }, /nevada-county journey campaign close was saved with status 500, not 200/],
    ["a close that read no public address", (r) => { journey(r, "nevada-county").close.addresses = []; }, /nevada-county journey read no public address after closing its campaign/],
    ["a public page still showing the campaign", (r) => { journey(r, "california-county").close.addresses[0].campaignTextFound = true; }, /california-county journey public portal address still shows the campaign's own text after the close/],
    ["public portal data still answering with the campaign", (r) => { journey(r, "california-county").close.publicReadAfter = { status: 200, campaignTextFound: true }; }, /california-county journey public portal data answered 200 after the close with the campaign's own text/],
    ["no harness checkout", (r) => { delete journey(r, "california-county").harness; }, /california-county journey names no clean harness checkout \(harness\.clean is undefined\)/],
    ["a harness checkout with changes", (r) => { journey(r, "california-county").harness.clean = false; }, /names no clean harness checkout \(harness\.clean is false\)/],
    ["an unknown harness field", (r) => { journey(r, "california-county").harness.path = "C:/Users"; }, /record\.journeys\[0\]\.harness has unknown field path/],
  ])("refuses a record dated 2026-11-16 with %s", (_name, change, reason) => {
    const record = newRecord();
    change(record);
    expect(() => check(record)).toThrow(reason);
  });
});

const REPO_ROOT = resolve(process.cwd(), "..");
const hasPoppler = ["pdftotext", "pdftoppm"].every((tool) => pdfToolVersion(tool).poppler);

describe.skipIf(!hasPoppler)("the committed first record against the date rule (needs Poppler's pdftotext and pdftoppm)", () => {
  const record = JSON.parse(readFileSync(resolve(REPO_ROOT, "docs/product/capability-evidence/first-proven-job.v1.json"), "utf8"));

  it("is dated before the rule and does not carry the fields", () => {
    expect(record.recordedOn).toBe("2026-11-14");
    for (const entry of record.journeys) for (const key of ["mode", "close", "harness"]) expect(entry).not.toHaveProperty(key);
  });

  it("would be refused if it were dated from 2026-11-16, for the missing mode", () => {
    expect(() => validateProvenJobRecord({ ...structuredClone(record), recordedOn: "2026-11-16" }, { repoRoot: REPO_ROOT })).toThrow(
      /california-county journey ran in undefined mode; only a proof run is proof/,
    );
  });
});
