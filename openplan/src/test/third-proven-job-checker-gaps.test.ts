// @vitest-environment node
/**
 * KI-2026-11-16-112: the gaps review 81 (agent-run, November 16, 2026) found
 * in the third proven job's checker, closed with one rule each. Every case
 * starts from the committed third record and its committed application PDFs,
 * changes one thing in a copy, and requires the checker's own refusal; the
 * unchanged record is accepted beside it. A change to a PDF's text is made in
 * a stand-in reader that returns Poppler's real text with one edit, which is
 * what a wrong or forged PDF with a matching hash would read as.
 *
 * 1. The harness checkout is the record's commit (copy B2).
 * 2. One build across the journeys: version and migrations (copy B7). This
 *    rule holds for every job.
 * 3. The journeys run one at a time in the definition's order (copies F1, F2).
 * 4. The export time agrees with the cover's Assembled time (copy A3), and
 *    the definition's time form is the product's own.
 * 5. A bare `token=` or `code=`, a link's one-time token and a PKCE name are
 *    refused in the record and in every JSON file a proven job pins (copy
 *    I15). The patterns hold for every job.
 * 6. Words that say a tribe or an agency prepared, adopted or submitted the
 *    application are refused (copy H9), and the honest sentences each role's
 *    PDF prints are not.
 *
 * Skips where `pdftotext` on PATH is not Poppler's, as the record's own test
 * does. CI installs Poppler.
 *
 * Blind category: these are single changes to one honest record. A record
 * and a PDF falsified together to agree, a record whose times were all moved
 * together, and a claim worded outside the phrase list are not caught; the
 * definition's notes say so.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatRecordedMoment, timeZoneInputLabel } from "@/lib/time/workspace-calendar";
import { stripSourceComments } from "@/test/helpers/source-text";
import { pdftotextPages, validateCapabilityEvidence, validateProvenJobRecord } from "../../scripts/ops/capability-evidence.mjs";
import { pdfTextHasPhrase } from "../../scripts/lib/pdf-text-match.mjs";
import { pdfToolVersion } from "../../scripts/lib/poppler-text.mjs";

const REPO_ROOT = resolve(process.cwd(), "..");
const JOB_ID = "california-atp-application-in-three-places";
const RECORD_PATH = "docs/product/capability-evidence/third-proven-job.v1.json";
const REFUSED = "proven job record refused: ";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the record, registry and definitions are untyped JSON
type Json = any;
const readJson = (path: string): Json => JSON.parse(readFileSync(resolve(REPO_ROOT, path), "utf8"));
const DEFINITIONS = readJson("schemas/proven_job_definitions.v1.json");
const JOB = DEFINITIONS.jobs.find((job: Json) => job.id === JOB_ID);
const REGISTRY = readJson("docs/product/US_PLANNING_CAPABILITY_REGISTRY.json");
const ENTRY = REGISTRY.provenJobs.find((job: Json) => job.jobId === JOB_ID);
const record = (): Json => readJson(RECORD_PATH);
const journeyOf = (value: Json, role: string) => value.journeys.find((journey: Json) => journey.role === role);
const hasPoppler = pdfToolVersion("pdftotext").poppler;

// Poppler's text of each committed PDF, read once.
const popplerText = new Map<string, string[]>();
const realPages = (path: string) => {
  if (!popplerText.has(path)) popplerText.set(path, pdftotextPages(path));
  return [...popplerText.get(path)!];
};

/** A reader that returns one role's PDF text with one edit; the edit must change it. */
function readerChanging(role: string, from: string, to: string) {
  return (path: string) => {
    const pages = realPages(path);
    if (!path.replaceAll("\\", "/").endsWith(`/${role}-atp-application.pdf`)) return pages;
    // Poppler ends lines with CRLF on Windows and LF elsewhere; the edit keeps the page's own.
    const eol = pages.some((page) => page.includes("\r\n")) ? "\r\n" : "\n";
    const [before, after] = [from, to].map((words) => words.replaceAll("\n", eol));
    const index = pages.findIndex((page) => page.includes(before));
    expect(index, `the ${role} PDF prints ${JSON.stringify(from)}`).toBeGreaterThanOrEqual(0);
    pages[index] = pages[index].replace(before, after);
    return pages;
  };
}

function verdict(value: Json, readPdfPages: (path: string) => string[] = realPages): string {
  try {
    validateProvenJobRecord(value, { repoRoot: REPO_ROOT, censusNames: true, readPdfPages });
    return "accepted";
  } catch (error) {
    return (error as Error).message;
  }
}

function expectRefused(message: string, reason: RegExp) {
  expect(message.startsWith(REFUSED), `expected the checker's own refusal, got: ${message}`).toBe(true);
  expect(message.slice(REFUSED.length)).toMatch(reason);
}

describe("the definition's export-time block is the product's own form", () => {
  it("names the zone label and the date-time form the export prints for a workspace with no time zone", () => {
    const rule = JOB.application.exportTime;
    expect(timeZoneInputLabel(null)).toBe(rule.zone);
    expect(formatRecordedMoment("2026-11-16T15:38:21Z", "UTC", timeZoneInputLabel(null))).toBe(`November 16, 2026 at 15:38 (${rule.zone})`);
    const source = stripSourceComments(readFileSync(resolve(REPO_ROOT, "openplan/src/lib/grants/application-html.ts"), "utf8"));
    expect(source).toContain(`<dt>${rule.label}</dt><dd>\${esc(formatDateTime(data.generatedAt, calendar))}</dd>`);
    expect(rule.field).toBe(JOB.health.endAfter);
  });
});

describe.skipIf(!hasPoppler)("the third record against each closed gap (KI-2026-11-16-112)", () => {
  it("is accepted unchanged, and with its journeys listed in another order", () => {
    expect(verdict(record())).toBe("accepted");
    const reordered = record();
    reordered.journeys.reverse();
    expect(verdict(reordered)).toBe("accepted");
  }, 240_000);

  it.each<[string, (value: Json) => void, RegExp]>([
    [
      "1. every journey's harness checkout on another commit than the record's",
      (value) => { for (const journey of value.journeys) journey.harness.commit = "f".repeat(40); },
      /the county journey ran from harness checkout f{40}, not the record's commit 95be0369cd0ff55366d140d4b44522d18f499341; a proof runs from the commit it records/,
    ],
    [
      "2. one journey on another version at both readbacks, commit kept",
      (value) => { for (const reading of journeyOf(value, "city").health) reading.version = "0.71.0"; },
      /the city journey's start health readback reports version 0\.71\.0, but the county journey's start readback reports 0\.72\.0; a record's journeys run on one build/,
    ],
    [
      "2. one journey on another migration count at both readbacks",
      (value) => { for (const reading of journeyOf(value, "tribal-area").health) reading.migrationsExpected = 454; },
      /the tribal-area journey's start health readback reports migrationsExpected 454, but the county journey's start readback reports 455/,
    ],
    [
      "3. the city journey's start moved inside the county journey",
      (value) => {
        const city = journeyOf(value, "city");
        city.health.find((reading: Json) => reading.point === "start").checkedAt = "2026-11-16T15:30:00Z";
        city.accountCreatedAt = "2026-11-16T15:30:05Z";
      },
      /the city journey started \(2026-11-16T15:30:00Z\) before the county journey ended \(2026-11-16T15:40:51Z\); this job's journeys run one at a time in the order county, city, tribal-area/,
    ],
    [
      "3. the tribal area's journey started before the city's ended",
      (value) => {
        const tribal = journeyOf(value, "tribal-area");
        tribal.health.find((reading: Json) => reading.point === "start").checkedAt = "2026-11-16T16:07:00Z";
        tribal.accountCreatedAt = "2026-11-16T16:07:05Z";
      },
      /the tribal-area journey started \(2026-11-16T16:07:00Z\) before the city journey ended \(2026-11-16T16:07:50Z\)/,
    ],
    [
      "4. the county's export time moved to one minute after sign-up",
      (value) => { journeyOf(value, "county").application.exportedAt = "2026-11-16T15:16:09Z"; },
      /county journey atp-application PDF cover says it was assembled November 16, 2026 at 15:38 \(UTC, no workspace time zone set\), but the journey's application\.exportedAt is 2026-11-16T15:16:09Z; they differ by more than 60 seconds/,
    ],
    [
      "4. the tribal area's export time two minutes after the printed minute",
      (value) => { journeyOf(value, "tribal-area").application.exportedAt = "2026-11-16T16:33:01Z"; },
      /tribal-area journey atp-application PDF cover says it was assembled November 16, 2026 at 16:31/,
    ],
    [
      "5. a link with ?token= in a not-applicable reason",
      (value) => { journeyOf(value, "county").application.rows.find((row: Json) => row.reason).reason += " See https://example.test/confirm?token=abc123."; },
      /record\.journeys\[0\]\.application\.rows\[\d+\]\.reason contains a token or sign-in link/,
    ],
    [
      "5. a bare token= in a project name",
      (value) => { journeyOf(value, "city").projectName += " token=abc123"; },
      /record\.journeys\[1\]\.projectName contains a token or sign-in link/,
    ],
    [
      "5. a link's one-time code in a reason",
      (value) => { journeyOf(value, "tribal-area").application.rows.find((row: Json) => row.reason).reason += " https://example.test/callback?state=1&code=abc123"; },
      /record\.journeys\[2\]\.application\.rows\[\d+\]\.reason contains a token or sign-in link/,
    ],
    [
      "5. a PKCE verifier's name in a limit",
      (value) => { value.limits[0].text += " pkce_0123abcd"; },
      /record\.limits\[0\]\.text contains a token or sign-in link/,
    ],
  ])("refuses %s", (_name, change, reason) => {
    const copy = record();
    change(copy);
    expectRefused(verdict(copy), reason);
  }, 240_000);

  it("accepts an export time inside the printed minute's clock allowance, both sides", () => {
    // The county's cover prints 15:38. The journey's clock and the site's differ by seconds.
    for (const exportedAt of ["2026-11-16T15:37:05Z", "2026-11-16T15:39:55Z"]) {
      const copy = record();
      journeyOf(copy, "county").application.exportedAt = exportedAt;
      expect(verdict(copy), exportedAt).toBe("accepted");
    }
  }, 240_000);

  it.each<[string, string, string, string, RegExp]>([
    ["4. the county cover's Assembled minute changed", "county", "at 15:38 (UTC, no", "at 15:48 (UTC, no", /county journey atp-application PDF cover says it was assembled November 16, 2026 at 15:48 \(UTC, no workspace time zone set\), but the journey's application\.exportedAt is 2026-11-16T15:38:21Z/],
    ["4. the city cover's Assembled time in another zone", "city", "(UTC, no", "(America/Los_Angeles) (no", /city journey atp-application PDF cover prints no "Assembled" time in the form "Month D, YYYY at HH:MM \(UTC, no workspace time zone set\)"/],
    ["6. a tribal government said to have prepared and adopted the text", "tribal-area", "No tribal government\nprepared, reviewed, adopted or submitted this text.", "A tribal government\nprepared and adopted it.", /tribal-area journey atp-application PDF prints "prepared and adopted", words that say someone prepared, adopted or submitted the application/],
    ["6. the text said to come from the Tribe's governing body", "tribal-area", "No tribal government\nprepared,", "The Tribe's governing body\nprepared,", /tribal-area journey atp-application PDF prints "governing body"/],
    ["6. the county said to have prepared and submitted the text", "county", "Trinity County did not\nprepare, review, adopt or submit this text", "Trinity County has\nprepared and submitted this text", /county journey atp-application PDF prints "prepared and submitted"/],
    ["6. the city said to submit the application", "city", "The City of Yreka did not\nprepare, review, adopt or submit this text", "The City of Yreka submits this\napplication and this text", /city journey atp-application PDF prints "submits this"/],
    ["6. a line saying the application was prepared by an agency", "city", "The City of Yreka did not\n", "Prepared by the City of Yreka, which did not\n", /city journey atp-application PDF prints "prepared by"/],
  ])("refuses a PDF with %s", (_name, role, from, to, reason) => {
    expectRefused(verdict(record(), readerChanging(role, from, to)), reason);
  }, 240_000);
});

describe.skipIf(!hasPoppler)("the honest sentences each role's PDF prints are outside the authorship list", () => {
  const phrases: string[] = JOB.application.authorshipPhrases.phrases;
  // What the committed PDFs print, word for word, about who prepared the text, and the program facts
  // nearest the list's words. A planner reading these would not take any of them as a claim.
  it.each<[string, string]>([
    ["county", "Trinity County did not prepare, review, adopt or submit this text, and it commits the County to nothing."],
    ["city", "The City of Yreka did not prepare, review, adopt or submit this text, and it commits the City to nothing."],
    ["tribal-area", "No tribal government prepared, reviewed, adopted or submitted this text. It speaks for no tribe and commits no one to anything."],
    ["tribal-area", "projects located within federally recognized Tribal Lands and projects submitted by tribal governments."],
    ["county", "2027 ATP Guidelines (Cycle 8, adopted March 19, 2026"],
    ["city", "this text is a rehearsal of the form and was not submitted to the Commission."],
    ["tribal-area", "No layout, estimate or schedule was prepared for this demonstration."],
  ])("%s prints: %s", (role, sentence) => {
    const path = resolve(REPO_ROOT, journeyOf(record(), role).pdfs[0].path);
    const text = realPages(path).join("\n");
    expect(pdfTextHasPhrase(text, sentence), "the PDF prints the sentence").toBe(true);
    expect(phrases.filter((phrase) => pdfTextHasPhrase(sentence, phrase))).toEqual([]);
  }, 240_000);
});

describe.skipIf(!hasPoppler)("every JSON file a proven job pins is scanned (KI-2026-11-16-112)", () => {
  /** A copy of the third job's eleven pinned files in a scratch repository, with one run file changed and re-pinned. */
  function registryWithRunFile(change: (text: string) => string) {
    const root = mkdtempSync(join(tmpdir(), "openplan-third-job-scan-"));
    const entry = structuredClone(ENTRY);
    for (const file of entry.evidence) {
      mkdirSync(join(root, dirname(file.path)), { recursive: true });
      copyFileSync(resolve(REPO_ROOT, file.path), join(root, file.path));
      if (!file.path.endsWith("/county/journey-county.json")) continue;
      const before = readFileSync(join(root, file.path), "utf8");
      const after = change(before);
      writeFileSync(join(root, file.path), after);
      file.sha256 = createHash("sha256").update(after).digest("hex");
    }
    return { root, registry: { reviewedAt: REGISTRY.reviewedAt, dimensions: {}, provenJobs: [entry] } };
  }
  const run = (change: (text: string) => string) => {
    const { root, registry } = registryWithRunFile(change);
    try {
      validateCapabilityEvidence(registry, root, ENTRY.reviewedAt, { censusNames: true, readPdfPages: realPages });
      return "accepted";
    } catch (error) {
      return (error as Error).message;
    }
  };

  it("accepts the copy with the run file unchanged, so a refusal below is the scan's", () => {
    expect(run((text) => text)).toBe("accepted");
  }, 240_000);

  it.each<[string, string, RegExp]>([
    ["a sign-in link's token", '"findings": ["see https://example.test/auth/confirm?token=abc123"]', /evidence docs\/product\/capability-evidence\/third-proven-job\/county\/journey-county\.json contains a token or sign-in link at \.findings\[0\]/],
    ["a bare code=", '"findings": ["code=abc123"]', /journey-county\.json contains a token or sign-in link at \.findings\[0\]/],
    ["an email address", '"findings": ["planner@example.test"]', /journey-county\.json contains an email address at \.findings\[0\]/],
  ])("refuses a run file holding %s", (_name, findings, reason) => {
    expect(run((text) => {
      expect(text).toContain('"findings": []');
      return text.replace('"findings": []', findings);
    })).toMatch(reason);
  }, 240_000);
});
