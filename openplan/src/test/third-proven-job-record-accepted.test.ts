// @vitest-environment node
/**
 * The third proven job's record (November 16, 2026) is evidence and cannot
 * be edited: its record, three run files, three application PDFs, README and
 * inputs are pinned by SHA-256 in the capability registry. Any rule added to
 * the proven job checker may refuse only what that record does not do. This
 * test runs the committed record through the current checker with the
 * committed PDFs, read by Poppler's pdftotext, with the Census Bureau's
 * names on, and requires it to be accepted. It also requires every file the
 * registry pins to still have its pinned bytes, and each run file to say what
 * the record says about where and how the journey ran.
 *
 * The acceptance could fail: the last block changes one thing at a time in a
 * copy and requires the checker's own refusal.
 *
 * Skips the checker runs where `pdftotext` on PATH is not Poppler's (Git
 * Bash's xpdf, or none), as the other records' tests do. CI installs Poppler
 * (KI-2026-11-14-101).
 *
 * Blind category: this shows the checker accepts the record, not that the
 * record is true. The record's origin, build and mode, the crash counts, the
 * screens' results and the statuses the two accounts received are the
 * journey's own statements. The PDFs were printed on the hosted site's Linux
 * fonts; the checker reads their text the same way on any machine. What else
 * stays on the journey's word is listed in
 * docs/product/capability-evidence/third-proven-job/README.md and
 * KI-2026-11-16-110.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PROOF_ORIGIN, validateProvenJobRecord } from "../../scripts/ops/capability-evidence.mjs";
import { pdfToolVersion } from "../../scripts/lib/poppler-text.mjs";

const REPO_ROOT = resolve(process.cwd(), "..");
const JOB_ID = "california-atp-application-in-three-places";
const RECORD_PATH = "docs/product/capability-evidence/third-proven-job.v1.json";
const FOLDER = "docs/product/capability-evidence/third-proven-job";
const COMMIT = "95be0369cd0ff55366d140d4b44522d18f499341";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the record and registry are untyped JSON
type Json = any;
const registry: Json = JSON.parse(readFileSync(resolve(REPO_ROOT, "docs/product/US_PLANNING_CAPABILITY_REGISTRY.json"), "utf8"));
const entry: Json = registry.provenJobs.find((job: Json) => job.jobId === JOB_ID);
const record = (): Json => JSON.parse(readFileSync(resolve(REPO_ROOT, RECORD_PATH), "utf8"));
const sha256 = (path: string) => createHash("sha256").update(readFileSync(resolve(REPO_ROOT, path))).digest("hex");
const hasPoppler = pdfToolVersion("pdftotext").poppler;
const journeyOf = (value: Json, role: string) => value.journeys.find((journey: Json) => journey.role === role);
const INPUTS: Record<string, string> = { county: "trinity-county-ca", city: "yreka-ca", "tribal-area": "hoopa-valley-reservation-ca" };

describe("the third proven job's registry entry", () => {
  it("names the job, the hosted commit and three California places of three kinds", () => {
    expect(entry).toMatchObject({
      jobId: JOB_ID,
      commit: COMMIT,
      places: [
        { kind: "county", geoid: "06105", stateFips: ["06"] },
        { kind: "city", geoid: "0686944", stateFips: ["06"] },
        { kind: "aiannh", geoid: "1490R", stateFips: ["06"] },
      ],
    });
  });

  it("pins eleven files, and each still has its pinned bytes", () => {
    expect(entry.evidence).toHaveLength(11);
    for (const file of entry.evidence) expect(sha256(file.path), file.path).toBe(file.sha256);
  });

  it("pins every file the record names, the record itself, each run file, the README and the inputs", () => {
    const pinned = new Set(entry.evidence.map((file: Json) => file.path));
    expect(pinned.has(RECORD_PATH)).toBe(true);
    expect(pinned.has(`${FOLDER}/README.md`)).toBe(true);
    for (const journey of record().journeys) {
      expect(pinned.has(`${FOLDER}/${journey.role}/journey-${journey.role}.json`), journey.role).toBe(true);
      expect(pinned.has(`${FOLDER}/inputs/${INPUTS[journey.role]}.inputs.json`), journey.role).toBe(true);
      for (const file of journey.pdfs) {
        expect(pinned.has(file.path), file.path).toBe(true);
        expect(sha256(file.path), file.path).toBe(file.sha256);
      }
    }
  });
});

describe("the third proven job's run files and its record say the same thing", () => {
  it.each(["county", "city", "tribal-area"])("%s: a finished proof run on the hosted origin and the record's commit, with its inputs pinned", (role) => {
    const run: Json = JSON.parse(readFileSync(resolve(REPO_ROOT, `${FOLDER}/${role}/journey-${role}.json`), "utf8"));
    const value = record();
    expect(run.mode).toBe("proof");
    expect(run.baseUrl).toBe(PROOF_ORIGIN);
    expect(value.baseUrl).toBe(PROOF_ORIGIN);
    expect(run.expectedCommit).toBe(COMMIT);
    expect(value.commit).toBe(COMMIT);
    expect(run.harness).toEqual({ commit: COMMIT, clean: true });
    expect(run.stoppedAt ?? null).toBeNull();
    expect(run.findings).toEqual([]);
    expect(run.steps.every((step: Json) => step.status === "passed")).toBe(true);
    expect(run.steps).toHaveLength(17);
    const journey = journeyOf(value, role);
    expect(journey.mode).toBe("proof");
    expect(journey.crashes).toEqual(run.journey.crashes);
    expect(journey.application.outstandingRequiredCount).toBe(17);
    expect(run.inputsSha256).toBe(sha256(`${FOLDER}/inputs/${INPUTS[role]}.inputs.json`));
  });

  it("holds no address, token or link in any run file", () => {
    for (const role of ["county", "city", "tribal-area"]) {
      const text = readFileSync(resolve(REPO_ROOT, `${FOLDER}/${role}/journey-${role}.json`), "utf8");
      expect(text, role).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
      expect(text, role).not.toMatch(/token_hash=|pkce_[0-9a-f]{8}|[?&](token|code|access_token|refresh_token)=/);
    }
  });
});

describe.skipIf(!hasPoppler)("the third proven job's record through the current checker", () => {
  const check = (value: Json) => validateProvenJobRecord(value, { repoRoot: REPO_ROOT, censusNames: true });

  it("is accepted with its three committed application PDFs and the Census Bureau's names on", () => {
    expect(() => check(record())).not.toThrow();
  }, 120_000);

  it.each([
    ["one journey said to be a rehearsal", (value: Json) => { journeyOf(value, "city").mode = "rehearsal"; }, /city journey ran in rehearsal mode/],
    ["a local origin", (value: Json) => { value.baseUrl = "http://localhost:3530"; }, /record\.baseUrl is not in the expected form/],
    ["an end health readback on another commit", (value: Json) => { journeyOf(value, "tribal-area").health[1].commit = "aaaaaaaaaaaa"; }, /tribal-area journey end health readback reports commit aaaaaaaaaaaa/],
    ["the county's id changed to its neighbor's, label kept", (value: Json) => { journeyOf(value, "county").place.geoid = "06093"; }, /county journey label "Trinity County, CA" is not the Census Bureau's name for county 06093/],
    ["the tribal area listed in two states", (value: Json) => { journeyOf(value, "tribal-area").place.stateFips = ["06", "32"]; }, /tribal-area journey states the Census states with FIPS 06, 32/],
    ["crashes from the national file", (value: Json) => { journeyOf(value, "tribal-area").crashes.sourceId = "fars-national"; }, /tribal-area journey crashes come from fars-national, not ccrs-ca/],
    ["a crash count the PDF does not print", (value: Json) => { const crashes = journeyOf(value, "county").crashes; crashes.reportedCount = 99; crashes.storedCount = 99; }, /county journey atp-application PDF "Appendix B\. Crash summary" does not state "Crashes reported: 99"/],
    ["the city's PDF named for the county too", (value: Json) => { journeyOf(value, "county").pdfs[0] = { ...journeyOf(value, "city").pdfs[0] }; }, /the same bytes as the county journey's atp-application PDF/],
    ["the outstanding count changed", (value: Json) => { journeyOf(value, "tribal-area").application.outstandingRequiredCount = 16; }, /tribal-area journey says 16 required attachments are outstanding; its checklist rows give 17/],
    ["a checklist row claimed attached", (value: Json) => { journeyOf(value, "county").application.rows.find((row: Json) => row.disposition === "outstanding").disposition = "attached"; }, /is attached; an agent-run proof attaches no stand-in document/],
    ["another tract data value", (value: Json) => { journeyOf(value, "county").application.tractData = "none-retrieved"; }, /county journey atp-application PDF "Appendix E\. Disadvantaged-community and equity inputs"/],
    ["the owner's control missing for one journey", (value: Json) => { value.crossWorkspace.ownerChecks = value.crossWorkspace.ownerChecks.filter((check: Json) => check.journey !== "city"); }, /the city journey needs exactly one owner application-read check, found 0/],
    ["a second account reading the application", (value: Json) => { const found = value.crossWorkspace.checks.find((check: Json) => check.journey === "tribal-area" && check.request === "application-read"); found.status = 200; found.contentReturned = true; }, /application-read for another workspace's atp-application returned content/],
    ["a required limit dropped", (value: Json) => { value.limits = value.limits.filter((limit: Json) => limit.id !== "rehearsal-of-a-closed-call"); }, /record does not state the rehearsal-of-a-closed-call limit/],
  ])("refuses a copy with %s", (_label, change, reason) => {
    const copy = record();
    change(copy);
    expect(() => check(copy)).toThrow(reason);
  }, 120_000);
});
