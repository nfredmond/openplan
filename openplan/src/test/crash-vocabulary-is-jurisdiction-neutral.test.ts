import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripSourceComments } from "./helpers/source-text";
import {
  CRASH_AGE_BANDS,
  CRASH_COLLISION_TYPES,
  CRASH_DIMENSIONS,
  CRASH_DIMENSION_COLUMNS,
  CRASH_DIMENSION_SPECS,
  CRASH_LEVEL_ONLY_DIMENSION_SUPPORT,
  CRASH_LIGHTING_CONDITIONS,
  CRASH_PARTY_ROLES,
  CRASH_PERSON_INJURIES,
  CRASH_SEVERITIES,
  CRASH_WEATHER_CONDITIONS,
  findDescriptorVocabularyViolations,
  mapCrashDimension,
  toCrashAgeBand,
  type CrashSourceVocabularyDescriptor,
} from "@/lib/safety/vocabulary";
import { CRASH_SOURCE_ADAPTERS } from "@/lib/safety/sources/registry";

/**
 * THE CONSTRAINT THIS FILE ENFORCES, in one sentence: a planner in another state
 * must be able to get their own crash feed into OpenPlan by adding a DESCRIPTOR,
 * and never by editing a core type, a filter enum, a route or a screen.
 *
 * The crash vocabulary was built against one state's feed, which is the exact
 * circumstance in which a jurisdiction leaks into a shared type. It leaks in
 * three ways, and each has a test below:
 *
 *   1. A VALUE named after a jurisdiction's form. "BROADSIDE" is what one state
 *      calls an angle collision and a KABCO letter is what one country's crash
 *      taxonomy calls a severity. Either one in the neutral vocabulary means a
 *      planner elsewhere is filtering by somebody else's paperwork.
 *   2. A SPELLING escaping the descriptor. The mapping tables are the only place
 *      a source's own strings may exist; the moment one appears in a route or a
 *      component, coverage advances by editing call sites again.
 *   3. A GAP shaped by one source. The first source has no motorcyclist party
 *      type, so the tempting move is to leave `motorcyclist` out of the role
 *      vocabulary — and then the next source that HAS one cannot express it
 *      without a migration.
 *
 * The second descriptor below is a FIXTURE, not a shipped adapter, and it is
 * written with realistically ugly field spellings on purpose. A pretend registry
 * with tidy values proves only that tidy values work, and the whole risk here is
 * the untidy ones.
 */

const SRC = path.join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

/** Product source only, and never the descriptors' own home. */
function productFilesOutsideSources(): string[] {
  const adapters = path.join(SRC, "lib", "safety", "sources");
  return walk(SRC).filter(
    (file) => !file.startsWith(path.join(SRC, "test")) && !file.startsWith(adapters)
  );
}

function codeOf(file: string): string {
  return stripSourceComments(readFileSync(file, "utf8"));
}

/**
 * The dimension columns whose name is distinctive enough to guard by spelling.
 *
 * `severity`, `lighting` and `weather` are deliberately NOT here. They are
 * ordinary English words and ordinary column names elsewhere in the product (a
 * project risk has a severity; an engagement template mentions street
 * lighting), so a spelling guard on them would fire on prose-shaped strings
 * that have nothing to do with a collision. The three below occur nowhere in
 * this product except as crash vocabulary columns.
 */
const GUARDED_DIMENSION_COLUMNS = ["collision_type", "party_role", "person_injury"] as const;

/**
 * Every string literal in a chunk of source.
 *
 * A `.select()` projection is one long string, so the column name a guard is
 * looking for sits in the MIDDLE of a literal rather than hugging its quotes.
 * Literals are extracted first and matched second so that a column name can be
 * found as a word inside one without the matcher ever seeing bare code — an
 * identifier like `collisionType` or a local named `party_role_label` is not a
 * second spelling of a column and must not be reported as one.
 */
function stringLiteralsIn(code: string): string[] {
  return code.match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? [];
}

/**
 * Which guarded column names this source spells inside a string literal.
 *
 * WHY THIS IS WORD-BASED AND NOT QUOTE-ADJACENT. The first version of this
 * guard required a quote immediately after the column name, so it saw
 * `"collision_type"` and was blind to
 * `"id, severity, collision_type, lighting, weather"`. A multi-column select
 * string is precisely the shape a second reader of the vocabulary takes, and
 * `/api/map-features/crashes` had been one for its whole life without this test
 * noticing: a seventh dimension added to `vocabulary.ts` reached the workbench
 * query and the export CSV automatically and would never have reached the
 * shared map backdrop.
 *
 * Comments are stripped by the SHARED stripper before anything is matched, so
 * the paragraph you are reading — which names all three columns — is not a
 * violation. Three private strippers once grew in this directory and no two
 * behaved alike; see `src/test/helpers/source-text.ts`.
 */
function guardedColumnsSpelledIn(source: string): string[] {
  const literals = stringLiteralsIn(stripSourceComments(source));
  return GUARDED_DIMENSION_COLUMNS.filter((column) =>
    literals.some((literal) => new RegExp(`\\b${column}\\b`).test(literal))
  );
}

/**
 * A SECOND JURISDICTION, invented for this test.
 *
 * A pretend statewide feed with the kind of field spellings real agency data
 * actually carries: SHOUTED constants in one field, TitleCase in another,
 * hyphens and slashes, a stray leading space, and a value nobody declared. If
 * this descriptor needs one line of production code to work, the "add a
 * descriptor, not a code change" claim is false and this test says so.
 *
 * Deliberately NOT modelled on the shipped adapter: different spellings,
 * different casing conventions, a dimension it does not record at all, and a
 * dimension it records with a value the vocabulary has no member for.
 */
const PRETEND_STATE_DESCRIPTOR: CrashSourceVocabularyDescriptor = {
  sourceId: "wcrash-wr",
  support: {
    severity: "supplied",
    collision_type: "supplied",
    // This state's crash form has no lighting field at all. The honest posture,
    // and the one a facet must render as "this source does not record it".
    lighting: "not_supplied",
    weather: "supplied",
    party_role: "supplied",
    person_injury: "partial",
  },
  maps: {
    collision_type: {
      "STRUCK FROM BEHIND": "rear_end",
      "SIDESWIPE-SAME DIR": "sideswipe",
      "SIDESWIPE-OPP DIR": "sideswipe",
      "HEAD ON": "head_on",
      "RIGHT ANGLE": "angle",
      "STRUCK FIXED OBJECT": "hit_object",
      ROLLOVER: "overturn",
      "MV/PED": "vehicle_pedestrian",
      UNCLASSIFIED: "other",
    },
    weather: {
      "CLEAR/SUNNY": "clear",
      OVERCAST: "cloudy",
      "RAIN/SLEET": "rain",
      "SNOW/HAIL": "snow",
      "FOG/SMOG/SMOKE": "fog",
      "SEVERE CROSSWIND": "wind",
    },
    party_role: {
      "MOTOR VEHICLE OPERATOR": "driver",
      OCCUPANT: "passenger",
      "PEDESTRIAN/WHEELCHAIR": "pedestrian",
      PEDALCYCLIST: "bicyclist",
      // The first shipped source has no such party type. If the vocabulary had
      // been shaped by that gap, this line could not be written.
      "MOTORCYCLE OPERATOR": "motorcyclist",
      "UNATTENDED VEHICLE": "parked_vehicle",
    },
    person_injury: {
      K: "fatal",
      A: "suspected_serious",
      B: "suspected_minor",
      C: "possible",
      O: "no_apparent_injury",
    },
  },
};

describe("the neutral crash vocabulary carries no jurisdiction", () => {
  it("names every value for a physical fact, not for a form or a code letter", () => {
    const everyValue = [
      ...CRASH_SEVERITIES,
      ...CRASH_COLLISION_TYPES,
      ...CRASH_LIGHTING_CONDITIONS,
      ...CRASH_WEATHER_CONDITIONS,
      ...CRASH_PARTY_ROLES,
      ...CRASH_PERSON_INJURIES,
      ...CRASH_AGE_BANDS,
    ];

    // The spellings that would mean a jurisdiction had leaked in. Each one is a
    // real value from a real crash file, which is what makes them plausible
    // rather than a strawman.
    const jurisdictionSpellings = [
      "broadside",
      "pedestrain",
      "kabco",
      "ksi",
      "switrs",
      "ccrs",
      "fars",
      "mmucc",
      "vc",
      "caltrans",
      "california",
      "statewide",
      "suspectserious",
      "severeinactive",
      "complaintofpain",
      "parkedvehicle",
      "autonomousvehicle",
      "raining",
      "snowing",
      "dusk-dawn",
    ];
    for (const value of everyValue) {
      expect(jurisdictionSpellings, `"${value}" is a jurisdiction's own spelling`).not.toContain(
        value.toLowerCase()
      );
      // A bare KABCO letter as a whole value.
      expect(value, `"${value}" is a bare severity code letter`).not.toMatch(/^[a-z]$/i);
    }
  });

  it("keeps a role the first source cannot express, so the next source can", () => {
    // `motorcyclist` has no counterpart party type in the only shipped adapter's
    // source — it is derived from a vehicle column. A vocabulary shaped by that
    // gap is one the next feed has to fight.
    expect(CRASH_PARTY_ROLES).toContain("motorcyclist");
    expect(PRETEND_STATE_DESCRIPTOR.maps.party_role?.["MOTORCYCLE OPERATOR"]).toBe("motorcyclist");
  });

  it("gives every dimension a declared absent value and a declared fallback", () => {
    // Without both, an adapter author has to invent a behaviour for "the source
    // said nothing" and another for "the source said something we do not know",
    // and two adapters will invent different ones.
    for (const dimension of CRASH_DIMENSIONS) {
      const spec = CRASH_DIMENSION_SPECS[dimension];
      expect(spec.values, `${dimension} must declare its absent value`).toContain(spec.absent);
      expect(spec.values, `${dimension} must declare its unmapped value`).toContain(spec.unmapped);
      expect(spec.column).toBe(CRASH_DIMENSION_COLUMNS[dimension]);
    }
  });

  it("spells the dimension COLUMN names in exactly one module", () => {
    // The column name is the single declaration from which a Postgres predicate
    // and a TypeScript predicate are both generated. A second hand-written copy
    // is how a facet becomes filterable in the API and unreachable in the UI.
    const offenders: string[] = [];
    for (const file of productFilesOutsideSources()) {
      if (file.endsWith(path.join("lib", "safety", "vocabulary.ts"))) continue;
      for (const column of guardedColumnsSpelledIn(readFileSync(file, "utf8"))) {
        offenders.push(`${path.relative(process.cwd(), file)} spells "${column}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("finds a column name in the MIDDLE of a select string, not only beside a quote", () => {
    // The mutation that defeated the earlier version of the guard above, run
    // here as an assertion so the widening is proven rather than claimed. A
    // projection is one long string; a column name inside one is a second
    // spelling exactly as much as a name in its own quotes is.
    expect(guardedColumnsSpelledIn(`const SEL = "id, collision_type, lighting";`)).toEqual([
      "collision_type",
    ]);
    expect(
      guardedColumnsSpelledIn(
        "const SEL = `crash_id, party_role, age_band, person_injury`;"
      )
    ).toEqual(["party_role", "person_injury"]);
    expect(guardedColumnsSpelledIn(`const SEL = 'x, collision_type';`)).toEqual(["collision_type"]);
    // And the original quote-adjacent shape is still caught.
    expect(guardedColumnsSpelledIn(`row["collision_type"]`)).toEqual(["collision_type"]);
  });

  it("does not fire on prose, on a comment, or on a longer name that merely contains one", () => {
    // The three ways a widened matcher goes wrong, each asserted. A guard that
    // false-positives gets weakened by the next person who trips it, so the
    // ways it must NOT fire are as load-bearing as the ways it must.
    expect(guardedColumnsSpelledIn(`// the collision_type column moved\nconst x = 1;`)).toEqual([]);
    expect(guardedColumnsSpelledIn(`/** party_role lives in the vocabulary */\nconst x = 1;`)).toEqual(
      []
    );
    // The cases that need the STRIPPER, not just the literal extractor: a
    // comment that quotes the very projection it is explaining. Real files here
    // are full of these — `crash-filters.ts` argues at length about why it must
    // not spell a column — and dropping the shared stripper makes the sweep
    // report that file as an offender. Proven by mutation, not assumed.
    expect(
      guardedColumnsSpelledIn(`// it used to select "id, collision_type, lighting" here\nconst x = 1;`)
    ).toEqual([]);
    expect(
      guardedColumnsSpelledIn(`/** the projection was "crash_id, party_role" once */\nconst x = 1;`)
    ).toEqual([]);
    expect(guardedColumnsSpelledIn(`const s = "collision_type_desc";`)).toEqual([]);
    expect(guardedColumnsSpelledIn(`const s = "raw_person_injury_code";`)).toEqual([]);
    // A bare identifier is not a spelling of the column — only a literal is.
    expect(guardedColumnsSpelledIn(`const collision_type = spec.column;`)).toEqual([]);
  });

  it("keeps every source's own spelling inside the adapter directory", () => {
    // Values from the shipped source's raw feed. If one of these appears outside
    // `sources/`, a jurisdiction has reached the shared surface and coverage has
    // gone back to advancing by editing call sites.
    const rawSourceSpellings = [
      "BROADSIDE",
      "VEHICLE/PEDESTRAIN",
      "DARK-NO STREET LIGHTS",
      "DUSK-DAWN",
      "FOG/VISIBILITY",
      "SuspectSerious",
      "SevereInactive",
      "ParkedVehicle",
      "MotorVehicleInvolvedWithDesc",
      "LightingDescription",
      "ExtentOfInjuryCode",
    ];
    const offenders: string[] = [];
    for (const file of productFilesOutsideSources()) {
      const code = codeOf(file);
      for (const spelling of rawSourceSpellings) {
        if (code.includes(spelling)) {
          offenders.push(`${path.relative(process.cwd(), file)} names "${spelling}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("lets nothing outside the adapter directory read a key out of source_attributes", () => {
    // The per-source blob is the escape hatch for values the mapping does not
    // cover. It is only safe while it stays an ARCHIVE: a screen that reads a key
    // out of it has made one source's private spelling part of the product.
    const offenders = productFilesOutsideSources()
      .filter((file) => /sourceAttributes\s*(?:\[|\?\.\[|\.[A-Za-z_])/.test(codeOf(file)))
      .map((file) => path.relative(process.cwd(), file));
    expect(offenders).toEqual([]);
  });
});

describe("a second jurisdiction needs only a descriptor", () => {
  it("maps a completely different feed's spellings with no production change", () => {
    const map = (dimension: Parameters<typeof mapCrashDimension>[1], raw: unknown) =>
      mapCrashDimension(PRETEND_STATE_DESCRIPTOR, dimension, raw);

    expect(map("collision_type", "STRUCK FROM BEHIND")?.value).toBe("rear_end");
    expect(map("collision_type", "MV/PED")?.value).toBe("vehicle_pedestrian");
    expect(map("weather", "CLEAR/SUNNY")?.value).toBe("clear");
    expect(map("party_role", "MOTORCYCLE OPERATOR")?.value).toBe("motorcyclist");
    expect(map("person_injury", "K")?.value).toBe("fatal");
    // Casing drift and a stray leading space are absorbed — real feeds have both
    // — while still being an EXACT declared match.
    expect(map("party_role", "  pedalcyclist ")?.value).toBe("bicyclist");
  });

  it("declares a dimension it does not record, rather than reporting an empty one", () => {
    // NULL, not "unknown". "Unknown" would claim the source asked and got no
    // answer; the truth is that this state's form has no lighting field.
    expect(map_lighting()).toBeNull();
    expect(PRETEND_STATE_DESCRIPTOR.support.lighting).toBe("not_supplied");
    // The shipped fatality-census capability makes the same statement.
    expect(CRASH_LEVEL_ONLY_DIMENSION_SUPPORT.lighting).toBe("not_supplied");

    function map_lighting() {
      return mapCrashDimension(PRETEND_STATE_DESCRIPTOR, "lighting", "DAYLIGHT");
    }
  });

  it("counts an undeclared value instead of guessing what it meant", () => {
    // The tail of a real weather field is operator free text — an indoor car
    // wash, a named wildfire's smoke, a blowing-dust visibility estimate. Fuzzy
    // matching any of it into a category is inventing an observation about a
    // real collision.
    const drizzle = mapCrashDimension(PRETEND_STATE_DESCRIPTOR, "weather", "LIGHT DRIZZLE");
    expect(drizzle).toEqual({ value: "other", raw: "LIGHT DRIZZLE", unmapped: true });
    const misty = mapCrashDimension(PRETEND_STATE_DESCRIPTOR, "weather", "MISTY");
    expect(misty?.value).not.toBe("rain");
    expect(misty?.value).not.toBe("fog");
  });

  it("separates 'the source said nothing' from 'the source said something new'", () => {
    const absent = mapCrashDimension(PRETEND_STATE_DESCRIPTOR, "collision_type", null);
    expect(absent).toEqual({ value: "unknown", raw: null, unmapped: false });
    const blank = mapCrashDimension(PRETEND_STATE_DESCRIPTOR, "collision_type", "   ");
    expect(blank).toEqual({ value: "unknown", raw: null, unmapped: false });

    const novel = mapCrashDimension(PRETEND_STATE_DESCRIPTOR, "collision_type", "TRAIN STRIKE");
    expect(novel).toEqual({ value: "other", raw: "TRAIN STRIKE", unmapped: true });
  });

  it("rejects a descriptor that maps onto a value the vocabulary does not have", () => {
    // The failure this catches happens at ingest time, against a live source, on
    // somebody else's machine: a CHECK constraint violation mid-write.
    const typo: CrashSourceVocabularyDescriptor = {
      ...PRETEND_STATE_DESCRIPTOR,
      maps: { ...PRETEND_STATE_DESCRIPTOR.maps, collision_type: { ROLLOVER: "overturned" } },
    };
    const violations = findDescriptorVocabularyViolations(typo);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ dimension: "collision_type", value: "overturned" });

    // A lower-case key can never match, because keys are compared upper-cased —
    // a mapping that silently never fires is worse than one that errors.
    const lowerCased: CrashSourceVocabularyDescriptor = {
      ...PRETEND_STATE_DESCRIPTOR,
      maps: { ...PRETEND_STATE_DESCRIPTOR.maps, weather: { overcast: "cloudy" } },
    };
    expect(findDescriptorVocabularyViolations(lowerCased)).toHaveLength(1);

    // And the fixture itself is clean, so the assertions above are about the
    // mutations and not about a pre-existing fault.
    expect(findDescriptorVocabularyViolations(PRETEND_STATE_DESCRIPTOR)).toEqual([]);
  });

  it("requires every registered adapter to declare all six dimensions", () => {
    // The declaration is what the filter panel renders a disabled facet from.
    // An adapter that omitted one would leave the panel guessing.
    for (const adapter of CRASH_SOURCE_ADAPTERS) {
      for (const dimension of CRASH_DIMENSIONS) {
        expect(
          adapter.dimensions[dimension],
          `${adapter.id} must declare ${dimension}`
        ).toMatch(/^(supplied|partial|not_supplied)$/);
      }
      // A source that declares person-level dimensions must be able to fetch
      // people, and vice versa — otherwise the panel offers a facet nothing fills.
      const claimsPeople =
        adapter.dimensions.person_injury !== "not_supplied" ||
        adapter.dimensions.party_role === "supplied";
      expect(typeof adapter.fetchParties === "function", `${adapter.id} party capability mismatch`).toBe(
        claimsPeople
      );
    }
  });
});

describe("age banding is one function everywhere", () => {
  it("bands at the declared boundaries", () => {
    expect(toCrashAgeBand(0)).toBe("under_15");
    expect(toCrashAgeBand(14)).toBe("under_15");
    expect(toCrashAgeBand(15)).toBe("15_24");
    expect(toCrashAgeBand(24)).toBe("15_24");
    expect(toCrashAgeBand(25)).toBe("25_44");
    expect(toCrashAgeBand(44)).toBe("25_44");
    expect(toCrashAgeBand(45)).toBe("45_64");
    expect(toCrashAgeBand(64)).toBe("45_64");
    expect(toCrashAgeBand(65)).toBe("65_plus");
    expect(toCrashAgeBand("83")).toBe("65_plus");
  });

  it("refuses to band an unusable age rather than guessing one", () => {
    // Agency feeds use large sentinel ages. Banding one into 65_plus would put a
    // placeholder into an equity count that a grant application cites.
    for (const value of [null, undefined, "", "unknown", -1, 999, Number.NaN]) {
      expect(toCrashAgeBand(value)).toBe("unknown");
    }
  });
});
