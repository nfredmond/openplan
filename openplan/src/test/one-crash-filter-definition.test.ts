import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyCrashFiltersToQuery,
  CRASH_FILTER_DEFAULTS,
  CRASH_FILTER_FACETS,
  CRASH_QUERY_PROJECTION,
  CRASH_YEAR_FIELD,
  crashFeatureMatchesFilters,
  crashFilterColumns,
  crashFilterProperties,
  crashFilterSearchParams,
  describeCrashDimensions,
  facetAvailability,
  facetValues,
  narrowedChoice,
  parseCrashFilterSelection,
  type CrashFacetId,
  type CrashFilterSelection,
  type CrashQueryBuilderLike,
} from "@/lib/safety/crash-filters";
import { toLiveCrashCollection } from "@/lib/safety/ingest";
import type { CrashRecord } from "@/lib/safety/sources/types";

/**
 * ONE DEFINITION, TWO INTERPRETERS — and this file is the thing that makes that
 * claim checkable instead of aspirational.
 *
 * The crash filters used to exist twice: as PostgREST calls in the query route,
 * and as hand-written TypeScript predicates in the Safety workspace for the live
 * lane, whose crashes never reach Postgres. The second carried a comment saying
 * it was "written to mirror" the first. A convention only written down has
 * already been violated somewhere, and the failure mode is invisible: a facet
 * added to one lane and not the other produces a filter that answers differently
 * depending on whether the planner acquired the data or read it live, with no
 * error anywhere.
 *
 * THE MECHANISM UNDER TEST. `applyCrashFiltersToQuery` and
 * `crashFeatureMatchesFilters` both walk `CRASH_FILTER_FACETS` and neither
 * contains a per-facet branch. The test below drives both over the same corpus,
 * for the full cartesian product of selections, and asserts the selected sets
 * are identical. The query side is not merely inspected — its recorded calls are
 * REPLAYED by a small evaluator, so the test compares two evaluated answers
 * rather than an answer against a description of one. A test that only asserted
 * "the route called .in('severity', …)" would pass a registry whose column names
 * were all wrong.
 */

/** A crash in both shapes it exists in: a database row, and a map feature. */
type Fixture = {
  name: string;
  row: Record<string, unknown>;
  properties: Record<string, unknown>;
};

/**
 * SPELLED OUT BY HAND, IN BOTH SHAPES, ON PURPOSE.
 *
 * Deriving the feature properties from the row through the registry would make
 * the differential vacuous: a wrong column name would produce a matching wrong
 * property name and the two lanes would agree perfectly about nothing. The two
 * shapes have to be written independently for a naming mutation to have anywhere
 * to show up.
 */
function fixture(
  name: string,
  row: Record<string, unknown>,
  properties: Record<string, unknown>
): Fixture {
  return { name, row, properties };
}

const CORPUS: Fixture[] = [
  fixture(
    "fatal, night, unlit, rain, pedestrian",
    {
      severity: "fatal",
      collision_type: "vehicle_pedestrian",
      lighting: "dark_unlighted",
      weather: "rain",
      pedestrian_involved: true,
      bicyclist_involved: false,
      motorcyclist_involved: false,
      collision_year: 2024,
    },
    {
      severity: "fatal",
      collisionType: "vehicle_pedestrian",
      lighting: "dark_unlighted",
      weather: "rain",
      pedestrianInvolved: true,
      bicyclistInvolved: false,
      motorcyclistInvolved: false,
      collisionYear: 2024,
    }
  ),
  fixture(
    "injury, daylight, clear, bicyclist",
    {
      severity: "injury",
      collision_type: "angle",
      lighting: "daylight",
      weather: "clear",
      pedestrian_involved: false,
      bicyclist_involved: true,
      motorcyclist_involved: false,
      collision_year: 2023,
    },
    {
      severity: "injury",
      collisionType: "angle",
      lighting: "daylight",
      weather: "clear",
      pedestrianInvolved: false,
      bicyclistInvolved: true,
      motorcyclistInvolved: false,
      collisionYear: 2023,
    }
  ),
  fixture(
    "severe injury, motorcyclist — invisible in this product until now",
    {
      severity: "severe_injury",
      collision_type: "rear_end",
      lighting: "dawn_dusk",
      weather: "cloudy",
      pedestrian_involved: false,
      bicyclist_involved: false,
      motorcyclist_involved: true,
      collision_year: 2025,
    },
    {
      severity: "severe_injury",
      collisionType: "rear_end",
      lighting: "dawn_dusk",
      weather: "cloudy",
      pedestrianInvolved: false,
      bicyclistInvolved: false,
      motorcyclistInvolved: true,
      collisionYear: 2025,
    }
  ),
  fixture(
    "property damage only — off by default",
    {
      severity: "pdo",
      collision_type: "sideswipe",
      lighting: "daylight",
      weather: "clear",
      pedestrian_involved: false,
      bicyclist_involved: false,
      motorcyclist_involved: false,
      collision_year: 2022,
    },
    {
      severity: "pdo",
      collisionType: "sideswipe",
      lighting: "daylight",
      weather: "clear",
      pedestrianInvolved: false,
      bicyclistInvolved: false,
      motorcyclistInvolved: false,
      collisionYear: 2022,
    }
  ),
  fixture(
    "unclassified — the source supplied no casualty count",
    {
      severity: "unknown",
      collision_type: "unknown",
      lighting: "unknown",
      weather: "unknown",
      pedestrian_involved: false,
      bicyclist_involved: false,
      motorcyclist_involved: false,
      collision_year: 2025,
    },
    {
      severity: "unknown",
      collisionType: "unknown",
      lighting: "unknown",
      weather: "unknown",
      pedestrianInvolved: false,
      bicyclistInvolved: false,
      motorcyclistInvolved: false,
      collisionYear: 2025,
    }
  ),
  fixture(
    // The case that separates NULL from 'unknown': a fatality census records no
    // lighting, no weather and no manner of collision at all.
    "fatality census — the source has no such fields (NULL, not unknown)",
    {
      severity: "fatal",
      collision_type: null,
      lighting: null,
      weather: null,
      pedestrian_involved: true,
      bicyclist_involved: false,
      motorcyclist_involved: false,
      collision_year: 2021,
    },
    {
      severity: "fatal",
      collisionType: null,
      lighting: null,
      weather: null,
      pedestrianInvolved: true,
      bicyclistInvolved: false,
      motorcyclistInvolved: false,
      collisionYear: 2021,
    }
  ),
  fixture(
    "pedestrian AND bicyclist in one collision",
    {
      severity: "injury",
      collision_type: "other",
      lighting: "dark_lighted",
      weather: "fog",
      pedestrian_involved: true,
      bicyclist_involved: true,
      motorcyclist_involved: false,
      collision_year: 2020,
    },
    {
      severity: "injury",
      collisionType: "other",
      lighting: "dark_lighted",
      weather: "fog",
      pedestrianInvolved: true,
      bicyclistInvolved: true,
      motorcyclistInvolved: false,
      collisionYear: 2020,
    }
  ),
  fixture(
    "no collision year at all",
    {
      severity: "injury",
      collision_type: "hit_object",
      lighting: "dark_lighting_inoperative",
      weather: "wind",
      pedestrian_involved: false,
      bicyclist_involved: false,
      motorcyclist_involved: false,
      collision_year: null,
    },
    {
      severity: "injury",
      collisionType: "hit_object",
      lighting: "dark_lighting_inoperative",
      weather: "wind",
      pedestrianInvolved: false,
      bicyclistInvolved: false,
      motorcyclistInvolved: false,
      collisionYear: null,
    }
  ),
];

// ---------------------------------------------------------------------------
// A recording builder, and an evaluator that replays what it recorded.
// ---------------------------------------------------------------------------

type RecordedCall =
  | { op: "in"; column: string; values: readonly unknown[] }
  | { op: "or"; filter: string }
  | { op: "gte" | "lte" | "eq"; column: string; value: unknown };

function recordingBuilder() {
  const calls: RecordedCall[] = [];
  const builder: CrashQueryBuilderLike = {
    in(column, values) {
      calls.push({ op: "in", column, values });
      return builder;
    },
    or(filter) {
      calls.push({ op: "or", filter });
      return builder;
    },
    gte(column, value) {
      calls.push({ op: "gte", column, value });
      return builder;
    },
    lte(column, value) {
      calls.push({ op: "lte", column, value });
      return builder;
    },
    eq(column, value) {
      calls.push({ op: "eq", column, value });
      return builder;
    },
  };
  return { builder, calls };
}

/**
 * Evaluate recorded PostgREST calls against a row, with SQL's NULL semantics.
 *
 * `IN` excludes NULL; a range comparison against NULL is unknown and therefore
 * excludes. Those two rules are what the TypeScript predicate has to match, and
 * getting them wrong in the same direction in both places is the one failure
 * this differential cannot catch — which is why the corpus carries explicit NULL
 * rows and the direct assertions further down pin the expected answer.
 */
function rowMatchesRecordedCalls(row: Record<string, unknown>, calls: RecordedCall[]): boolean {
  for (const call of calls) {
    if (call.op === "in") {
      const value = row[call.column];
      if (value === null || value === undefined) return false;
      if (!call.values.includes(value)) return false;
      continue;
    }
    if (call.op === "or") {
      const clauses = call.filter.split(",");
      const anyTrue = clauses.some((clause) => {
        const [column, operator, literal] = clause.split(".");
        if (operator !== "eq") throw new Error(`unhandled or-clause operator: ${clause}`);
        return row[column] === (literal === "true");
      });
      if (!anyTrue) return false;
      continue;
    }
    if (call.op === "eq") {
      if (row[call.column] !== call.value) return false;
      continue;
    }
    const value = row[call.column];
    if (typeof value !== "number") return false;
    if (call.op === "gte" && value < (call.value as number)) return false;
    if (call.op === "lte" && value > (call.value as number)) return false;
  }
  return true;
}

function storedLaneSelection(selection: CrashFilterSelection): string[] {
  const { builder, calls } = recordingBuilder();
  applyCrashFiltersToQuery(builder, selection);
  return CORPUS.filter((entry) => rowMatchesRecordedCalls(entry.row, calls)).map((entry) => entry.name);
}

function liveLaneSelection(selection: CrashFilterSelection): string[] {
  return CORPUS.filter((entry) => crashFeatureMatchesFilters(entry.properties, selection)).map(
    (entry) => entry.name
  );
}

/**
 * Selections to try per facet: nothing, one value, two values, and everything.
 *
 * "Everything" is not padding — it is the case that proves ticking every box
 * cannot hide more than ticking none, which is the rule that keeps a NULL
 * dimension (a source with no such field) from vanishing.
 */
function facetSelections(facetId: CrashFacetId): Array<readonly string[] | undefined> {
  const facet = CRASH_FILTER_FACETS.find((candidate) => candidate.id === facetId);
  if (!facet) throw new Error(`no facet ${facetId}`);
  const values = facetValues(facet);
  return [undefined, [values[0]], [values[0], values[values.length - 1]], values];
}

function allSelections(): CrashFilterSelection[] {
  let selections: CrashFilterSelection[] = [{}];
  for (const facet of CRASH_FILTER_FACETS) {
    const next: CrashFilterSelection[] = [];
    for (const base of selections) {
      for (const choice of facetSelections(facet.id)) {
        next.push(choice === undefined ? base : { ...base, [facet.id]: choice });
      }
    }
    selections = next;
  }

  const withYears: CrashFilterSelection[] = [];
  for (const selection of selections) {
    withYears.push(selection);
    withYears.push({ ...selection, yearFrom: 2023 });
    withYears.push({ ...selection, yearFrom: 2022, yearTo: 2024 });
  }
  return withYears;
}

describe("the stored lane and the live lane cannot answer differently", () => {
  it("selects identical crashes for every combination of filters", () => {
    const selections = allSelections();
    // A guard on the guard: an empty or trivially small product would make the
    // assertion below pass without exercising anything.
    expect(selections.length).toBeGreaterThan(500);

    const disagreements: Array<{ selection: CrashFilterSelection; stored: string[]; live: string[] }> = [];
    for (const selection of selections) {
      const stored = storedLaneSelection(selection);
      const live = liveLaneSelection(selection);
      if (stored.join("|") !== live.join("|")) disagreements.push({ selection, stored, live });
    }

    expect(disagreements).toEqual([]);
  });

  it("actually discriminates — some selections keep some crashes and drop others", () => {
    // Without this, the test above would pass just as happily against two
    // interpreters that both selected everything, or both selected nothing.
    const partial = allSelections().filter((selection) => {
      const count = storedLaneSelection(selection).length;
      return count > 0 && count < CORPUS.length;
    });
    expect(partial.length).toBeGreaterThan(100);
  });
});

describe("what the filters mean, stated directly", () => {
  it("selecting every value of a facet narrows nothing, so a NULL dimension survives", () => {
    // The failure this prevents: a source with no lighting field writes NULL,
    // `IN` excludes NULL, and "tick every lighting box" would erase every crash
    // from that source. Ticking everything must never hide more than ticking
    // nothing.
    const lighting = CRASH_FILTER_FACETS.find((facet) => facet.id === "lighting");
    if (!lighting) throw new Error("no lighting facet");
    const all = facetValues(lighting);

    expect(narrowedChoice(lighting, all)).toEqual([]);
    expect(storedLaneSelection({ lighting: all })).toEqual(CORPUS.map((entry) => entry.name));
    expect(liveLaneSelection({ lighting: all })).toEqual(CORPUS.map((entry) => entry.name));
  });

  it("a narrowing selection excludes a crash whose source has no such field", () => {
    const censusRow = "fatality census — the source has no such fields (NULL, not unknown)";
    expect(storedLaneSelection({ lighting: ["daylight"] })).not.toContain(censusRow);
    expect(liveLaneSelection({ lighting: ["daylight"] })).not.toContain(censusRow);
  });

  it("'unknown' is a selectable band, not a hidden one", () => {
    const unclassified = "unclassified — the source supplied no casualty count";
    expect(liveLaneSelection({ severity: ["unknown"] })).toEqual([unclassified]);
    expect(storedLaneSelection({ severity: ["unknown"] })).toEqual([unclassified]);
  });

  it("the default withholds property damage only and keeps the unclassified band", () => {
    const selected = liveLaneSelection(CRASH_FILTER_DEFAULTS);
    expect(selected).not.toContain("property damage only — off by default");
    expect(selected).toContain("unclassified — the source supplied no casualty count");
  });

  it("involvement ORs its options instead of ANDing them", () => {
    // A crash involving a pedestrian OR a bicyclist is not a crash involving
    // both. Chained `.eq()` filters would AND, which is why the query
    // interpreter emits a single `or`.
    const selected = liveLaneSelection({ involvement: ["pedestrian", "bicyclist"] });
    expect(selected).toContain("fatal, night, unlit, rain, pedestrian");
    expect(selected).toContain("injury, daylight, clear, bicyclist");
    expect(selected).toContain("pedestrian AND bicyclist in one collision");
    expect(storedLaneSelection({ involvement: ["pedestrian", "bicyclist"] })).toEqual(selected);
  });

  it("motorcyclists are reachable", () => {
    expect(liveLaneSelection({ involvement: ["motorcyclist"] })).toEqual([
      "severe injury, motorcyclist — invisible in this product until now",
    ]);
  });

  it("a year bound excludes a crash with no year, in both lanes", () => {
    const undated = "no collision year at all";
    expect(storedLaneSelection({ yearFrom: 2000 })).not.toContain(undated);
    expect(liveLaneSelection({ yearFrom: 2000 })).not.toContain(undated);
  });
});

describe("the declaration reaches every surface that has to honour it", () => {
  it("projects every column the MIGRATION added, not merely every column the registry knows", () => {
    // Checked against the SQL rather than against the registry, because the
    // registry is what builds the projection — comparing the two would agree by
    // construction even if both were wrong. `.select()` strings are not
    // type-checked in this codebase (no generated Supabase types, by decision),
    // so a column that exists in Postgres and is absent here is a filter that
    // works and a detail card that shows nothing, found at runtime by a planner.
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260812000001_safety_crash_neutral_dimensions.sql"),
      "utf8"
    );
    const added = [...sql.matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)/g)].map((match) => match[1]);
    // Sanity: the regex has to be finding something, or this test proves nothing.
    expect(added.length).toBeGreaterThan(3);

    const projected = CRASH_QUERY_PROJECTION.split(",");
    // `source_attributes` is deliberately NOT projected — nothing outside
    // `src/lib/safety/sources/**` may read a key out of it.
    for (const column of added.filter((name) => name !== "source_attributes")) {
      if (!crashFilterColumns().includes(column)) continue;
      expect(projected, `${column} is filterable but not projected`).toContain(column);
    }
    for (const column of ["id", "external_id", "collision_date", "killed_count", "injured_count"]) {
      expect(projected).toContain(column);
    }
  });

  it("every filterable property is carried by a LIVE crash feature", () => {
    // The live lane's predicate reads the FEATURE. A property the live
    // projection omits is a facet that silently excludes every live crash the
    // moment a planner touches it — the same shipped-invisible defect one level
    // down.
    const record: CrashRecord = {
      externalId: "case-1",
      collisionDate: "2025-03-04",
      collisionYear: 2025,
      severity: "injury",
      killedCount: 0,
      injuredCount: 2,
      pedestrianInvolved: false,
      bicyclistInvolved: false,
      motorcyclistInvolved: true,
      collisionType: "rear_end",
      lighting: "daylight",
      weather: "clear",
      sourceAttributes: {},
      latitude: 39.2,
      longitude: -121.0,
    };
    const [feature] = toLiveCrashCollection([record], "source-under-test").features;
    const properties = feature.properties as unknown as Record<string, unknown>;

    for (const property of crashFilterProperties()) {
      expect(Object.keys(properties)).toContain(property);
    }
  });

  it("round-trips a selection through the query string it is sent as", () => {
    const selection: CrashFilterSelection = {
      severity: ["fatal", "severe_injury"],
      lighting: ["dark_unlighted"],
      involvement: ["motorcyclist"],
    };
    const params = new URLSearchParams(crashFilterSearchParams(selection));
    expect(parseCrashFilterSelection((key) => params.get(key))).toEqual(selection);
  });

  it("refuses a value outside the vocabulary rather than ignoring it", () => {
    // Quietly dropping an unrecognised filter is how a planner reads a total for
    // a population they did not ask for.
    const params = new URLSearchParams([["severity", "fatal,catastrophic"]]);
    expect(parseCrashFilterSelection((key) => params.get(key))).toBeNull();
  });
});

describe("a facet the source cannot answer is disabled, never empty", () => {
  const lighting = CRASH_FILTER_FACETS.find((facet) => facet.id === "lighting");
  if (!lighting) throw new Error("no lighting facet");

  it("says the source does not record it, and disables the control", () => {
    const availability = facetAvailability(lighting, { lighting: { support: "not_supplied" } });
    expect(availability.disabled).toBe(true);
    expect(availability.note).toMatch(/does not record/i);
    // The sentence must refuse the inference, not merely omit it.
    expect(availability.note).toMatch(/not a finding/i);
  });

  it("treats unreadable coverage as unknown rather than as supplied", () => {
    for (const coverage of [undefined, null, {}, { lighting: "supplied" }, { lighting: {} }]) {
      expect(facetAvailability(lighting, coverage).state).toBe("unknown");
    }
  });

  it("counts values the mapping could not classify", () => {
    const availability = facetAvailability(lighting, {
      lighting: { support: "supplied", unmapped: 314 },
    });
    expect(availability.disabled).toBe(false);
    expect(availability.note).toContain("314");
  });
});

describe("the per-collision detail says which fields the source did not supply", () => {
  const coverage = {
    collision_type: { support: "supplied" },
    lighting: { support: "not_supplied" },
    weather: { support: "supplied" },
    severity: { support: "supplied" },
    party_role: { support: "supplied" },
  };

  it("distinguishes 'not reported here' from 'this source has no such field'", () => {
    const rows = describeCrashDimensions(
      {
        severity: "injury",
        collisionType: "rear_end",
        // The source records weather and said nothing for this collision.
        weather: "unknown",
        // The source has no lighting field at all.
        lighting: null,
        pedestrianInvolved: false,
        bicyclistInvolved: false,
        motorcyclistInvolved: false,
      },
      coverage
    );

    const byLabel = new Map(rows.map((row) => [row.label, row]));
    expect(byLabel.get("Manner of collision")).toMatchObject({
      state: "reported",
      value: "Rear end",
    });
    expect(byLabel.get("Weather")).toMatchObject({ state: "not_reported" });
    expect(byLabel.get("Lighting")).toMatchObject({ state: "not_supplied" });
    expect(byLabel.get("Lighting")?.value).toMatch(/does not record/i);
  });

  it("never returns a blank value for any facet", () => {
    // A blank slot is read as "nothing happened". Every dimension gets a
    // sentence, including the ones the source was silent about.
    const rows = describeCrashDimensions({ severity: "fatal" }, undefined);
    expect(rows.length).toBe(CRASH_FILTER_FACETS.length);
    for (const row of rows) expect(row.value.trim().length).toBeGreaterThan(0);
  });

  it("reports absent involvement flags as an absent report, not as nobody", () => {
    const rows = describeCrashDimensions(
      { pedestrianInvolved: false, bicyclistInvolved: false, motorcyclistInvolved: false },
      coverage
    );
    const involvement = rows.find((row) => row.label === "Who was involved");
    expect(involvement?.value).toMatch(/reported/);
  });
});

describe("the vocabulary a planner sees carries no jurisdiction", () => {
  it("no facet value, label or column names a place, agency or statute", () => {
    // Non-negotiable #0: a planner in another state must never meet one state's
    // spellings. CCRS's own strings ("BROADSIDE", "VEHICLE/PEDESTRAIN"), KABCO
    // letters and vehicle-code citations live behind the adapter.
    const forbidden =
      /\b(ccrs|switrs|kabco|caltrans|california|ca_|fars|nhtsa|broadside|pedestrain|vc\s?\d|statute)\b/i;

    const surface: string[] = [CRASH_QUERY_PROJECTION, CRASH_YEAR_FIELD.column, CRASH_YEAR_FIELD.property];
    for (const facet of CRASH_FILTER_FACETS) {
      surface.push(facet.id, facet.label, facet.dimension);
      for (const value of facetValues(facet)) surface.push(value);
      if (facet.kind === "in") {
        surface.push(facet.column, facet.property);
        surface.push(...Object.values(facet.valueLabels));
      } else {
        for (const option of facet.options) surface.push(option.column, option.property, option.label);
      }
    }

    const offenders = surface.filter((text) => forbidden.test(text));
    expect(offenders).toEqual([]);
  });

  it("declares a severity band for a collision nobody classified", () => {
    const severity = CRASH_FILTER_FACETS.find((facet) => facet.id === "severity");
    expect(facetValues(severity!)).toContain("unknown");
  });
});
