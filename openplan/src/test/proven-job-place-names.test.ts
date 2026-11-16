// @vitest-environment node
/**
 * A PROVEN JOB RECORD'S PLACE LABEL IS THE CENSUS BUREAU'S NAME FOR ITS ID.
 *
 * Two fresh-context reviews (review 59, case P5; review 64, cases 22 and 23)
 * changed a place's Census id in a record and kept its label, and the checker
 * accepted the copy: Coos County's id became Douglas County's, and the Hopi
 * Reservation's id became its off-reservation trust land's. The checker had
 * no list of what each id is called.
 *
 * The list is the Bureau's 2026 Gazetteer, cut down to ids and names in
 * schemas/census_gazetteer_2026 (SOURCES.md there says how). The direction
 * check turns the rule on for every record in the registry, so a record with
 * a wrong label cannot be recorded. Synthetic examples and unit fixtures use
 * ids the Bureau does not list, on purpose, and call the checker without the
 * option.
 *
 * Skips the checker runs where `pdftotext` on PATH is not Poppler's, as the
 * committed records' own tests do. CI installs Poppler.
 *
 * WHAT THIS CANNOT PROVE. That the journey worked in the place it names: the
 * Gazetteer says what an id is called, nothing more. A tribal area's
 * Gazetteer row covers its reservation and its trust land, so the rule tells
 * the two apart only by the words "Trust Land" in the label.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateCapabilityEvidence, validateProvenJobRecord } from "../../scripts/ops/capability-evidence.mjs";
import { pdfToolVersion } from "../../scripts/lib/poppler-text.mjs";

const REPO_ROOT = resolve(process.cwd(), "..");
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- records and the registry are untyped JSON
type Json = any;
const read = (path: string): Json => JSON.parse(readFileSync(resolve(REPO_ROOT, path), "utf8"));
const first = () => read("docs/product/capability-evidence/first-proven-job.v1.json");
const second = () => read("docs/product/capability-evidence/second-proven-job.v1.json");
const hasPoppler = ["pdftotext", "pdftoppm"].every((tool) => pdfToolVersion(tool).poppler);
const place = (record: Json, role: string) => record.journeys.find((journey: Json) => journey.role === role).place;
const check = (record: Json) => validateProvenJobRecord(record, { repoRoot: REPO_ROOT, censusNames: true });

describe("the Gazetteer tables", () => {
  const table = (file: string) => readFileSync(resolve(REPO_ROOT, "schemas/census_gazetteer_2026", file), "utf8").split("\n");

  it("list every county, place, county subdivision and tribal area id once, with a name", () => {
    for (const [file, header, rows] of [["counties.tsv", "GEOID\tUSPS\tNAME", 3222], ["places.tsv", "GEOID\tUSPS\tNAME", 32363], ["cousubs.tsv", "GEOID\tUSPS\tNAME", 36381], ["aiannh.tsv", "GEOID\tNAME", 704]] as const) {
      const lines = table(file).filter(Boolean);
      expect(lines[0], file).toBe(header);
      expect(lines.length - 1, file).toBe(rows);
      const ids = lines.slice(1).map((line) => line.split("\t")[0]);
      expect(new Set(ids).size, file).toBe(ids.length);
      expect(lines.slice(1).every((line) => line.split("\t").every((cell) => cell.length > 0)), file).toBe(true);
    }
  });

  it("call the six places the two records name what the records call them", () => {
    expect(table("counties.tsv")).toContain("06091\tCA\tSierra County");
    expect(table("counties.tsv")).toContain("32017\tNV\tLincoln County");
    expect(table("counties.tsv")).toContain("41011\tOR\tCoos County");
    expect(table("places.tsv")).toContain("5644760\tWY\tLander city");
    expect(table("aiannh.tsv")).toContain("3010\tPyramid Lake Paiute Reservation");
    expect(table("aiannh.tsv")).toContain("1505\tHopi Reservation and Off-Reservation Trust Land");
  });
});

describe.skipIf(!hasPoppler)("a record's place label against the Gazetteer", () => {
  it("accepts both committed records as they are", () => {
    expect(() => check(first())).not.toThrow();
    expect(() => check(second())).not.toThrow();
  });

  it("accepts a place label that keeps the Bureau's descriptor word", () => {
    const record = second();
    place(record, "city-or-town").label = "Lander city, WY";
    expect(() => check(record)).not.toThrow();
  });

  it.each([
    ["Coos County's id changed to Douglas County's, label kept (review 64, case 22)", second, "county", (p: Json) => { p.geoid = "41019"; }, /county journey label "Coos County, OR" is not the Census Bureau's name for county 41019, which the 2026 Gazetteer calls "Douglas County" in OR/],
    ["the Hopi Reservation's id changed to its trust land's, label kept (review 64, case 23)", second, "tribal-area", (p: Json) => { p.geoid = "1505T"; }, /tribal-area journey label "Hopi Reservation, AZ" is not the Census Bureau's name for aiannh 1505T/],
    ["another tribal area's id, label kept", second, "tribal-area", (p: Json) => { p.geoid = "2430R"; }, /is not the Census Bureau's name for aiannh 2430R, which the 2026 Gazetteer calls "Navajo Nation Reservation and Off-Reservation Trust Land"/],
    ["a city's label changed, id kept", second, "city-or-town", (p: Json) => { p.label = "Riverton, WY"; }, /city-or-town journey label "Riverton, WY" is not the Census Bureau's name for city 5644760, which the 2026 Gazetteer calls "Lander city" in WY/],
    ["the right name in the wrong state", second, "county", (p: Json) => { p.label = "Coos County, NH"; }, /label "Coos County, NH" is not the Census Bureau's name for county 41011/],
    ["a label that is only the start of the name", second, "county", (p: Json) => { p.label = "Coos, OR"; }, /label "Coos, OR" is not the Census Bureau's name for county 41011/],
    ["a label with no name", second, "county", (p: Json) => { p.label = ", OR"; }, /is not the Census Bureau's name for county 41011/],
    ["an id the Bureau does not list", first, "nevada-county", (p: Json) => { p.geoid = "32998"; }, /nevada-county journey geoid 32998 is not a county id in the Census Bureau's 2026 Gazetteer/],
    ["a trust land label on a reservation id", first, "tribal-area", (p: Json) => { p.label = "Pyramid Lake Paiute Off-Reservation Trust Land, NV"; }, /is not the Census Bureau's name for aiannh 3010R/],
  ])("refuses %s", (_what, record, role, change, reason) => {
    const copy = record();
    change(place(copy, role));
    // The registry entry's own place rule would refuse a changed id first; the
    // record checker is called directly so the name rule is the one that answers.
    expect(() => check(copy)).toThrow(reason);
  });

  it("is off unless asked for, so a synthetic example with a made-up id is still checked by every other rule", () => {
    const copy = second();
    place(copy, "county").geoid = "41019";
    expect(() => validateProvenJobRecord(copy, { repoRoot: REPO_ROOT })).not.toThrow(/Census Bureau/);
  });

  it("is on for the registry: the direction check's call refuses a record whose label is not its id's name", () => {
    const registry = read("docs/product/US_PLANNING_CAPABILITY_REGISTRY.json");
    const today = new Date().toISOString().slice(0, 10);
    expect(() => validateCapabilityEvidence(registry, REPO_ROOT, today, { censusNames: true })).not.toThrow();
    const source = readFileSync(resolve(REPO_ROOT, "openplan/scripts/ops/product-direction-review.mjs"), "utf8");
    expect(source).toContain("validateCapabilityEvidence(registry, REPO_ROOT, new Date().toISOString().slice(0, 10), { censusNames: true });");
  });
});
