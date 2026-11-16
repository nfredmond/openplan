// @vitest-environment node
/**
 * The second proven job's record (November 15, 2026) is evidence and cannot
 * be edited: its record, three run files, twelve review files, README and
 * inputs are pinned by SHA-256 in the capability registry. Any rule added to
 * the proven job checker may refuse only what that record does not do. This
 * test runs the committed record through the current checker with the
 * committed review PDFs, read by Poppler's pdftotext, and the committed
 * workbooks, and requires it to be accepted. It also requires every file the
 * registry pins to still have its pinned bytes, and each run file to say what
 * the record says about where and how the journey ran.
 *
 * The acceptance could fail: the last block changes one thing at a time in a
 * copy and requires the checker's own refusal.
 *
 * Skips the checker runs where `pdftotext` on PATH is not Poppler's (Git
 * Bash's xpdf, or none), as the first record's test does. CI installs Poppler
 * (KI-2026-11-14-101).
 *
 * Blind category: this shows the checker accepts the record, not that the
 * record is true. The record's origin, build and mode are the journey's own
 * statements; what else stays on the journey's word is listed in
 * docs/product/capability-evidence/second-proven-job/README.md and
 * KI-2026-11-15-042.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PROOF_ORIGIN, validateProvenJobRecord } from "../../scripts/ops/capability-evidence.mjs";
import { pdfToolVersion } from "../../scripts/lib/poppler-text.mjs";

const REPO_ROOT = resolve(process.cwd(), "..");
const JOB_ID = "engagement-campaign-review-and-response-in-three-places";
const RECORD_PATH = "docs/product/capability-evidence/second-proven-job.v1.json";
const COMMIT = "3af5a8b35860138e2a01214702ff7016b4b6fd32";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the record and registry are untyped JSON
type Json = any;
const registry: Json = JSON.parse(readFileSync(resolve(REPO_ROOT, "docs/product/US_PLANNING_CAPABILITY_REGISTRY.json"), "utf8"));
const entry: Json = registry.provenJobs.find((job: Json) => job.jobId === JOB_ID);
const record = (): Json => JSON.parse(readFileSync(resolve(REPO_ROOT, RECORD_PATH), "utf8"));
const sha256 = (path: string) => createHash("sha256").update(readFileSync(resolve(REPO_ROOT, path))).digest("hex");
const hasPoppler = pdfToolVersion("pdftotext").poppler;
const journeyOf = (value: Json, role: string) => value.journeys.find((journey: Json) => journey.role === role);

describe("the second proven job's registry entry", () => {
  it("names the job, the hosted commit and three places of three kinds in three states", () => {
    expect(entry).toMatchObject({
      jobId: JOB_ID,
      commit: COMMIT,
      places: [
        { kind: "county", geoid: "41011", stateFips: ["41"] },
        { kind: "city", geoid: "5644760", stateFips: ["56"] },
        { kind: "aiannh", geoid: "1505R", stateFips: ["04"] },
      ],
    });
  });

  it("pins twenty files, and each still has its pinned bytes", () => {
    expect(entry.evidence).toHaveLength(20);
    for (const file of entry.evidence) expect(sha256(file.path), file.path).toBe(file.sha256);
  });

  it("pins every file the record names, and the record itself", () => {
    const pinned = new Set(entry.evidence.map((file: Json) => file.path));
    expect(pinned.has(RECORD_PATH)).toBe(true);
    for (const journey of record().journeys) {
      for (const file of [...journey.pdfs, ...journey.workbooks]) {
        expect(pinned.has(file.path), file.path).toBe(true);
        expect(sha256(file.path), file.path).toBe(file.sha256);
      }
    }
  });
});

describe("the second proven job's run files and its record say the same thing", () => {
  it.each(["county", "city-or-town", "tribal-area"])("%s: a finished proof run on the hosted origin and the record's commit, with its inputs pinned", (role) => {
    const run: Json = JSON.parse(readFileSync(resolve(REPO_ROOT, `docs/product/capability-evidence/second-proven-job/${role}/engagement-journey-${role}.json`), "utf8"));
    const value = record();
    expect(run.mode).toBe("proof");
    expect(run.baseUrl).toBe(PROOF_ORIGIN);
    expect(value.baseUrl).toBe(PROOF_ORIGIN);
    expect(run.expectedCommit).toBe(COMMIT);
    expect(value.commit).toBe(COMMIT);
    expect(run.stoppedAt ?? null).toBeNull();
    expect(run.close.closed).toBe(true);
    expect(journeyOf(value, role).mode).toBe("proof");
    expect(journeyOf(value, role).close.closed).toBe(true);
    const inputs = { county: "coos-county", "city-or-town": "lander", "tribal-area": "hopi-reservation" }[role];
    expect(run.inputsSha256).toBe(sha256(`docs/product/capability-evidence/second-proven-job/inputs/${inputs}.inputs.json`));
  });
});

describe.skipIf(!hasPoppler)("the second proven job's record through the current checker", () => {
  const check = (value: Json) => validateProvenJobRecord(value, { repoRoot: REPO_ROOT });

  it("is accepted with its twelve committed review files", () => {
    expect(() => check(record())).not.toThrow();
  });

  it.each([
    ["one journey said to be a rehearsal", (value: Json) => { journeyOf(value, "city-or-town").mode = "rehearsal"; }, /city-or-town journey ran in rehearsal mode/],
    ["a campaign left open", (value: Json) => { journeyOf(value, "county").close.closed = false; }, /county journey did not take its campaign offline/],
    ["a local origin", (value: Json) => { value.baseUrl = "http://localhost:3485"; }, /record\.baseUrl is not in the expected form/],
    ["an end health readback on another commit", (value: Json) => { journeyOf(value, "tribal-area").health[1].commit = "aaaaaaaaaaaa"; }, /tribal-area journey end health readback reports commit aaaaaaaaaaaa/],
    ["the withheld text replaced with other words", (value: Json) => { journeyOf(value, "county").campaign.rejectedTexts[0] = "Other words."; }, /county journey rejected text 1 does not match its hash/],
    ["the public and internal PDFs swapped", (value: Json) => {
      const pdfs = journeyOf(value, "tribal-area").pdfs;
      const [a, b] = [{ ...pdfs[0] }, { ...pdfs[1] }];
      Object.assign(pdfs[0], { path: b.path, sha256: b.sha256, bytes: b.bytes, pages: b.pages });
      Object.assign(pdfs[1], { path: a.path, sha256: a.sha256, bytes: a.bytes, pages: a.pages });
    }, /proven job record refused: tribal-area journey/],
    ["one journey's participant refusals removed", (value: Json) => { value.participantChecks.refusals = value.participantChecks.refusals.filter((refusal: Json) => refusal.journey !== "county"); }, /the county journey needs exactly one public participant/],
  ])("refuses a copy with %s", (_label, change, reason) => {
    const copy = record();
    change(copy);
    expect(() => check(copy)).toThrow(reason);
  });
});
