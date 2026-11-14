// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizePlaceGeoid } from "@/lib/api/place-geographies";
import { scrubText } from "@/lib/observability/error-report";
import { stripSourceComments } from "./helpers/source-text";
import {
  pdftotextPages,
  validateCapabilityEvidence,
  validateProvenJobRecord,
} from "../../scripts/ops/capability-evidence.mjs";
import { pdfToolVersion } from "../../scripts/lib/poppler-text.mjs";

const root = mkdtempSync(join(tmpdir(), "openplan-capability-evidence-"));
mkdirSync(join(root, "docs"));
const bytes = "Synthetic test record, not product acceptance evidence.\n";
writeFileSync(join(root, "docs/proof.md"), bytes);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const today = "2026-09-04";

function record() {
  return {
    reviewedAt: "2026-09-01",
    dimensions: {
      planner: [{
        id: "example-planner",
        status: "proven",
        reviewedAt: today,
        evidence: [{ path: "docs/proof.md", sha256 }],
      }],
    },
  };
}

describe("evidence behind proven capability cells", () => {
  it("accepts a currently reviewed exact-byte record and does not invent proof requirements for partial coverage", () => {
    expect(() => validateCapabilityEvidence(record(), root, today)).not.toThrow();
    const partial = { reviewedAt: today, dimensions: { planner: [{ id: "unproven", status: "partial" }] } };
    expect(() => validateCapabilityEvidence(partial, root, today)).not.toThrow();
  });

  it("refuses promotion without an attributable evidence record", () => {
    const registry = record();
    registry.dimensions.planner[0].evidence = [];
    expect(() => validateCapabilityEvidence(registry, root, today)).toThrow(/no evidence records/);
  });

  it.each(["", "2026-08-31", "2026-09-05", "2026-02-30"])("refuses an invalid, stale, or future cell review date: %s", (reviewedAt) => {
    const registry = record();
    registry.dimensions.planner[0].reviewedAt = reviewedAt;
    expect(() => validateCapabilityEvidence(registry, root, today)).toThrow(/valid review date/);
  });

  it("refuses missing files and changed evidence bytes", () => {
    const registry = record();
    registry.dimensions.planner[0].evidence[0].path = "docs/missing.md";
    expect(() => validateCapabilityEvidence(registry, root, today)).toThrow(/file is missing/);
    const changed = record();
    changed.dimensions.planner[0].evidence[0].sha256 = "0".repeat(64);
    expect(() => validateCapabilityEvidence(changed, root, today)).toThrow(/hash changed/);
  });

  it("refuses unbound digests and duplicate evidence", () => {
    const registry = record();
    registry.dimensions.planner[0].evidence[0].sha256 = "";
    expect(() => validateCapabilityEvidence(registry, root, today)).toThrow(/needs a lowercase SHA-256/);
    const duplicate = record();
    duplicate.dimensions.planner[0].evidence.push(duplicate.dimensions.planner[0].evidence[0]);
    expect(() => validateCapabilityEvidence(duplicate, root, today)).toThrow(/repeats evidence/);
  });

  it("refuses an empty record even when its digest matches", () => {
    const registry = record();
    writeFileSync(join(root, "docs/empty.md"), "");
    registry.dimensions.planner[0].evidence[0] = {
      path: "docs/empty.md",
      sha256: createHash("sha256").update("").digest("hex"),
    };
    expect(() => validateCapabilityEvidence(registry, root, today)).toThrow(/file is empty/);
  });

  it("refuses absolute paths instead of binding evidence to one developer's computer", () => {
    const registry = record();
    registry.dimensions.planner[0].evidence[0].path = join(root, "docs/proof.md");
    expect(() => validateCapabilityEvidence(registry, root, today)).toThrow(/repository-relative/);
  });

  it("refuses an outside file reached through a repository symlink", () => {
    const outside = mkdtempSync(join(tmpdir(), "openplan-outside-evidence-"));
    writeFileSync(join(outside, "proof.md"), bytes);
    symlinkSync(join(outside, "proof.md"), join(root, "docs/outside.md"));
    const registry = record();
    registry.dimensions.planner[0].evidence[0].path = "docs/outside.md";
    expect(() => validateCapabilityEvidence(registry, root, today)).toThrow(/stay inside/);
  });
});

// The committed synthetic example is the base fixture, so the example a
// journey script copies is the one the checker accepts. Its "PDFs" are text
// files with a %PDF- first line and form-feed page breaks, read by a fake
// reader; the real pdftotext reader has its own test below.
const EXAMPLE = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../schemas/examples/proven_job_record.v1.synthetic.json", import.meta.url)), "utf8"),
);
const jobRoot = mkdtempSync(join(tmpdir(), "openplan-proven-job-"));
const fakePdfPages = (path: string) => readFileSync(path, "utf8").replace(/^[^\n]*\n/, "").split("\f");

function syntheticPdf(role: string, kind: string, extra = ""): string {
  return [
    `%PDF-1.4 synthetic test file for the proven job checker, not a real PDF\n${kind} for the ${role} journey\nCrash summary: synthetic counts`,
    "High-injury network map",
    `Countermeasures\nBenefit-cost analysis\nEngagement summary${extra}`,
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
const check = (record: Json) => validateProvenJobRecord(record, { repoRoot: jobRoot, readPdfPages: fakePdfPages });

/** Rewrite one PDF under a new name and re-pin its hash and size, so only the content rule under test can refuse it. */
function rewritePdf(record: Json, role: string, kind: string, text: string) {
  const pdf = journey(record, role).pdfs.find((entry: Json) => entry.kind === kind);
  const sha256 = createHash("sha256").update(text).digest("hex");
  pdf.path = pdf.path.replace(/\.pdf$/, `-${sha256.slice(0, 8)}.pdf`);
  writeFileSync(join(jobRoot, pdf.path), text);
  pdf.sha256 = sha256;
  pdf.bytes = Buffer.byteLength(text);
}

describe("the proven job record checker", () => {
  it("accepts the complete synthetic example on its committed bytes", () => {
    expect(() => check(proven())).not.toThrow();
  });

  it.each<[string, (record: Json) => void, RegExp]>([
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
    ["a screen not checked at 390 px in dark mode", (r) => { journey(r, "nevada-county").screens.pop(); }, /safety has no check at 390 px dark/],
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
    ["another workspace's report served", (r) => { r.crossWorkspace.checks[0] = { target: "safety-action-plan", status: 200, contentReturned: true }; }, /returned content \(status 200\)/],
    ["a missing cross-workspace check", (r) => { r.crossWorkspace.checks.pop(); }, /cross-workspace check for ss4a-application is missing/],
    ["a server error counted as a cross-workspace refusal", (r) => { r.crossWorkspace.checks[0].status = 500; }, /safety-action-plan answered status 500, which is inconclusive/],
    ["an unavailable service counted as a cross-workspace refusal", (r) => { r.crossWorkspace.checks[1].status = 503; }, /ss4a-application answered status 503, which is inconclusive/],
    ["a signed-out second account counted as a cross-workspace refusal", (r) => { r.crossWorkspace.checks[0].status = 401; }, /answered status 401, which is inconclusive/],
    ["a rejected export payload counted as a cross-workspace refusal", (r) => { r.crossWorkspace.checks[1].status = 422; }, /answered status 422, which is inconclusive/],
    ["a source check that found different counts", (r) => { r.sourceCheck = { status: "differs", checkedOn: "2026-11-21", url: "https://example.gov/query", note: "Counts differ." }; }, /finding, not a pass/],
    ["an unstated limit", (r) => { r.limits = r.limits.filter((limit: Json) => limit.id !== "fars-is-fatal-only"); }, /does not state the fars-is-fatal-only limit/],
    ["an unconfirmed crash count without its limit", (r) => { r.limits = r.limits.filter((limit: Json) => limit.id !== "crash-counts-not-independently-confirmed"); }, /crash-counts-not-independently-confirmed limit/],
  ])("refuses %s", (_name, mutate, reason) => {
    const record = proven();
    mutate(record);
    expect(() => check(record)).toThrow(reason);
  });

  // The secret values below are synthetic. The refusal names the field and
  // the kind of secret, and never repeats the value.
  it.each<[string, string, RegExp]>([
    ["an email address", "Prepared by planner@example.org", /contains an email address/],
    ["a plus-address", "Account planner+journey3@example.org", /contains a plus-address/],
    ["a JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJl", /contains a JWT/],
    ["a provider token", "sk-ant-api03-SYNTHETICSYNTHETIC", /contains a token/],
    ["an OpenAI project key", "sk-proj-SYNTHETICSYNTHETIC0123", /contains a token/],
    ["a bare sk- key", "sk-SYNTHETICSYNTHETIC0123", /contains a token/],
    ["a sign-in link", "https://project.supabase.co/auth/v1/verify?type=signup", /contains a token or sign-in link/],
    ["a password", "password: correct-horse", /contains a password/],
    ["a cookie", "sb-project-auth-token", /contains a cookie/],
  ])("refuses a text field holding %s, without repeating it", (_name, value, reason) => {
    const record = proven();
    record.limits[0].text = value;
    let message = "";
    try {
      check(record);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(reason);
    expect(message).toContain("record.limits[0].text");
    expect(message).not.toContain(value);
  });

  it("reads Census ids for each place kind the way the place resolver does", () => {
    const definitions = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../../schemas/proven_job_definitions.v1.json", import.meta.url)), "utf8"),
    );
    const kinds = Object.keys(definitions.geoidPatterns).filter((key) => key !== "source") as Array<"county" | "aiannh">;
    expect(kinds.sort()).toEqual(["aiannh", "county"]);
    for (const kind of kinds) {
      for (const sample of ["06001", "32031", "0600", "060011", "2430R", "2430T", "2430X", "24301", "2430r"]) {
        const accepted = new RegExp(definitions.geoidPatterns[kind]).test(sample);
        expect(accepted, `${kind} ${sample}`).toBe(normalizePlaceGeoid(kind, sample) === sample);
      }
    }
  });

  // KI-2026-11-14-117: the hosted site renders PDFs on Linux, where a label set
  // with letter spacing read back as single letters. The checker finds item
  // text with the shared matcher (scripts/lib/pdf-text-match.mjs), which
  // finds such a label and refuses what a whitespace-squashing search took:
  // part of a longer word, and two cells read across a column gap.
  const withPage3 = (role: string, kind: string, page3: string) =>
    syntheticPdf(role, kind).replace(/[^\f]*$/, page3);

  it("finds an item heading that reads back letter-spaced", () => {
    const record = proven();
    rewritePdf(record, "tribal-area", "ss4a-application", withPage3("tribal-area", "ss4a-application",
      "C O U N T E R M E A S U R E S\nB E N E F I T- C O S T A N A LY S I S\nE N G A G E M E N T S U M M A RY"));
    expect(() => check(record)).not.toThrow();
  });

  it.each([
    ["part of a longer word", "Countermeasures\nBenefit-cost analysis\nEngagement summaryless"],
    ["two cells across a column gap", "Countermeasures\nBenefit-cost analysis\nEngagement      summary"],
    ["a phrase split by a blank line", "Countermeasures\nBenefit-cost analysis\nEngagement\n\nsummary"],
  ])("refuses item text found only as %s", (_name, page3) => {
    const record = proven();
    rewritePdf(record, "tribal-area", "ss4a-application", withPage3("tribal-area", "ss4a-application", page3));
    expect(() => check(record)).toThrow(/tribal-area journey ss4a-application PDF engagement-summary text is not on page 3/);
  });

  it("refuses a DRAFT stamp that reads back letter-spaced", () => {
    const record = proven();
    rewritePdf(record, "california-county", "ss4a-application", syntheticPdf("california-county", "ss4a-application", "\nD R A F T: 2 required attachment(s) outstanding"));
    expect(() => check(record)).toThrow(/ss4a-application PDF page 3 carries a DRAFT stamp/);
  });

  it("refuses a PDF page holding an email address", () => {
    const record = proven();
    rewritePdf(record, "tribal-area", "ss4a-application", syntheticPdf("tribal-area", "ss4a-application", "\nFinalized by planner@example.org"));
    expect(() => check(record)).toThrow(/tribal-area journey ss4a-application PDF page 3 contains an email address/);
  });

  it.each([
    ["an OpenAI project key", "sk-proj-SYNTHETICSYNTHETIC0123"],
    ["a bare sk- key", "sk-SYNTHETICSYNTHETIC0123"],
  ])("refuses a PDF page holding %s, without repeating it", (_name, value) => {
    const record = proven();
    rewritePdf(record, "nevada-county", "safety-action-plan", syntheticPdf("nevada-county", "safety-action-plan", `\nModel key ${value}`));
    let message = "";
    try {
      check(record);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/nevada-county journey safety-action-plan PDF page 3 contains a token/);
    expect(message).not.toContain(value);
  });

  // The error-report sanitizer and this checker guard the same secrets on two
  // paths. Read the sanitizer's token prefixes from its code (comments
  // stripped), so a prefix added there and not here fails this test.
  it("refuses every token prefix the error-report sanitizer scrubs", () => {
    const source = stripSourceComments(
      readFileSync(fileURLToPath(new URL("../lib/observability/error-report.ts", import.meta.url)), "utf8"),
    );
    const prefixesFor = (label: string): string[] => {
      const line = source.split("\n").find((candidate) => candidate.includes(`"[${label}]"`));
      const group = line?.match(/\(\?:([^)]*)\)/)?.[1];
      if (!group) throw new Error(`no sanitizer prefix group for [${label}]`);
      return group.split("|");
    };
    const samples = [
      ...prefixesFor("secret").map((prefix) => `${prefix}SYNTHETIC0123456789`),
      ...prefixesFor("mapbox-token").map((prefix) => `${prefix}.eyJSYNTHETIC0123.SYNTHETIC0123`),
    ];
    expect(samples.length).toBeGreaterThanOrEqual(9);
    for (const sample of samples) {
      expect(scrubText(sample, 200), `the sanitizer scrubs ${sample}`).not.toContain(sample);
      const record = proven();
      record.limits[0].text = `Value ${sample}`;
      expect(() => check(record), sample).toThrow(/record\.limits\[0\]\.text contains a token/);
    }
  });
});

describe("proven jobs in the capability registry", () => {
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
  const validate = (registry: Json) =>
    validateCapabilityEvidence(registry, jobRoot, "2026-11-21", { readPdfPages: fakePdfPages });

  it("accepts an empty list and an entry whose record passes", () => {
    expect(() => validate({ reviewedAt: "2026-11-01", dimensions: {}, provenJobs: [] })).not.toThrow();
    expect(() => validate(registryWith(proven()))).not.toThrow();
  });

  it.each<[string, (registry: Json) => void, RegExp]>([
    ["a list that is not a list", (g) => { g.provenJobs = {}; }, /provenJobs must be a list/],
    ["an unknown entry field", (g) => { g.provenJobs[0].status = "proven"; }, /has unknown field status/],
    ["a commit other than the record's", (g) => { g.provenJobs[0].commit = "f".repeat(40); }, /commit does not match its record/],
    ["places other than the record's", (g) => { g.provenJobs[0].places.reverse(); }, /places do not match/],
    ["a future review date", (g) => { g.provenJobs[0].reviewedAt = "2026-11-22"; }, /valid review date/],
    ["a changed record", (g) => { g.provenJobs[0].evidence[0].sha256 = "0".repeat(64); }, /evidence hash changed/],
    ["no record among the evidence", (g) => { g.provenJobs[0].evidence = [{ path: EXAMPLE.journeys[0].pdfs[0].path, sha256: EXAMPLE.journeys[0].pdfs[0].sha256 }]; }, /exactly one openplan\.proven_job_record\.v1 record among its evidence, found 0/],
    ["a job listed twice", (g) => { g.provenJobs.push({ ...g.provenJobs[0] }); }, /is listed twice/],
  ])("refuses %s", (_name, mutate, reason) => {
    const registry = registryWith(proven());
    mutate(registry);
    expect(() => validate(registry)).toThrow(reason);
  });

  it("refuses an entry whose record the checker refuses", () => {
    const record = proven();
    record.baseUrl = "https://openplan-git-work-natford.vercel.app";
    expect(() => validate(registryWith(record))).toThrow(/not the hosted origin/);
  });
});

/** A minimal uncompressed PDF, one Helvetica text line per page. */
function makePdf(pages: string[]): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  pages.forEach((text, i) => {
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// Only Poppler's pdftotext counts: Git Bash on Windows finds xpdf's first,
// and the reader refuses it (KI-2026-11-14-190).
const hasPdftotext = pdfToolVersion("pdftotext").poppler;

/** A stand-in for spawnSync that answers `-v` the way a given program does. */
function versionStub(stderr: string) {
  return (() => ({ status: 99, stdout: "", stderr })) as unknown as typeof spawnSync;
}

describe("the default PDF reader refuses a pdftotext that is not Poppler's", () => {
  const neverRun = (() => {
    throw new Error("read a page with the wrong program");
  }) as unknown as typeof execFileSync;

  it("refuses xpdf before reading a page, and says how to fix PATH", () => {
    const xpdf = versionStub("pdftotext version 4.06 [www.xpdfreader.com]\nCopyright 1996-2025 Glyph & Cog, LLC\n");
    expect(() => pdftotextPages("record.pdf", { spawn: xpdf, execFile: neverRun })).toThrow(
      /proven job record refused: the pdftotext on PATH is not Poppler's: it reports "pdftotext version 4\.06 \[www\.xpdfreader\.com\]".*ahead of every other folder on PATH/,
    );
  });

  it("refuses a missing pdftotext with the same advice", () => {
    const missing = (() => ({ error: Object.assign(new Error("spawn pdftotext ENOENT"), { code: "ENOENT" }) })) as unknown as typeof spawnSync;
    expect(() => pdftotextPages("record.pdf", { spawn: missing, execFile: neverRun })).toThrow(/pdftotext is not on PATH.*poppler-utils/);
  });

  it("reads with Poppler and splits pages on form feeds", () => {
    const poppler = versionStub("pdftotext version 24.02.0\nCopyright 2005-2024 The Poppler Developers - http://poppler.freedesktop.org\n");
    const calls: string[][] = [];
    const execFile = ((tool: string, args: string[]) => {
      calls.push([tool, ...args]);
      return "Crash summary\fFinalized by Workspace owner\f";
    }) as unknown as typeof execFileSync;
    expect(pdftotextPages("record.pdf", { spawn: poppler, execFile })).toEqual(["Crash summary", "Finalized by Workspace owner"]);
    expect(calls).toEqual([["pdftotext", "-layout", "-enc", "UTF-8", "record.pdf", "-"]]);
  });
});

describe.skipIf(!hasPdftotext)("the default PDF reader (needs Poppler's pdftotext)", () => {
  it("returns one text per page, without a trailing empty page", () => {
    const path = join(jobRoot, "real.pdf");
    writeFileSync(path, makePdf(["Crash summary", "Finalized by planner@example.org"]));
    const pages = pdftotextPages(path);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("Crash summary");
    expect(pages[1]).toContain("planner@example.org");
  });
});
