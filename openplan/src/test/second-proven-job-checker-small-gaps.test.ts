// @vitest-environment node
/**
 * Lane 66 (November 16, 2026): the small checker gaps three fresh-context
 * reviews left open on the second proven job (KI-2026-11-15-041 and -043).
 * Each case is one change to a copy of the committed second record, or to a
 * copy of one of its review files, and each must be refused for its own
 * reason. The committed record and files are never written: changed files
 * go to a temporary copy of the record's folder, re-pinned in the copy.
 *
 * The rules, and the definition field each reads:
 * - executors are agents (definitions `executors`; review 64, case 25);
 * - the record's date fits its journeys (`recordedOn`; review 64, case 31);
 * - the accessibility engine and tags are the job's (`screens.axe`; review 59, S7);
 * - a limit the definition words carries those words (`limitTexts`; review 59, L2);
 * - no public workbook value holds a moderation note (review 62, N10b to N10d);
 * - a Windows line ending in the rejected text is a line ending (review 62);
 * - a participant refusal names its journey (lane 63);
 * - a required screen with a console error refuses this job's record
 *   (`screens.consoleErrorsRefused`; review 59, S6).
 *
 * Skips the checker runs where `pdftotext` on PATH is not Poppler's, as the
 * committed record's own test does. CI installs Poppler.
 *
 * Blind category: these show the rules refuse the named changes. Every value
 * they compare is still the journey's own statement; a run that wrote a
 * false record and matching false files is not caught.
 */
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateProvenJobRecord } from "../../scripts/ops/capability-evidence.mjs";
import { pdfToolVersion } from "../../scripts/lib/poppler-text.mjs";

const REPO_ROOT = resolve(process.cwd(), "..");
const FOLDER = "docs/product/capability-evidence/second-proven-job";
const RECORD_PATH = "docs/product/capability-evidence/second-proven-job.v1.json";
const XLSX = createRequire(import.meta.url)("xlsx");
const hasPoppler = pdfToolVersion("pdftotext").poppler;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the record is untyped JSON
type Json = any;
const record = (): Json => JSON.parse(readFileSync(resolve(REPO_ROOT, RECORD_PATH), "utf8"));
const journeyOf = (value: Json, role: string) => value.journeys.find((journey: Json) => journey.role === role);
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

// A copy of the record's folder, so a changed review file never touches the committed one.
const root = mkdtempSync(join(tmpdir(), "openplan-second-record-gaps-"));
cpSync(resolve(REPO_ROOT, FOLDER), join(root, FOLDER), { recursive: true });
const check = (value: Json) => validateProvenJobRecord(value, { repoRoot: root });

/** Change one county workbook with SheetJS, write it under a new name and re-pin it in the copy. */
function changeWorkbook(value: Json, kind: string, change: (book: Json) => void) {
  const entry = journeyOf(value, "county").workbooks.find((workbook: Json) => workbook.kind === kind);
  const book = XLSX.read(readFileSync(join(root, entry.path)), { type: "buffer" });
  change(book);
  const bytes: Buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  const digest = sha256(bytes);
  entry.path = entry.path.replace(/\.xlsx$/, `-${digest.slice(0, 8)}.xlsx`);
  writeFileSync(join(root, entry.path), bytes);
  entry.sha256 = digest;
  entry.bytes = bytes.length;
}

/** The internal workbook's Contributions rows, header first. */
const contributionRows = (book: Json): unknown[][] => XLSX.utils.sheet_to_json(book.Sheets.Contributions, { header: 1, defval: "" });

/** The county's moderation note for one outcome, read from its committed internal workbook. */
function moderationNote(outcome: "approved" | "rejected"): string {
  const entry = journeyOf(record(), "county").workbooks.find((workbook: Json) => workbook.kind === "campaign-review");
  const rows = contributionRows(XLSX.read(readFileSync(resolve(REPO_ROOT, entry.path)), { type: "buffer" }));
  const [header] = rows;
  const row = rows.find((cells) => cells[header.indexOf("status")] === outcome);
  return String(row?.[header.indexOf("moderation_notes")]);
}

describe.skipIf(!hasPoppler)("the second record's checker, lane 66's rules", () => {
  it("accepts the unchanged copy", () => {
    expect(() => check(record())).not.toThrow();
  });

  it.each([
    // 1. Executors are agents.
    ["a staff executor named as a person, model none (review 64, case 25)", (v: Json) => { journeyOf(v, "county").executors[0] = { role: "staff", agent: "A Planner", model: "none" }; }, /county journey staff executor is "A Planner", not an agent harness/],
    ["a known harness with the model none", (v: Json) => { journeyOf(v, "city-or-town").executors[1].model = "none"; }, /city-or-town journey public-participant executor names model "none", which is not a model id/],
    ["a model that is a name, not a model id", (v: Json) => { journeyOf(v, "tribal-area").executors[0].model = "Fable"; }, /tribal-area journey staff executor names model "Fable", which is not a model id/],
    // 2. The record's date fits its journeys (last end readback 2026-11-15T23:43:21Z).
    ["a record dated two weeks before its runs (review 64, case 31)", (v: Json) => { v.recordedOn = "2026-11-01"; }, /recordedOn 2026-11-01 is before the last journey ended/],
    ["a record dated the day before its last journey ended", (v: Json) => { v.recordedOn = "2026-11-14"; }, /recordedOn 2026-11-14 is before the last journey ended/],
    ["a record dated more than fourteen days after its runs", (v: Json) => { v.recordedOn = "2026-12-01"; }, /recordedOn 2026-12-01 is more than 14 days after the last journey ended/],
    // 3. The accessibility engine and tags are the definition's.
    ["one screen run on another engine version (review 59, S7)", (v: Json) => { journeyOf(v, "county").screens[5].axe.version = "4.10.2"; }, /ran accessibility engine 4\.10\.2 .*this job's definition names 4\.11\.1/],
    ["one screen run with fewer rule tags", (v: Json) => { journeyOf(v, "tribal-area").screens[0].axe.tags = ["wcag2a"]; }, /tribal-area journey screen portal at 1440 px light ran accessibility engine 4\.11\.1 with tags wcag2a;/],
    // 4. A limit's words are the definition's.
    ["a limit that says the opposite of its id (review 59, L2)", (v: Json) => { v.limits.find((l: Json) => l.id === "no-human-usefulness-review").text = "A planner reviewed the review files and found them useful."; }, /record's no-human-usefulness-review limit does not carry its definition's words/],
    ["a limit with one word changed", (v: Json) => { const l = v.limits.find((x: Json) => x.id === "build-named-by-the-journey"); l.text = l.text.replace("Nothing", "Little"); }, /record's build-named-by-the-journey limit does not carry its definition's words/],
    // 7. The participant refusal names the journey.
    ["a participant read answering 500 in one journey (lane 63)", (v: Json) => { v.participantChecks.refusals.find((c: Json) => c.journey === "city-or-town" && c.request === "campaign-read").status = 500; }, /city-or-town journey public participant request campaign-read answered status 500/],
    // 8. Console errors on a required screen.
    ["a required screen that logged one console error (review 59, S6)", (v: Json) => { journeyOf(v, "county").screens.find((s: Json) => s.screen === "public-response" && s.width === 390).consoleErrors = 1; }, /county journey screen public-response at 390 px \w+ logged 1 console errors/],
  ])("refuses a copy with %s", (_label, change, reason) => {
    const copy = record();
    change(copy);
    expect(() => check(copy)).toThrow(reason);
  });

  it("accepts a record dated on the last day its window allows, and a record's own added limit in other words", () => {
    const copy = record();
    copy.recordedOn = "2026-11-30";
    copy.limits.find((l: Json) => l.id === "closed-pages-read-from-the-journey-screenshots").text = "Other words: this limit is the record's own, pinned by its hash.";
    expect(() => check(copy)).not.toThrow();
  });

  // 5. A staff-only moderation note's value in a public file, under any name.
  it.each([
    ["the approved note under a column named Staff remarks", "approved", (book: Json, note: string) => {
      const rows = contributionRows(book);
      XLSX.utils.sheet_add_aoa(book.Sheets.Contributions, [["Staff remarks"], [note]], { origin: { r: 0, c: rows[0].length } });
    }, /county journey campaign-review-public workbook holds a staff-only moderation note at sheet Contributions cell/],
    ["the withheld comment's note as a Read me row", "rejected", (book: Json, note: string) => {
      XLSX.utils.sheet_add_aoa(book.Sheets["Read me"], [["Reviewer remark", note]], { origin: -1 });
    }, /county journey campaign-review-public workbook holds a staff-only moderation note at sheet Read me cell B/],
  ])("refuses a public workbook holding %s (review 62)", (_label, outcome, change, reason) => {
    const note = moderationNote(outcome as "approved" | "rejected");
    expect(note.length).toBeGreaterThan(20);
    const copy = record();
    changeWorkbook(copy, "campaign-review-public", (book) => change(book, note));
    expect(() => check(copy)).toThrow(reason);
  });

  // 6. A Windows line ending in the rejected text (review 62): the stored
  // body holds "\n" where the record's text holds "\r\n".
  it("accepts a rejected text whose line ending is \\r\\n where the workbook's is \\n, and still refuses other words", () => {
    const copy = record();
    const county = journeyOf(copy, "county");
    const original: string = county.campaign.rejectedTexts[0];
    expect(original).toContain(". Entered");
    changeWorkbook(copy, "campaign-review", (book) => {
      const rows = contributionRows(book);
      const [header] = rows;
      const index = rows.findIndex((cells) => cells[header.indexOf("body")] === original);
      expect(index).toBeGreaterThan(0);
      XLSX.utils.sheet_add_aoa(book.Sheets.Contributions, [[original.replace(". Entered", ".\nEntered")]], { origin: { r: index, c: header.indexOf("body") } });
    });
    const withText = (text: string) => {
      const value = structuredClone(copy);
      journeyOf(value, "county").campaign.rejectedTexts[0] = text;
      journeyOf(value, "county").campaign.rejectedTextSha256[0] = sha256(text);
      return value;
    };
    expect(() => check(withText(original.replace(". Entered", ".\r\nEntered")))).not.toThrow();
    expect(() => check(withText(original.replace(". Entered", ".\r\n\r\nEntered")))).toThrow(/Contributions body of rejected comment .* is not rejected text 1/);
  });
});
