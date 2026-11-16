// @vitest-environment node
/**
 * THE FIRST JOB'S DEFINITION NAMES ITS ACCESSIBILITY ENGINE AND THE WORDS OF
 * ITS LIMITS (KI-2026-11-16-020).
 *
 * Lane 66 pinned both for the engagement job only. A first-job record run on
 * another axe version, or one whose limit said the opposite of its id, was
 * still accepted. Each case here is one change to a copy of the committed
 * first record, read with its six committed PDFs; the committed record is
 * never written.
 *
 * One limit has two accepted wordings. The record of November 14, 2026 names
 * its own places in its FARS limit ("the Nevada county and tribal area
 * counts"), and a record cannot change, so the definition lists those words
 * after the place-neutral words the assembler now writes.
 *
 * Skips the checker runs where `pdftotext` or `pdftoppm` on PATH is not
 * Poppler's, as the committed record's own test does. CI installs Poppler.
 *
 * Blind category: these show the rules refuse the named changes. The engine
 * version and the limit words are still the journey's own statements; a run
 * that used another engine and wrote this version is not caught.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateProvenJobRecord } from "../../scripts/ops/capability-evidence.mjs";
import { pdfToolVersion } from "../../scripts/lib/poppler-text.mjs";

const REPO_ROOT = resolve(process.cwd(), "..");
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the record and the definitions are untyped JSON
type Json = any;
const read = (path: string): Json => JSON.parse(readFileSync(resolve(REPO_ROOT, path), "utf8"));
const record = () => read("docs/product/capability-evidence/first-proven-job.v1.json");
const definition = () => read("schemas/proven_job_definitions.v1.json").jobs.find((job: Json) => job.id === "safety-action-plan-and-ss4a-in-three-places");
const journeyLib = createRequire(import.meta.url)(resolve(REPO_ROOT, "qa-harness/first-job-journey-lib.js"));
const hasPoppler = ["pdftotext", "pdftoppm"].every((tool) => pdfToolVersion(tool).poppler);
const check = (value: Json) => validateProvenJobRecord(value, { repoRoot: REPO_ROOT });
const journeyOf = (value: Json, role: string) => value.journeys.find((journey: Json) => journey.role === role);
const limitOf = (value: Json, id: string) => value.limits.find((limit: Json) => limit.id === id);

describe("the first job's definition and the journey that writes its records", () => {
  it("names the engine and tags the journey runs", () => {
    expect(definition().screens.axe.version).toBe(journeyLib.AXE_VERSION);
    expect(definition().screens.axe.tags).toEqual(journeyLib.AXE_TAGS);
  });

  it("holds words for every limit the checker can require of this job", () => {
    const job = definition();
    const ids = [...job.requiredLimits, job.sourceCheck.unconfirmedLimit, job.crossWorkspace.pageAnsweredOkLimit];
    for (const id of ids) {
      const wordings = [job.limitTexts[id]].flat();
      expect(wordings.length, id).toBeGreaterThan(0);
      expect(wordings.every((text: unknown) => typeof text === "string" && text.length > 20), id).toBe(true);
    }
  });

  it("gives the assembler the definition's first wording for each limit, and no place name in the FARS limit", () => {
    const job = definition();
    const limits: Json[] = journeyLib.definitionLimits({ sourceConfirmed: false });
    expect(limits.map((limit) => limit.id)).toEqual([...job.requiredLimits, job.sourceCheck.unconfirmedLimit]);
    for (const limit of limits) expect(limit.text, limit.id).toBe([job.limitTexts[limit.id]].flat()[0]);
    expect(journeyLib.definitionLimits({ sourceConfirmed: true }).map((limit: Json) => limit.id)).toEqual(job.requiredLimits);
    const fars = limits.find((limit) => limit.id === "fars-is-fatal-only").text;
    expect(fars).not.toMatch(/Nevada|California|tribal/i);
    expect(fars).toContain("omits serious injuries");
  });

  it("keeps the committed record's own words among the accepted ones", () => {
    const job = definition();
    for (const limit of record().limits) {
      if (!Object.hasOwn(job.limitTexts, limit.id)) continue;
      expect([job.limitTexts[limit.id]].flat(), limit.id).toContain(limit.text);
    }
    // The four limits every record must state are all worded by the definition.
    expect(record().limits.filter((limit: Json) => Object.hasOwn(job.limitTexts, limit.id)).map((limit: Json) => limit.id)).toEqual(job.requiredLimits);
  });
});

describe.skipIf(!hasPoppler)("a first-job record against its definition's pins", () => {
  it("accepts the committed record as it is", () => {
    expect(() => check(record())).not.toThrow();
  });

  it("accepts the FARS limit in the words the assembler now writes", () => {
    const copy = record();
    limitOf(copy, "fars-is-fatal-only").text = definition().limitTexts["fars-is-fatal-only"][0];
    expect(() => check(copy)).not.toThrow();
  });

  it.each([
    ["one screen run on another engine version", (v: Json) => { journeyOf(v, "nevada-county").screens[3].axe.version = "4.10.2"; }, /nevada-county journey screen .* ran accessibility engine 4\.10\.2 .*this job's definition names 4\.11\.1/],
    ["one screen run with fewer rule tags", (v: Json) => { journeyOf(v, "tribal-area").screens[0].axe.tags = ["wcag2a"]; }, /tribal-area journey screen sign-up at 1440 px light ran accessibility engine 4\.11\.1 with tags wcag2a;/],
    ["the keyboard limit saying the opposite of its id", (v: Json) => { limitOf(v, "no-keyboard-or-screen-reader-pass").text = "A full keyboard-only and screen-reader pass was made."; }, /record's no-keyboard-or-screen-reader-pass limit does not carry its definition's words/],
    ["the usefulness limit saying a planner reviewed the PDFs", (v: Json) => { limitOf(v, "no-human-usefulness-review").text = "A planner reviewed the PDFs and found them useful."; }, /record's no-human-usefulness-review limit does not carry its definition's words/],
    ["the FARS limit saying its counts are complete", (v: Json) => { limitOf(v, "fars-is-fatal-only").text = "FARS records fatal crashes only, so the counts are complete."; }, /record's fars-is-fatal-only limit does not carry its definition's words/],
    ["the PDF/UA limit with one word changed", (v: Json) => { limitOf(v, "no-pdf-ua-check").text = "A PDF/UA check was run on the exported PDFs."; }, /record's no-pdf-ua-check limit does not carry its definition's words/],
  ])("refuses %s", (_what, change, reason) => {
    const copy = record();
    change(copy);
    expect(() => check(copy)).toThrow(reason);
  });

  it("leaves a limit the definition does not word to the record's own hash", () => {
    const copy = record();
    limitOf(copy, "hosted-pdf-fonts-are-one-family").text = "Changed words for a limit only this record states.";
    expect(() => check(copy)).not.toThrow();
  });
});
