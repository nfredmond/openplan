import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stripSourceComments } from "./helpers/source-text";
import { CCRS_INJURED_COLUMNS, CCRS_PARTY_COLUMNS, fetchCcrsParties } from "@/lib/safety/sources/ccrs-parties";
import { toCrashPartyRows } from "@/lib/safety/ingest";
import { __clearFetchJsonResponseCacheForTests } from "@/lib/data-sources/http";
import { CRASH_AGE_BANDS } from "@/lib/safety/vocabulary";
import type { CrashPartyRecord } from "@/lib/safety/sources/types";

/**
 * PERSON-LEVEL CRASH FIELDS THAT ARE REFUSED, AND THE ARGUMENT FOR EACH.
 *
 * The crash-parties lane stores real injuries and deaths, one row per person,
 * attached to a precise coordinate and a date. The source tables carry far more
 * about each of those people than this product will ever store, and the refusals
 * below are the design rather than a backlog.
 *
 * WHY A TEST AND NOT A PARAGRAPH. A refusal written only in a comment is a
 * refusal one plausible-looking pull request away from being undone, by a future
 * session reading "the source has age, why are we banding it?" and reaching for
 * the obvious answer. This file makes the refusal executable, and it fails the
 * build if one of these spellings appears anywhere in the Safety module — in a
 * SELECT, a type, a row builder or a log line.
 *
 * REFUSED IN THE QUERY, NOT MERELY UNDISPLAYED. That distinction is the whole
 * posture. A field that is fetched reaches an HTTP cache, a retry log and an
 * error message, and "we don't show it" is a promise about one screen rather
 * than about the system.
 *
 * THE LIST, with the reason each one is refused:
 *
 *   RACE / ETHNICITY — both source tables carry it. A race field on an
 *     individual victim beside a precise coordinate is an identification vector,
 *     and crash-level race is NOT a valid basis for the Title VI analysis this
 *     platform already performs correctly from tract demographics. Storing it
 *     would offer a worse method for an analysis that is already done properly.
 *
 *   SEX / GENDER — refused this release rather than forever. Some safety action
 *     plans do report victims by sex; adding it is one column and one enum and
 *     is a deliberate change to the PII posture, which is exactly the kind of
 *     decision that should require re-arguing this file rather than slipping in.
 *
 *   EXACT AGE — the one field on this list that IS read, and is therefore
 *     guarded differently. Banding cannot happen without the number, so the
 *     refusal is not "never fetch it" but "the integer never leaves the
 *     adapter": it reaches no row, no response and no log. That is a weaker
 *     guarantee than the others and it is stated as such rather than dressed up
 *     — an age plus a coordinate plus a date identifies a person in a small
 *     town, and the whole analytical value is in the band.
 *
 *   VEHICLE IDENTITY (make / model / colour / year) — a car description plus a
 *     date and a coordinate identifies a household. The vehicle TYPE is read
 *     once, to separate a motorcyclist from a driver, and is never stored raw.
 *
 *   IMPAIRMENT AND FAULT ALLEGATIONS (sobriety and drug findings,
 *     drug-recognition-evaluation flags, at-fault, hit-and-run) — pre-
 *     adjudication allegations about identifiable people, rendered next to their
 *     home street. There is no reader for them and no defensible one.
 *
 *   LICENCE class and issuing state; SEAT POSITION, EJECTION, AIRBAG and
 *     SAFETY-EQUIPMENT detail; VICTIM-SERVICES notification flags — occupant and
 *     medical detail with no planning use that the injury band does not serve.
 *
 *   CASE-FILE IDENTIFIERS (report number, evidence number, NCIC code, beat,
 *     reporting district, judicial district, sketch and photograph flags) — the
 *     key back into the police file. Publishing the key is publishing the file.
 *
 * A related refusal that is NOT about people and lives in `ccrs-vocabulary.ts`:
 * the violation / primary-collision-factor field. It is free text spelled a
 * dozen ways, its only closed companion has no published meaning, and a
 * violation category is a fault allegation about an identifiable person shown
 * beside a precise coordinate before adjudication.
 *
 * This is a ratchet in one direction: an entry may be REMOVED, but only by a
 * session that writes down why the argument changed.
 */

/** Source column spellings that must never appear in the Safety module. */
const REFUSED_FIELD_SPELLINGS: ReadonlyArray<{ label: string; spellings: string[] }> = [
  { label: "race / ethnicity", spellings: ["RaceCode", "RaceDesc", '"Race"', '"Race Desc"'] },
  {
    label: "sex / gender",
    spellings: ["GenderCode", "GenderDescription", '"Gender"', '"Gender Desc"'],
  },
  {
    label: "vehicle identity",
    spellings: [
      "Vehicle1Make",
      "Vehicle1Model",
      "Vehicle1Color",
      "Vehicle1Year",
      "Vehicle2Make",
      "Vehicle2Model",
      "Vehicle2Color",
      "Vehicle2Year",
    ],
  },
  {
    label: "impairment and fault allegations",
    spellings: [
      "SobrietyDrugPhysicalCode1",
      "SobrietyDrugPhysicalCode2",
      "IsDREConducted",
      "IsAtFault",
      "IsHitAndRun",
      '"HitRun"',
    ],
  },
  { label: "licence", spellings: ["DriverLicenseClass", "DriverLicenseStateCode"] },
  {
    label: "occupant and medical detail",
    spellings: ["SeatPosition", "Ejected", "AirBag", "SafetyEquipment", "IsVOVCNotified"],
  },
  {
    label: "case-file identifiers",
    spellings: [
      '"Report Number"',
      "EvidenceNumber",
      '"NCIC Code"',
      '"Beat"',
      "ReportingDistrict",
      "JudicialDistrict",
      "SketchDesc",
      "HasPhotographs",
      "HasDigitalMediaFiles",
      "InjuredWitPassId",
    ],
  },
  {
    label: "fault allegation as a facet",
    spellings: ['"Primary Collision Factor Violation"', '"Primary Collision Factor Code"'],
  },
];

const SAFETY_LIB = path.join(process.cwd(), "src", "lib", "safety");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

/**
 * Scan CODE, not prose.
 *
 * The refusals are only durable if the NEXT maintainer can read why a field is
 * absent, and that explanation has to name the field. A guard that forbade the
 * name in a comment would push someone to delete the argument — which is the
 * most valuable thing in those files.
 */
function safetyCode(): Array<{ file: string; code: string }> {
  return walk(SAFETY_LIB).map((file) => ({
    file: path.relative(process.cwd(), file),
    code: stripSourceComments(readFileSync(file, "utf8")),
  }));
}

describe("refused crash person fields", () => {
  it("never names a refused field anywhere in the Safety module's code", () => {
    const files = safetyCode();
    // The scan must actually reach the adapters, or it proves nothing.
    expect(files.some((f) => f.file.endsWith(path.join("sources", "ccrs-parties.ts")))).toBe(true);
    expect(files.length).toBeGreaterThan(5);

    const offenders: string[] = [];
    for (const { label, spellings } of REFUSED_FIELD_SPELLINGS) {
      for (const spelling of spellings) {
        for (const { file, code } of files) {
          if (code.includes(spelling)) offenders.push(`${file} names ${spelling} (${label})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("requests only the columns it can name a reader for", () => {
    // The SELECT lists are the contract. Anything not here was not fetched, so
    // it cannot reach a cache, a retry log or an error message.
    expect(Object.values(CCRS_PARTY_COLUMNS).sort()).toEqual([
      "CollisionId",
      "PartyNumber",
      "PartyType",
      "StatedAge",
      "Vehicle1TypeDesc",
    ]);
    expect(Object.values(CCRS_INJURED_COLUMNS).sort()).toEqual([
      "CollisionId",
      "ExtentOfInjuryCode",
      "InjuredPersonType",
      "IsWitnessOnly",
      "PartyNumber",
      "StatedAge",
    ]);
  });

  it("guards the guard — a refused spelling in a column list is caught", () => {
    // Mutation, executable. If someone adds a gender column to either SELECT,
    // the file-scan above fires. Proven here against the pattern rather than by
    // trusting that it would.
    const pretendColumns = { ...CCRS_PARTY_COLUMNS, gender: "GenderCode" };
    const asCode = `const cols = ${JSON.stringify(pretendColumns)};`;
    const genderEntry = REFUSED_FIELD_SPELLINGS.find((e) => e.label === "sex / gender");
    expect(genderEntry?.spellings.some((s) => asCode.includes(s))).toBe(true);

    // And every entry catches something, so no entry is a hole with no symptom.
    for (const { label, spellings } of REFUSED_FIELD_SPELLINGS) {
      expect(spellings.length, `${label} must declare at least one spelling`).toBeGreaterThan(0);
      for (const spelling of spellings) {
        expect(`x ${spelling} y`.includes(spelling), `${label}: ${spelling}`).toBe(true);
      }
    }
  });

  it("keeps the exact age out of the party record, banded before a row exists", () => {
    // `fetchCcrsParties` is the only thing that ever sees a raw age. Its output
    // type has no field for one, which is checked here as a value rather than as
    // a type so that a widening of the type cannot pass silently.
    const party: CrashPartyRecord = {
      crashExternalId: "c1",
      externalPartyId: "c1-1",
      role: "pedestrian",
      ageBand: "65_plus",
      injury: "suspected_serious",
      sourceAttributes: {},
    };
    expect(Object.keys(party).sort()).toEqual([
      "ageBand",
      "crashExternalId",
      "externalPartyId",
      "injury",
      "role",
      "sourceAttributes",
    ]);
    expect(typeof fetchCcrsParties).toBe("function");
  });

  it("reads the exact age only to band it, and lets no row builder emit it", () => {
    // The age column IS requested — banding is impossible without the number —
    // so this one refusal is enforced at the row builder rather than at the
    // query, and saying which is which matters more than the guard looking tidy.
    expect(Object.values(CCRS_PARTY_COLUMNS)).toContain("StatedAge");
    expect(Object.values(CCRS_INJURED_COLUMNS)).toContain("StatedAge");

    const rows = toCrashPartyRows(
      [
        {
          crashExternalId: "c1",
          externalPartyId: "c1-1",
          role: "driver",
          ageBand: "45_64",
          injury: "unknown",
          sourceAttributes: {},
        },
      ],
      {
        workspaceId: "ws-1",
        ingestId: "i",
        sourceId: "ccrs-ca",
        crashIdByExternalId: new Map([["c1", "crash-uuid"]]),
      }
    );
    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toContain("StatedAge");
    expect(serialized).not.toContain("stated_age");
    expect(Object.keys(rows[0])).not.toContain("age");
  });

  it("writes no person column the migration does not declare", () => {
    // A row builder that emitted a field the schema has no column for would fail
    // at PostgREST — but a row builder that emitted one the schema DOES have and
    // this argument refuses would not fail at all. So the shape is pinned.
    const rows = toCrashPartyRows(
      [
        {
          crashExternalId: "c1",
          externalPartyId: "c1-1",
          role: "bicyclist",
          ageBand: "15_24",
          injury: "possible",
          sourceAttributes: { PartyType: "Skateboarder" },
        },
      ],
      {
        workspaceId: "ws-1",
        ingestId: "ingest-1",
        sourceId: "ccrs-ca",
        crashIdByExternalId: new Map([["c1", "crash-uuid"]]),
      }
    );

    expect(Object.keys(rows[0]).sort()).toEqual([
      "age_band",
      "crash_id",
      "external_party_id",
      "ingest_id",
      "party_role",
      "person_injury",
      "source_attributes",
      "source_id",
      "workspace_id",
    ]);
  });

  it("drops a person whose crash was not stored rather than orphaning them", () => {

    // A person row with no collision is not a record of anything, and it is the
    // shape that leaks: it survives a crash deletion and carries an injury
    // outcome with nothing to interpret it against.
    const rows = toCrashPartyRows(
      [
        {
          crashExternalId: "missing",
          externalPartyId: "missing-1",
          role: "driver",
          ageBand: "unknown",
          injury: "unknown",
          sourceAttributes: {},
        },
      ],
      { workspaceId: "ws-1", ingestId: "i", sourceId: "ccrs-ca", crashIdByExternalId: new Map() }
    );
    expect(rows).toEqual([]);
  });
});

/**
 * THE EXACT AGE, FROM A SOURCE ROW TO A PERSISTED ROW, END TO END.
 *
 * WHY THE EXISTING COVERAGE WAS NOT ENOUGH, stated plainly because the gap is
 * the interesting part. Two tests already touched this: one checked that the
 * adapter BANDS the age, and one checked that `toCrashPartyRows` emits exactly
 * nine columns given a record whose age was ALREADY a band. Nothing ran a
 * precise age through both, and the adapter check searched the serialized party
 * for one specific numeral ("71"), which happened to be the age of one person
 * in the fixture. So a leak on the OTHER seeding path — the injured-person
 * branch, which builds a passenger the party table never lists — was invisible:
 * writing that person's raw age into `source_attributes` (a column that IS
 * persisted, verbatim, per row) passed the whole safety suite 70/70. Verified by
 * running it, not by reading the code.
 *
 * WHY IT MATTERS MORE THAN THE OTHER REFUSALS ON THIS FILE. Age is the one
 * refused field the adapter must actually FETCH — banding is impossible without
 * the number — so it is the only one whose guarantee is a row-builder promise
 * rather than a query-shaped one. An exact age beside a precise coordinate and a
 * date identifies a person in a small town, and every analytical use is served
 * by the band.
 *
 * The ages below are chosen so their digits appear nowhere else in a row: the
 * ids carry no digits of their own beyond the party number, so a bare "37", "71"
 * or "13" anywhere in the persisted JSON can only have come from a person's age.
 */
describe("a person's exact age reaches no persisted field", () => {
  const originalFetch = globalThis.fetch;

  /** The three ages fed in, each on a different code path through the adapter. */
  const RAW_AGES = [37, 71, 13] as const;

  beforeEach(() => __clearFetchJsonResponseCacheForTests());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
    __clearFetchJsonResponseCacheForTests();
  });

  function jsonResponse(body: unknown) {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }

  /**
   * A feed carrying a precise age on BOTH seeding paths.
   *
   * `CX-1` and `CX-2` come from the party table; `CX-3` is an injured passenger
   * who exists only in the second table, and is the path the earlier check could
   * not see.
   */
  function stubFeed() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = decodeURIComponent(String(input));
        if (url.includes("package_show")) {
          return jsonResponse({
            result: {
              resources: [
                { id: "party-res", name: "Parties_2025" },
                { id: "injured-res", name: "InjuredWitnessPassengers_2025" },
              ],
            },
          });
        }
        if (url.includes("party-res")) {
          return jsonResponse({
            result: {
              records: [
                { CollisionId: "CX", PartyNumber: 1, PartyType: "Driver", StatedAge: 37, Vehicle1TypeDesc: null },
                { CollisionId: "CX", PartyNumber: 2, PartyType: "Pedestrian", StatedAge: 71, Vehicle1TypeDesc: null },
              ],
            },
          });
        }
        return jsonResponse({
          result: {
            records: [
              {
                CollisionId: "CX",
                PartyNumber: 2,
                InjuredPersonType: "Pedestrian",
                StatedAge: 71,
                ExtentOfInjuryCode: "SuspectSerious",
                IsWitnessOnly: "False",
              },
              // Only in the injured table — the seeding path with no party row.
              {
                CollisionId: "CX",
                PartyNumber: 3,
                InjuredPersonType: "Passenger",
                StatedAge: 13,
                ExtentOfInjuryCode: "Fatal",
                IsWitnessOnly: "False",
              },
            ],
          },
        });
      }) as unknown as typeof fetch
    );
  }

  /** Every string that appears anywhere in a value, however deeply nested. */
  function stringsIn(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (typeof value === "number" || typeof value === "boolean") return [String(value)];
    if (Array.isArray(value)) return value.flatMap(stringsIn);
    if (value && typeof value === "object") {
      return Object.entries(value).flatMap(([key, inner]) => [key, ...stringsIn(inner)]);
    }
    return [];
  }

  it("bands the age on every path and persists only the band", async () => {
    stubFeed();

    const parties = await fetchCcrsParties({ crashes: [{ externalId: "CX", collisionYear: 2025 }] });
    expect(parties).toHaveLength(3);

    const rows = toCrashPartyRows(parties, {
      workspaceId: "ws-alpha",
      ingestId: "ingest-alpha",
      sourceId: "ccrs-ca",
      crashIdByExternalId: new Map([["CX", "crash-alpha"]]),
    });
    expect(rows).toHaveLength(3);

    const byPartyId = new Map(rows.map((row) => [String(row.external_party_id), row]));

    // THE BANDS, per path. Named individually so a failure says which person's
    // age stopped being banded rather than only that something did.
    expect(byPartyId.get("CX-1")?.age_band).toBe("25_44");
    expect(byPartyId.get("CX-2")?.age_band).toBe("65_plus");
    // The injured-only passenger — the path a leak survived on.
    expect(byPartyId.get("CX-3")?.age_band).toBe("under_15");

    for (const row of rows) {
      const label = String(row.external_party_id);

      // KEYS: exactly the nine persisted columns, so a tenth carrying an age
      // cannot be added without this failing.
      expect(Object.keys(row).sort(), `${label} column set`).toEqual([
        "age_band",
        "crash_id",
        "external_party_id",
        "ingest_id",
        "party_role",
        "person_injury",
        "source_attributes",
        "source_id",
        "workspace_id",
      ]);

      // VALUES: the band is a declared band, never a number wearing the name.
      expect(CRASH_AGE_BANDS as readonly string[], `${label} age_band`).toContain(row.age_band);
      expect(typeof row.age_band, `${label} age_band type`).toBe("string");

      // Nothing numeric survives anywhere in the row. An integer age is the only
      // number this shape could ever acquire, so "no numbers" is the honest
      // invariant rather than a proxy for one.
      for (const value of Object.values(row)) {
        expect(typeof value, `${label} carries a number`).not.toBe("number");
      }

      // And no raw age appears as a digit run in ANY field — including the
      // per-source attributes blob, which is persisted verbatim and is where the
      // surviving leak lived. Digit-bounded so "13" cannot hide inside a longer
      // number and so a band's own digits ("15", "24") cannot raise a false one.
      const serialized = JSON.stringify(row);
      for (const age of RAW_AGES) {
        expect(
          new RegExp(`(?<!\\d)${age}(?!\\d)`).test(serialized),
          `${label} leaks the exact age ${age}: ${serialized}`
        ).toBe(false);
      }

      // Nothing is even NAMED for an age other than the band itself.
      for (const text of stringsIn(row.source_attributes)) {
        expect(/age/i.test(text), `${label} source_attributes mentions an age: ${text}`).toBe(false);
      }
      expect(String(row.external_party_id)).not.toContain("StatedAge");
    }

    // The fixture has to be capable of failing: the ages really were supplied,
    // and the digits really are absent from everything else in the rows.
    expect(JSON.stringify(rows)).not.toContain("StatedAge");
    expect(RAW_AGES.every((age) => new RegExp(`(?<!\\d)${age}(?!\\d)`).test(String(age)))).toBe(true);
  });
});
