// @vitest-environment node
/**
 * The fourth proven job, grant-award-to-reimbursement-record-in-three-places:
 * the checker accepts its synthetic example and refuses each way a record can
 * fall short of the lead's eleven rules (PLAN_PJ4_2026-11-16.md, addendum of
 * November 17, 2026, 06:55Z), each for that rule's own reason.
 *
 * The worksheets are text files the fixture builds with the product's own
 * code (fixtures/proven-job-award.ts): the drawdown ledger over the record's
 * requests at each download, the profile the record's place resolves, and the
 * worksheet document. A changed record is rebuilt the same way, so a copy
 * whose PDFs agree with it is refused only by the rule under test. A real PDF
 * printed by Chrome is read in proven-job-award-real-pdf.test.ts.
 *
 * The second half is the false records a hostile reviewer would try: a total
 * typed to match a wrong sum, a rejected request counted as claimed, a
 * resubmission with no link, a paid request with no date, a released amount
 * worked on the wrong basis, one worksheet standing for both downloads, a
 * member refusal with no signed-in member, a custody write recorded as
 * refused with a 200, and a limit that says the opposite of its id.
 *
 * Only the checker's own message counts as a refusal: every case must throw
 * "proven job record refused:" followed by its rule's reason.
 *
 * Blind category: these are text files laid out by this test's fixture, so
 * nothing here shows how Chrome on the hosted site wraps a line. Every status,
 * time and screen reading is the record's statement, which no test here can
 * check against the hosted site.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateProvenJobRecord } from "../../scripts/ops/capability-evidence.mjs";
import { screenFiguresAt, syntheticPdfPages, syntheticWorksheetItems, syntheticWorksheetPdfText } from "./fixtures/proven-job-award";

const read = (path: string) => JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"));
const EXAMPLE = read("../../../schemas/examples/proven_job_record.v1.award.synthetic.json");
const DEFINITIONS = read("../../../schemas/proven_job_definitions.v1.json");
const JOB_ID = "grant-award-to-reimbursement-record-in-three-places";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a record under test is deliberately untyped JSON
type Json = any;
const JOB: Json = DEFINITIONS.jobs.find((job: Json) => job.id === JOB_ID);
const REFUSED = "proven job record refused: ";
const ROLES = ["county", "city", "tribal-area"];

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const jobRoot = mkdtempSync(join(tmpdir(), "openplan-proven-award-"));
const fakePdfPages = (path: string) => syntheticPdfPages(readFileSync(path, "utf8"));

function writeFile(path: string, text: string) {
  mkdirSync(join(jobRoot, dirname(path)), { recursive: true });
  writeFileSync(join(jobRoot, path), text);
}

/** Write a PDF's text under a name of its own and pin its hash, size, pages and items in the record. */
function repin(pdf: Json, text: string) {
  const digest = sha(text);
  pdf.path = pdf.path.replace(/(-[0-9a-f]{8})?\.pdf$/, `-${digest.slice(0, 8)}.pdf`);
  writeFile(pdf.path, text);
  pdf.sha256 = digest;
  pdf.bytes = Buffer.byteLength(text);
  pdf.pages = syntheticPdfPages(text).length;
  pdf.items = syntheticWorksheetItems(text, JOB, pdf.kind);
}

for (const entry of EXAMPLE.journeys) for (const pdf of entry.pdfs) writeFile(pdf.path, syntheticWorksheetPdfText(entry, pdf.kind));

const proven = (): Json => structuredClone(EXAMPLE);
const journey = (record: Json, role: string) => record.journeys.find((entry: Json) => entry.role === role);
const request = (record: Json, role: string, number: string) => journey(record, role).requests.find((entry: Json) => entry.number === number);
const check = (record: Json) => validateProvenJobRecord(record, { repoRoot: jobRoot, readPdfPages: fakePdfPages });

/** The checker's own refusal, for the reason given. */
function refused(record: Json, reason: string | RegExp) {
  let message = "";
  try {
    check(record);
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message.startsWith(REFUSED), `refused by the checker, not accepted or thrown elsewhere: ${message || "accepted"}`).toBe(true);
  if (typeof reason === "string") expect(message).toContain(reason);
  else expect(message).toMatch(reason);
}

/** Rebuild a journey's worksheets and screen readings from its record with the product's code, so they agree with it. */
function rebuild(record: Json, role: string) {
  const entry = journey(record, role);
  for (const pdf of entry.pdfs) repin(pdf, syntheticWorksheetPdfText(entry, pdf.kind));
  for (const reading of entry.screenReadings) reading.figures = screenFiguresAt(entry, reading.at, Object.keys(reading.figures));
}

/** Change one worksheet's text and nothing in the record. */
function editPdf(record: Json, role: string, kind: string, change: (text: string) => string) {
  const pdf = journey(record, role).pdfs.find((entry: Json) => entry.kind === kind);
  const before = readFileSync(join(jobRoot, pdf.path), "utf8");
  const after = change(before);
  expect(after, "the edit must change the worksheet's text").not.toBe(before);
  repin(pdf, after);
}

/** Replace the first match; `to` is taken literally, or given the match's first group before the literal text when `keepGroup` is set. */
const swap = (text: string, from: string | RegExp, to: string, keepGroup = false) => {
  const found = typeof from === "string" ? text.includes(from) : from.test(text);
  expect(found, `the synthetic worksheet holds ${String(from).slice(0, 60)}`).toBe(true);
  return text.replace(from, (...match: string[]) => (keepGroup ? match[1] : "") + to);
};
const escapeRegExp = (words: string) => words.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A figure row's amount, wherever the layout set it: the first amount after the label. */
const setRowAmount = (label: string, amount: string) => (text: string) =>
  swap(text, new RegExp(`(${escapeRegExp(label)}[\\s\\S]*?)-?\\$[\\d,]+\\.\\d{2}`), amount, true);
/** Insert a line after the line that holds `anchor`. */
const afterLine = (anchor: string, line: string) => (text: string) => swap(text, new RegExp(`(\\n[^\\n]*${escapeRegExp(anchor)}[^\\n]*\\n)`), `${line}\n`, true);

describe("the fourth proven job's example", () => {
  it("is accepted, with every journey on its role's profile", () => {
    expect(() => check(proven())).not.toThrow();
    expect(proven().journeys.map((entry: Json) => entry.role)).toEqual(ROLES);
  });

  it("pins the bytes the fixture builds from the product's worksheet code", () => {
    // A change to the worksheet's words or the ledger changes these files; the
    // example is then re-pinned on purpose, never quietly.
    for (const entry of EXAMPLE.journeys) {
      for (const pdf of entry.pdfs) expect(sha(syntheticWorksheetPdfText(entry, pdf.kind)), `${entry.role} ${pdf.kind}`).toBe(pdf.sha256);
      for (const reading of entry.screenReadings) {
        expect(screenFiguresAt(entry, reading.at, Object.keys(reading.figures)), `${entry.role} ${reading.screen} ${reading.at}`).toEqual(reading.figures);
      }
    }
  });

  it("is still accepted when the browser sets each amount beside its label, or below its note", () => {
    // No rule reads a fixed line. A row's cell is centred, so Chrome can set
    // its amount beside the label, between the label and its note, or after
    // the note, and a one-line label can push the amount to its own line.
    const record = proven();
    for (const kind of ["worksheet-open", "worksheet-closed"]) {
      editPdf(record, "city", kind, (text) =>
        text
          .replace(/\n {2}([^\n$]+)\n {20,}(\$[\d,]+\.\d{2}|\d{4}-\d{2}-\d{2})\n {2}([^\n]+)\n/g, (_whole, label, value, note) => `\n  ${label}\n  ${note}\n${" ".repeat(100)}${value}\n`)
          .replace(/\n {2}([A-Z][^\n$]*?) {2,}(\$[\d,]+\.\d{2})\n/g, (_whole, label, value) => `\n  ${label}\n${" ".repeat(100)}${value}\n`),
      );
    }
    const text = readFileSync(join(jobRoot, journey(record, "city").pdfs[1].path), "utf8");
    expect(text, "the variant moved an amount below its note").toMatch(/2 invoice records\n {100}\$105,000\.00/);
    expect(text, "the variant moved a one-line row's amount to its own line").toMatch(/Recorded award ceiling\n {100}\$200,000\.00/);
    expect(() => check(record)).not.toThrow();
  });
});

describe("rule 1: the places and each role's profile", () => {
  it("refuses a tribal area that lies in one state", () => {
    const record = proven();
    journey(record, "tribal-area").place.stateFips = ["46"];
    refused(record, "tribal-area journey states 1 Census state(s) for its place (FIPS 46); this journey's place must cross at least 2");
  });

  it("refuses a county outside California", () => {
    const record = proven();
    Object.assign(journey(record, "county").place, { geoid: "32998", stateFips: ["32"], label: "Synthetic County, NV" });
    refused(record, "county journey must be in the state with FIPS 06");
  });

  it("refuses a city in California, a state with a profile of its own, with or without worksheets that agree", () => {
    // Review 97, L03 and L13: the record kept on the generic profile and its PDFs unchanged.
    const record = proven();
    Object.assign(journey(record, "city").place, { geoid: "0699812", stateFips: ["06"], label: "Synthetic city, CA" });
    refused(record, "city journey is in the state with FIPS 06; this journey's place may not lie in 06");
    rebuild(record, "city");
    refused(record, "city journey is in the state with FIPS 06; this journey's place may not lie in 06");
  });

  it("refuses a workspace whose profile is not its role's", () => {
    const record = proven();
    journey(record, "county").reimbursementProfile.profileId = "us_federal_generic_reimbursement_v1";
    refused(record, "county journey workspace resolved the reimbursement profile us_federal_generic_reimbursement_v1, not us_ca_lapm_reimbursement_v1");
  });

  it("refuses an interim default profile", () => {
    const record = proven();
    journey(record, "tribal-area").reimbursementProfile.selection = "interim_unconfigured_default";
    refused(record, "tribal-area journey reimbursement profile was bound as interim_unconfigured_default, not jurisdiction_matched");
  });

  it("refuses a request that carries another profile than its workspace's", () => {
    const record = proven();
    request(record, "county", "INV-2").profileId = "us_federal_generic_reimbursement_v1";
    refused(record, "county journey request INV-2 carries the reimbursement profile us_federal_generic_reimbursement_v1, not the workspace's us_ca_lapm_reimbursement_v1");
  });

  it("refuses a worksheet that says its process was not chosen for the workspace", () => {
    const record = proven();
    editPdf(record, "city", "worksheet-closed", afterLine("Process: US federal-aid", "This process was not chosen for this workspace."));
    refused(record, 'city journey worksheet-closed PDF says "This process was not chosen for this workspace."');
  });
});

describe("rule 2: one hosted commit, one checkout, journeys in order, one build", () => {
  it("refuses a second harness checkout", () => {
    const record = proven();
    journey(record, "city").harness.commit = "f".repeat(40);
    refused(record, "the city journey ran from harness checkout ffff");
  });

  it("refuses a journey that started before the one before it ended", () => {
    const record = proven();
    journey(record, "city").health[0].checkedAt = "2026-11-20T10:44:00Z";
    journey(record, "city").accountCreatedAt = "2026-11-20T10:44:10Z";
    refused(record, "the city journey started (2026-11-20T10:44:00Z) before the county journey ended");
  });

  it("refuses a journey on another build", () => {
    const record = proven();
    for (const reading of journey(record, "tribal-area").health) reading.version = "0.77.0";
    refused(record, "the tribal-area journey's start health readback reports version 0.77.0");
  });

  it("refuses a rehearsal", () => {
    const record = proven();
    journey(record, "county").mode = "rehearsal";
    refused(record, "county journey ran in rehearsal mode; only a proof run is proof");
  });
});

describe("rule 3: the fixed demonstration amounts", () => {
  it("refuses another match, though the worksheets and screens agree with it", () => {
    const record = proven();
    journey(record, "county").award.match = "40000.00";
    rebuild(record, "county");
    refused(record, 'county journey award match is "40000.00"; this job\'s fixed demonstration figure is "50000.00"');
  });

  it("refuses another gross on the first request, though everything agrees with it", () => {
    const record = proven();
    request(record, "city", "INV-1").gross = "61000.00";
    journey(record, "city").closeOut.releasedAmount = "94000.00";
    rebuild(record, "city");
    refused(record, 'city journey request INV-1 gross is "61000.00"; this job\'s fixed first request has "60000.00"');
  });

  it("refuses a path that skips internal review, a move the product allows", () => {
    const record = proven();
    const history = request(record, "county", "INV-1").history;
    history.splice(1, 1);
    rebuild(record, "county");
    refused(record, "county journey request INV-1 went draft, submitted, approved_for_payment, paid; this job's first request goes draft, internal_review, submitted, approved_for_payment, paid");
  });

  it("refuses an obligation date after a request's period starts", () => {
    const record = proven();
    journey(record, "county").award.obligatedOn = "2026-04-15";
    rebuild(record, "county");
    refused(record, "county journey request INV-1 period starts 2026-04-01, before the award was obligated on 2026-04-15");
  });

  it("refuses an award with no obligation date", () => {
    const record = proven();
    journey(record, "county").award.obligatedOn = null;
    rebuild(record, "county");
    refused(record, "county journey award has no obligation date");
  });
});

describe("rule 4: money recomputed from the record, compared with both worksheets and the screens", () => {
  it("refuses a worksheet whose claimed total is not the record's", () => {
    const record = proven();
    editPdf(record, "county", "worksheet-open", setRowAmount("Claimed to date (gross)", "$150,000.00"));
    refused(record, 'county journey worksheet-open PDF "Claimed to date (gross)" prints $150,000.00, but the figure recomputed from the record at the download is $105,000.00');
  });

  it("refuses a worksheet whose paid figure is the closed one in the open download", () => {
    const record = proven();
    editPdf(record, "tribal-area", "worksheet-open", setRowAmount("Paid to date (net of retention)", "$105,000.00"));
    refused(record, 'tribal-area journey worksheet-open PDF "Paid to date (net of retention)" prints $105,000.00, but the figure recomputed from the record at the download is $60,000.00');
  });

  it("refuses a worksheet whose count beside a total is not the record's", () => {
    const record = proven();
    editPdf(record, "county", "worksheet-closed", (text) => swap(text, "0 invoice records", "1 invoice record"));
    refused(record, 'county journey worksheet-closed PDF "Claimed and not yet paid (net)" does not say "0 invoice records"');
  });

  it("refuses a request row whose amount is not the record's", () => {
    const record = proven();
    editPdf(record, "city", "worksheet-closed", (text) => swap(text, /(INV-2A[^\n]*?)\$45,000\.00/, "$46,000.00", true));
    refused(record, "city journey worksheet-closed PDF request INV-2A prints");
  });

  it("refuses a row printed twice", () => {
    const record = proven();
    editPdf(record, "county", "worksheet-closed", afterLine("Remaining against recorded award ceiling", "  Recorded award ceiling                $200,000.00"));
    refused(record, 'county journey worksheet-closed PDF must print the row "Recorded award ceiling" exactly once');
  });

  it("refuses a request row the record does not hold", () => {
    const record = proven();
    editPdf(record, "county", "worksheet-closed", afterLine("resubmits INV-2", "  INV-3             Paid                     2026-11-20     Not recorded     2026-11-20       $10,000.00         $0.00          $10,000.00"));
    refused(record, "county journey worksheet-closed PDF prints 12 amounts under \"Invoice records on this award\"; its 3 request rows hold 9");
  });

  it("refuses a screen reading that is not the record's", () => {
    const record = proven();
    journey(record, "city").screenReadings.find((entry: Json) => entry.screen === "invoices-register").figures.outstandingNet = "$0.00";
    refused(record, 'city journey invoices-register screen reading at 2026-11-20T11:22:00Z outstandingNet reads "$0.00", but the figure recomputed from the record at that time is $45,000.00');
  });

  it("refuses a dashboard share drawn that is not the record's", () => {
    const record = proven();
    journey(record, "county").screenReadings.find((entry: Json) => entry.screen === "dashboard").figures.drawnPercent = "30%";
    refused(record, 'county journey dashboard screen reading at 2026-11-20T10:23:00Z drawnPercent reads "30%", but the figure recomputed from the record at that time is 53%');
  });

  it("refuses an open download made after the close-out", () => {
    const record = proven();
    journey(record, "county").downloads[0].at = "2026-11-20T10:30:30Z";
    refused(record, "county journey worksheet-open download was made after the close-out; this job's worksheet-open is downloaded before it");
  });

  it("refuses an open download with nothing outstanding", () => {
    const record = proven();
    journey(record, "county").downloads[0].at = "2026-11-20T10:17:30Z";
    rebuild(record, "county");
    refused(record, "county journey worksheet-open download was made with 0 request(s) claimed and not yet paid; this job's worksheet-open needs at least 1");
  });
});

describe("rule 5: missing is never zero", () => {
  it("refuses $0.00 for a match the record does not hold", () => {
    const record = proven();
    journey(record, "county").award.match = null;
    rebuild(record, "county");
    editPdf(record, "county", "worksheet-open", (text) => swap(text, /(Local match recorded on the award\n\s+)Not recorded/, "$0.00", true));
    refused(record, 'county journey worksheet-open PDF "Local match recorded on the award" prints $0.00, but the record holds no entry for it; a fact not entered reads "Not recorded", never zero');
  });

  it("refuses a screen reading of $0.00 for a match the record does not hold", () => {
    const record = proven();
    journey(record, "city").award.match = null;
    rebuild(record, "city");
    journey(record, "city").screenReadings.find((entry: Json) => entry.screen === "funding-tab").figures.match = "$0.00";
    refused(record, 'city journey funding-tab screen reading at 2026-11-20T11:20:00Z match reads "$0.00", but the record holds no entry for it; a fact not entered reads "Not recorded", never zero');
  });

  it("accepts Not recorded where the record holds no match, until the fixed amounts refuse it", () => {
    const record = proven();
    journey(record, "city").award.match = null;
    rebuild(record, "city");
    refused(record, 'city journey award match is null; this job\'s fixed demonstration figure is "50000.00"');
  });

  it("refuses a close-out that states no released amount", () => {
    const record = proven();
    journey(record, "county").closeOut.releasedAmount = null;
    refused(record, "county journey close-out states no released amount; a missing amount is not read as zero");
  });

  it("refuses a cost section that prints an amount", () => {
    const record = proven();
    editPdf(record, "county", "worksheet-closed", afterLine("No cost entries recorded", "Cost entries recorded in this period        $0.00"));
    refused(record, 'county journey worksheet-closed PDF "Recorded project costs in this period" prints an amount, but the record enters no cost');
  });
});

describe("rule 6: the path is the product's", () => {
  it("refuses a rejection with no reason", () => {
    const record = proven();
    request(record, "county", "INV-2").rejectionReason = null;
    refused(record, "county journey request INV-2 is rejected with no reason recorded");
  });

  it("refuses a rejection made with another control", () => {
    const record = proven();
    request(record, "county", "INV-2").history[2].control = "PATCH /api/invoicing/invoices";
    refused(record, 'county journey request INV-2 moved to rejected with "PATCH /api/invoicing/invoices", not the product\'s "Mark rejected" control');
  });

  it("refuses a request rejected from draft", () => {
    const record = proven();
    request(record, "county", "INV-2").history.splice(1, 1);
    refused(record, "county journey request INV-2 moved from draft to rejected, a move the product's request rules refuse");
  });

  it("refuses a request moved backward", () => {
    const record = proven();
    request(record, "city", "INV-1").history[2].status = "draft";
    request(record, "city", "INV-1").history[2].control = "Mark submitted";
    refused(record, "city journey request INV-1 moved from internal_review to draft");
  });

  it("refuses a resubmission made before the rejection", () => {
    const record = proven();
    request(record, "county", "INV-2A").history[0].at = "2026-11-20T10:16:30Z";
    refused(record, "county journey request INV-2A was created before the request it resubmits was rejected");
  });

  it("refuses a resubmission logged with the composer instead of Resubmit", () => {
    const record = proven();
    request(record, "county", "INV-2A").history[0].control = "invoice-record-composer";
    refused(record, 'county journey request INV-2A was created with "invoice-record-composer", not the product\'s "Resubmit"');
  });

  it("refuses a move the route did not answer 200", () => {
    const record = proven();
    request(record, "tribal-area", "INV-1").history[3].responseStatus = 202;
    refused(record, "tribal-area journey request INV-1 move to approved_for_payment was answered 202, not 200");
  });

  it("refuses a history out of time order", () => {
    const record = proven();
    request(record, "county", "INV-1").history[2].at = "2026-11-20T10:10:30Z";
    refused(record, "county journey request INV-1 history entry 3 (2026-11-20T10:10:30Z) is out of time order");
  });

  it("refuses a close-out made with another control", () => {
    const record = proven();
    journey(record, "county").closeOut.control = "funding_award_closeout_command";
    refused(record, 'county journey close-out was made with "funding_award_closeout_command", not the product\'s "Close out award"');
  });

  it("refuses a close-out made while a request was still open", () => {
    const record = proven();
    const close = journey(record, "county").closeOut;
    close.closedAt = "2026-11-20T10:25:30Z";
    refused(record, "county journey close-out came before request INV-2A's last status (2026-11-20T10:26:00Z)");
  });

  it("refuses a close-out worksheet that does not say the basis", () => {
    const record = proven();
    editPdf(record, "county", "worksheet-closed", (text) => swap(text, "Closed with balance released", "Closed on paid coverage"));
    refused(record, 'county journey worksheet-closed PDF "Award close-out" does not say "Closed with balance released"');
  });

  it("refuses close-out rows printed on the open worksheet", () => {
    const record = proven();
    editPdf(record, "county", "worksheet-open", afterLine("posture recorded as", "  Balance released at close-out                 $95,000.00"));
    refused(record, 'county journey worksheet-open PDF prints "Balance released at close-out", but the award was not closed when it was downloaded');
  });
});

describe("rule 7: the refusals", () => {
  it("refuses a member log-request answered 201", () => {
    const record = proven();
    journey(record, "county").refusals.find((entry: Json) => entry.action === "log-request").status = 201;
    refused(record, "county journey member log-request answered 201; only 403 shows the product refused a member");
  });

  it("refuses a record with no member close-out refusal", () => {
    const record = proven();
    const entry = journey(record, "city");
    entry.refusals = entry.refusals.filter((refusal: Json) => refusal.action !== "close-out");
    refused(record, "city journey needs exactly one member close-out refusal, found 0");
  });

  it("refuses an over-ceiling refusal without the product's code", () => {
    const record = proven();
    journey(record, "county").refusals.find((entry: Json) => entry.action === "over-ceiling-claim-without-note").code = null;
    refused(record, "county journey owner over-ceiling-claim-without-note carried the code null, not the product's over_award_ceiling");
  });

  it("refuses a paid-before-approval attempt that the route accepted", () => {
    const record = proven();
    journey(record, "tribal-area").refusals.find((entry: Json) => entry.action === "paid-before-approval").status = 200;
    refused(record, "tribal-area journey owner paid-before-approval answered 200; only 422 shows the product refused it");
  });

  it("refuses a second workspace's worksheet download answered 200", () => {
    const record = proven();
    record.crossWorkspace.checks.find((entry: Json) => entry.journey === "city" && entry.request === "worksheet-download").status = 200;
    refused(record, "cross-workspace data request worksheet-download for another workspace's worksheet answered status 200, which is inconclusive");
  });

  it("refuses a second workspace's refusal with no owner 200 beside it", () => {
    const record = proven();
    record.crossWorkspace.ownerChecks.find((entry: Json) => entry.journey === "county" && entry.request === "worksheet-download").status = 404;
    refused(record, "the county journey's owner received status 404 for worksheet-download, not 200");
  });

  it("refuses a database write by the member that changed a request", () => {
    const record = proven();
    journey(record, "county").custody.find((entry: Json) => entry.account === "member" && entry.target === "paid-request-amount").rowsChanged = 1;
    refused(record, "county journey member direct write of paid-request-amount changed a row; the database must hold the award's facts");
  });

  it("refuses a custody check with a code the database does not use", () => {
    const record = proven();
    journey(record, "county").custody.find((entry: Json) => entry.account === "owner" && entry.target === "award-closure-columns").code = "P0001";
    refused(record, "county journey owner direct write of award-closure-columns answered 400 with code P0001, which does not show the database refused it");
  });
});

describe("rule 8: what the worksheet must and must not say", () => {
  it("refuses a worksheet that names SF-270", () => {
    const record = proven();
    editPdf(record, "county", "worksheet-closed", afterLine("Process: Caltrans", "Submit this with your SF 270."));
    refused(record, 'county journey worksheet-closed PDF names the form "SF-270", which the worksheet does not implement');
  });

  it("refuses LAPM Exhibit 5-A wrapped over two lines", () => {
    const record = proven();
    editPdf(record, "county", "worksheet-closed", afterLine("Process: Caltrans", "Attach it to LAPM Exhibit\n5-A when you invoice."));
    refused(record, 'county journey worksheet-closed PDF names the form "Exhibit 5-A"');
  });

  it("accepts a sentence saying the worksheet is not an SF-270", () => {
    const record = proven();
    editPdf(record, "city", "worksheet-closed", afterLine("Process: US federal-aid", "This worksheet is not an SF-270."));
    expect(() => check(record)).not.toThrow();
  });

  it("refuses a sentence that a cost is allowable", () => {
    const record = proven();
    editPdf(record, "city", "worksheet-closed", afterLine("Process: US federal-aid", "These costs are  allowable under the award."));
    refused(record, 'city journey worksheet-closed PDF prints "are allowable", which this job refuses anywhere in the worksheet');
  });

  it("refuses a sentence that the balance was deobligated", () => {
    const record = proven();
    editPdf(record, "tribal-area", "worksheet-closed", afterLine("Process: US federal-aid", "The remaining balance was deobligated."));
    refused(record, 'tribal-area journey worksheet-closed PDF prints "deobligated"');
  });

  it("refuses a page with no footer", () => {
    const record = proven();
    editPdf(record, "county", "worksheet-open", (text) => swap(text, /\n[^\n]*not a funder's form · Page 2 of 2\n/, "\n"));
    refused(record, "county journey worksheet-open PDF page 2 does not carry the footer that says it is not a funder's form, with page 2 of 2");
  });

  it("refuses a first page with no note saying it is not a funder's form", () => {
    const record = proven();
    editPdf(record, "county", "worksheet-open", (text) =>
      text
        .replace(/\n {3}Prepared by OpenPlan[^\n]*\n {3}[^\n]*\n/, "\n")
        .replace(/\nPrepared by OpenPlan from records this workspace entered\.[^\n]*\n/, "\n"),
    );
    refused(record, "county journey worksheet-open PDF page 1 does not say it is not a funder's form");
  });

  it("refuses an award title without the demonstration label", () => {
    const record = proven();
    journey(record, "city").award.title = "Synthetic city SS4A planning award";
    rebuild(record, "city");
    refused(record, 'city journey award title does not carry the demonstration label "Demonstration by an automated OpenPlan proof run"');
  });

  it("refuses a worksheet whose award line is not the record's title", () => {
    const record = proven();
    editPdf(record, "city", "worksheet-open", (text) => swap(text, "Award: Synthetic city SS4A planning award", "Award: Synthetic city SS4A capital award"));
    refused(record, 'city journey worksheet-open PDF page 1 does not print "Award: Synthetic city SS4A planning award (Demonstration by an automated OpenPlan proof run)"');
  });

  it("refuses a worksheet the built-in writer typeset", () => {
    const record = proven();
    editPdf(record, "county", "worksheet-open", afterLine("AWARD POSITION", "Typeset by OpenPlan's built-in PDF writer because this deployment has no browser rendering engine."));
    refused(record, "county journey worksheet-open PDF was typeset by OpenPlan's built-in writer");
  });

  it("refuses a download the route printed with the built-in writer", () => {
    const record = proven();
    journey(record, "county").downloads[1].engine = "builtin";
    refused(record, "county journey worksheet-closed download was printed by the builtin engine, not chrome");
  });
});

describe("rule 9: screens", () => {
  it("refuses a screen not read after the close-out", () => {
    const record = proven();
    const entry = journey(record, "county");
    entry.screenReadings = entry.screenReadings.filter((reading: Json) => !(reading.screen === "dashboard" && reading.at > entry.closeOut.closedAt));
    refused(record, "county journey has no reading of the dashboard screen after the close-out");
  });

  it("refuses a reading that leaves out a figure its screen shows", () => {
    const record = proven();
    delete journey(record, "county").screenReadings[0].figures.remaining;
    refused(record, "county journey funding-tab screen reading at 2026-11-20T10:20:00Z does not hold the remaining figure");
  });

  it("refuses an accessibility check made without reading the whole screen", () => {
    const record = proven();
    journey(record, "county").screens[3].paneUnrolled = false;
    refused(record, "county journey screen funding-tab at 390 px dark was checked without reading the whole screen");
  });

  it("refuses a serious accessibility violation", () => {
    const record = proven();
    journey(record, "city").screens[0].axe.serious = 16;
    refused(record, "city journey screen funding-tab at 1440 px light has 16 serious and 0 critical accessibility violations");
  });

  it("refuses a console error", () => {
    const record = proven();
    journey(record, "city").screens[5].consoleErrors = 1;
    refused(record, "logged 1 console errors");
  });
});

describe("rule 10: limits in the definition's words", () => {
  it("refuses a record that leaves out a limit", () => {
    const record = proven();
    record.limits = record.limits.filter((limit: Json) => limit.id !== "paid-is-what-the-workspace-typed");
    refused(record, "record does not state the paid-is-what-the-workspace-typed limit");
  });

  it("refuses a limit that says the opposite of its id", () => {
    const record = proven();
    record.limits.find((limit: Json) => limit.id === "not-a-payment-request").text = "The worksheets are payment requests sent to the funder.";
    refused(record, "record's not-a-payment-request limit does not carry its definition's words");
  });
});

describe("false records a hostile reviewer would try", () => {
  it("refuses a total typed to match a wrong sum (the rejected request counted as claimed)", () => {
    // 60,000 + 45,000 + 45,000: every request's gross, the sum a careless total gives.
    const record = proven();
    editPdf(record, "county", "worksheet-closed", setRowAmount("Claimed to date (gross)", "$150,000.00"));
    refused(record, 'county journey worksheet-closed PDF "Claimed to date (gross)" prints $150,000.00, but the figure recomputed from the record at the download is $105,000.00');
    const screens = proven();
    journey(screens, "county").screenReadings.find((entry: Json) => entry.screen === "grants-awards" && entry.at > "2026-11-20T10:30:00Z").figures.claimedGross = "$150,000.00";
    refused(screens, 'county journey grants-awards screen reading at 2026-11-20T10:33:00Z claimedGross reads "$150,000.00", but the figure recomputed from the record at that time is $105,000.00');
  });

  it("refuses a rejected request counted as claimed: worksheets that count it, a record that says rejected", () => {
    // The worksheets are built by the product from a copy in which INV-2 was
    // approved instead of rejected; the record keeps the rejection.
    const record = proven();
    const entry = journey(record, "city");
    const counted = structuredClone(entry);
    const inv2 = counted.requests.find((item: Json) => item.number === "INV-2");
    Object.assign(inv2.history[2], { status: "approved_for_payment", control: "Mark approved for payment" });
    for (const pdf of entry.pdfs) repin(pdf, syntheticWorksheetPdfText(counted, pdf.kind));
    refused(record, 'city journey worksheet-open PDF "Claimed to date (gross)" prints $150,000.00, but the figure recomputed from the record at the download is $105,000.00');
  });

  it("refuses a resubmission with no link", () => {
    const record = proven();
    request(record, "county", "INV-2A").resubmitsInvoiceId = null;
    refused(record, "county journey request INV-2A does not carry the link to the rejected request INV-2 it resubmits");
  });

  it("refuses a resubmission linked to the request that was paid", () => {
    const record = proven();
    request(record, "county", "INV-2A").resubmitsInvoiceId = request(record, "county", "INV-1").invoiceId;
    refused(record, "county journey request INV-2A does not carry the link to the rejected request INV-2 it resubmits");
  });

  it("refuses a paid request with no date", () => {
    const record = proven();
    request(record, "tribal-area", "INV-1").paidDate = null;
    refused(record, "tribal-area journey request INV-1 is paid with no payment date");
  });

  it("refuses a payment date after the day the request was marked paid", () => {
    const record = proven();
    request(record, "tribal-area", "INV-1").paidDate = "2026-11-22";
    refused(record, "tribal-area journey request INV-1 payment date 2026-11-22 is after the day it was marked paid");
  });

  it("refuses a released amount worked as the ceiling minus gross when the rule is net", () => {
    // Retention 6,000 on INV-1: net paid is 54,000 + 45,000 = 99,000, so the
    // product's rule releases 101,000; the ceiling minus paid gross is 95,000.
    const record = proven();
    request(record, "county", "INV-1").retention = "6000.00";
    refused(record, "county journey close-out released $95,000.00, but the ceiling minus net paid at the close-out is $101,000.00 ($200,000.00 - $99,000.00)");
  });

  it("refuses the reverse: the record released on the net rule, the worksheet printing the gross figure", () => {
    const record = proven();
    request(record, "county", "INV-1").retention = "6000.00";
    journey(record, "county").closeOut.releasedAmount = "101000.00";
    rebuild(record, "county");
    editPdf(record, "county", "worksheet-closed", setRowAmount("Balance released at close-out", "$95,000.00"));
    refused(record, 'county journey worksheet-closed PDF "Balance released at close-out" prints $95,000.00, but the figure recomputed from the record at the download is $101,000.00');
  });

  it("refuses one worksheet standing for both downloads", () => {
    const record = proven();
    const [open, closed] = journey(record, "county").pdfs;
    Object.assign(closed, { path: open.path, sha256: open.sha256, bytes: open.bytes, pages: open.pages, items: structuredClone(open.items) });
    refused(record, "the county journey's worksheet-closed PDF is the same bytes as the county journey's worksheet-open PDF");
  });

  it("refuses the open worksheet with a byte added standing for the closed one", () => {
    const record = proven();
    const [open, closed] = journey(record, "county").pdfs;
    repin(closed, `${readFileSync(join(jobRoot, open.path), "utf8")}\n`);
    refused(record, 'county journey worksheet-closed PDF must print the row "Award close-out" exactly once under "Award position", found 0');
  });

  it("refuses a member refusal recorded with no signed-in member", () => {
    const record = proven();
    journey(record, "city").memberAccount.ownStatus = 401;
    refused(record, "city journey member account received status 401 for its own worksheet-download, not 200 for worksheet-download");
    const unconfirmed = proven();
    journey(unconfirmed, "city").memberAccount.confirmed = false;
    refused(unconfirmed, "city journey member account was not confirmed");
  });

  it("refuses a custody write recorded as refused with a 200", () => {
    const record = proven();
    Object.assign(journey(record, "county").custody.find((entry: Json) => entry.account === "owner" && entry.target === "award-closure-columns"), { status: 200, code: null });
    refused(record, "county journey owner direct write of award-closure-columns answered 200, which does not show the database refused it");
    const member = proven();
    Object.assign(journey(member, "county").custody.find((entry: Json) => entry.account === "member" && entry.target === "award-closure-columns"), { status: 200, code: null });
    refused(member, "county journey member direct write of award-closure-columns answered 200, which does not show the database refused it");
  });

  it("refuses a limit saying the opposite of its id", () => {
    const record = proven();
    record.limits.find((limit: Json) => limit.id === "no-allowability-statement").text = "Every cost in the worksheets is allowable.";
    refused(record, "record's no-allowability-statement limit does not carry its definition's words");
  });
});

describe("review 97: the copies its first version accepted", () => {
  it("refuses an amount printed outside the rows the checker reads (M16 to M19)", () => {
    const cases: [string, string, (text: string) => string, number, number][] = [
      ["county", "worksheet-open", afterLine("All amounts on this worksheet are in USD.", "Reimbursed to date by the funder $150,000.00"), 20, 20],
      ["county", "worksheet-open", afterLine("Period: Award to date", "Total paid to date: $150,000.00"), 20, 20],
      ["city", "worksheet-closed", afterLine("HOW TO READ THESE FIGURES", "$150,000.00 has been paid."), 21, 21],
      ["tribal-area", "worksheet-closed", afterLine("Process: US federal-aid", "Balance due from the funder: $45,000"), 21, 20],
    ];
    for (const [role, kind, change, signs, numbers] of cases) {
      const record = proven();
      editPdf(record, role, kind, change);
      refused(record, `${role} journey ${kind} PDF prints ${signs} currency signs and ${numbers} amounts with cents; the`);
    }
  });

  it("counts every honest worksheet's amounts as 19 before the close-out and 20 after", () => {
    for (const entry of EXAMPLE.journeys) {
      for (const pdf of entry.pdfs) {
        const text = syntheticWorksheetPdfText(entry, pdf.kind);
        expect((text.match(/\$\s?-?\d/g) ?? []).length, `${entry.role} ${pdf.kind}`).toBe(pdf.kind === "worksheet-open" ? 19 : 20);
      }
    }
  });

  it("refuses a cost with no cents in the cost section (M20)", () => {
    const record = proven();
    editPdf(record, "county", "worksheet-closed", afterLine("No cost entries recorded", "Consultant costs $5,000"));
    refused(record, 'county journey worksheet-closed PDF "Recorded project costs in this period" prints an amount, but the record enters no cost');
  });

  it("refuses a custody refusal answered 401, or a status paired with another error's code (F10, F11)", () => {
    const owner = (record: Json, target: string) => journey(record, "county").custody.find((entry: Json) => entry.account === "owner" && entry.target === target);
    const unsigned = proven();
    Object.assign(owner(unsigned, "award-closure-columns"), { status: 401, code: "42501" });
    refused(unsigned, "county journey owner direct write of award-closure-columns answered 401 with code 42501, which does not show the database refused it; only 400 with 23514 or 403 with 42501 counts");
    const unpaired = proven();
    Object.assign(owner(unpaired, "paid-request-amount"), { status: 409, code: "23514" });
    refused(unpaired, "county journey owner direct write of paid-request-amount answered 409 with code 23514");
    const crossed = proven();
    Object.assign(owner(crossed, "paid-request-amount"), { status: 403, code: "23514" });
    refused(crossed, "county journey owner direct write of paid-request-amount answered 403 with code 23514");
  });

  it("accepts a privilege refusal, 403 with 42501", () => {
    const record = proven();
    Object.assign(journey(record, "county").custody.find((entry: Json) => entry.account === "member" && entry.target === "award-closure-columns"), { status: 403, code: "42501" });
    expect(() => check(record)).not.toThrow();
  });

  it("refuses a payment date before the request's invoice date (P12, P13)", () => {
    for (const paidDate of ["2020-01-01", "2026-03-01"]) {
      const record = proven();
      request(record, "city", "INV-1").paidDate = paidDate;
      rebuild(record, "city");
      refused(record, `city journey request INV-1 payment date ${paidDate} is before its invoice date 2026-07-15`);
    }
  });

  it("refuses a payment date printed only in the invoice-date cell (P14)", () => {
    // INV-2A was invoiced and paid the same day, so a blank paid cell still leaves the date in the row once.
    const record = proven();
    editPdf(record, "county", "worksheet-closed", (text) => swap(text, /(INV-2A {12}Paid {21}2026-11-20 {5}Not recorded {5})2026-11-20/, "Not recorded", true));
    refused(record, `county journey worksheet-closed PDF request INV-2A payment date cell reads "not recorded"; it must hold its payment date 2026-11-20`);
  });

  it("refuses a due date the record does not hold (Z07)", () => {
    const record = proven();
    editPdf(record, "county", "worksheet-closed", (text) => swap(text, /(INV-2 {13}Rejected {17}2026-10-15 {5})Not recorded/, "2026-12-01  ", true));
    refused(record, `county journey worksheet-closed PDF request INV-2 due date cell reads "2026 12 01"; it must hold "Not recorded" for its due date`);
  });

  it("refuses a period that ends before it starts, and a date that is not on the calendar", () => {
    const backward = proven();
    request(backward, "county", "INV-1").periodEnd = "2026-03-31";
    refused(backward, "county journey request INV-1 period ends (2026-03-31) before it starts (2026-04-01)");
    const impossible = proven();
    request(impossible, "county", "INV-2").dueDate = "2026-13-45";
    refused(impossible, "county journey request INV-2 dueDate 2026-13-45 is not a calendar date");
  });

  it("refuses a screen reading outside the journey (S09)", () => {
    const record = proven();
    journey(record, "city").screenReadings.at(-1).at = "2027-11-20T11:35:00Z";
    refused(record, "city journey dashboard screen reading at 2027-11-20T11:35:00Z is outside the journey");
  });

  it("refuses the three forms named by their titles (W09 to W11)", () => {
    const titles = ["Request for Advance or Reimbursement", "Outlay Report and Request for Reimbursement for Construction Programs", "Federal Financial Report"];
    for (const title of titles) {
      const record = proven();
      editPdf(record, "city", "worksheet-closed", afterLine("Process: US federal-aid", `File this with the ${title} for the period.`));
      refused(record, `city journey worksheet-closed PDF names the form "${title}"`);
    }
  });

  it("refuses the review's seven wordings (W12, W17 to W23)", () => {
    const wordings: [string, string][] = [
      ["This worksheet is your payment request.", "payment request"],
      ["Eligible costs are listed above.", "eligible costs"],
      ["Every line here allowable under the agreement.", "allowable under"],
      ["The funder paid both requests.", "the funder paid"],
      ["Funds disbursed in full.", "disbursed"],
      ["These requests qualify for reimbursement.", "qualify for reimbursement"],
      ["Deposited on receipt.", "deposited"],
    ];
    for (const [line, phrase] of wordings) {
      const record = proven();
      editPdf(record, "tribal-area", "worksheet-closed", afterLine("Process: US federal-aid", line));
      refused(record, `tribal-area journey worksheet-closed PDF prints "${phrase}", which this job refuses anywhere in the worksheet`);
    }
  });

  it("refuses a refused phrase that continues on the next page, past the footer and the fixed note (W25)", () => {
    const record = proven();
    editPdf(record, "county", "worksheet-open", (text) =>
      swap(text, "\n\n\nPrepared by OpenPlan from records", "\n  The final payment was\n\n\nPrepared by OpenPlan from records").replace(
        "\fINVOICE RECORDS ON THIS AWARD",
        "\freceived by the agency.\nINVOICE RECORDS ON THIS AWARD",
      ),
    );
    const pdf = journey(record, "county").pdfs[0];
    expect(readFileSync(join(jobRoot, pdf.path), "utf8")).toContain("\freceived by the agency.");
    refused(record, 'county journey worksheet-open PDF prints "payment was received"');
  });

  it("refuses a download outside the journey (kills review 97's mutant MA)", () => {
    const record = proven();
    journey(record, "county").downloads[1].at = "2026-11-20T10:46:00Z";
    refused(record, "county journey worksheet-closed download (2026-11-20T10:46:00Z) is outside the journey");
  });

  it("refuses a request row whose payment date is not the record's (kills mutant MB)", () => {
    const record = proven();
    editPdf(record, "county", "worksheet-closed", (text) => swap(text, /(INV-1 {13}Paid {21}2026-07-15 {5}Not recorded {5})2026-11-20/, "2026-11-19", true));
    refused(record, `county journey worksheet-closed PDF request INV-1 payment date cell reads "2026 11 19"; it must hold its payment date 2026-11-20`);
  });

  it("refuses a first page that names another workspace (kills mutant MD)", () => {
    const record = proven();
    editPdf(record, "county", "worksheet-open", (text) => swap(text, "\nSynthetic County reimbursement demonstration workspace\n", "\nNeighbouring County planning workspace\n"));
    refused(record, "county journey worksheet-open PDF page 1 does not print the workspace's name");
  });

  it("refuses a request row whose status is not the record's (kills mutant ME)", () => {
    const record = proven();
    editPdf(record, "city", "worksheet-closed", (text) => swap(text, /(INV-2 {13})Rejected/, "Approved", true));
    refused(record, 'city journey worksheet-closed PDF request INV-2 status cell reads "approved missing the progress report for the billing period"');
  });

  it("refuses a record that does not say who acted is the journey's word", () => {
    const record = proven();
    record.limits = record.limits.filter((limit: Json) => limit.id !== "who-acted-is-the-journeys-word");
    refused(record, "record does not state the who-acted-is-the-journeys-word limit");
  });
});

describe("review 99: the copies its recheck found accepted", () => {
  it("refuses dates moved between a row's cells (D1 to D3)", () => {
    const cases: [RegExp, string, string][] = [
      // D1: INV-1's invoice and paid dates exchanged.
      [/(INV-1 {13}Paid {21})2026-07-15( {5}Not recorded {5})2026-11-20/, "2026-11-20     Not recorded     2026-07-15", 'request INV-1 invoice date cell reads "2026 11 20"; it must hold its invoice date 2026-07-15'],
      // D2: INV-1's paid date in the due cell, "Not recorded" in the paid cell.
      [/(INV-1 {13}Paid {21})2026-07-15 {5}Not recorded {5}2026-11-20/, "2026-07-15     2026-11-20       Not recorded", 'request INV-1 due date cell reads "2026 11 20"; it must hold "Not recorded" for its due date'],
      // D3: INV-2A's due cell holds the date its paid cell should, the same date string.
      [/(INV-2A {12}Paid {21})2026-11-20 {5}Not recorded {5}2026-11-20/, "2026-11-20     2026-11-20       Not recorded", 'request INV-2A due date cell reads "2026 11 20"; it must hold "Not recorded" for its due date'],
    ];
    for (const [pattern, row, message] of cases) {
      const record = proven();
      editPdf(record, "county", "worksheet-closed", (text) => swap(text, pattern, row, true));
      refused(record, `county journey worksheet-closed PDF ${message}`);
    }
  });

  it("counts an amount with no sign, a spaced sign, a full-width sign or no cents (A1 to A4)", () => {
    const cases: [string, number, number][] = [
      ["Reimbursed to date by the funder 150,000.00 USD", 19, 20],
      ["Balance due from the funder: $  45,000.00", 20, 20],
      ["Total paid to date ＄150,000.00", 20, 20],
      ["USD 150,000.00 has been paid on this award.", 19, 20],
    ];
    for (const [line, signs, numbers] of cases) {
      const record = proven();
      editPdf(record, "city", "worksheet-open", afterLine("All amounts on this worksheet are in USD.", line));
      refused(record, `city journey worksheet-open PDF prints ${signs} currency signs and ${numbers} amounts with cents`);
    }
  });

  it("refuses a form name with an en dash or split by a hyphen at a line's end (F2, F6)", () => {
    const cases: [string, string][] = [
      ["This worksheet is an SF–270.", "SF-270"],
      ["File it with the Request for Advance or Reim-\nbursement.", "Request for Advance or Reimbursement"],
    ];
    for (const [line, name] of cases) {
      const record = proven();
      editPdf(record, "city", "worksheet-closed", afterLine("Process: US federal-aid", line));
      refused(record, `city journey worksheet-closed PDF names the form "${name}"`);
    }
  });

  it("refuses an invoice before its period, a due date before its invoice, and a resubmission out of step with the request it replaces (C2 to C4, H4)", () => {
    const early = proven();
    Object.assign(request(early, "county", "INV-1"), { invoiceDate: "2026-03-01", paidDate: "2026-03-02" });
    refused(early, "county journey request INV-1 invoice date 2026-03-01 is before its period starts (2026-04-01)");
    const due = proven();
    request(due, "county", "INV-1").dueDate = "2026-01-01";
    refused(due, "county journey request INV-1 due date 2026-01-01 is before its invoice date 2026-07-15");
    const ahead = proven();
    Object.assign(request(ahead, "county", "INV-2A"), { invoiceDate: "2026-10-14", paidDate: "2026-10-14" });
    refused(ahead, "county journey request INV-2A invoice date 2026-10-14 is before that of the request it resubmits (2026-10-15)");
    const period = proven();
    Object.assign(request(period, "county", "INV-2A"), { periodStart: "2026-10-01", periodEnd: "2026-12-31" });
    refused(period, "county journey request INV-2A claims the period 2026-10-01 to 2026-12-31, but the request it resubmits claimed 2026-07-01 to 2026-09-30");
  });

  it("refuses an amount in typed text", () => {
    const named = proven();
    journey(named, "city").workspaceName = "Synthetic city $45,000.00 workspace";
    refused(named, "city journey workspace name holds a dollar amount");
    const reason = proven();
    request(reason, "county", "INV-2").rejectionReason = "Short by 1,500.00 on the backup.";
    refused(reason, "county journey request INV-2 rejection reason holds a dollar amount");
  });

  it("refuses a limit under an id the definition does not word (X04)", () => {
    const record = proven();
    record.limits.push({ id: "worksheets-are-payment-requests", text: "The worksheets are the payment requests sent to the funder." });
    refused(record, "record states a worksheets-are-payment-requests limit, which this job's definition does not word");
  });
});

describe("review 100: short reason words, dates outside the date cells, and amounts in other forms", () => {
  it("accepts honest reasons of short words, read beside the invoice date (F0, F1)", () => {
    const reasons = [
      "If it is filed, I will fill it in, list it, and tell Jill if I still will. It is ill timed; I fill it if I file it.",
      "We do not pay a claim if it is not in a form we can use. Fix it, add a W-9 and an I-9, and send it to us by mail or by fax if you can.",
    ];
    for (const reason of reasons) {
      const record = proven();
      request(record, "county", "INV-2").rejectionReason = reason;
      rebuild(record, "county");
      expect(() => check(record), reason).not.toThrow();
    }
  });

  it("accepts a reason word set 4 columns left of the row's invoice date (Chrome set one 5 columns left in review 100's NV6)", () => {
    const record = proven();
    editPdf(record, "county", "worksheet-closed", (text) => {
      const lines = text.split("\n");
      const row = lines.findIndex((line) => /^ {2}INV-2 {13}Rejected/.test(line));
      const invoiceX = lines[row].indexOf("2026-10-15");
      const reasonEnd = lines.findIndex((line, index) => index > row && line.trim() === "period.");
      expect(reasonEnd, "the reason's last line").toBeGreaterThan(row);
      lines[reasonEnd] = `${" ".repeat(invoiceX - 4)}period.`;
      return lines.join("\n");
    });
    expect(() => check(record)).not.toThrow();
  });

  it("refuses a date under the status, after the amounts or under the number (CR1 to CR3)", () => {
    const inv1 = /(\n {2}INV-1 {13}Paid[^\n]*\n)/;
    const cases: [(text: string) => string, string][] = [
      [(text) => swap(text, inv1, `${" ".repeat(20)}2026-08-01\n`, true), 'request INV-1 status cell reads "paid 2026 08 01"'],
      [(text) => swap(text, /(\n {2}INV-1 {13}Paid[^\n]*\$60,000\.00)/, "   paid 2026-08-01", true), 'request INV-1 amount cells read "$60,000.00 $0.00 $60,000.00 paid 2026-08-01"'],
      [(text) => swap(text, inv1, "  due 2026-08-15\n", true), 'request INV-1 number cell reads "inv 1 due 2026 08 15"'],
    ];
    for (const [change, message] of cases) {
      const record = proven();
      editPdf(record, "county", "worksheet-closed", change);
      refused(record, `county journey worksheet-closed PDF ${message}`);
    }
  });

  it("refuses an amount with a currency word, full-width digits or comma cents (AC1 to AC3)", () => {
    const cases: [string, string][] = [
      ["USD 150000 has been paid on this award.", "prints 19 currency signs and 19 amounts with cents, and 1 amounts written with comma cents or a currency word"],
      ["＄１５０,０００.００ paid to date.", "prints 20 currency signs and 20 amounts with cents"],
      ["150.000,00 EUR paid to date.", "prints 19 currency signs and 19 amounts with cents, and 1 amounts written with comma cents or a currency word"],
    ];
    for (const [line, message] of cases) {
      const record = proven();
      editPdf(record, "city", "worksheet-open", afterLine("All amounts on this worksheet are in USD.", line));
      refused(record, `city journey worksheet-open PDF ${message}`);
    }
  });

  it("refuses typed text that names an amount with a currency word or full-width digits (TT2, TT3)", () => {
    const note = proven();
    journey(note, "county").closeOut.note += " Paid USD 150000 in full.";
    refused(note, "county journey close-out note holds a dollar amount");
    const reason = proven();
    request(reason, "county", "INV-2").rejectionReason = "Missing the progress report; only ＄１５０,０００ was shown.";
    refused(reason, "county journey request INV-2 rejection reason holds a dollar amount");
  });
});
