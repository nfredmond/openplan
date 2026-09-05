/**
 * ONE evidence shape for observed crashes, and one loader for it.
 *
 * WHAT THIS FIXES. Four surfaces cite the same acquisition — the benefit-cost
 * screen, the grants board, the RTP safety criterion, and the drafted grant
 * narrative — and before this module each of them assembled its own numbers
 * from `safety_crash_ingests` plus its own counting query. That is the shape
 * this repository has a rule about: a shared capability living inside one of its
 * callers gets reimplemented wrongly by the next one. It already had. The grants
 * board fired four `count(*)` requests PER PROJECT and folded severe injuries
 * into "injury" silently, while nothing else in the product could see the
 * `unknown` band at all.
 *
 * THE THREE HONESTY RULES, inherited verbatim from `bca-evidence.ts` because
 * they were right there:
 *
 *   1. NULL RATHER THAN ZEROS. A count that could not be read is `null`, never
 *      `0`. An acquisition whose person rows were never retrieved has no role
 *      counts — it does not have zero pedestrians. This is the same rule the
 *      `unknown` severity band exists to enforce one level down, and it is the
 *      rule that a fabricated zero on a safety screen breaks silently, because a
 *      zero looks exactly like good news.
 *   2. THE CITATION TRAVELS WITH THE NUMBERS. `citationText` and `caveats` are
 *      fields of this object, not something a consumer is trusted to add. There
 *      is no way to render a figure from this shape without having its
 *      provenance in hand.
 *   3. OBSERVED IS NOT PREDICTED, AND IT IS NOT COMPLETE. Every evidence object
 *      carries the sentences saying so, computed from ITS extract — never a
 *      constant quoting a statewide figure that describes almost no real
 *      acquisition (see `caveats.ts`, `describeGeocodingShortfall`).
 *
 * IT INFORMS, IT NEVER SCORES. Nothing here produces a rating, a rank, a
 * priority, or a verdict. The RTP safety criterion shows these facts beside the
 * planner's 0–3 rating exactly as the VMT/GHG criteria show a model run's KPIs,
 * and the planner sets the number. A function here that returned "this project
 * scores 3 on safety" would be a machine authoring a judgement onto an adopted
 * plan, which is refused (see `src/lib/rtp/safety-evidence.ts`).
 *
 * JURISDICTION-NEUTRAL. Every band and role in this file comes from
 * `vocabulary.ts`. Nothing here knows which agency, state or country supplied a
 * crash, and a source that records fewer dimensions produces a smaller evidence
 * object rather than a wrong one.
 */

import {
  CRASH_DIMENSION_COLUMNS,
  CRASH_PARTY_ROLES,
  CRASH_SEVERITIES,
  type CrashPartyRole,
  type CrashSeverity,
} from "./vocabulary";
import { readEveryPage } from "@/lib/supabase/paged-read";
import {
  SAFETY_CRASH_DATA_CAVEAT,
  SAFETY_CRASH_DATA_NARRATIVE_CAVEAT,
  SAFETY_SCREENING_NARRATIVE_CAVEAT,
  SAFETY_SEVERITY_COMPLETENESS_CAVEAT,
  SAFETY_UNCLASSIFIED_SEVERITY_CAVEAT,
  SAFETY_UNCLASSIFIED_SEVERITY_NARRATIVE_CAVEAT,
  describeGeocodingShortfall,
} from "./caveats";

/** Counts by neutral severity band. Every band present; absent bands are true zeros. */
export type SafetyCrashSeverityCounts = Readonly<Record<CrashSeverity, number>>;

/** Counts of PEOPLE by neutral role. */
export type SafetyCrashRoleCounts = Readonly<Record<CrashPartyRole, number>>;

/**
 * The `safety_crash_ingests` fields the evidence shape reads.
 *
 * camelCase because this is the boundary: the loader below is the only place
 * that knows the column names, and every consumer takes this type.
 */
export type SafetyCrashEvidenceIngest = {
  id: string;
  projectId: string | null;
  status: string;
  sourceLabel: string | null;
  attribution: string | null;
  severityCompleteness: string;
  /** Reported collisions matching the acquisition — geocoded or not. */
  crashCount: number;
  /** Of those, how many carried coordinates and are stored as points. */
  geocodedCount: number;
  truncated: boolean;
  yearsRequested: number[];
  createdAt: string;
  /** `dimension_coverage`, untyped on purpose — read it through `facetAvailability`. */
  dimensionCoverage: unknown;
  /** 'retrieved' | 'not_retrieved' | 'not_supported'. */
  partyCompleteness: string;
  /** People stored, or null when person rows were not retrieved. Never 0-for-unknown. */
  partyCount: number | null;
  /** 'party_rows' | 'crash_flags' | null — which basis the involvement flags rest on. */
  involvementBasis: string | null;
  publishedThrough?: string | null;
  publishedThroughProvenance?: Record<string, unknown> | null;
};

/**
 * Everything a surface needs to cite one crash acquisition honestly.
 *
 * Read the three nullable count fields as three different statements:
 *   `severityCounts: null` — the counting query failed. Nothing may be rendered.
 *   `roleCounts: null`     — person rows were not retrieved for this acquisition.
 *   `ksi: null`            — the source cannot separate suspected serious-
 *                            injury crashes, so a severe-crash count cannot be
 *                            derived from it AT ALL. Not zero.
 */
export type SafetyCrashEvidence = {
  ingestId: string;
  projectId: string | null;
  /**
   * The acquisition's own status. Carried on the evidence because a consumer
   * that offers numbers (the benefit-cost prefill) must refuse a retrieval that
   * has not finished, and asking it to hold the ingest row as well as the
   * evidence would put two sources of the same truth on one screen.
   */
  status: string;
  /** Whether the source separates suspected serious injuries — see `separatesSeriousInjuries`. */
  severityCompleteness: string;
  /** Retrieval stopped at the record cap, so every count here is a floor. */
  truncated: boolean;
  sourceLabel: string | null;
  attribution: string | null;
  /** Distinct requested years, ascending. */
  years: number[];
  /** Stored collisions by band, or null when the count could not be read. */
  severityCounts: SafetyCrashSeverityCounts | null;
  /** People by role, or null when person rows were not retrieved for this acquisition. */
  roleCounts: SafetyCrashRoleCounts | null;
  /** Fatal-crash rows plus severe-injury-crash rows, or null when the source cannot separate them. */
  ksi: number | null;
  /** Collisions the source reported no casualty count for. Null when counts are unreadable. */
  unclassifiedCount: number | null;
  /** Reported collisions, geocoded or not — the denominator a planner should quote. */
  reportedTotal: number;
  /** Of those, the ones with coordinates, which are the ones counted above. */
  mappedTotal: number;
  /** `dimension_coverage`, passed through for `facetAvailability`. */
  dimensionCoverage: unknown;
  citationText: string;
  /** Full-sentence disclosures for a UI surface. Always at least one. */
  caveats: string[];
  /**
   * The ONE sentence a drafted narrative must reproduce beside any figure from
   * this object. Single-sentence by contract: the per-sentence grounding
   * validator leaves the trailing sentences of a multi-sentence caveat uncited
   * (see `caveats.ts`).
   */
  narrativeCaveat: string;
  /**
   * Every applicable narrative caveat, each individually a single sentence, most
   * important first. `narrativeCaveat` is the first of these. A drafter that can
   * only carry one sentence uses that field; one that can carry several must not
   * have to re-derive which others apply.
   */
  narrativeCaveats: string[];
  publishedThrough: string | null;
  publishedThroughProvenance: Record<string, unknown> | null;
};

function zeroSeverityCounts(): Record<CrashSeverity, number> {
  return Object.fromEntries(CRASH_SEVERITIES.map((band) => [band, 0])) as Record<CrashSeverity, number>;
}

function zeroRoleCounts(): Record<CrashPartyRole, number> {
  return Object.fromEntries(CRASH_PARTY_ROLES.map((role) => [role, 0])) as Record<CrashPartyRole, number>;
}

/** Distinct requested years, ascending. */
function distinctYears(years: number[]): number[] {
  return Array.from(new Set(years.filter((year) => Number.isFinite(year)))).sort((a, b) => a - b);
}

function formatYearSpan(years: number[]): string {
  if (years.length === 0) return "";
  if (years.length === 1) return `, year ${years[0]}`;
  return `, years ${years[0]}–${years[years.length - 1]}`;
}

/**
 * The severity total a caller should compare against `mappedTotal`.
 *
 * Exported because two surfaces need "how many collisions do these bands
 * actually cover" and computing it by adding up the fields they happen to
 * render is how a total stops agreeing with its parts.
 */
export function totalCountedCrashes(counts: SafetyCrashSeverityCounts | null): number | null {
  if (!counts) return null;
  return CRASH_SEVERITIES.reduce((sum, band) => sum + counts[band], 0);
}

/** People counted across every role, or null when person rows were not retrieved. */
export function totalCountedParties(counts: SafetyCrashRoleCounts | null): number | null {
  if (!counts) return null;
  return CRASH_PARTY_ROLES.reduce((sum, role) => sum + counts[role], 0);
}

/**
 * Whether a source separates suspected serious injuries.
 *
 * The severity-completeness marker is the ingest's own record of what its source
 * could express, and `severe_injury` is only reachable when it says `kabco_full`.
 * A severe-crash figure derived without it would be `fatal + 0`, which reads as
 * "no serious-injury crashes occurred" — an unsupported claim this module must
 * not publish.
 */
export function separatesSeriousInjuries(severityCompleteness: string): boolean {
  return severityCompleteness === "kabco_full";
}

/**
 * Build the evidence for ONE acquisition.
 *
 * Pure. `severityCounts`/`roleCounts` are passed as `null` by the loader when
 * the read failed or the rows were never retrieved, and every derived figure
 * downstream of a null stays null rather than collapsing to a zero.
 */
export function buildSafetyCrashEvidence(
  ingest: SafetyCrashEvidenceIngest,
  counts: {
    severity: SafetyCrashSeverityCounts | null;
    role: SafetyCrashRoleCounts | null;
  }
): SafetyCrashEvidence {
  const years = distinctYears(ingest.yearsRequested);
  const severityCounts = counts.severity;
  const roleCounts = counts.role;

  const ksi = severityCounts && separatesSeriousInjuries(ingest.severityCompleteness)
    ? severityCounts.fatal + severityCounts.severe_injury
    : null;
  const unclassifiedCount = severityCounts ? severityCounts.unknown : null;

  const caveats: string[] = [SAFETY_CRASH_DATA_CAVEAT];
  const narrativeCaveats: string[] = [SAFETY_CRASH_DATA_NARRATIVE_CAVEAT];

  const geocodingShortfall = describeGeocodingShortfall(ingest.crashCount, ingest.geocodedCount);
  if (geocodingShortfall) caveats.push(geocodingShortfall);

  if (unclassifiedCount !== null && unclassifiedCount > 0) {
    caveats.push(
      `${unclassifiedCount.toLocaleString()} of these collisions carry no casualty count from the source agency. ` +
        SAFETY_UNCLASSIFIED_SEVERITY_CAVEAT
    );
    narrativeCaveats.push(SAFETY_UNCLASSIFIED_SEVERITY_NARRATIVE_CAVEAT);
  }

  if (!separatesSeriousInjuries(ingest.severityCompleteness)) {
    caveats.push(SAFETY_SEVERITY_COMPLETENESS_CAVEAT);
  }

  if (ingest.truncated) {
    caveats.push(
      "Retrieval stopped at the record cap, so this acquisition is a partial slice of the study area and every count below is a floor."
    );
  }

  caveats.push(
    ingest.publishedThrough
      ? `The source states that this dataset is published through ${ingest.publishedThrough}.`
      : "The source supplied no exact publication cutoff. The requested years and latest returned crash are not used as substitutes."
  );

  if (roleCounts === null) {
    caveats.push(
      // NOT "no pedestrians were involved". The distinction the whole module
      // rests on: an unretrieved count is not a zero.
      ingest.partyCompleteness === "not_supported"
        ? "This source records no person-level detail, so who was involved cannot be counted from it — only whether a collision was flagged as involving a pedestrian, bicyclist or motorcyclist."
        : "Person-level records were not retrieved for this acquisition, so nobody is counted by role here. That is missing information, not an absence of people."
    );
  } else if (ingest.involvementBasis === "crash_flags") {
    caveats.push(
      "Pedestrian, bicyclist and motorcyclist involvement here rests on the source's crash-level flags rather than on its person records; measured against one state's 2025 file those flags undercount bicyclist involvement by about 17%."
    );
  }

  narrativeCaveats.push(SAFETY_SCREENING_NARRATIVE_CAVEAT);

  const sourceName = ingest.sourceLabel ?? "Observed crash source";
  const attributionSuffix = ingest.attribution ? ` ${ingest.attribution}` : "";
  const citationText =
    `${sourceName}: ${ingest.crashCount.toLocaleString("en-US")} crashes reported, ` +
    `${ingest.geocodedCount.toLocaleString("en-US")} geocoded${formatYearSpan(years)}. ` +
    `Source ingest ${ingest.id}.${attributionSuffix}`;

  return {
    ingestId: ingest.id,
    projectId: ingest.projectId,
    status: ingest.status,
    severityCompleteness: ingest.severityCompleteness,
    truncated: ingest.truncated,
    sourceLabel: ingest.sourceLabel,
    attribution: ingest.attribution,
    years,
    severityCounts,
    roleCounts,
    ksi,
    unclassifiedCount,
    reportedTotal: ingest.crashCount,
    mappedTotal: ingest.geocodedCount,
    dimensionCoverage: ingest.dimensionCoverage,
    publishedThrough: ingest.publishedThrough ?? null,
    publishedThroughProvenance: ingest.publishedThroughProvenance ?? null,
    citationText,
    caveats,
    narrativeCaveat: narrativeCaveats[0],
    narrativeCaveats,
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * The `safety_crash_ingests` projection every evidence consumer must request.
 *
 * ONE STRING, because `.select()` is not type-checked in this codebase (there is
 * no generated Supabase types step, by deliberate decision) — so a consumer that
 * hand-wrote its own projection and forgot `party_completeness` would get
 * `undefined`, which reads as "not retrieved", which prints a caveat about
 * missing people onto an acquisition that has them.
 */
export const SAFETY_CRASH_EVIDENCE_INGEST_PROJECTION = [
  "id",
  "project_id",
  "min_lon",
  "min_lat",
  "max_lon",
  "max_lat",
  "status",
  "source_label",
  "attribution",
  "severity_completeness",
  "crash_count",
  "geocoded_count",
  "truncated",
  "years_requested",
  "created_at",
  "dimension_coverage",
  "party_completeness",
  "party_count",
  "involvement_basis",
  "published_through",
  "published_through_provenance",
].join(", ");

/** The name of the grouped-count RPC. One spelling, so a caller cannot typo it into a silent empty. */
export const SAFETY_CRASH_EVIDENCE_COUNTS_RPC = "safety_crash_evidence_counts";

/**
 * Read one ingest row (as PostgREST hands it over, untyped) into the boundary type.
 *
 * A row whose id is unusable returns null rather than an evidence object with an
 * empty id: an evidence object keyed on "" would silently collide with the next
 * unreadable row.
 */
export function readSafetyCrashEvidenceIngest(
  row: Readonly<Record<string, unknown>>
): SafetyCrashEvidenceIngest | null {
  const id = typeof row.id === "string" && row.id.length > 0 ? row.id : null;
  if (!id) return null;

  const years = Array.isArray(row.years_requested)
    ? row.years_requested.filter((year): year is number => typeof year === "number" && Number.isFinite(year))
    : [];

  return {
    id,
    projectId: typeof row.project_id === "string" ? row.project_id : null,
    status: typeof row.status === "string" ? row.status : "",
    sourceLabel: typeof row.source_label === "string" ? row.source_label : null,
    attribution: typeof row.attribution === "string" ? row.attribution : null,
    severityCompleteness: typeof row.severity_completeness === "string" ? row.severity_completeness : "",
    crashCount: typeof row.crash_count === "number" ? row.crash_count : 0,
    geocodedCount: typeof row.geocoded_count === "number" ? row.geocoded_count : 0,
    truncated: row.truncated === true,
    yearsRequested: years,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    dimensionCoverage: row.dimension_coverage ?? null,
    // An absent marker is 'not_supported', which suppresses role counts and says
    // so. The optimistic reading — assuming people were retrieved — would print
    // a zero pedestrian count for an acquisition that never looked.
    partyCompleteness: typeof row.party_completeness === "string" ? row.party_completeness : "not_supported",
    partyCount: typeof row.party_count === "number" ? row.party_count : null,
    involvementBasis: typeof row.involvement_basis === "string" ? row.involvement_basis : null,
    publishedThrough: typeof row.published_through === "string" ? row.published_through : null,
    publishedThroughProvenance:
      row.published_through_provenance && typeof row.published_through_provenance === "object"
        ? row.published_through_provenance as Record<string, unknown>
        : null,
  };
}

/** One row of the grouped-count RPC. */
type EvidenceCountRow = {
  ingest_id: unknown;
  dimension: unknown;
  value: unknown;
  record_count: unknown;
};

/** Structural client type — cast the real (deliberately untyped) client with `as unknown as SafetyCrashEvidenceSupabaseLike`. */
export type SafetyCrashEvidenceSupabaseLike = {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): SafetyCrashEvidenceRpcBuilder;
};

/**
 * The bits of the PostgREST builder this module drives. Both are optional
 * because the older structural fakes provide neither, and a fake missing
 * `.range` is served one unpaged read — the behaviour before paging existed.
 */
export type SafetyCrashEvidenceRpcBuilder = PromiseLike<{ data: unknown; error: unknown }> & {
  /** PostgREST range header. Present on the real builder; see the paging note below. */
  range?: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>;
  /** PostgREST ordering. Required for paging to be correct — see the loop below. */
  order?: (
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean }
  ) => SafetyCrashEvidenceRpcBuilder;
};

/**
 * How many rows to ask for per page.
 *
 * POSTGREST CAPS A FUNCTION RESULT THE SAME WAY IT CAPS A TABLE READ. Measured
 * on 2026-08-14 against this deployment with a throwaway function returning
 * 1,500 rows: psql returned 1,500, the REST endpoint returned exactly 1,000.
 * This RPC returns one row per (ingest, dimension, value) — about eleven per
 * populated acquisition — so a workspace somewhere north of ninety acquisitions
 * would have had bands silently dropped from the RTP safety criterion, the BCA
 * screening input, the grants board and drafted grant narratives. Nothing would
 * have looked wrong; the counts would simply have been low, in documents that
 * go to funders.
 *
 * Paging is deliberately cap-AGNOSTIC, and the shared loop in
 * `@/lib/supabase/paged-read` is what makes that true. An earlier version of
 * this file stopped when a page came back SHORT and claimed in this very
 * docblock that it stayed correct if an operator "raises or lowers" max-rows.
 * The lowering half was false: with max-rows below this page size the FIRST
 * page is short, so the loop ended immediately and folded a prefix into
 * totals that read as complete. The page size is a request, never an
 * assumption about what the server will honour.
 */
/**
 * The columns that give the RPC's result a stable TOTAL order.
 *
 * These are `safety_crash_evidence_counts`'s own GROUP BY key (migration
 * 20260812000003 groups both UNION ALL arms by ingest and by the dimension's
 * value), so together they are unique per returned row. Ordering on fewer of
 * them would leave ties, and a tie is exactly where a row slips across a page
 * boundary between two requests — read twice, or not at all.
 *
 * `src/test/paged-reads-order-before-they-range.test.ts` checks these against
 * the migration, so adding a dimension to the function without extending this
 * list fails rather than silently destabilising the paging.
 */
export const SAFETY_CRASH_EVIDENCE_ORDER_COLUMNS = ["ingest_id", "dimension", "value"] as const;

const EVIDENCE_COUNT_PAGE_SIZE = 500;

/** A defensive ceiling: 200 pages is far past any real workspace and stops a
 *  server that ignores range headers from looping forever. Hitting it is
 *  treated as a FAILED read, not a complete one. */
const EVIDENCE_COUNT_MAX_PAGES = 200;

/**
 * Fold the RPC's long result into per-ingest count maps.
 *
 * Exported for the tests, and because the fold is where the two "absent means
 * zero" decisions live and they must live in ONE place:
 *
 *   - A severity band with no row IS a true zero. `severity` is NOT NULL on
 *     `safety_crashes`, so every stored collision is counted in exactly one
 *     band, and a band the RPC did not mention genuinely holds nothing.
 *   - A role with no row is a zero ONLY IF person rows were retrieved. That
 *     decision needs the ingest, so it is made in `buildSafetyCrashEvidenceMap`
 *     below, not here; this function reports what the RPC actually said.
 */
export function foldCrashEvidenceCounts(rows: readonly EvidenceCountRow[]): Map<
  string,
  { severity: Record<CrashSeverity, number>; role: Record<CrashPartyRole, number>; sawRole: boolean }
> {
  const byIngest = new Map<
    string,
    { severity: Record<CrashSeverity, number>; role: Record<CrashPartyRole, number>; sawRole: boolean }
  >();

  const severityValues = new Set<string>(CRASH_SEVERITIES);
  const roleValues = new Set<string>(CRASH_PARTY_ROLES);

  for (const row of rows) {
    const ingestId = typeof row.ingest_id === "string" ? row.ingest_id : null;
    const dimension = typeof row.dimension === "string" ? row.dimension : null;
    const value = typeof row.value === "string" ? row.value : null;
    // `count(*)` comes back from PostgREST as a number, but a bigint over the
    // JSON boundary is a string in some drivers; both are read, neither is guessed.
    const count =
      typeof row.record_count === "number"
        ? row.record_count
        : typeof row.record_count === "string"
          ? Number.parseInt(row.record_count, 10)
          : Number.NaN;
    if (!ingestId || !dimension || !value || !Number.isFinite(count)) continue;

    const entry =
      byIngest.get(ingestId) ??
      { severity: zeroSeverityCounts(), role: zeroRoleCounts(), sawRole: false };

    if (dimension === CRASH_DIMENSION_COLUMNS.severity && severityValues.has(value)) {
      entry.severity[value as CrashSeverity] += count;
    } else if (dimension === CRASH_DIMENSION_COLUMNS.party_role && roleValues.has(value)) {
      entry.role[value as CrashPartyRole] += count;
      entry.sawRole = true;
    }

    byIngest.set(ingestId, entry);
  }

  return byIngest;
}

/**
 * Load the evidence for a set of acquisitions in ONE round-trip.
 *
 * Replaces four `count(*)` HEAD requests per project with a single grouped
 * count. The RPC is `SECURITY INVOKER`, so the caller's own RLS is what scopes
 * the rows — passing a service-role client here would count crashes the reader
 * may not see, which is why callers pass their request-scoped client.
 *
 * A FAILED COUNT DOES NOT FAIL THE PAGE, and it does not become zeros either:
 * every evidence object comes back with `severityCounts: null`, which every
 * consumer renders as "could not be read".
 */
export async function loadSafetyCrashEvidence(
  supabase: SafetyCrashEvidenceSupabaseLike,
  workspaceId: string,
  ingests: readonly SafetyCrashEvidenceIngest[]
): Promise<Map<string, SafetyCrashEvidence>> {
  const ingestIds = Array.from(new Set(ingests.map((ingest) => ingest.id)));
  if (ingestIds.length === 0) return new Map();

  const makeQuery = () =>
    supabase.rpc(SAFETY_CRASH_EVIDENCE_COUNTS_RPC, {
      p_workspace_id: workspaceId,
      p_ingest_ids: ingestIds,
    });

  // A client without `.range` (the older structural fakes, and any caller
  // passing a minimal stub) gets one unpaged read rather than an exception —
  // one unpaged read is exactly the behaviour before paging existed, so nothing
  // that worked before breaks here. The builder is inspected, never an extra
  // request: this same builder becomes either the single read or page zero.
  let pending: SafetyCrashEvidenceRpcBuilder | null = makeQuery();

  if (!pending.range) {
    const { data, error } = await pending;
    const unpaged = Array.isArray(data) ? (data as EvidenceCountRow[]) : [];
    return buildSafetyCrashEvidenceMap(ingests, error ? null : foldCrashEvidenceCounts(unpaged));
  }

  const { rows, complete } = await readEveryPage<EvidenceCountRow>(
    (from, toInclusive) => {
      const query = pending ?? makeQuery();
      pending = null;

      // A STABLE TOTAL ORDER, WITHOUT WHICH PAGING IS WORSE THAN NOT PAGING.
      //
      // The RPC is a UNION ALL of two GROUP BYs and defines no ORDER BY, so
      // Postgres owes no consistent row order between the separate requests
      // that LIMIT/OFFSET paging makes. A row that shifts across a page
      // boundary between requests is read twice or not at all — and
      // `foldCrashEvidenceCounts` SUMS what it reads, so a duplicate inflates a
      // severity band in the RTP safety criterion, the BCA input and drafted
      // grant narratives. These three columns are the function's own grouping
      // key, so together they are unique per row: a total order, not merely an
      // order.
      const ordered = SAFETY_CRASH_EVIDENCE_ORDER_COLUMNS.reduce<SafetyCrashEvidenceRpcBuilder>(
        (builder, column) =>
          builder.order ? builder.order(column, { ascending: true, nullsFirst: false }) : builder,
        query
      );

      if (!ordered.range && !query.range) {
        // Unreachable: `pending.range` was proven above, and `.order` returns
        // the same builder. Stated rather than asserted so a future client whose
        // `.order` drops `.range` fails as an unreadable count, not as a silent
        // single page presented as a total.
        return Promise.resolve({ data: null, error: { message: "client cannot page this read" } });
      }

      // Keep the method attached to its builder. The real PostgREST transform
      // reads `this.url`; detaching it worked in arrow-function mocks and then
      // crashed every real project page that loaded linked safety evidence.
      return (ordered.range
        ? ordered.range(from, toInclusive)
        : query.range!(from, toInclusive)) as PromiseLike<{
        data: EvidenceCountRow[] | null;
        error: { message: string } | null;
      }>;
    },
    { pageSize: EVIDENCE_COUNT_PAGE_SIZE, maxPages: EVIDENCE_COUNT_MAX_PAGES }
  );

  // An incomplete read becomes `null` counts, never a partial total. Every
  // consumer renders null as "could not be read".
  return buildSafetyCrashEvidenceMap(ingests, complete ? foldCrashEvidenceCounts(rows) : null);
}

/**
 * Assemble the evidence map from the ingests and whatever the count read
 * produced. Pure, and separated from the I/O so the "counts unreadable" and
 * "people not retrieved" branches are reachable in a test without a database.
 */
export function buildSafetyCrashEvidenceMap(
  ingests: readonly SafetyCrashEvidenceIngest[],
  countsByIngest: ReturnType<typeof foldCrashEvidenceCounts> | null
): Map<string, SafetyCrashEvidence> {
  const evidence = new Map<string, SafetyCrashEvidence>();

  for (const ingest of ingests) {
    const counted = countsByIngest?.get(ingest.id) ?? null;

    // The count read failed as a whole → nothing may be rendered as a number.
    // Distinct from "this acquisition stored no crashes", which is a real zero
    // and arrives as an ingest with no counted entry.
    const severity = countsByIngest === null ? null : (counted?.severity ?? zeroSeverityCounts());

    // Role counts exist only when person rows were actually retrieved. An
    // acquisition that never fetched people has no zero to report — see the
    // caveat this drives in `buildSafetyCrashEvidence`.
    const role =
      countsByIngest === null || ingest.partyCompleteness !== "retrieved"
        ? null
        : (counted?.role ?? zeroRoleCounts());

    evidence.set(ingest.id, buildSafetyCrashEvidence(ingest, { severity, role }));
  }

  return evidence;
}

/**
 * The newest READY acquisition for each project.
 *
 * Extracted because the grants board and the project spine both want exactly
 * this and both had their own copy of the loop. A non-ready acquisition is
 * skipped rather than shown with a warning: an ingest still running has counts
 * that will change under the reader.
 *
 * IT SORTS RATHER THAN TRUSTING THE CALLER'S ORDER. The version this replaces
 * took "first row wins" on faith that every caller had written
 * `.order("created_at", { ascending: false })`, which is a convention — and a
 * caller who forgets it gets the OLDEST acquisition silently, with correct-
 * looking numbers from the wrong retrieval. Sorting here costs nothing at these
 * row counts and removes the possibility.
 */
export function latestReadyIngestByProject(
  rows: readonly SafetyCrashEvidenceIngest[]
): Map<string, SafetyCrashEvidenceIngest> {
  const latest = new Map<string, SafetyCrashEvidenceIngest>();
  const newestFirst = [...rows].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  for (const row of newestFirst) {
    if (row.status !== "ready" || !row.projectId) continue;
    if (!latest.has(row.projectId)) latest.set(row.projectId, row);
  }
  return latest;
}
