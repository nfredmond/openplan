// @vitest-environment node
/**
 * Lane 45 closes changes to a proven job record that the checker used to
 * accept (KI-2026-11-14-303; review 43, non-blocking finding 2). Each case
 * makes one change to a copy, in memory, of the committed first proven job
 * record and reads the six committed PDFs with Poppler. Main's checker
 * (frozen byte for byte in fixtures/proven-job-checker-main-1fbfe95ed; PR 483
 * did not change it) accepts every changed copy, and the current checker
 * refuses each for the stated reason. Both accept the record unchanged.
 *
 * The last block runs changes the checker still accepts, so the limits the
 * capability-evidence README and KI-2026-11-14-303 state are executable: a
 * rule that starts refusing one of them fails here and the docs must follow.
 *
 * Lane 49 made the checker render the map item's page with Poppler's
 * pdftoppm and count its highlight-red pixels, with the journey's own rule
 * and threshold (scripts/lib/poppler-pixels.mjs). The map cases below point
 * the map item at each PDF's first page and at its ranked table's page; each
 * holds no highlight red and is refused for that. A PDF whose map page is
 * replaced by a blank page is not tried here: the PDF's own SHA-256 in the
 * record already refuses any changed file.
 *
 * Skips where `pdftotext` or `pdftoppm` on PATH is not Poppler's, as the
 * other real-PDF tests do; CI installs Poppler (KI-2026-11-14-101).
 *
 * Blind category: one change at a time to one real record. A record with two
 * faults may be refused for another of them. The cases show the rules fire on
 * these changes, not that no other change slips through.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as current from "../../scripts/ops/capability-evidence.mjs";
import * as main from "./fixtures/proven-job-checker-main-1fbfe95ed/openplan/scripts/ops/capability-evidence.mjs";
import { pdfToolVersion } from "../../scripts/lib/poppler-text.mjs";

const REPO_ROOT = resolve(process.cwd(), "..");
const RECORD = JSON.parse(readFileSync(resolve(REPO_ROOT, "docs/product/capability-evidence/first-proven-job.v1.json"), "utf8"));
const hasPoppler = ["pdftotext", "pdftoppm"].every((tool) => pdfToolVersion(tool).poppler);

// Each PDF is read once and shared by both checkers; the reader is not under comparison.
const pageCache = new Map<string, string[]>();
function readPdfPages(path: string): string[] {
  if (!pageCache.has(path)) pageCache.set(path, current.pdftotextPages(path));
  return pageCache.get(path)!;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a record under test is deliberately untyped JSON
type Json = any;
type Checker = Pick<typeof current, "validateProvenJobRecord">;

function verdict(checker: Checker, record: Json): string {
  try {
    checker.validateProvenJobRecord(structuredClone(record), { repoRoot: REPO_ROOT, readPdfPages });
    return "accepted";
  } catch (error) {
    return (error as Error).message;
  }
}
const changed = (mutate: (record: Json) => void): Json => {
  const record = structuredClone(RECORD);
  mutate(record);
  return record;
};
const journey = (record: Json, role: string) => record.journeys.find((entry: Json) => entry.role === role);
const pdf = (record: Json, role: string, kind: string) => journey(record, role).pdfs.find((entry: Json) => entry.kind === kind);
const item = (record: Json, role: string, kind: string, name: string) => pdf(record, role, kind).items.find((entry: Json) => entry.item === name);

// Every PDF of the record with its map page and the page its ranked table
// ends on: the page before the map in the plan, the page after it in the
// SS4A appendix.
const MAP_PDFS: Array<{ role: string; kind: string; path: string; mapPage: number; tablePage: number }> = RECORD.journeys.flatMap((j: Json) =>
  j.pdfs.map((p: Json) => {
    const mapPage = item(RECORD, j.role, p.kind, "high-injury-map").page;
    return { role: j.role, kind: p.kind, path: p.path, mapPage, tablePage: p.kind === "safety-action-plan" ? mapPage - 1 : mapPage + 1 };
  }),
);
const noRed = (role: string, kind: string, page: number) =>
  new RegExp(`^proven job record refused: ${role} journey ${kind} PDF high-injury-map page ${page} has 0 highlight-red pixels at 72 dpi; a map page needs at least 40$`);

describe.skipIf(!hasPoppler)("gaps in the proven job checker, shown on the real first proven job record (needs Poppler's pdftotext)", () => {
  it("both checkers accept the record unchanged", () => {
    expect({ main: verdict(main, RECORD), current: verdict(current, RECORD) }).toEqual({ main: "accepted", current: "accepted" });
  });

  it.each<[string, (record: Json) => void, RegExp]>([
    // Review 43 R1: one journey's four checks standing for all three journeys.
    ["cross-workspace checks cut to one journey's four", (r) => { r.crossWorkspace.checks = r.crossWorkspace.checks.slice(0, 4); },
      /cross-workspace checks hold 1 report-pdf-download data checks for safety-action-plan; this job needs one from each of its 3 journeys/],
    ["one journey's report download check dropped", (r) => { r.crossWorkspace.checks.splice(5, 1); },
      /hold 2 report-pdf-download data checks for safety-action-plan/],
    ["one journey's report page check dropped", (r) => { r.crossWorkspace.checks.splice(4, 1); },
      /hold 2 report-page page checks for safety-action-plan/],
    // R2b: each journey's screens cut to the sign-up page.
    ["each journey's screens cut to the sign-up page", (r) => { for (const j of r.journeys) j.screens = j.screens.filter((s: Json) => s.screen === "sign-up"); },
      /california-county journey has no check of the portal screen/],
    ["one journey without its grants application screen", (r) => { const j = journey(r, "tribal-area"); j.screens = j.screens.filter((s: Json) => s.screen !== "grants-application"); },
      /tribal-area journey has no check of the grants-application screen/],
    // R3: "matched" with any address and any note.
    ["a matched source check on an unrelated address", (r) => { r.sourceCheck.url = "https://example.org/anything"; },
      /a matched crash source check must name an https address on static\.nhtsa\.gov, crashviewer\.nhtsa\.dot\.gov, data\.ca\.gov, found https:\/\/example\.org/],
    ["a matched source check on a look-alike host", (r) => { r.sourceCheck.url = "https://static.nhtsa.gov.example.org/FARS2024NationalCSV.zip"; },
      /must name an https address on .* found https:\/\/static\.nhtsa\.gov\.example\.org/],
    ["a matched source check with a one-letter note", (r) => { r.sourceCheck.note = "x"; },
      /a matched crash source check note must say what was compared, in at least 80 characters/],
    // R4 and R13: crashes, segments and countermeasures in every journey.
    ["the California county storing no crash", (r) => { journey(r, "california-county").crashes.storedCount = 0; },
      /california-county journey stored 0 crashes; every journey of this job stores at least 1/],
    ["the tribal area storing no crash", (r) => { journey(r, "tribal-area").crashes.storedCount = 0; },
      /tribal-area journey stored 0 crashes; every journey of this job stores at least 1/],
    ["the California county with no ranked segment", (r) => { journey(r, "california-county").highInjuryNetwork.segmentCount = 0; },
      /california-county journey ranked 0 high-injury segments; at least 1 required/],
    ["the Nevada county with no countermeasure", (r) => { journey(r, "nevada-county").countermeasureCount = 0; },
      /nevada-county journey saved 0 countermeasures; at least 1 required/],
    // R8: approved comments and a staff review in every journey.
    ["a journey with no approved comment", (r) => { journey(r, "california-county").engagement.approvedCommentIds = []; },
      /california-county journey recorded 0 approved comments; at least 1 required/],
    ["a journey with no staff review", (r) => { journey(r, "tribal-area").engagement.staffReviewIds = []; },
      /tribal-area journey recorded 0 approved staff reviews; at least 1 required/],
    // R6 and R11: a text item names its own heading, as a line of its own.
    ["the SS4A crash summary pointed at page 2 as other words", (r) => { Object.assign(item(r, "california-county", "ss4a-application", "crash-summary"), { page: 2, text: "Safety problem" }); },
      /california-county journey ss4a-application PDF crash-summary must name its heading "Appendix B\. Crash summary", found "Safety problem"/],
    ["the plan's countermeasures item text changed to another word", (r) => { item(r, "nevada-county", "safety-action-plan", "countermeasures").text = "Source"; },
      /nevada-county journey safety-action-plan PDF countermeasures must name its heading "Countermeasures", found "Source"/],
    ["the crash summary pointed at a page where the words sit in a sentence", (r) => { item(r, "california-county", "safety-action-plan", "crash-summary").page = 22; },
      /california-county journey safety-action-plan PDF crash-summary heading "Crash summary" is not a line of its own on page 22/],
    ["the countermeasures item pointed at a table whose column is named Countermeasures", (r) => { item(r, "california-county", "safety-action-plan", "countermeasures").page = 15; },
      /countermeasures heading "Countermeasures" is not a line of its own on page 15/],
    // The map item's page is rendered and counted (lane 49). The heading
    // page carries the words "High-injury network map" and no red.
    ["the SS4A map pointed at its heading page, not the map", (r) => { item(r, "tribal-area", "ss4a-application", "high-injury-map").page = 8; },
      noRed("tribal-area", "ss4a-application", 8)],
    ...MAP_PDFS.map(({ role, kind }): [string, (record: Json) => void, RegExp] =>
      [`the ${role} ${kind} map pointed at page 1`, (r) => { item(r, role, kind, "high-injury-map").page = 1; }, noRed(role, kind, 1)]),
    ...MAP_PDFS.map(({ role, kind, tablePage }): [string, (record: Json) => void, RegExp] =>
      [`the ${role} ${kind} map pointed at its ranked table on page ${tablePage}`, (r) => { item(r, role, kind, "high-injury-map").page = tablePage; }, noRed(role, kind, tablePage)]),
  ])("main accepts and the current checker refuses %s", (_name, mutate, reason) => {
    const record = changed(mutate);
    expect(verdict(main, record)).toBe("accepted");
    expect(verdict(current, record)).toMatch(reason);
  });

  it("points the table cases at pages that hold the ranked table and not the map", () => {
    for (const { path, mapPage, tablePage } of MAP_PDFS) {
      const pages = readPdfPages(resolve(REPO_ROOT, path));
      expect(pages[tablePage - 1], `${path} page ${tablePage}`).toMatch(/\bRank\b[^\n]*\bLocation\b/);
      expect(tablePage, path).not.toBe(mapPage);
    }
  });

  // A check may name its journey (the schema field lane 45 added; main's
  // schema refuses it as unknown). A name must be one of the record's journeys.
  it("accepts checks that name their journeys and refuses one naming a journey the record does not hold", () => {
    const roles = RECORD.journeys.map((entry: Json) => entry.role);
    const named = changed((r) => r.crossWorkspace.checks.forEach((check: Json, index: number) => { check.journey = roles[Math.floor(index / 4)]; }));
    expect(verdict(current, named)).toBe("accepted");
    named.crossWorkspace.checks[0].journey = "oregon-county";
    expect(verdict(current, named)).toMatch(/report-page for another workspace's safety-action-plan names the oregon-county journey, which the record does not hold/);
  });

  // What the checker still cannot see. Each is accepted by both; the docs
  // say why and what else shows the truth.
  it.each<[string, (record: Json) => void]>([
    // The PNG's bytes differ between Poppler builds whose pixels are the
    // same, so its hash is not recomputed. The checker renders and counts the
    // map page itself instead, and recomputes pixelSha256 when a record
    // carries it (the first record predates that field).
    ["the map item's image hash replaced", (r) => { item(r, "california-county", "safety-action-plan", "high-injury-map").imageSha256 = "f".repeat(64); }],
    // No committed table maps a Census id to its name.
    ["a place's Census id changed with its label kept", (r) => { journey(r, "california-county").place.geoid = "06057"; }],
    // The first job's checks name no journey, so they are counted, not matched to journeys.
    ["one journey's checks repeated for all three", (r) => { r.crossWorkspace.checks = [0, 1, 2].flatMap(() => r.crossWorkspace.checks.slice(0, 4)); }],
    // The note is long enough; the checker cannot repeat the comparison.
    ["a matched source check whose note is long and untrue", (r) => { r.sourceCheck.note = "Compared nothing at all; this sentence is long enough to pass the length rule on its own words."; }],
  ])("both checkers still accept %s", (_name, mutate) => {
    const record = changed(mutate);
    expect({ main: verdict(main, record), current: verdict(current, record) }).toEqual({ main: "accepted", current: "accepted" });
  });
});
