// @vitest-environment node
/**
 * The engagement job's checker on a copy of lane 53's rehearsal record and
 * its real review files (fixtures/engagement-rehearsal-lane53, see its
 * README). The county journey's four files are the bytes the local app
 * exported; the town and tribal files are stand-ins holding the real files'
 * pdftotext pages and workbook cells. The record is refused for its local
 * origin and accepted with the hosted origin in its place; each change below
 * is then refused for the stated reason (KI-2026-11-14-370, -371).
 *
 * Blind category: one rehearsal, one county journey's real bytes. A review
 * file the export writes differently in another place, or on the hosted
 * worker, is not covered here.
 */
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROOF_ORIGIN, pdftotextPages, validateProvenJobRecord, xlsxSheets } from "../../scripts/ops/capability-evidence.mjs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a record under test is deliberately untyped JSON
type Json = any;
type Sheets = Record<string, unknown[][]>;

const FIXTURE = fileURLToPath(new URL("./fixtures/engagement-rehearsal-lane53/", import.meta.url));
const RECORD = JSON.parse(readFileSync(join(FIXTURE, "record.json"), "utf8"));
const XLSX = createRequire(import.meta.url)("xlsx");

// Each test writes its changed files into its own copy of the fixture folder.
const root = mkdtempSync(join(tmpdir(), "openplan-engagement-rehearsal-"));
cpSync(FIXTURE, root, { recursive: true });

const STAND_IN = /^(%PDF-1\.4|PK\u0003\u0004) stand-in/;
const isStandIn = (path: string) => STAND_IN.test(readFileSync(path, "latin1").slice(0, 40));
const body = (path: string) => readFileSync(path, "utf8").split("\n").slice(2).join("\n");
const readPdfPages = (path: string): string[] => (isStandIn(path) ? body(path).split("\f") : pdftotextPages(path));
const readWorkbook = (path: string): Sheets => (isStandIn(path) ? JSON.parse(body(path)) : xlsxSheets(path));
const check = (record: Json, pages = readPdfPages) => validateProvenJobRecord(record, { repoRoot: root, readPdfPages: pages, readWorkbook });

const hosted = (): Json => ({ ...structuredClone(RECORD), baseUrl: PROOF_ORIGIN });
const county = (record: Json) => record.journeys.find((entry: Json) => entry.role === "county");
const entryOf = (record: Json, list: "pdfs" | "workbooks", kind: string) => county(record)[list].find((entry: Json) => entry.kind === kind);
const rejectedText: string = county(RECORD).campaign.rejectedTexts[0];
const rejectedId: string = county(RECORD).campaign.moderation.find((entry: Json) => entry.outcome === "rejected").commentId;

/** Write changed bytes under a new name and re-pin the entry, so only the rule under test can refuse it. */
function repin(entry: Json, bytes: Buffer, pages?: number) {
  const digest = createHash("sha256").update(bytes).digest("hex");
  entry.path = entry.path.replace(/(\.\w+)$/, `-${digest.slice(0, 8)}$1`);
  writeFileSync(join(root, entry.path), bytes);
  entry.sha256 = digest;
  entry.bytes = bytes.length;
  if (pages !== undefined) entry.pages = pages;
}

/** A changed copy of a real county workbook, written with SheetJS, the library that writes the export. */
function changeWorkbook(record: Json, kind: string, change: (book: Json) => void) {
  const entry = entryOf(record, "workbooks", kind);
  const book = XLSX.read(readFileSync(join(root, entry.path)), { type: "buffer" });
  change(book);
  repin(entry, XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
}

/** Set one Summary row's count by its label. */
const setSummary = (label: string, value: number) => (book: Json) => {
  const rows: unknown[][] = XLSX.utils.sheet_to_json(book.Sheets.Summary, { header: 1, defval: "" });
  const row = rows.findIndex((cells) => cells[0] === label);
  expect(row, label).toBeGreaterThan(0);
  XLSX.utils.sheet_add_aoa(book.Sheets.Summary, [[value]], { origin: `B${row + 1}` });
};

/** A copy of one county file in another kind's place. */
function swapFile(record: Json, list: "pdfs" | "workbooks", into: string, from: string) {
  const source = entryOf(record, list, from);
  const target = entryOf(record, list, into);
  const bytes = readFileSync(join(root, source.path));
  repin(target, bytes, source.pages);
}

describe("lane 53's engagement rehearsal record", () => {
  it("is refused for its local origin and for nothing else", () => {
    expect(RECORD.baseUrl).toMatch(/^http:\/\/localhost:/);
    expect(() => check(structuredClone(RECORD))).toThrow(/record\.baseUrl is not in the expected form/);
    expect(() => check(hosted())).not.toThrow();
  });

  it("reads the county journey's real files, not stand-ins", () => {
    for (const entry of [...county(RECORD).pdfs, ...county(RECORD).workbooks]) expect(isStandIn(join(root, entry.path)), entry.path).toBe(false);
    expect(rejectedText).toMatch(/represents no one/);
  });
});

describe("the checker refuses a changed copy of the rehearsal record", () => {
  it.each<[string, (record: Json) => void, RegExp]>([
    // The internal workbook's Summary rows (KI-2026-11-14-371).
    ["a Summary row changed", (r) => changeWorkbook(r, "campaign-review", setSummary("Approved", 4)), /county journey campaign-review workbook Summary Approved is 4; its own Contributions cells give 3/],
    ["a Summary received row changed", (r) => changeWorkbook(r, "campaign-review", setSummary("Received", 5)), /Summary Received is 5; its own Contributions cells give 4/],
    ["a Summary answered row changed", (r) => changeWorkbook(r, "campaign-review", setSummary("Answered by a published staff response", 1)), /Summary Answered by a published staff response is 1; its own Staff responses cells give 2/],
    // The public copy.
    ["the public PDF swapped for the internal one", (r) => swapFile(r, "pdfs", "campaign-review-public", "campaign-review"), /campaign-review-public PDF holds rejected text 1 at page \d+/],
    ["the public workbook swapped for the internal one", (r) => swapFile(r, "workbooks", "campaign-review-public", "campaign-review"), /campaign-review-public workbook holds rejected text 1 at sheet Contributions cell/],
    ["a public workbook holding a rejected row", (r) => changeWorkbook(r, "campaign-review-public", (book) => {
      const header: string[] = XLSX.utils.sheet_to_json(book.Sheets.Contributions, { header: 1 })[0];
      const row = header.map((name) => ({ id: "00000000-0000-4000-8000-000000000999", status: "rejected", body: rejectedText })[name as "id"] ?? "");
      XLSX.utils.sheet_add_aoa(book.Sheets.Contributions, [row], { origin: -1 });
    }), /campaign-review-public workbook holds rejected text 1 at sheet Contributions cell/],
    ["a public workbook holding a withheld row", (r) => changeWorkbook(r, "campaign-review-public", (book) => {
      const rows: string[][] = XLSX.utils.sheet_to_json(book.Sheets.Contributions, { header: 1, defval: "" });
      XLSX.utils.sheet_add_aoa(book.Sheets.Contributions, [["rejected"]], { origin: { r: 1, c: rows[0].indexOf("status") } });
    }), /campaign-review-public workbook Contributions row for [0-9a-f-]{36} has status rejected; a public copy holds approved rows only/],
    ["a public workbook naming the rejected comment's id", (r) => changeWorkbook(r, "campaign-review-public", (book) => {
      XLSX.utils.sheet_add_aoa(book.Sheets["Read me"], [["Note", rejectedId]], { origin: -1 });
    }), new RegExp(`campaign-review-public workbook holds the id of rejected comment ${rejectedId} at sheet Read me`)],
    ["a public Summary with a withheld count", (r) => changeWorkbook(r, "campaign-review-public", (book) => {
      XLSX.utils.sheet_add_aoa(book.Sheets.Summary, [["Withheld", 1]], { origin: -1 });
    }), /campaign-review-public workbook Summary has a Withheld row, which a public copy leaves out/],
    ["a public Summary approved count changed", (r) => changeWorkbook(r, "campaign-review-public", setSummary("Approved", 2)), /campaign-review-public workbook Summary Approved is 2; the journey's approved count is 3/],
    // The internal files, where the search must find the text it looks for.
    ["the internal PDF swapped for the public one", (r) => swapFile(r, "pdfs", "campaign-review", "campaign-review-public"), /county journey campaign-review PDF does not hold rejected text 1, which it prints/],
    ["the internal workbook without the rejected comment's text", (r) => changeWorkbook(r, "campaign-review", (book) => {
      const rows: string[][] = XLSX.utils.sheet_to_json(book.Sheets.Contributions, { header: 1, defval: "" });
      const row = rows.findIndex((cells) => cells.includes(rejectedText));
      XLSX.utils.sheet_add_aoa(book.Sheets.Contributions, [["Withheld"]], { origin: { r: row, c: rows[row].indexOf(rejectedText) } });
    }), /campaign-review workbook does not hold rejected text 1, which it prints/],
    // The record's own text and hash.
    ["a rejected text that does not match its hash", (r) => { county(r).campaign.rejectedTexts = ["Another comment. It represents no one."]; }, /county journey rejected text 1 does not match its hash/],
    ["no rejected text", (r) => { county(r).campaign.rejectedTexts = []; }, /county journey must hold each rejected comment's text beside its hash/],
    ["a record without the public PDF", (r) => { county(r).pdfs = county(r).pdfs.filter((p: Json) => p.kind !== "campaign-review-public"); }, /county journey needs exactly one campaign-review-public PDF, found 0/],
    // The two staff reads (KI-2026-11-14-370), for the participant and for a second account.
    ...(["campaign-export-read", "rejected-item-history-read"] as const).flatMap((request): Array<[string, (record: Json) => void, RegExp]> => [
      [`${request} answering 200 to the participant`, (r) => { r.participantChecks.refusals.find((c: Json) => c.request === request).status = 200; }, new RegExp(`public participant request ${request} answered status 200, which is inconclusive`)],
      [`${request} answering 405 to the participant`, (r) => { r.participantChecks.refusals.find((c: Json) => c.request === request).status = 405; }, new RegExp(`public participant request ${request} answered status 405, which is inconclusive`)],
      [`${request} missing from the participant checks`, (r) => { r.participantChecks.refusals = r.participantChecks.refusals.filter((c: Json) => c.request !== request); }, new RegExp(`public participant check ${request} is missing`)],
      [`${request} answering 200 to a second account`, (r) => { r.crossWorkspace.checks.find((c: Json) => c.request === request).status = 200; }, new RegExp(`${request} for another workspace's .* answered status 200, which is inconclusive`)],
      [`${request} missing from one journey's second-account checks`, (r) => { r.crossWorkspace.checks = r.crossWorkspace.checks.filter((c: Json) => !(c.request === request && c.journey === "tribal-area")); }, new RegExp(`the tribal-area journey needs exactly one ${request} data check`)],
    ]),
  ])("%s", (_name, change, reason) => {
    const record = hosted();
    change(record);
    expect(() => check(record)).toThrow(reason);
  });

  it("refuses the internal PDF read without the rejected text, so a search that cannot find it fails", () => {
    // A PDF's text cannot be edited in place, so the reader returns the real
    // pages with one word of the rejected comment removed.
    const internal = join(root, entryOf(RECORD, "pdfs", "campaign-review").path);
    const word = rejectedText.split(" ").find((token) => token.length > 4) as string;
    const pages = (path: string) => readPdfPages(path).map((page) => (path === internal ? page.replaceAll(word, "") : page));
    expect(() => check(hosted(), pages)).toThrow(/county journey campaign-review PDF does not hold rejected text 1, which it prints/);
  });

  it("refuses a public PDF whose pages hold the rejected text", () => {
    const publicPdf = join(root, entryOf(RECORD, "pdfs", "campaign-review-public").path);
    const pages = (path: string) => readPdfPages(path).map((page, index) => (path === publicPdf && index === 1 ? `${page}\n${rejectedText}` : page));
    expect(() => check(hosted(), pages)).toThrow(/campaign-review-public PDF holds rejected text 1 at page 2/);
  });
});
