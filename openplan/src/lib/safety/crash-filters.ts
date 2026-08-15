/**
 * ONE declaration of the crash filters, and two interpreters over it.
 *
 * WHAT WENT WRONG BEFORE. The same filter set was written out twice: once as
 * PostgREST calls in `src/app/api/safety/crashes/route.ts` (the stored lane) and
 * once as TypeScript predicates in `safety-workspace.tsx` (the live lane, whose
 * crashes never touch Postgres). The comment on the second said its predicates
 * were "written to mirror" the first. That is a convention, and this repository
 * has been bitten by exactly that class often enough to have a rule about it: a
 * convention only written down has already been violated somewhere. Adding a
 * lighting facet to one of the two hand-written copies and not the other is a
 * one-line omission that produces a filter which silently answers differently
 * depending on whether the planner acquired the data or read it live.
 *
 * THE MECHANISM. `CRASH_FILTER_FACETS` below is the only place a facet exists.
 * `applyCrashFiltersToQuery` walks it to build a database query;
 * `crashFeatureMatchesFilters` walks it to test one feature in memory. NEITHER
 * INTERPRETER CONTAINS A PER-FACET BRANCH — they branch on `kind`, of which
 * there are two, and both kinds are exercised by every facet-shaped test. A
 * facet therefore cannot exist in one lane and not the other, and the zod schema
 * and the filter panel are generated from the same list, which also closes the
 * "filterable in the API, unreachable in the UI" variant of the
 * shipped-invisible defect.
 *
 * `src/test/one-crash-filter-definition.test.ts` is the proof: it drives both
 * interpreters over the same fixture corpus for the full cartesian product of
 * selections and asserts the two selected sets are identical, so a divergence
 * fails a test rather than reaching a planner.
 *
 * JURISDICTION-NEUTRAL BY CONSTRUCTION. Every value here comes from
 * `src/lib/safety/vocabulary.ts`, which names physical facts and no
 * jurisdiction's spelling. Nothing in this file knows which source supplied a
 * crash. Whether a facet is USABLE for a given acquisition is a separate
 * question answered by the source's own `dimension_coverage` declaration — see
 * `facetAvailability` at the bottom, which is what stops "this source has no
 * lighting field" from rendering as "no crash here happened after dark".
 *
 * PURE — no I/O, no React, no Supabase import. The query interpreter takes a
 * structurally-typed builder so it can be driven by a recording fake in a test.
 */

import {
  CRASH_COLLISION_TYPES,
  CRASH_DIMENSIONS,
  CRASH_DIMENSION_SPECS,
  CRASH_INVOLVEMENT_COLUMNS,
  CRASH_LIGHTING_CONDITIONS,
  CRASH_PARTY_ROLES,
  CRASH_SEVERITIES,
  CRASH_WEATHER_CONDITIONS,
  type CrashDimension,
  type CrashDimensionSupport,
} from "./vocabulary";
import { SEVERITY_LABELS } from "./client-types";

/**
 * The facets a planner can filter on.
 *
 * `involvement` is not a vocabulary dimension of its own: it selects over the
 * three denormalized crash-level booleans so the map query never has to join the
 * person table. It is nevertheless declared against `party_role`, because that
 * is the dimension whose source capability decides whether the answer can be
 * trusted — a source with no person rows still reports pedestrian involvement,
 * and the panel must be able to say so.
 */
export const CRASH_INVOLVEMENT_FACET = "involvement" as const;

export type CrashFacetId = CrashDimension | typeof CRASH_INVOLVEMENT_FACET;

/** A facet whose values live in one low-cardinality column. */
type CrashInFacet = {
  id: CrashFacetId;
  kind: "in";
  label: string;
  /** The dimension whose source capability governs this facet. */
  dimension: CrashDimension;
  /** The storage column, from the vocabulary — never spelled here. */
  column: string;
  /** The GeoJSON feature property carrying the same value. */
  property: string;
  values: readonly string[];
  valueLabels: Readonly<Record<string, string>>;
};

/** A facet that ORs a set of boolean columns together. */
type CrashAnyTrueFacet = {
  id: CrashFacetId;
  kind: "anyTrue";
  label: string;
  dimension: CrashDimension;
  options: ReadonlyArray<{ value: string; label: string; column: string; property: string }>;
};

export type CrashFacetDefinition = CrashInFacet | CrashAnyTrueFacet;

/** Sentence-case a neutral value for a control label, when no better label exists. */
function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function labelsFor(values: readonly string[], overrides: Record<string, string> = {}) {
  const labels: Record<string, string> = {};
  for (const value of values) labels[value] = overrides[value] ?? humanize(value);
  return labels;
}

/**
 * NOTHING HERE SPELLS A DIMENSION NAME OR A COLUMN NAME, and that is enforced.
 *
 * `crash-vocabulary-is-jurisdiction-neutral.test.ts` fails the build if a
 * dimension's column string appears in any module outside `vocabulary.ts` — the
 * column name is the single declaration a Postgres predicate and a TypeScript
 * predicate are both generated from, and a second hand-written copy is exactly
 * how a facet becomes filterable in the API and unreachable in the UI. Writing
 * the facet list out longhand tripped that guard, which was the guard doing its
 * job: the strings would have been a second spelling even though they sat in the
 * `id` slot rather than the `column` slot.
 *
 * So the crash-level facets are DERIVED: every dimension the vocabulary says is
 * stored on the crash row becomes a facet, in vocabulary order, taking its
 * column, its values and its label from the spec. Adding a dimension to
 * `vocabulary.ts` adds a facet here, a control in the panel, a parameter on the
 * route and a row on the detail card, with no edit to any of them.
 */

/** Per-value display labels, keyed by the vocabulary array itself. */
const VALUE_LABELS = new Map<readonly string[], Readonly<Record<string, string>>>([
  // Reused rather than re-worded. The `unknown` band's label is a whole sentence
  // on purpose ("Not classified — no casualty count reported"); a shorter one
  // written here would be the same claim, weakened.
  [CRASH_SEVERITIES, SEVERITY_LABELS],
  [
    CRASH_COLLISION_TYPES,
    labelsFor(CRASH_COLLISION_TYPES, {
      rear_end: "Rear end",
      head_on: "Head-on",
      hit_object: "Hit object",
      vehicle_pedestrian: "Vehicle / pedestrian",
      unknown: "Not reported",
    }),
  ],
  [
    CRASH_LIGHTING_CONDITIONS,
    labelsFor(CRASH_LIGHTING_CONDITIONS, {
      dawn_dusk: "Dawn or dusk",
      dark_lighted: "Dark — street lights on",
      dark_unlighted: "Dark — no street lights",
      dark_lighting_inoperative: "Dark — street lights not working",
      unknown: "Not reported",
    }),
  ],
  [
    CRASH_WEATHER_CONDITIONS,
    labelsFor(CRASH_WEATHER_CONDITIONS, {
      other: "Other (recorded, not classified)",
      unknown: "Not reported",
    }),
  ],
]);

/**
 * The feature property carrying each dimension's value.
 *
 * The one thing the vocabulary does not declare — it knows about columns, not
 * about the camelCase a GeoJSON feature uses — so it is declared once, here,
 * keyed by the dimension's own vocabulary array rather than by its name. The
 * differential test fails if any of these stops matching the live projection.
 */
const DIMENSION_PROPERTY = new Map<readonly string[], string>([
  [CRASH_SEVERITIES, "severity"],
  [CRASH_COLLISION_TYPES, "collisionType"],
  [CRASH_LIGHTING_CONDITIONS, "lighting"],
  [CRASH_WEATHER_CONDITIONS, "weather"],
]);

/**
 * The dimension whose vocabulary IS the party roles.
 *
 * Found by identity against the exported role list rather than named, for the
 * reason in the block comment above. It reads as what it means: the involvement
 * facet is governed by whichever dimension carries a person's role, whatever
 * that dimension ends up being called.
 */
const PARTY_ROLE_DIMENSION = CRASH_DIMENSIONS.find(
  (dimension) => CRASH_DIMENSION_SPECS[dimension].values === CRASH_PARTY_ROLES
);

const CRASH_ROW_FACETS: CrashFacetDefinition[] = CRASH_DIMENSIONS.filter(
  (dimension) => CRASH_DIMENSION_SPECS[dimension].table === "crash"
).map((dimension) => {
  const spec = CRASH_DIMENSION_SPECS[dimension];
  const property = DIMENSION_PROPERTY.get(spec.values);
  if (!property) {
    // A dimension added to the vocabulary with no declared feature property
    // would be filterable in Postgres and invisible to the live lane. Failing
    // at import is louder than shipping half a facet.
    throw new Error(`crash dimension "${dimension}" has no declared feature property`);
  }
  return {
    id: dimension,
    kind: "in",
    label: spec.label,
    dimension,
    column: spec.column,
    property,
    values: spec.values,
    valueLabels: VALUE_LABELS.get(spec.values) ?? labelsFor(spec.values),
  };
});

export const CRASH_FILTER_FACETS: readonly CrashFacetDefinition[] = [
  ...CRASH_ROW_FACETS,
  ...(PARTY_ROLE_DIMENSION
    ? [
        {
          id: CRASH_INVOLVEMENT_FACET,
          kind: "anyTrue" as const,
          label: "Who was involved",
          // Not a dimension of its own: it selects over the three denormalized
          // crash-level booleans so the map query never joins the person table.
          // It is declared against the role dimension because that is the
          // capability which decides whether the answer can be trusted.
          dimension: PARTY_ROLE_DIMENSION,
          options: [
            {
              value: "pedestrian",
              label: "Pedestrian",
              column: CRASH_INVOLVEMENT_COLUMNS.pedestrian,
              property: "pedestrianInvolved",
            },
            {
              value: "bicyclist",
              label: "Bicyclist",
              column: CRASH_INVOLVEMENT_COLUMNS.bicyclist,
              property: "bicyclistInvolved",
            },
            {
              value: "motorcyclist",
              label: "Motorcyclist",
              column: CRASH_INVOLVEMENT_COLUMNS.motorcyclist,
              property: "motorcyclistInvolved",
            },
          ],
        },
      ]
    : []),
];

/** Collision year, filtered as a range rather than a set. */
export const CRASH_YEAR_FIELD = {
  column: "collision_year",
  property: "collisionYear",
} as const;

/** Every value a facet admits, in declaration order. */
export function facetValues(facet: CrashFacetDefinition): readonly string[] {
  return facet.kind === "in" ? facet.values : facet.options.map((option) => option.value);
}

export function facetValueLabel(facet: CrashFacetDefinition, value: string): string {
  if (facet.kind === "in") return facet.valueLabels[value] ?? humanize(value);
  return facet.options.find((option) => option.value === value)?.label ?? humanize(value);
}

/**
 * What the planner has chosen. Absent or empty means "no constraint on this
 * facet", which is a different thing from every value being selected — see
 * `narrowedChoice`.
 */
export type CrashFilterSelection = Partial<Record<CrashFacetId, readonly string[]>> & {
  yearFrom?: number;
  yearTo?: number;
};

export const EMPTY_CRASH_FILTER_SELECTION: CrashFilterSelection = {};

/**
 * What the Safety workbench opens on: every severity band EXCEPT
 * property-damage-only.
 *
 * WHY PDO IS OFF BY DEFAULT — a planner's reason, not a technical one. PDO
 * reporting thresholds vary by agency, by dollar limit, by whether a unit was
 * dispatched, and they drift over time, so PDO counts are not comparable across
 * jurisdictions or years and a grant reviewer will discount a headline "crashes"
 * number built on them. They stay retrievable and one click away, because PDO is
 * the only stratum dense enough to see a pattern at a single intersection over
 * five years.
 *
 * WHY `unknown` IS ON. It is the band for a collision whose casualty counts the
 * source never supplied — 4.7% of one state's 2025 records and 9.5% in one rural
 * county of it. Those crashes were stored as property-damage-only until the band
 * existed, so defaulting PDO off BEFORE the band shipped would have made one
 * record in eleven vanish from a rural county's map with no explanation. The
 * ordering was load-bearing and it is recorded here because the reason is not
 * visible from the code.
 *
 * Selecting every band is equivalent to selecting none (see `narrowedChoice`),
 * so this default is genuinely narrower than the previous behaviour — which is
 * why the panel states the PDO caveat whenever it is in force.
 */
export const CRASH_FILTER_DEFAULTS: CrashFilterSelection = {
  severity: CRASH_SEVERITIES.filter((severity) => severity !== "pdo"),
};

/**
 * The values this facet actually narrows by, or `[]` for "does not narrow".
 *
 * TWO DECISIONS LIVE HERE, and they live here rather than in either interpreter
 * so the two cannot disagree about them.
 *
 * 1. Unknown values are dropped. A value outside the vocabulary cannot select
 *    anything honestly, and passing it through to `.in()` would let a crafted
 *    query string reach the column.
 * 2. A selection covering EVERY declared value narrows nothing, so it emits no
 *    predicate at all. This is not a micro-optimisation — it is the difference
 *    between showing and hiding rows whose column is NULL. NULL means "this
 *    source does not record this dimension", and SQL `IN` excludes NULL, so
 *    "select all lighting conditions" would otherwise erase every crash from a
 *    source that has no lighting field. Ticking every box must never hide more
 *    than ticking none.
 */
export function narrowedChoice(
  facet: CrashFacetDefinition,
  chosen: readonly string[] | undefined
): readonly string[] {
  if (!chosen || chosen.length === 0) return [];
  const declared = facetValues(facet);
  const kept = declared.filter((value) => chosen.includes(value));
  if (kept.length === 0) return [];
  return kept.length === declared.length ? [] : kept;
}

/**
 * The subset of a query builder these filters use.
 *
 * Structural on purpose: the real caller passes a supabase-js builder, and the
 * differential test passes a fake that records every call. A test that could
 * only run against a mocked Supabase client could not prove the two lanes agree,
 * because it would never evaluate the predicates it recorded.
 */
export type CrashQueryBuilderLike = {
  eq: (column: string, value: unknown) => CrashQueryBuilderLike;
  gte: (column: string, value: unknown) => CrashQueryBuilderLike;
  lte: (column: string, value: unknown) => CrashQueryBuilderLike;
  in: (column: string, values: readonly unknown[]) => CrashQueryBuilderLike;
  or: (filter: string) => CrashQueryBuilderLike;
};

/**
 * INTERPRETER 1 — the stored lane. Walks the facet list; no facet is named.
 */
export function applyCrashFiltersToQuery<T>(builder: T, selection: CrashFilterSelection): T {
  let query = builder as unknown as CrashQueryBuilderLike;

  for (const facet of CRASH_FILTER_FACETS) {
    const chosen = narrowedChoice(facet, selection[facet.id]);
    if (chosen.length === 0) continue;

    if (facet.kind === "in") {
      query = query.in(facet.column, chosen);
      continue;
    }

    // `or` rather than a chain of `eq`: chained filters AND together, and a
    // crash involving a pedestrian AND a bicyclist AND a motorcyclist is not
    // what "pedestrian or bicyclist" means.
    const clause = facet.options
      .filter((option) => chosen.includes(option.value))
      .map((option) => `${option.column}.eq.true`)
      .join(",");
    query = query.or(clause);
  }

  if (selection.yearFrom !== undefined) query = query.gte(CRASH_YEAR_FIELD.column, selection.yearFrom);
  if (selection.yearTo !== undefined) query = query.lte(CRASH_YEAR_FIELD.column, selection.yearTo);

  return query as unknown as T;
}

/**
 * The facet carrying the severity bands, found by identity against the
 * vocabulary rather than by name — the same reason `PARTY_ROLE_DIMENSION` is.
 *
 * It throws at import if it is missing. A silent `undefined` here would make
 * `restrictCrashQueryToSeverityBand` a no-op, and a no-op there does not produce
 * an error or an empty result: it produces a band count equal to the total,
 * which is a wrong number that looks like a right one on a grant application.
 */
const SEVERITY_FACET = CRASH_FILTER_FACETS.find(
  (facet): facet is CrashInFacet => facet.kind === "in" && facet.values === CRASH_SEVERITIES
);
if (!SEVERITY_FACET) {
  throw new Error("no crash facet carries the severity vocabulary");
}

/** Every severity band, in vocabulary order. The bands a total is counted for. */
export const CRASH_SEVERITY_BANDS: readonly string[] = SEVERITY_FACET.values;

/**
 * Narrow an ALREADY-FILTERED crash query to one severity band.
 *
 * ═══ WHY THIS IS ONE MORE PREDICATE AND NOT A SECOND FILTER BUILDER ═══
 *
 * The Safety page's headline is a KSI total — killed or seriously injured — and
 * it used to be added up from the crash rows the query route returned. That
 * query is capped (PostgREST `max_rows`), so a real run drew 1,000 crashes
 * against 11,870 matching the study area and the headline understated by roughly
 * an order of magnitude. A planner copies that number into a funding
 * application; it has to be the study-area total, counted in the database.
 *
 * The hazard in fixing it is that the total and the map start disagreeing. So
 * this does NOT build a query of its own: the caller applies
 * `applyCrashFiltersToQuery` exactly as it does for the rows, and this appends
 * ONE further predicate over the same registry-derived column. Repeated
 * predicates on a column AND together in PostgREST, so the result is "the
 * planner's filters, and this band" — never a second, differently-spelled
 * interpretation of the same selection.
 *
 * `src/test/safety-headline-total-is-counted-not-drawn.test.ts` drives the real
 * route with a recording client and asserts that every band count carries the
 * row query's exact filter sequence plus this one call.
 */
export function restrictCrashQueryToSeverityBand<T>(builder: T, band: string): T {
  const facet = SEVERITY_FACET;
  if (!facet) throw new Error("no crash facet carries the severity vocabulary");
  if (!facet.values.includes(band)) {
    // A band outside the vocabulary cannot be counted honestly, and passing it
    // through would let an arbitrary string reach the column.
    throw new Error(`"${band}" is not a declared severity band`);
  }
  return (builder as unknown as CrashQueryBuilderLike).in(facet.column, [band]) as unknown as T;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * INTERPRETER 2 — the live lane. Same walk, same decisions, no shared state.
 *
 * The NULL handling mirrors SQL deliberately: a feature whose facet property is
 * absent or null does not match a narrowing selection, exactly as `IN` excludes
 * NULL. That is the behaviour the differential test pins, and it is the reason
 * `narrowedChoice` treats "everything selected" as "no constraint".
 */
export function crashFeatureMatchesFilters(
  properties: Readonly<Record<string, unknown>>,
  selection: CrashFilterSelection
): boolean {
  for (const facet of CRASH_FILTER_FACETS) {
    const chosen = narrowedChoice(facet, selection[facet.id]);
    if (chosen.length === 0) continue;

    if (facet.kind === "in") {
      const value = readString(properties[facet.property]);
      if (value === null || !chosen.includes(value)) return false;
      continue;
    }

    const anyTrue = facet.options.some(
      (option) => chosen.includes(option.value) && properties[option.property] === true
    );
    if (!anyTrue) return false;
  }

  const year = readNumber(properties[CRASH_YEAR_FIELD.property]);
  if (selection.yearFrom !== undefined && (year === null || year < selection.yearFrom)) return false;
  if (selection.yearTo !== undefined && (year === null || year > selection.yearTo)) return false;

  return true;
}

/**
 * The columns a crash query must project for these filters to be renderable.
 *
 * Derived from the same list, because a `.select()` string is NOT type-checked
 * against the schema in this codebase (there is no generated types step, by
 * deliberate decision) — so a facet added without its column in the projection
 * is a filter that works and a detail card that shows nothing, discovered at
 * runtime by a planner.
 */
export function crashFilterColumns(): string[] {
  const columns = new Set<string>([CRASH_YEAR_FIELD.column]);
  for (const facet of CRASH_FILTER_FACETS) {
    if (facet.kind === "in") columns.add(facet.column);
    else for (const option of facet.options) columns.add(option.column);
  }
  return [...columns];
}

/**
 * Columns every crash row carries regardless of which facets exist: identity,
 * position, and the two casualty counts. None of them is a dimension, so none of
 * them is a second spelling of a vocabulary column.
 */
const CRASH_IDENTITY_COLUMNS = [
  "id",
  "external_id",
  "source_id",
  "collision_date",
  "killed_count",
  "injured_count",
  "latitude",
  "longitude",
] as const;

/**
 * The projection every crash query must ask for, GENERATED from the registry.
 *
 * `.select()` strings are not type-checked in this codebase — there is no
 * generated Supabase types step, by deliberate decision — so a facet added
 * without its column in the projection is a filter that works and a detail card
 * that shows nothing, discovered at runtime by a planner. Generating the string
 * removes the possibility rather than testing for it, and it keeps the column
 * names where the vocabulary guard insists they stay.
 */
export const CRASH_QUERY_PROJECTION = [...CRASH_IDENTITY_COLUMNS, ...crashFilterColumns()].join(",");

/** The feature properties those columns become. */
export function crashFilterProperties(): string[] {
  const properties = new Set<string>([CRASH_YEAR_FIELD.property]);
  for (const facet of CRASH_FILTER_FACETS) {
    if (facet.kind === "in") properties.add(facet.property);
    else for (const option of facet.options) properties.add(option.property);
  }
  return [...properties];
}

/**
 * Parse a comma-separated query-string value into a validated choice.
 *
 * Returns `null` — not an empty list — when the caller supplied a value outside
 * the vocabulary, so the route can answer 400 instead of quietly widening the
 * query to everything. Quietly ignoring an unrecognised filter is how a planner
 * ends up reading a total for the wrong population.
 */
export function parseFacetParam(
  facet: CrashFacetDefinition,
  raw: string | undefined | null
): readonly string[] | null {
  if (raw === undefined || raw === null) return [];
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return [];
  const declared = facetValues(facet);
  if (parts.some((part) => !declared.includes(part))) return null;
  return parts;
}

/**
 * Read a whole selection out of URL search params, one facet at a time.
 *
 * `null` means at least one facet was given an unrecognised value.
 */
export function parseCrashFilterSelection(
  read: (key: string) => string | null
): CrashFilterSelection | null {
  const selection: CrashFilterSelection = {};
  for (const facet of CRASH_FILTER_FACETS) {
    const parsed = parseFacetParam(facet, read(facet.id));
    if (parsed === null) return null;
    if (parsed.length > 0) selection[facet.id] = parsed;
  }
  return selection;
}

/** Serialize a selection back into query-string pairs. One spelling, both ways. */
export function crashFilterSearchParams(selection: CrashFilterSelection): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const facet of CRASH_FILTER_FACETS) {
    const chosen = selection[facet.id];
    if (chosen && chosen.length > 0) pairs.push([facet.id, [...chosen].join(",")]);
  }
  if (selection.yearFrom !== undefined) pairs.push(["yearFrom", String(selection.yearFrom)]);
  if (selection.yearTo !== undefined) pairs.push(["yearTo", String(selection.yearTo)]);
  return pairs;
}

/**
 * Per-facet availability, from the acquisition's own coverage declaration.
 *
 * THE POINT OF THIS FUNCTION. Every dimension column is nullable, and a source
 * that does not record lighting writes NULL. Rendered naively, selecting a
 * lighting condition then returns nothing — and "nothing" on a safety screen
 * reads as a finding about the road, not as a gap in the feed. So a facet whose
 * source declares `not_supplied` is rendered DISABLED with the reason, and a
 * `partial` one is rendered usable with a warning. Adding a jurisdiction means
 * adding a descriptor that declares its own capability; it does not mean editing
 * this function or the panel.
 *
 * `coverage` is the ingest row's `dimension_coverage` JSONB, which is untyped on
 * the way out of PostgREST — an unreadable or absent entry yields `"unknown"`
 * rather than an optimistic `supplied`.
 */
export type CrashFacetAvailability = {
  state: CrashDimensionSupport | "unknown";
  /** Values the source supplied that its descriptor could not classify. */
  unmapped: number | null;
  /** A sentence for the planner, or null when the facet is unremarkable. */
  note: string | null;
  disabled: boolean;
};

/**
 * One line of the per-collision detail card, for one dimension.
 *
 * THREE STATES, NEVER A BLANK. The requirement this satisfies is that a detail
 * card shows every field the source supplied AND says plainly which fields it
 * did not — because a missing row and a row saying "not reported" carry very
 * different information, and an empty slot is read by everybody as the former.
 *
 *   `reported`     — the source gave a value for this collision.
 *   `not_reported` — the source records this dimension and gave nothing HERE.
 *   `not_supplied` — the source has no such field at all. A fact about the feed.
 *
 * The last two look identical in the data (both end up as an absent value on
 * screen) and are distinguished only by the acquisition's coverage declaration,
 * which is why `describeCrashDimensions` insists on being handed it.
 */
export type CrashDetailRow = {
  label: string;
  value: string;
  state: "reported" | "not_reported" | "not_supplied";
};

/**
 * The dimension rows for one collision, generated from the facet registry.
 *
 * Registry-driven for the same reason the panel is: a dimension that can be
 * filtered on but never appears on the record it filters is half a feature, and
 * the halves are added in different sessions by different people.
 */
export function describeCrashDimensions(
  properties: Readonly<Record<string, unknown>>,
  coverage: unknown
): CrashDetailRow[] {
  const rows: CrashDetailRow[] = [];

  for (const facet of CRASH_FILTER_FACETS) {
    const availability = facetAvailability(facet, coverage);

    if (facet.kind === "anyTrue") {
      const present = facet.options.filter((option) => properties[option.property] === true);
      if (present.length > 0) {
        rows.push({
          label: facet.label,
          value: present.map((option) => option.label.toLowerCase()).join(", "),
          state: "reported",
        });
        continue;
      }
      rows.push({
        label: facet.label,
        // NOT "nobody". The flags are positive reports; their absence is the
        // absence of a report, and the involvement basis (crash-level flags vs
        // person rows) is measurably different — one undercounts the other by up
        // to 17%.
        value: `no ${facet.options.map((option) => option.label.toLowerCase()).join(", ")} reported`,
        state: availability.state === "supplied" ? "reported" : "not_reported",
      });
      continue;
    }

    const raw = properties[facet.property];
    if (raw === null || raw === undefined) {
      rows.push({
        label: facet.label,
        value: "this source does not record it",
        state: "not_supplied",
      });
      continue;
    }

    const value = typeof raw === "string" ? raw : String(raw);
    const absent = CRASH_DIMENSION_SPECS[facet.dimension]?.absent;
    if (value === absent) {
      rows.push({
        label: facet.label,
        value: "not reported for this collision",
        state: "not_reported",
      });
      continue;
    }

    rows.push({ label: facet.label, value: facetValueLabel(facet, value), state: "reported" });
  }

  return rows;
}

export function facetAvailability(
  facet: CrashFacetDefinition,
  coverage: unknown
): CrashFacetAvailability {
  const entry =
    coverage && typeof coverage === "object"
      ? (coverage as Record<string, unknown>)[facet.dimension]
      : undefined;
  const support =
    entry && typeof entry === "object" ? (entry as Record<string, unknown>).support : undefined;
  const unmappedRaw =
    entry && typeof entry === "object" ? (entry as Record<string, unknown>).unmapped : undefined;
  const unmapped = typeof unmappedRaw === "number" && Number.isFinite(unmappedRaw) ? unmappedRaw : null;

  const state: CrashFacetAvailability["state"] =
    support === "supplied" || support === "partial" || support === "not_supplied" ? support : "unknown";

  if (state === "not_supplied") {
    return {
      state,
      unmapped,
      note: `This source does not record ${facet.label.toLowerCase()}, so it cannot be filtered on. That is a limit of the source, not a finding about these crashes.`,
      disabled: true,
    };
  }

  const unmappedNote =
    unmapped !== null && unmapped > 0
      ? ` ${unmapped.toLocaleString()} ${unmapped === 1 ? "value was" : "values were"} supplied in a spelling OpenPlan does not recognise and ${unmapped === 1 ? "is" : "are"} not classified here.`
      : "";

  if (state === "partial") {
    return {
      state,
      unmapped,
      note: `This source records ${facet.label.toLowerCase()} only partly, so some crashes carry no value for it.${unmappedNote}`,
      disabled: false,
    };
  }

  if (state === "unknown") {
    return {
      state,
      unmapped,
      note: `This acquisition did not record whether its source supplies ${facet.label.toLowerCase()}, so an empty result here is not evidence of anything.`,
      disabled: false,
    };
  }

  return { state, unmapped, note: unmappedNote.trim() || null, disabled: false };
}
