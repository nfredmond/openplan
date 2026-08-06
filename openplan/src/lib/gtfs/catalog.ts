/**
 * THE MOBILITY DATABASE CATALOG — HOW A PLANNER ANYWHERE FINDS THE FEEDS THAT
 * COVER THEIR AREA, AND WHY THIS MODULE NEVER PICKS ONE FOR THEM.
 *
 * The Mobility Database is a public, keyless, community-maintained CSV listing
 * of the world's published transit feeds: 3,434 rows across 84 countries when
 * this was written, of which 2,441 are static GTFS and the rest are realtime.
 * It is the only thing that lets OpenPlan answer "what transit serves this
 * place" for a planner in Ohio, in Fresno, or in Nairobi without an operator
 * hand-configuring anything (product non-negotiables #0, #1 and #4).
 *
 * ============================================= WHY THIS RETURNS A LIST, ALWAYS
 *
 * `workers/aequilibrae_worker/gtfs_skim.py` — the domain reference this lane was
 * ported from — has `select_feed_from_catalog`, which returns ONE url: the
 * smallest intersecting bounding box wins. That is the right shape for a
 * screening model that must run unattended and needs *a* feed. It is the wrong
 * shape here, and knowingly so.
 *
 * Measured against the live catalog on 2026-08-05: THIRTEEN static feeds publish
 * a bounding box containing downtown Sacramento. One of them is Amtrak, whose
 * national box contains nearly every point in the United States. Several belong
 * to neighbouring counties whose service reaches in. Only the planner knows
 * which operator is theirs, which ones they are studying, and whether they want
 * one or all thirteen. A function that answers "the transit feed for your area"
 * is a function that is confidently wrong twelve times out of thirteen.
 *
 * So: everything that matched comes back, RANKED, and the choice stays with the
 * person. The ranking is `compareByLocality` and it is a presentation order, not
 * a verdict — nothing in this file discards a feed for being big.
 *
 * ================================================= THE FOUR-WAY OUTCOME, AND
 *                                                   WHY IT IS A UNION
 *
 * "The catalog listed nothing covering your area" and "the catalog could not be
 * read" are completely different facts, and collapsing them tells a planner
 * their community has no transit service when all that happened is that a
 * download failed. `gtfs_skim.py`'s `FeedDiscovery` makes exactly this point,
 * and `PlaceSearchOutcome` in the geographies lane carries the same distinction
 * as a `searchUnavailable` flag beside the items.
 *
 * This one goes one step further and makes it a DISCRIMINATED UNION with no
 * `feeds` field on the answerless branches, because a flag beside a list is a
 * flag someone forgets to read: `outcome.feeds.length === 0 ? "no transit
 * here" : …` type-checks against a flag-shaped result and is the exact misreport
 * this is defending against. Here it does not compile.
 *
 * THE SAME MISREPORT HAD A SECOND HOME, ONE LEVEL DOWN, and closing it is why
 * there are four branches rather than three. A feed can cover a planner's area
 * and still not be offered — the catalog withdrew it, it needs an API key this
 * deployment does not hold, or the catalog publishes no address for it. All
 * three used to fall through to `no_covering_feed`, so a planner in a city with
 * three transit feeds, all behind keys, was told their area has none. See
 * `GtfsCatalogSearchOutcome`: `covered_but_unusable` carries the agencies and
 * the reasons, and `no_covering_feed` is now reachable only when nothing covered
 * the area at all.
 *
 * ==================================== WHAT THE CATALOG SAYS VS WHAT IS TRUE
 *
 * THE CATALOG'S TEXT LOCATION FIELDS ARE UNRELIABLE AND ARE NEVER A FILTER.
 * Verified on 2026-08-05: `mdb_source_id` 75, "El Dorado Transit" — a California
 * operator serving El Dorado County — carries
 * `location.subdivision_name = "Colorado"`, while its published bounding box is
 * squarely in California and contains Sacramento. A subdivision filter would
 * hide that agency from the planners who work with it and show it to planners
 * 1,200 km away.
 *
 * Geography matching is therefore BY BOUNDING BOX ONLY. `country_code` is not a
 * filter either, and not merely because it is unreliable: filtering on it would
 * bake the United States into a core code path, which non-negotiable #0 forbids
 * outright. The text fields are projected and may be DISPLAYED as "what the
 * catalog says about this feed" — they are never asserted by OpenPlan and never
 * include or exclude anything.
 *
 * ========================================= THE STATUS TRAP, MEASURED, IN FULL
 *
 * The single most dangerous mistake available in this file is to keep the rows
 * whose `status` says `active`. Measured over the 1,173 United States static
 * GTFS rows on 2026-08-05:
 *
 *      blank status   770        active         54
 *      deprecated     263        development     5
 *      inactive        81
 *
 * An allow-list on `active` would drop 775 of the 829 usable feeds — 93.5% of
 * them — and every agency lost that way would read to a planner as "your area
 * has no transit". The exclusion is therefore a DENY-LIST over
 * {deprecated, inactive}, blank means USABLE, and `gtfs-catalog.test.ts` has a
 * case that fails if this is ever inverted into an allow-list.
 *
 * `development` is KEPT, because a feed an agency is still building is a feed a
 * planner may legitimately want to look at — and its verbatim status rides along
 * on the entry so a surface can say so rather than presenting it as settled.
 */

import { parse } from "csv-parse/sync";

import { fetchCappedBytes, type GtfsFetchOptions } from "./fetch";
import { resolveGtfsLimits } from "./limits";
import type { GtfsFailureCode } from "./types";

/**
 * THE CANONICAL CATALOG ADDRESS, PINNED.
 *
 * Verified 2026-08-05: HTTP 200, 1,154,557 bytes, 3,434 data rows.
 *
 * `gtfs_skim.py` reaches the same file through a bit.ly shortlink. That is a
 * dependency this side of the product will not take: a third party who can
 * silently repoint a shortlink can repoint EVERY deployment's feed catalog at
 * once, to a CSV of their choosing, and the first thing any deployment would do
 * with the result is fetch the URLs in it. The storage address is the one the
 * publisher actually serves from, and it is written out here in full so that
 * changing where this deployment looks is a visible edit and not a redirect
 * somebody else controls.
 *
 * An operator who mirrors the catalog internally passes `catalogUrl`; the
 * outbound allowlist still applies to whatever they pass.
 */
export const MOBILITY_DATABASE_CATALOG_URL =
  "https://storage.googleapis.com/storage/v1/b/mdb-csv/o/sources.csv?alt=media";

/**
 * A rectangle in WGS84 degrees.
 *
 * Field-for-field identical to `ResolvedBoundary["bbox"]` in
 * `src/lib/geographies/place-resolver.ts`, deliberately: the study-area picker
 * is the existing any-place front door, and a planner's resolved county, place,
 * CDP or metro boundary must drop straight into this search with no adapter.
 * A second, subtly different bbox convention in the same product is how a
 * latitude and a longitude end up swapped in one lane and not the other.
 */
export type GeoBoundingBox = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

/** A point, when the planner has one. Used only to break ranking ties. */
export type GeoPoint = { lon: number; lat: number };

/**
 * The area a feed search is about.
 *
 * A BOX AND OPTIONALLY A POINT, never a state, county, FIPS code or agency name
 * (non-negotiable #0). Every jurisdiction on earth can produce a bounding box;
 * only some can produce a FIPS code, and a core type that asks for one has
 * decided which country the product is for.
 */
export type GtfsCatalogArea = {
  bbox: GeoBoundingBox;
  /**
   * Where in the area the planner actually pointed, when they pointed. Feeds of
   * equal service-area size are ordered by distance from this, falling back to
   * the centre of `bbox` when it is absent.
   */
  focus?: GeoPoint;
};

/**
 * WHAT THE CATALOG SAYS ABOUT WHERE A FEED IS. Display only.
 *
 * Read the module header before using any of this for anything. These three
 * strings are the catalog's own words, they are wrong for at least one verified
 * agency, and nothing in OpenPlan may filter, include, exclude or rank on them.
 */
export type GtfsCatalogStatedLocation = {
  countryCode: string | null;
  subdivisionName: string | null;
  municipality: string | null;
};

/** How a feed's URL is authenticated, and whether that puts it out of reach. */
export type GtfsCatalogAuthentication = {
  /** The catalog's verbatim `urls.authentication_type`. */
  type: string | null;
  /**
   * True when the feed cannot be downloaded without a key this deployment does
   * not hold. FAILS CLOSED: `0` and blank mean no key, and ANY OTHER VALUE —
   * including one this code has never seen — means a key is needed. An
   * authentication scheme we do not recognise is not one we can satisfy, and
   * guessing "probably open" produces a download that fails later with a
   * confusing 401 instead of an honest refusal now.
   */
  requiresKey: boolean;
  /** The query parameter the key goes in, when the catalog names one. */
  apiKeyParameterName: string | null;
  /** Whatever the catalog says about obtaining a key. */
  info: string | null;
};

/**
 * ONE STATIC GTFS FEED AS THE CATALOG DESCRIBES IT.
 *
 * A NARROW PROJECTION OF A 28-COLUMN ROW, on purpose. The columns not carried
 * here (`note`, `static_reference`, `features`, `is_official`,
 * `is_producer_url_unstable`, the license URL's siblings) are omitted because
 * nothing in the product reads them, and a field carried "in case" is a field
 * whose meaning nobody verifies until it is rendered wrongly on a page.
 * `is_producer_url_unstable` is worth knowing about even though it is not
 * projected: it is the catalog's own warning that a producer's direct download
 * breaks, and it is part of why `urls.latest` is preferred below.
 */
export type GtfsCatalogEntry = {
  /** `mdb_source_id`. Stable across catalog revisions; safe to store. */
  catalogId: string;
  provider: string | null;
  name: string | null;
  /**
   * The catalog's verbatim `status`, or null when blank.
   *
   * NULL IS THE MAJORITY CASE AND MEANS USABLE — see the status trap in the
   * module header. Carried verbatim rather than normalised into a boolean so a
   * surface can disclose "the catalog marks this feed `development`" instead of
   * silently treating it as settled.
   */
  status: string | null;
  statedLocation: GtfsCatalogStatedLocation;
  /**
   * The service area the catalog publishes for this feed, or null when it
   * publishes none (104 of 1,173 US rows on 2026-08-05) or publishes one that
   * cannot be read as a rectangle.
   */
  boundingBox: GeoBoundingBox | null;
  /** When the catalog derived that box from the feed. Provenance, verbatim. */
  boundingBoxExtractedOn: string | null;
  /**
   * The address to download this feed from, or null when the catalog offers
   * none.
   *
   * `urls.latest` — a MobilityData-hosted mirror — is preferred over the
   * producer's own `urls.direct_download`, which is what `gtfs_skim.py` does
   * too. Two reasons, both the catalog's own: `latest` was populated for 100%
   * of US static rows when measured, and the catalog carries a dedicated
   * `is_producer_url_unstable` flag precisely because producer URLs move. The
   * producer address is kept beside it so a surface can show a planner where
   * their agency actually publishes.
   */
  downloadUrl: string | null;
  downloadUrlSource: "mirror" | "producer" | null;
  /** `urls.latest`, verbatim. */
  mirrorUrl: string | null;
  /** `urls.direct_download`, verbatim. */
  producerUrl: string | null;
  licenseUrl: string | null;
  authentication: GtfsCatalogAuthentication;
  /**
   * Who to write to at the agency. This is the field that makes an
   * `catalog_entry_requires_key` refusal actionable instead of a dead end — a
   * planner can ask their own transit operator for the key.
   */
  feedContactEmail: string | null;
  /** `redirect.id` — the catalog's statement that this feed is superseded. */
  redirectToCatalogId: string | null;
  redirectComment: string | null;
};

/**
 * The catalog, read.
 *
 * PLAIN JSON, no `Map`, no class. A route may reasonably want to load this once
 * and hand it to both a search and a redirect resolution, or to cache it in
 * whatever cache the deployment already has; a value with a `Map` in it cannot
 * survive that. The id index the redirect walk needs is built where it is used.
 */
export type ParsedGtfsCatalog = {
  /** Static GTFS entries only. Realtime rows never reach here. */
  entries: GtfsCatalogEntry[];
  /**
   * Rows whose `data_type` says REALTIME, dropped. OpenPlan derives service
   * levels from a published schedule and does not read vehicle positions; a
   * realtime feed offered as an answer to "what serves this area" would be a
   * feed the parser cannot open. 993 of 3,434 rows on 2026-08-05.
   *
   * THIS COUNTS ONLY ROWS THAT SAY `gtfs-rt`, and that narrowness is the point.
   * The counter used to be everything-that-is-not-`gtfs`, under this same name —
   * so a blank `data_type`, or a `gtfs-flex` row, was counted here and disclosed
   * to a planner as a realtime feed. A count's NAME is a claim, and this one was
   * asserting something the code never established. What the parse actually
   * knows about an unrecognised type is that it is unrecognised, which is what
   * `unrecognisedDataTypeRows` says.
   */
  realtimeEntriesIgnored: number;
  /**
   * Rows whose `data_type` is blank, or a word this lane has no reader for
   * (`gtfs-flex`, and whatever the catalog adds next). Dropped like realtime
   * rows are, but disclosed as their own number, because "we skipped 4 realtime
   * feeds" and "we skipped 4 rows we did not recognise" are different admissions
   * and only the second one invites anybody to look.
   */
  unrecognisedDataTypeRows: number;
  /** Rows with no usable `mdb_source_id`. Nothing can reference them. */
  unreadableRows: number;
  /** Repeated ids, last one wins — matching `parse.ts`'s duplicate-key rule. */
  duplicateIds: number;
};

/**
 * ONE FEED, PLACED IN THE RANKING, WITH THE NUMBERS THAT PUT IT THERE.
 *
 * The rank numbers ride along rather than staying inside the comparator so a
 * surface can show its work — "this box is 0.4 square degrees, that one is
 * 1,300" is the difference between a planner trusting an order and being asked
 * to take it on faith.
 */
export type RankedGtfsCatalogFeed = {
  entry: GtfsCatalogEntry;
  /** The feed's published service area, in square degrees. See `boundingBoxSpread`. */
  serviceAreaSpread: number;
  /** Degrees between the feed's centre and the search focus. The tie-break. */
  focusOffsetDegrees: number;
};

/**
 * WHAT THE SEARCH DID NOT SHOW YOU, AND WHY — returned with the answer, never
 * on the side.
 *
 * A count that lives in a log is a count nobody reads. Every number here exists
 * because a planner drawing a conclusion about their area needs it: "nothing
 * covers you" means something different when four feeds were withheld for
 * needing an API key, and something different again when eighty-eight feeds
 * publish no service area at all and could not be matched to anywhere.
 */
export type GtfsCatalogDisclosure = {
  /** Static GTFS entries the catalog listed, before any exclusion. */
  staticEntriesConsidered: number;
  /** Realtime entries the parse ignored, carried through from the parse. */
  realtimeEntriesIgnored: number;
  /**
   * Rows the parse dropped for a `data_type` it does not recognise, carried
   * through from the parse. See `ParsedGtfsCatalog.unrecognisedDataTypeRows`.
   */
  unrecognisedDataTypeRows: number;
  /** Catalog rows that could not be read as an entry at all. */
  unreadableRows: number;
  /**
   * Ids the catalog listed twice, where the later row replaced the earlier one.
   *
   * CARRIED HERE BECAUSE LAST-WINS SILENTLY DELETES AN AGENCY. The two rows
   * sharing an `mdb_source_id` are not two copies of one feed — measured on the
   * live catalog they differ in provider and download URL — so the collision
   * removes a real operator from the list a planner is reading. The parse counts
   * it and, before this field existed, that count died inside the parse: nobody
   * downstream had a number, so nobody could say a feed had gone missing.
   * Global rather than area-scoped, because the collision is resolved before
   * geography is considered.
   */
  duplicateIds: number;
  /**
   * Entries the deny-list removed, across the whole catalog. Global rather than
   * area-scoped because the exclusion happens BEFORE geography is considered: a
   * superseded row's service area is a claim about a feed nobody should fetch.
   */
  supersededOrInactive: number;
  /**
   * Of those, the ones whose published service area covers this search area.
   *
   * THE NUMBER THAT MATTERS TO A PLANNER, and the hook for the recovery path:
   * a superseded entry usually carries a `redirect.id` naming its successor, so
   * a surface seeing this above zero can offer `resolveGtfsCatalogRedirect`
   * instead of reporting a gap.
   */
  supersededOrInactiveCoveringArea: number;
  /**
   * Those entries themselves, so a surface can name the agency and offer to
   * follow its `redirect.id` to whatever superseded it.
   */
  supersededOrInactiveCoveringAreaEntries: GtfsCatalogEntry[];
  /** Covering this area, but needing an API key this deployment does not hold. */
  requiringApiKey: number;
  /**
   * Those entries themselves, so a surface can name the agency and its contact
   * address. Bounded by the catalog and, in practice, tiny: 9 of 1,173 US rows.
   */
  requiringApiKeyEntries: GtfsCatalogEntry[];
  /**
   * Usable entries the catalog publishes no readable service area for.
   *
   * NOT AREA-SCOPED, AND THE NAME SAYS SO. This counts entries across the WHOLE
   * CATALOG — every one of the world's static feeds whose service area could not
   * be read — because an entry with no box could not be matched against ANY
   * area, and pretending the number is about this planner's area would be
   * inventing a relationship the data does not have. It was called
   * `withoutPublishedServiceArea` and sat beside three area-scoped counters,
   * which is an invitation to write "88 feeds near you publish no service area".
   *
   * Disclosed rather than dropped because the honest sentence is "N feeds
   * anywhere in the catalog could not be matched to any area because it does not
   * publish their service area", and silence would turn those N into evidence of
   * no service. (For scale: 88 of the non-superseded UNITED STATES rows on
   * 2026-08-05 — a subset of what this counter reports, which is worldwide.)
   */
  entriesWithNoPublishedServiceAreaAnywhere: number;
  /** Covering this area, but with no download address in the catalog at all. */
  withoutDownloadUrl: number;
  /** Those entries themselves, so a surface can name the agency it cannot reach. */
  withoutDownloadUrlEntries: GtfsCatalogEntry[];
};

/**
 * WHY ONE FEED THAT COVERS THE PLANNER'S AREA IS STILL NOT AVAILABLE TO THEM.
 *
 * Three reasons, and each is a different thing the planner does next, which is
 * the only test a refusal vocabulary has to pass:
 *
 *   superseded       - the catalog has withdrawn this row. It usually names a
 *                      successor in `redirect.id`, so the move is to follow it
 *                      with `resolveGtfsCatalogRedirect`.
 *   requires_api_key - the feed is live and behind a key this deployment does
 *                      not hold. The move is to ask the agency, whose contact
 *                      address is on the entry.
 *   no_download_url  - the catalog lists the agency and publishes no address for
 *                      their feed. Nothing to fetch; the move is to ask the
 *                      agency where they publish.
 */
export type GtfsWithheldFeedReason = "superseded" | "requires_api_key" | "no_download_url";

/** One feed that covers the area and could not be offered, with the reason why. */
export type GtfsWithheldFeed = {
  entry: GtfsCatalogEntry;
  reason: GtfsWithheldFeedReason;
};

/**
 * THE ANSWER TO "WHAT SERVES THIS AREA", IN THE ONLY FOUR SHAPES IT HAS.
 *
 * `matched` carries a NON-EMPTY tuple type, so "matched, with nothing in it" is
 * not a value anyone can construct. The three answerless branches carry no
 * `feeds` at all, so none of them can be read as an empty list. The names mirror
 * `gtfs_skim.py`'s `FeedDiscovery.reason` strings on purpose — one vocabulary
 * across the TypeScript and the Python halves of this lane.
 *
 * ================================ WHY `covered_but_unusable` IS ITS OWN STATUS
 *
 * `no_covering_feed` states a fact about the WORLD: the catalog lists nothing
 * whose published service area contains this planner's study area. It is the
 * sentence a planner may reasonably quote in a document.
 *
 * There are three ways a feed can cover the area and still not be offered —
 * withdrawn, key-required, no published address — and every one of them used to
 * fall through to `no_covering_feed`. A planner in a city with three transit
 * feeds, all of them behind an API key, was told their area has no transit.
 * That is precisely the misreport `catalog_unavailable` was split out to
 * prevent, reproduced one level down: an ABSENCE OF EVIDENCE presented as
 * EVIDENCE OF ABSENCE, this time about a place with buses running past the
 * window.
 *
 * So the honest branch is honest by CONSTRUCTION rather than by discipline:
 * `findGtfsFeedsForArea` returns `no_covering_feed` only when every
 * withheld-but-covering counter is zero, and the other case gets a status of its
 * own carrying the agencies it withheld. Neither branch has a `feeds` field, so
 * a surface cannot collapse the two by testing `feeds?.length === 0`; and only
 * one of them has `withheld`, so it cannot collapse them the other way either.
 */
export type GtfsCatalogSearchOutcome =
  | {
      status: "matched";
      feeds: [RankedGtfsCatalogFeed, ...RankedGtfsCatalogFeed[]];
      disclosure: GtfsCatalogDisclosure;
      catalogUrl: string;
    }
  | {
      /** NOTHING covers this area. The only branch that says so. */
      status: "no_covering_feed";
      disclosure: GtfsCatalogDisclosure;
      catalogUrl: string;
    }
  | {
      /** Feeds DO cover this area; every one of them was withheld. */
      status: "covered_but_unusable";
      /**
       * The agencies that cover the area, with the reason each was withheld.
       * NON-EMPTY by construction — this status is unreachable with nothing in
       * it, because the counters that select it are the lengths of these lists.
       */
      withheld: [GtfsWithheldFeed, ...GtfsWithheldFeed[]];
      disclosure: GtfsCatalogDisclosure;
      catalogUrl: string;
    }
  | {
      status: "catalog_unavailable";
      /** The closed vocabulary's word for it, for a status column. */
      code: Extract<GtfsFailureCode, "catalog_unavailable">;
      detail: string;
      /** The unredacted refusal, when one was withheld. Logs only — see fetch.ts. */
      diagnostic?: string;
      catalogUrl: string;
    };

export type GtfsCatalogLoadOutcome =
  | { ok: true; catalog: ParsedGtfsCatalog; catalogUrl: string }
  | {
      ok: false;
      code: Extract<GtfsFailureCode, "catalog_unavailable">;
      detail: string;
      /** The unredacted refusal, when one was withheld. Logs only — see fetch.ts. */
      diagnostic?: string;
      catalogUrl: string;
    };

/**
 * Options every catalog entry point shares.
 *
 * `catalog` is the seam that keeps this module free of a module-level cache:
 * a caller that has already read the catalog passes it, and no request pays for
 * a second download.
 */
export type GtfsCatalogOptions = GtfsFetchOptions & {
  /** An operator's own mirror of the catalog CSV. Defaults to the pinned URL. */
  catalogUrl?: string;
  /** An already-loaded catalog. When present, nothing is fetched. */
  catalog?: ParsedGtfsCatalog;
};

/**
 * HOW MANY TIMES A `redirect.id` CHAIN MAY BE FOLLOWED.
 *
 * Chains are real: of the 244 US rows carrying a redirect on 2026-08-05, 20 of
 * the targets themselves redirect. Each hop is an agency's feed being superseded
 * once, so a chain is a history and not an error — an operator that reorganised
 * three times has three hops, legitimately.
 *
 * Termination is guaranteed by the CYCLE CHECK, not by this number; the visited
 * set is the brace and this is the belt. It exists so that a catalog with a
 * 400-long chain (which would be a corruption, not a history) costs a bounded
 * amount of work rather than walking the whole file.
 *
 * THE NUMBER IS THE NUMBER OF FOLLOWS, and the walk below is written `hop <`
 * rather than `hop <=` for that reason. It read `<=` first, so eight was
 * enforced as nine while `chain_too_long` told whoever read it that eight had
 * been tried. A refusal that states a limit and applies a different one sends
 * the person debugging it to look for a ninth entry that the message says should
 * not exist.
 */
export const GTFS_CATALOG_MAX_REDIRECT_HOPS = 8;

/**
 * WHY A SAVED CATALOG ID DID NOT PRODUCE A FEED.
 *
 * Each of these is a different thing the planner can do, which is the only test
 * a refusal vocabulary has to pass:
 *
 *   unknown_id        - the catalog does not list this id at all. Re-search.
 *   dead_pointer      - the entry says it is superseded by an id the catalog
 *                       does not list. 41 of the 244 US redirect targets were
 *                       in this state on 2026-08-05, so this is the ORDINARY
 *                       case and not a pathological one. Re-search.
 *   redirect_cycle    - the chain returns to an entry it already visited. The
 *                       catalog is inconsistent about this feed; re-search.
 *   chain_too_long    - the chain kept going past
 *                       `GTFS_CATALOG_MAX_REDIRECT_HOPS` without repeating
 *                       itself. Distinct from a cycle on purpose: a cycle is a
 *                       contradiction in the catalog, while this is a catalog
 *                       whose shape this deployment declined to keep walking,
 *                       and reporting the second as the first would send whoever
 *                       reads the log looking for a loop that is not there.
 *   still_superseded  - the chain ended on an entry that is itself deprecated or
 *                       inactive with nowhere further to go. There is no live
 *                       successor; re-search.
 *   requires_api_key  - the successor exists and needs a key. Ask the agency —
 *                       the entry carries their contact address.
 *   no_download_url   - the successor exists and the catalog offers no address
 *                       for it. Nothing to fetch.
 */
export type GtfsCatalogRedirectRefusal =
  | "unknown_id"
  | "dead_pointer"
  | "redirect_cycle"
  | "chain_too_long"
  | "still_superseded"
  | "requires_api_key"
  | "no_download_url";

/**
 * WHERE A SAVED CATALOG ID LEADS TODAY.
 *
 * `unknown_id` deliberately carries NO `code`. Every other refusal here is a
 * fact about a FEED and belongs in a feed's status column; an id the catalog
 * never heard of is a fact about a REQUEST, and giving it a feed status would
 * write "this feed is deprecated" about a feed that does not exist. The union
 * shape is what says so — a caller reading `.code` has to narrow first.
 */
export type GtfsCatalogRedirectOutcome =
  | {
      status: "live";
      entry: GtfsCatalogEntry;
      /**
       * The ids walked through to get here, oldest first, excluding the live
       * one. Empty when the saved id was already current — which is the answer
       * to "is my feed still the right one", not a boring degenerate case.
       */
      supersededIds: string[];
    }
  | {
      status: "refused";
      reason: "unknown_id";
      detail: string;
      supersededIds: string[];
    }
  | {
      status: "refused";
      reason: Exclude<GtfsCatalogRedirectRefusal, "unknown_id">;
      code: Extract<
        GtfsFailureCode,
        "catalog_entry_deprecated" | "catalog_entry_requires_key"
      >;
      detail: string;
      supersededIds: string[];
    }
  | {
      status: "catalog_unavailable";
      code: Extract<GtfsFailureCode, "catalog_unavailable">;
      detail: string;
      /** The unredacted refusal, when one was withheld. Logs only — see fetch.ts. */
      diagnostic?: string;
    };

/* -------------------------------------------------------------------------- */
/* Reading the CSV                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The catalog's column names, written out once.
 *
 * As data rather than inline string literals because they are an EXTERNAL
 * SCHEMA — 28 columns published by somebody else, four of which differ only in
 * the word `minimum`/`maximum`. A typo in one of those inline reads as "this
 * feed publishes no service area" and silently moves a feed into the
 * `entriesWithNoPublishedServiceAreaAnywhere` bucket, where it looks like the
 * catalog's fault.
 */
const COLUMN = {
  id: "mdb_source_id",
  dataType: "data_type",
  countryCode: "location.country_code",
  subdivisionName: "location.subdivision_name",
  municipality: "location.municipality",
  provider: "provider",
  name: "name",
  feedContactEmail: "feed_contact_email",
  directDownload: "urls.direct_download",
  authenticationType: "urls.authentication_type",
  authenticationInfo: "urls.authentication_info",
  apiKeyParameterName: "urls.api_key_parameter_name",
  latest: "urls.latest",
  license: "urls.license",
  minLat: "location.bounding_box.minimum_latitude",
  maxLat: "location.bounding_box.maximum_latitude",
  minLon: "location.bounding_box.minimum_longitude",
  maxLon: "location.bounding_box.maximum_longitude",
  bboxExtractedOn: "location.bounding_box.extracted_on",
  status: "status",
  redirectId: "redirect.id",
  redirectComment: "redirect.comment",
} as const;

/** The `data_type` this lane reads. Everything else is somebody else's feed. */
const STATIC_GTFS_DATA_TYPE = "gtfs";

/**
 * The `data_type` the catalog uses for a realtime feed — vehicle positions,
 * trip updates, service alerts. 993 of 3,434 rows on 2026-08-05, and the only
 * non-`gtfs` value the live catalog contains.
 *
 * NAMED AS A CONSTANT RATHER THAN INFERRED AS "not gtfs" on purpose: see
 * `ParsedGtfsCatalog.realtimeEntriesIgnored`. Counting everything unfamiliar as
 * realtime is how a blank cell became a disclosed realtime feed.
 */
const REALTIME_GTFS_DATA_TYPE = "gtfs-rt";

/**
 * THE DENY-LIST. Read the status trap in the module header before touching it.
 *
 * Two values, both meaning "the publisher has withdrawn this feed". Everything
 * else — blank, `active`, `development`, and any word the catalog invents next
 * year — is usable, which is the direction this list has to fail in: a new
 * status nobody has seen must default to SHOWN, because the alternative is
 * hiding a live agency from the planners who serve it.
 */
const SUPERSEDED_STATUSES = new Set(["deprecated", "inactive"]);

/**
 * Authentication types that mean "open". Everything else needs a key — see
 * `GtfsCatalogAuthentication.requiresKey` for why this fails closed.
 */
const OPEN_AUTHENTICATION_TYPES = new Set(["", "0"]);

function text(row: Record<string, string>, column: string): string | null {
  const raw = row[column];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Four columns to a rectangle, or null.
 *
 * NULL IS RETURNED FOR THREE DIFFERENT SHAPES OF UNUSABLE, and they are folded
 * together deliberately because the caller does the same thing with all of
 * them — counts the entry as having no published service area and says so:
 *
 *   - a column that is blank or not a number at all;
 *   - a coordinate outside the range a coordinate can be in;
 *   - a box whose minimum exceeds its maximum. That is what a feed straddling
 *     the antimeridian would have to look like in a min/max schema, and it is
 *     not interpretable without a convention the catalog does not state. Note
 *     that such feeds usually appear in the catalog the OTHER way — as a
 *     near-worldwide box, because the extents were taken over stops at both
 *     +179 and -179 — and those are KEPT and simply rank last. `gtfs_skim.py`
 *     discards any box spanning more than 100 degrees; this file does not,
 *     because for a place near the antimeridian that rule deletes the only feed
 *     that serves it, and ranking already puts a continental box at the bottom
 *     without hiding it.
 */
function readBoundingBox(row: Record<string, string>): GeoBoundingBox | null {
  const minLat = finite(text(row, COLUMN.minLat));
  const maxLat = finite(text(row, COLUMN.maxLat));
  const minLon = finite(text(row, COLUMN.minLon));
  const maxLon = finite(text(row, COLUMN.maxLon));
  if (minLat === null || maxLat === null || minLon === null || maxLon === null) return null;

  if (Math.abs(minLat) > 90 || Math.abs(maxLat) > 90) return null;
  if (Math.abs(minLon) > 180 || Math.abs(maxLon) > 180) return null;
  if (minLat > maxLat || minLon > maxLon) return null;

  return { minLon, minLat, maxLon, maxLat };
}

function finite(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse the catalog CSV into static GTFS entries.
 *
 * SYNCHRONOUS, over a string already in memory. The file is 1.15 MB and 3,434
 * rows; a streaming parse would save the transient array of wide row objects
 * (a few megabytes for the microseconds before each is projected into a narrow
 * entry) at the cost of making every caller async and every test a generator
 * drain. `zip.ts` streams because ONE member of a GTFS archive is 126 MB
 * measured; this is four orders of magnitude smaller and the trade goes the
 * other way.
 *
 * The csv-parse options are `zip.ts`'s, for `zip.ts`'s reasons: a UTF-8 BOM is
 * common in published CSV and silently renames the first column;
 * `relax_column_count` keeps a row whose field count disagrees with the header
 * rather than throwing, because one malformed row must never cost a planner the
 * whole catalog.
 */
export function parseGtfsCatalog(csvText: string): ParsedGtfsCatalog {
  const rows = parse(csvText, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const byId = new Map<string, GtfsCatalogEntry>();
  let realtimeEntriesIgnored = 0;
  let unrecognisedDataTypeRows = 0;
  let unreadableRows = 0;
  let duplicateIds = 0;

  for (const row of rows) {
    const dataType = (text(row, COLUMN.dataType) ?? "").toLowerCase();
    if (dataType !== STATIC_GTFS_DATA_TYPE) {
      // TWO BUCKETS, NOT ONE. A row that SAYS it is realtime is a row this lane
      // deliberately does not read. A row with a blank or unfamiliar
      // `data_type` is a row this lane does not UNDERSTAND, which is a different
      // admission and the only one that should make anybody look at the catalog.
      if (dataType === REALTIME_GTFS_DATA_TYPE) realtimeEntriesIgnored += 1;
      else unrecognisedDataTypeRows += 1;
      continue;
    }

    const catalogId = text(row, COLUMN.id);
    if (!catalogId) {
      unreadableRows += 1;
      continue;
    }

    if (byId.has(catalogId)) duplicateIds += 1;
    byId.set(catalogId, projectEntry(catalogId, row));
  }

  return {
    entries: [...byId.values()],
    realtimeEntriesIgnored,
    unrecognisedDataTypeRows,
    unreadableRows,
    duplicateIds,
  };
}

function projectEntry(catalogId: string, row: Record<string, string>): GtfsCatalogEntry {
  const mirrorUrl = text(row, COLUMN.latest);
  const producerUrl = text(row, COLUMN.directDownload);
  const authenticationType = text(row, COLUMN.authenticationType);

  return {
    catalogId,
    provider: text(row, COLUMN.provider),
    name: text(row, COLUMN.name),
    status: text(row, COLUMN.status),
    statedLocation: {
      countryCode: text(row, COLUMN.countryCode),
      subdivisionName: text(row, COLUMN.subdivisionName),
      municipality: text(row, COLUMN.municipality),
    },
    boundingBox: readBoundingBox(row),
    boundingBoxExtractedOn: text(row, COLUMN.bboxExtractedOn),
    downloadUrl: mirrorUrl ?? producerUrl,
    downloadUrlSource: mirrorUrl ? "mirror" : producerUrl ? "producer" : null,
    mirrorUrl,
    producerUrl,
    licenseUrl: text(row, COLUMN.license),
    authentication: {
      type: authenticationType,
      requiresKey: !OPEN_AUTHENTICATION_TYPES.has((authenticationType ?? "").toLowerCase()),
      apiKeyParameterName: text(row, COLUMN.apiKeyParameterName),
      info: text(row, COLUMN.authenticationInfo),
    },
    feedContactEmail: text(row, COLUMN.feedContactEmail),
    redirectToCatalogId: text(row, COLUMN.redirectId),
    redirectComment: text(row, COLUMN.redirectComment),
  };
}

/** Whether the catalog has withdrawn this feed. The deny-list, applied. */
export function isSupersededCatalogEntry(entry: GtfsCatalogEntry): boolean {
  return SUPERSEDED_STATUSES.has((entry.status ?? "").toLowerCase());
}

/* -------------------------------------------------------------------------- */
/* Geometry and ranking                                                        */
/* -------------------------------------------------------------------------- */

/** Do two rectangles share any point? Touching edges count as sharing. */
export function boundingBoxesIntersect(a: GeoBoundingBox, b: GeoBoundingBox): boolean {
  if (a.minLon > b.maxLon || a.maxLon < b.minLon) return false;
  if (a.minLat > b.maxLat || a.maxLat < b.minLat) return false;
  return true;
}

/**
 * HOW BIG A FEED'S PUBLISHED SERVICE AREA IS, IN SQUARE DEGREES.
 *
 * A RANK, NOT A MEASUREMENT, and named `spread` rather than `area` so nobody
 * renders it as one. A degree of longitude is 111 km at the equator and 50 km
 * in Anchorage, so this number is not proportional to ground area and must
 * never be shown as square kilometres.
 *
 * It is nevertheless the right ORDERING, and the reason is worth stating: two
 * feeds only ever get compared here when both intersect the same search area,
 * so both boxes overlap in latitude and the longitude distortion is very nearly
 * a shared constant between them. It cannot reorder a county-sized box above a
 * continental one, which is the only judgement the ranking makes.
 */
export function boundingBoxSpread(box: GeoBoundingBox): number {
  return Math.max(0, box.maxLat - box.minLat) * Math.max(0, box.maxLon - box.minLon);
}

export function boundingBoxCentre(box: GeoBoundingBox): GeoPoint {
  return { lon: (box.minLon + box.maxLon) / 2, lat: (box.minLat + box.maxLat) / 2 };
}

/**
 * THE ORDERING RULE, NAMED AND EXPORTED SO IT CAN BE TESTED ON ITS OWN.
 *
 * MOST LOCAL FIRST — ascending service-area spread. A planner's own operator is
 * normally the most geographically specific feed covering their area, while a
 * national rail operator's box swallows the continent and belongs at the bottom
 * of a list rather than at the top of one. Measured: thirteen feeds' boxes
 * contain downtown Sacramento and one of them is Amtrak's.
 *
 * TIES BREAK ON DISTANCE FROM THE FOCUS, then on catalog id. The id is not
 * cosmetic — without a total order, two feeds with identical boxes swap places
 * between calls and a list a planner is reading reorders under them.
 *
 * This is a RANKING AND NEVER A SELECTION. `gtfs_skim.py` sorts by the same key
 * and then returns `candidates[0]`, which is correct for an unattended screening
 * run and is exactly how it can hand back a single-agency feed that was
 * superseded years ago. The two differences here are that superseded entries are
 * excluded before ranking, and that nothing is ever auto-picked.
 */
export function compareByLocality(a: RankedGtfsCatalogFeed, b: RankedGtfsCatalogFeed): number {
  if (a.serviceAreaSpread !== b.serviceAreaSpread) {
    return a.serviceAreaSpread - b.serviceAreaSpread;
  }
  if (a.focusOffsetDegrees !== b.focusOffsetDegrees) {
    return a.focusOffsetDegrees - b.focusOffsetDegrees;
  }
  return compareCatalogIds(a.entry.catalogId, b.entry.catalogId);
}

/** Numeric where both ids are numbers, textual otherwise. Total, and stable. */
function compareCatalogIds(a: string, b: string): number {
  const left = Number(a);
  const right = Number(b);
  if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
  return a < b ? -1 : a > b ? 1 : 0;
}

function offsetDegrees(from: GeoPoint, to: GeoPoint): number {
  return Math.hypot(from.lon - to.lon, from.lat - to.lat);
}

/* -------------------------------------------------------------------------- */
/* Searching                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Match a loaded catalog against an area. Pure, synchronous, no I/O.
 *
 * THE ORDER THE BUCKETS ARE APPLIED IN IS THE DESIGN, so it is written out:
 *
 *   1. superseded?          -> excluded before geography is even considered,
 *                              because a withdrawn feed's service area is a
 *                              claim about a feed nobody should fetch. Counted
 *                              globally, and counted AGAIN if its box covers
 *                              this area, because that second number is what
 *                              tells a surface to offer redirect resolution.
 *   2. no readable box?     -> cannot be matched to anywhere. Counted, and the
 *                              count is part of the answer.
 *   3. box misses the area? -> not disclosed. A feed in another country is not
 *                              something this planner needs a sentence about.
 *   4. needs an API key?    -> counted AND named, with the agency's contact
 *                              address, so the refusal is actionable.
 *   5. no download address? -> counted AND named.
 *   6. otherwise            -> a candidate, ranked.
 *
 * First bucket wins, so a key-required entry with no box is reported as
 * unmatchable rather than as key-required. Both are true; the first is the one
 * that stopped it.
 *
 * BUCKETS 1, 4 AND 5 KEEP THE ENTRIES AND NOT JUST A COUNT, because those three
 * are the ways a feed can COVER this area and still be withheld — and a count
 * alone cannot tell a planner which agency was withheld or what to do about it.
 * `findGtfsFeedsForArea` reads those three lists to decide between
 * `covered_but_unusable` and `no_covering_feed`, so they are load-bearing rather
 * than decorative. Bucket 2 keeps only a count on purpose: it is not about this
 * area, so there is no agency here for the planner to act on.
 */
export function selectGtfsFeedsForArea(
  catalog: ParsedGtfsCatalog,
  area: GtfsCatalogArea,
): { feeds: RankedGtfsCatalogFeed[]; disclosure: GtfsCatalogDisclosure } {
  const focus = area.focus ?? boundingBoxCentre(area.bbox);

  const disclosure: GtfsCatalogDisclosure = {
    staticEntriesConsidered: catalog.entries.length,
    realtimeEntriesIgnored: catalog.realtimeEntriesIgnored,
    unrecognisedDataTypeRows: catalog.unrecognisedDataTypeRows,
    unreadableRows: catalog.unreadableRows,
    duplicateIds: catalog.duplicateIds,
    supersededOrInactive: 0,
    supersededOrInactiveCoveringArea: 0,
    supersededOrInactiveCoveringAreaEntries: [],
    requiringApiKey: 0,
    requiringApiKeyEntries: [],
    entriesWithNoPublishedServiceAreaAnywhere: 0,
    withoutDownloadUrl: 0,
    withoutDownloadUrlEntries: [],
  };

  const feeds: RankedGtfsCatalogFeed[] = [];

  for (const entry of catalog.entries) {
    if (isSupersededCatalogEntry(entry)) {
      disclosure.supersededOrInactive += 1;
      if (entry.boundingBox && boundingBoxesIntersect(entry.boundingBox, area.bbox)) {
        disclosure.supersededOrInactiveCoveringArea += 1;
        disclosure.supersededOrInactiveCoveringAreaEntries.push(entry);
      }
      continue;
    }

    if (!entry.boundingBox) {
      disclosure.entriesWithNoPublishedServiceAreaAnywhere += 1;
      continue;
    }

    if (!boundingBoxesIntersect(entry.boundingBox, area.bbox)) continue;

    if (entry.authentication.requiresKey) {
      disclosure.requiringApiKey += 1;
      disclosure.requiringApiKeyEntries.push(entry);
      continue;
    }

    if (!entry.downloadUrl) {
      disclosure.withoutDownloadUrl += 1;
      disclosure.withoutDownloadUrlEntries.push(entry);
      continue;
    }

    feeds.push({
      entry,
      serviceAreaSpread: boundingBoxSpread(entry.boundingBox),
      focusOffsetDegrees: offsetDegrees(boundingBoxCentre(entry.boundingBox), focus),
    });
  }

  feeds.sort(compareByLocality);
  return { feeds, disclosure };
}

/**
 * Read the catalog: fetch it, parse it, or say plainly that it could not be
 * read.
 *
 * NO MODULE-LEVEL CACHE, and that is a decision rather than an omission. A
 * mutable global here would be per-instance in a serverless deployment (so it
 * would help almost nobody), unbounded in staleness (so a planner could be told
 * about a feed that was withdrawn weeks ago), and shared between every workspace
 * on the deployment. The download is 1.15 MB against a CDN and happens once per
 * planner-initiated search, which is affordable; and a caller that genuinely
 * wants to amortise it passes `catalog` and decides its own lifetime, where the
 * staleness is visible to whoever chose it.
 *
 * EVERY FAILURE BECOMES `catalog_unavailable`, keeping the detail. That
 * flattening is the point: to a planner, a DNS failure, a 503 and a truncated
 * CSV are one fact — "OpenPlan could not consult the catalog, so nothing has
 * been established about your area."
 */
export async function loadGtfsCatalog(
  options: GtfsCatalogOptions = {},
): Promise<GtfsCatalogLoadOutcome> {
  const catalogUrl = options.catalogUrl ?? MOBILITY_DATABASE_CATALOG_URL;

  // EVERY PATH OUT OF THIS FUNCTION GOES THROUGH `acceptCatalog`, including the
  // injected one. The zero-entry check used to sit at the bottom, after the
  // download — so the `catalog` seam, which this module DOCUMENTS as the
  // supported way to reuse a catalog across calls, walked straight past it. An
  // empty catalog handed in by a caller that failed to load one would then have
  // been answered as `no_covering_feed`: "your area has no transit", from a
  // value that says nothing about any area.
  if (options.catalog) return acceptCatalog(options.catalog, catalogUrl);

  const limits = resolveGtfsLimits(options.env);

  const fetched = await fetchCappedBytes(catalogUrl, {
    // A BOUND OF ITS OWN, NOT THE ARCHIVE'S. This used to borrow
    // `GTFS_MAX_ARCHIVE_BYTES` on the argument that a fetched artifact is a
    // fetched artifact. The difference that argument missed is what happens
    // NEXT: a feed archive is streamed into a parser that bounds itself, while
    // the bytes below are decoded into one string and handed to a SYNCHRONOUS
    // CSV parse. At the archive bound that is a multi-gigabyte allocation inside
    // one call — a fatal V8 out-of-memory, which the `catch` around the parse
    // cannot see and no `catalog_unavailable` refusal survives. See
    // `GTFS_MAX_CATALOG_BYTES` in `limits.ts` for the measurement.
    maxBytes: limits.maxCatalogBytes,
    timeoutMs: Math.min(options.timeoutMs ?? limits.parseBudgetMs, limits.parseBudgetMs),
    subjectLabel: "feed catalog",
    now: options.now,
    fetchImpl: options.fetchImpl,
    lookup: options.lookup,
    env: options.env,
  });

  if (!fetched.ok) {
    return {
      ok: false,
      code: "catalog_unavailable",
      detail: `The transit feed catalog could not be read. ${fetched.detail}`,
      // Carried, never merged into `detail`: the fetch lane withholds a resolved
      // address from the planner-visible sentence and this must not put it back.
      ...(fetched.diagnostic ? { diagnostic: fetched.diagnostic } : {}),
      catalogUrl,
    };
  }

  let catalog: ParsedGtfsCatalog;
  try {
    catalog = parseGtfsCatalog(new TextDecoder().decode(fetched.bytes));
  } catch (error) {
    // A catalog we cannot parse is a catalog we could not consult; it is not
    // evidence that this study area has no transit. `gtfs_skim.py` makes the
    // same call in the same words.
    return {
      ok: false,
      code: "catalog_unavailable",
      detail: `The transit feed catalog was downloaded but could not be read: ${
        error instanceof Error ? error.message : "unknown error"
      }.`,
      catalogUrl,
    };
  }

  return acceptCatalog(catalog, catalogUrl);
}

/**
 * THE ONE GATE A CATALOG VALUE PASSES BEFORE ANYONE SEARCHES IT.
 *
 * Zero static entries means whatever we are holding is not the catalog — an
 * error page, a redirect notice, an empty mirror, or a caller's own failed load.
 * Treating that as "the world has no transit feeds" would be the most confident
 * wrong answer this module could give, so it is refused here, at the VALUE,
 * rather than at the download. Guarding the download guards one of the two ways
 * a catalog arrives.
 *
 * The wording says "read" rather than "downloaded" for exactly that reason: on
 * the injected path nothing was downloaded, and a refusal that describes a
 * download that never happened sends the reader to check a network they never
 * touched.
 */
function acceptCatalog(catalog: ParsedGtfsCatalog, catalogUrl: string): GtfsCatalogLoadOutcome {
  if (catalog.entries.length === 0) {
    return {
      ok: false,
      code: "catalog_unavailable",
      detail:
        "The transit feed catalog was read and listed no transit feeds at all, " +
        "which means what was read was not the catalog.",
      catalogUrl,
    };
  }

  return { ok: true, catalog, catalogUrl };
}

/**
 * WHAT SERVES THIS AREA — the whole question, in one call.
 *
 * Returns everything that matched, most local first, together with what was
 * withheld and why. Never picks. Never reports an unreadable catalog as an
 * absence of transit, and never reports a WITHHELD feed as one either.
 */
export async function findGtfsFeedsForArea(
  area: GtfsCatalogArea,
  options: GtfsCatalogOptions = {},
): Promise<GtfsCatalogSearchOutcome> {
  const loaded = await loadGtfsCatalog(options);
  if (!loaded.ok) {
    return {
      status: "catalog_unavailable",
      code: loaded.code,
      detail: loaded.detail,
      ...(loaded.diagnostic ? { diagnostic: loaded.diagnostic } : {}),
      catalogUrl: loaded.catalogUrl,
    };
  }

  const { feeds, disclosure } = selectGtfsFeedsForArea(loaded.catalog, area);
  const [first, ...rest] = feeds;

  if (first) {
    return { status: "matched", feeds: [first, ...rest], disclosure, catalogUrl: loaded.catalogUrl };
  }

  // NOTHING RANKED. That is where two different facts meet, and the whole point
  // of the next four lines is that only one of them may be called
  // `no_covering_feed`. `withheldCoveringFeeds` is built from the same three
  // area-scoped buckets the disclosure counted, so the status is decided by
  // whether that list is empty rather than by anyone remembering to check three
  // counters — which is what makes the misreport unrepresentable rather than
  // merely documented.
  const [firstWithheld, ...restWithheld] = withheldCoveringFeeds(disclosure);
  if (firstWithheld) {
    return {
      status: "covered_but_unusable",
      withheld: [firstWithheld, ...restWithheld],
      disclosure,
      catalogUrl: loaded.catalogUrl,
    };
  }

  return { status: "no_covering_feed", disclosure, catalogUrl: loaded.catalogUrl };
}

/**
 * Every feed that COVERS the area and could not be offered, with its reason.
 *
 * Reads the entry lists rather than the counters so the two cannot drift: a
 * counter incremented without its entry pushed would silently shorten this list,
 * and `gtfs-catalog.test.ts` asserts the list length against the counters for
 * exactly that reason.
 *
 * The order is the order the three exclusions are applied in
 * (`selectGtfsFeedsForArea`), which is also roughly the order of usefulness to a
 * planner: a superseded entry may have a successor to follow, a key-required one
 * has somebody to ask, and one with no published address has neither.
 */
function withheldCoveringFeeds(disclosure: GtfsCatalogDisclosure): GtfsWithheldFeed[] {
  return [
    ...disclosure.supersededOrInactiveCoveringAreaEntries.map(
      (entry): GtfsWithheldFeed => ({ entry, reason: "superseded" }),
    ),
    ...disclosure.requiringApiKeyEntries.map(
      (entry): GtfsWithheldFeed => ({ entry, reason: "requires_api_key" }),
    ),
    ...disclosure.withoutDownloadUrlEntries.map(
      (entry): GtfsWithheldFeed => ({ entry, reason: "no_download_url" }),
    ),
  ];
}

/* -------------------------------------------------------------------------- */
/* Redirects                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * FOLLOW A SAVED CATALOG ID TO WHATEVER IS LIVE TODAY.
 *
 * THE PROBLEM THIS SOLVES. A workspace stores the catalog id of the feed it
 * ingests. Months later the agency republishes under a new id and the catalog
 * marks the old row `deprecated` with `redirect.id` naming the successor. Every
 * refresh from then on would fail — or, worse, keep fetching a frozen mirror of
 * a schedule that no longer runs — unless something follows that pointer.
 *
 * WHAT THE MEASUREMENT SAYS ABOUT THE SHAPE OF THIS, all from the live catalog
 * on 2026-08-05: 244 US rows carry a redirect, and NOT ONE of them is a row that
 * is still usable. So a redirect is never a ranking concern and never competes
 * with a live feed — it is purely the recovery path for a saved id. 41 of the
 * 244 targets are not in the catalog at all (a dead pointer is ordinary, not
 * pathological), and 20 targets themselves redirect, so chains are real.
 *
 * The walk is bounded twice over: a visited set that makes a cycle impossible to
 * loop on, and `GTFS_CATALOG_MAX_REDIRECT_HOPS` in case a catalog ever ships a
 * chain longer than any history could justify.
 */
export async function resolveGtfsCatalogRedirect(
  catalogId: string,
  options: GtfsCatalogOptions = {},
): Promise<GtfsCatalogRedirectOutcome> {
  const loaded = await loadGtfsCatalog(options);
  if (!loaded.ok) {
    return {
      status: "catalog_unavailable",
      code: loaded.code,
      detail: loaded.detail,
      ...(loaded.diagnostic ? { diagnostic: loaded.diagnostic } : {}),
    };
  }

  const byId = new Map(loaded.catalog.entries.map((entry) => [entry.catalogId, entry]));

  const supersededIds: string[] = [];
  const visited = new Set<string>();
  let current = byId.get(catalogId);

  if (!current) {
    return {
      status: "refused",
      reason: "unknown_id",
      detail: `The transit feed catalog does not list an entry ${catalogId}. Search for the agency again to pick a current feed.`,
      supersededIds,
    };
  }

  for (let hop = 0; hop < GTFS_CATALOG_MAX_REDIRECT_HOPS; hop += 1) {
    visited.add(current.catalogId);

    const nextId = current.redirectToCatalogId;
    if (!nextId) break;

    if (visited.has(nextId)) {
      return {
        status: "refused",
        reason: "redirect_cycle",
        code: "catalog_entry_deprecated",
        detail:
          `The catalog says entry ${current.catalogId} is replaced by ${nextId}, which leads back to one already ` +
          `followed (${[...visited].join(" -> ")}). The catalog is inconsistent about this feed; search for the ` +
          `agency again to pick a current one.`,
        supersededIds,
      };
    }

    const next = byId.get(nextId);
    if (!next) {
      return {
        status: "refused",
        reason: "dead_pointer",
        code: "catalog_entry_deprecated",
        detail:
          `The catalog says entry ${current.catalogId} is replaced by ${nextId}, but it does not list ${nextId}. ` +
          `Search for the agency again to pick a current feed.`,
        supersededIds,
      };
    }

    supersededIds.push(current.catalogId);
    current = next;
  }

  if (current.redirectToCatalogId) {
    return {
      status: "refused",
      reason: "chain_too_long",
      code: "catalog_entry_deprecated",
      detail:
        `Following the catalog's replacements from entry ${catalogId} passed ` +
        `${GTFS_CATALOG_MAX_REDIRECT_HOPS} hops without arriving at a current feed. Search for the agency again.`,
      supersededIds,
    };
  }

  if (isSupersededCatalogEntry(current)) {
    return {
      status: "refused",
      reason: "still_superseded",
      code: "catalog_entry_deprecated",
      detail:
        `The catalog marks entry ${current.catalogId} as ${current.status} and names no replacement for it. ` +
        `Search for the agency again to see whether they publish somewhere else.`,
      supersededIds,
    };
  }

  if (current.authentication.requiresKey) {
    return {
      status: "refused",
      reason: "requires_api_key",
      code: "catalog_entry_requires_key",
      detail:
        `Entry ${current.catalogId}${current.provider ? ` (${current.provider})` : ""} needs an API key this ` +
        `deployment does not hold.` +
        (current.feedContactEmail ? ` The agency's contact address is ${current.feedContactEmail}.` : ""),
      supersededIds,
    };
  }

  if (!current.downloadUrl) {
    return {
      status: "refused",
      reason: "no_download_url",
      code: "catalog_entry_deprecated",
      detail: `The catalog lists entry ${current.catalogId} but publishes no download address for it.`,
      supersededIds,
    };
  }

  return { status: "live", entry: current, supersededIds };
}
