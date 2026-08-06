/**
 * THE TRANSIT-FEED HANDOFF: how a planner's own ingested GTFS feed reaches the
 * travel model, and why the run is handed an ID rather than an address.
 *
 * ══════════════════════════════════════════════════ WHAT THIS REPLACES
 *
 * Until now the AequilibraE worker chose its own transit feed. `plan_feed`
 * consults an operator-named `GTFS_URL`/`GTFS_PATH`, then the Mobility Database
 * catalog, then the feed bundled with the worker — and a planner who had spent
 * an afternoon ingesting their agency's feed into OpenPlan had no way to say
 * "use THAT one". The two halves of the product knew about different feeds.
 *
 * ══════════════════════ WHY A FEED-VERSION ID AND NOT A URL. THREE FACTS.
 *
 *   1. `gtfs_skim.load_feed` caches a downloaded feed at
 *      `gtfs_feed_{md5(url)[:16]}.zip` with NO TTL and no revalidation, while
 *      the same module gives its CATALOG CSV a TTL. So handing over a URL is
 *      not "the worker might get newer bytes" — it is "the worker gets whatever
 *      it first got, in either direction, forever", while OpenPlan's service-
 *      levels page moves on.
 *   2. The divergence would be CAMOUFLAGED, not merely silent. The worker
 *      builds its KPI provenance sentence from `transit_los["source_url"]` —
 *      the same URL the Data Hub card names. Two surfaces citing one address is
 *      exactly the evidence a reviewer uses to conclude they agree. Everything
 *      else in this lane renders an unknown AS an unknown; a refetch would
 *      manufacture corroboration instead.
 *   3. Byte storage was a small change, not a new subsystem: `ingest.ts`
 *      already computed `checksumSha256` for all three doors and only withheld
 *      the OBJECT from the two that were not uploads. So the worker can read
 *      the exact bytes OpenPlan parsed and PROVE it, against
 *      `gtfs_feed_versions.checksum_sha256`.
 *
 * ══════════════════ THE STAMP CARRIES NO PATH. THIS IS A SECURITY PROPERTY.
 *
 * `model_runs.input_snapshot_json` is writable by workspace members, and the
 * worker reads Storage with the service-role key. A storage path in the stamp
 * would therefore be a member-authored string that a service-role reader
 * dereferences — a cross-tenant read oracle unless every consumer remembers to
 * re-derive the tenancy. So the hazard is REMOVED rather than checked: the
 * stamp names a `feedVersionId` and nothing else the worker acts on, and the
 * worker resolves `storage_path` itself with
 * `id=eq.{versionId}&workspace_id=eq.{run.workspace_id}` — a server-side
 * tenancy filter over a uuid. A forged snapshot can name only a uuid.
 *
 * THIS MODULE NOW READS `storage_path` AND STILL NEVER CARRIES IT. That is a
 * deliberate narrowing of the rule, made 2026-08-06 because the earlier "never
 * name the column here" version bought a weaker property than it looked like:
 * the handoff tested `checksum_sha256` as its PROXY for "the archive was kept",
 * and `ingest.ts` computes a checksum for all three doors before any storage
 * attempt while `persist.ts` writes it on every ready version — so the proxy
 * was never false, the branch never fired, and every catalog and URL ingest
 * whose bytes were never stored was stamped `selected` and shown to a planner
 * as handed over. The fact is `storage_path`; the security property is that the
 * VALUE never reaches the stamp. So the value is reduced to a boolean the line
 * it is read on, and `transitFeedStampViolation` refuses any stamp whose fields
 * contain a path-shaped value.
 *
 * The same reasoning governs the DISPLAY fields. `agencyName`, `sourceUrl`,
 * `checksumSha256` and both service dates are read off the database here and
 * are echoed by the worker from ITS OWN read, never from the snapshot — which
 * closes a forgery path into the evidence panel as a side effect.
 *
 * ═══════════════════════ REBUILT ON EVERY LAUNCH, LIKE THE ZONE ATTRIBUTES
 *
 * The stamp is a snapshot of one read. Both paths that queue a worker run —
 * `POST /runs` and `POST /runs/[modelRunId]/launch` — go through this module and
 * re-stamp, for the reason `zone-attribute-payload.ts` records: an unrebuilt
 * stamp makes "fix the feed, then relaunch" a false instruction. A run stamped
 * `unavailable` because the feed's bytes were never stored must be able to
 * become `selected` after a re-ingest, without the planner picking anything
 * again. That is why the stamp remembers the FEED and re-resolves the VERSION.
 *
 * ═════════════════════════════════════ WHAT THIS MODULE REFUSES TO DECIDE
 *
 * It never decides that a feed is unusable because of where its stops are.
 * `coversStudyArea` is advisory and the worker's `feed_covers` is the
 * authority — see `gtfs/coverage.ts`. It never decides that a feed is unusable
 * because of HOW ITS SERVICE IS PUBLISHED either: `frequencyTripCount` is
 * disclosure, and `gtfs_skim` is the authority on what it can skim. And it
 * never promotes a claim tier: the
 * stamp carries no `claim_status`, no `median_headway_basis`, no
 * `peak_headway_is_lower_bound`, and there is no parameter through which a
 * caller could supply one. A transit skim built from an ingested feed does not
 * make a run's evidence stronger, and this handoff must not be the place that
 * says otherwise.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assessFeedVersionCoverage,
  type CoverageQueryClient,
  type StudyAreaCoverage,
} from "@/lib/gtfs/coverage";
import { filterToCurrentReadyVersion } from "@/lib/gtfs/persist";
import { zoneAttributeBboxFromGeojson } from "@/lib/models/zone-attribute-payload";

/**
 * Wire-format version, shared with the worker.
 *
 * The worker refuses a stamp whose version it does not recognise rather than
 * guessing at a newer shape — misreading a selection is how a run silently
 * skims a feed the planner did not choose while the provenance sentence names
 * the one they did.
 */
export const TRANSIT_FEED_STAMP_VERSION = "transit-feed-v1";

/**
 * The five outcomes. EXACTLY ONE of them carries a `feedVersionId`; every other
 * carries a reason, and the invariants below are asserted rather than described.
 *
 *   `selected`            a ready version whose bytes are stored — handed over.
 *   `not_selected`        the planner left automatic discovery on. Identical to
 *                         an absent stamp in worker behaviour, and deliberately
 *                         so: it is a record that the question was ASKED, which
 *                         an absence cannot express.
 *   `unavailable`         a feed was named and is not usable. The reason says
 *                         which of the several ways.
 *   `unsupported_by_skim` NO LONGER PRODUCED — retained because stored runs
 *                         carry it and the worker still maps it. See below.
 *   `handoff_failed`      the app could not resolve the selection at all — a
 *                         read error, a missing service-role key, an exception.
 *
 * ═══════════ WHY THE APP NO LONGER REFUSES A FREQUENCY-BASED FEED (2026-08-06)
 *
 * This module used to answer `unsupported_by_skim`, terminally, whenever
 * `frequency_trip_count > 0` — ANY frequency-based trip at all. In the same
 * changeset the worker's `gtfs_skim` stopped doing the equivalent thing, and
 * for a measured reason: of 16 sampled US feeds 7 ship `frequencies.txt`, SIX
 * of them header-only, and the seventh carries 4 rows over 2 of its 18,150
 * trips. Under the old rule that seventh agency lost its ENTIRE feed over four
 * rows, and a planner who NAMED their own feed got zero transit where not
 * naming it would have modeled some.
 *
 * The worker now drops frequency-based TRIPS, counts them in
 * `TransitLos.frequency_trips_excluded`, and raises `GtfsFrequencyOnly` only
 * when dropping them leaves no scheduled service on the modeled day. It is
 * therefore the authority on what it can skim, and it already reports the
 * honest outcome. The app's job here is to DISCLOSE — `frequencyTripCount` and
 * `scheduledTripCount` ride the stamp so a surface can say what will be left
 * out — and never to refuse. A pre-launch refusal on a fact the worker can
 * evaluate better is a refusal that costs a run and buys nothing.
 */
export type TransitFeedStampStatus =
  | "selected"
  | "not_selected"
  | "unavailable"
  | "unsupported_by_skim"
  | "handoff_failed";

export type TransitFeedStamp = {
  version: typeof TRANSIT_FEED_STAMP_VERSION;
  status: TransitFeedStampStatus;
  /** The ONLY field the worker acts on, and only when status is "selected". */
  feedVersionId: string | null;
  feedId: string | null;
  /** Display identity, read server-side off gtfs_feeds / gtfs_feed_versions. */
  agencyName: string | null;
  sourceKind: "catalog" | "url" | "upload" | null;
  sourceUrl: string | null;
  checksumSha256: string | null;
  /** ISO `YYYY-MM-DD`, from the version row's calendar-derived window. */
  serviceStartDate: string | null;
  serviceEndDate: string | null;
  /**
   * `service_end_date` < the launch date. Null when the feed stated no end.
   *
   * NOT A REFUSAL, and that is the whole point of recording it. Three of four
   * real Sacramento-area feeds measured on 2026-08-05 had already expired —
   * SacRT's sixteen months earlier — so an expired schedule is the NORMAL case
   * and is usually the last thing the agency published. Refusing it would
   * refuse most of the country. Saying nothing would let a model run on a
   * sixteen-month-old schedule with nothing on screen admitting it.
   */
  scheduleExpiredAtLaunch: boolean | null;
  /**
   * Trips this version's ingest read out of `frequencies.txt`, and trips it read
   * as real departures. DISCLOSURE, NEVER A REFUSAL — see the header. The worker
   * excludes the first group from the skim and counts what it excluded; these
   * two numbers are what let a surface say so before the run rather than after.
   * Null when the version row stated neither.
   */
  frequencyTripCount: number | null;
  scheduledTripCount: number | null;
  /** App-side pre-check; advisory. The worker's `feed_covers` is authoritative. */
  coversStudyArea: StudyAreaCoverage;
  /** One sentence a planner can act on. Null only when status is "selected". */
  reason: string | null;
};

/* -------------------------------------------------------------------------- */
/* Invariants — asserted, not described                                        */
/* -------------------------------------------------------------------------- */

/**
 * Why this stamp is malformed, or null when it is not.
 *
 * Exported so a guard can drive it over every stamp this module can produce
 * rather than over three hand-written fixtures. A described fixture proves the
 * assertion; only a built one proves the feature.
 */
export function transitFeedStampViolation(stamp: TransitFeedStamp): string | null {
  if (stamp.version !== TRANSIT_FEED_STAMP_VERSION) {
    return `stamp version is "${stamp.version}", not "${TRANSIT_FEED_STAMP_VERSION}"`;
  }

  // THE PATH MUST NOT BE HERE, on any status, in any field. This module reads
  // `storage_path` to decide whether the archive was kept (see the header) and
  // reduces it to a boolean on the line it is read — but "reduces it on that
  // line" is a convention, and a convention is what a future edit breaks. A
  // storage path in `input_snapshot_json` is a member-authored string the
  // service-role worker would dereference, so the ban is asserted over every
  // string the stamp carries rather than trusted at the one call site.
  // A bucket object key is `{workspaceId}/{feedId}/{versionId}.zip` — a
  // uuid-prefixed RELATIVE path. `sourceUrl` legitimately ends in `.zip`, so the
  // shape being refused is the uuid prefix without a URL scheme, not the suffix.
  for (const [field, value] of Object.entries(stamp)) {
    if (typeof value !== "string") continue;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/./i.test(value)) {
      return `stamp field "${field}" carries what looks like a storage path, which the worker must resolve for itself under its own tenancy filter`;
    }
  }

  if (stamp.status === "selected") {
    if (!stamp.feedVersionId) return "a selected stamp carries no feedVersionId";
    if (!stamp.checksumSha256) {
      return "a selected stamp carries no checksumSha256, so the worker could not prove it read the bytes OpenPlan parsed";
    }
    if (stamp.reason !== null) return "a selected stamp carries a refusal reason";
    return null;
  }

  if (stamp.feedVersionId !== null) {
    return `a ${stamp.status} stamp carries a feedVersionId, which the worker would act on`;
  }
  if (!stamp.reason || stamp.reason.trim().length === 0) {
    return `a ${stamp.status} stamp carries no reason, so nothing on screen could say why`;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Stamps that need no database                                                */
/* -------------------------------------------------------------------------- */

const EMPTY_IDENTITY = {
  feedVersionId: null,
  feedId: null,
  agencyName: null,
  sourceKind: null,
  sourceUrl: null,
  checksumSha256: null,
  serviceStartDate: null,
  serviceEndDate: null,
  scheduleExpiredAtLaunch: null,
  frequencyTripCount: null,
  scheduledTripCount: null,
  coversStudyArea: "not_determined",
} as const;

/**
 * The planner named no feed, so the worker keeps its existing precedence —
 * `GTFS_URL` / `GTFS_PATH`, then catalog discovery, then the bundled feed.
 *
 * A reason is still carried, because this stamp is read by a person looking at
 * an evidence packet six months later who needs to know that nothing was
 * chosen, rather than that the field is missing.
 */
export function transitFeedNotSelectedStamp(): TransitFeedStamp {
  return {
    version: TRANSIT_FEED_STAMP_VERSION,
    ...EMPTY_IDENTITY,
    status: "not_selected",
    reason:
      "No transit feed from this workspace was named for this run, so the modeling worker chose one " +
      "the way it always has — a feed the deployment's operator configured, or one discovered in the " +
      "published-feed catalog for this study area, or the feed bundled with the worker.",
  };
}

/** The app could not resolve the selection at all. */
export function transitFeedHandoffFailedStamp(reason: string, feedId: string | null): TransitFeedStamp {
  return {
    version: TRANSIT_FEED_STAMP_VERSION,
    ...EMPTY_IDENTITY,
    status: "handoff_failed",
    feedId,
    reason,
  };
}

/* -------------------------------------------------------------------------- */
/* Expiry                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Had this feed's schedule already ended when the run was launched?
 *
 * Pure, and takes both dates as ISO `YYYY-MM-DD` strings compared as strings on
 * purpose. `new Date("2025-04-05")` parses as midnight UTC and the comparison
 * would shift by a day for most of the United States — a feed that expired
 * yesterday would read as current for anyone west of Greenwich. A calendar date
 * printed in a feed is not a moment in the reader's timezone, and ISO dates sort
 * lexicographically.
 */
export function scheduleExpiredAt(
  serviceEndDate: string | null,
  launchDateIso: string
): boolean | null {
  if (!serviceEndDate) return null;
  const end = serviceEndDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  return end < launchDateIso.slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* Projections                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What the handoff reads, written once and exported so a test can assert on the
 * projection STRING. The clients here are deliberately untyped, so a mocked
 * client returns the fixture whatever columns were asked for and deleting one
 * from a `.select()` leaves every assertion green while the real stamp renders
 * `undefined`.
 *
 * `storage_path` IS READ AND IS NEVER CARRIED — see the header. It is the only
 * fact that answers "were the bytes kept", the question the whole byte-pinning
 * design turns on, and the checksum that used to stand in for it is written on
 * every ready version whether or not an object was ever stored.
 */
export const TRANSIT_FEED_HANDOFF_FEED_COLUMNS = ["id", "workspace_id", "agency_name"].join(", ");

export const TRANSIT_FEED_HANDOFF_VERSION_COLUMNS = [
  "id",
  "feed_id",
  "workspace_id",
  "source_kind",
  "source_url",
  "storage_path",
  "checksum_sha256",
  "service_start_date",
  "service_end_date",
  "frequency_trip_count",
  "scheduled_trip_count",
  "route_count",
  "stop_count",
].join(", ");

type FeedRow = { id: string; workspace_id: string | null; agency_name: string | null };

type VersionRow = {
  id: string;
  feed_id: string;
  workspace_id: string | null;
  source_kind: string | null;
  source_url: string | null;
  storage_path: string | null;
  checksum_sha256: string | null;
  service_start_date: string | null;
  service_end_date: string | null;
  frequency_trip_count: number | null;
  scheduled_trip_count: number | null;
};

function tripCount(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asSourceKind(value: string | null): "catalog" | "url" | "upload" | null {
  return value === "catalog" || value === "url" || value === "upload" ? value : null;
}

function isoDate(value: string | null): string | null {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : null;
}

/* -------------------------------------------------------------------------- */
/* The resolution                                                              */
/* -------------------------------------------------------------------------- */

export type PrepareTransitFeedHandoffArgs = {
  /**
   * A client that can read `gtfs_feeds` and `gtfs_feed_versions` for this
   * workspace. The caller's own request-scoped client is enough — every read
   * below names the workspace explicitly, so RLS is a second net rather than
   * the only one.
   */
  client: SupabaseClient;
  workspaceId: string;
  /** The feed the planner named, or null when they named none. */
  feedId: string | null;
  /** The run's study-area geometry, for the advisory coverage pre-check. */
  corridorGeojson: unknown;
  /** ISO `YYYY-MM-DD`. Passed in so this function keeps no clock of its own. */
  launchDateIso: string;
};

/**
 * Resolve the feed a run was launched against into the stamp the worker reads.
 *
 * NEVER THROWS AND NEVER FAILS A LAUNCH. A run whose transit selection could
 * not be resolved is still a run worth executing — it simply models no transit
 * from this workspace's feed, and says so. Refusing the launch would make a
 * transient database hiccup cost a planner their whole run.
 *
 * `workspace_id` IS FILTERED EXPLICITLY, and it excludes public preloaded feeds
 * (`gtfs_feeds.workspace_id IS NULL`) rather than including them. That is not an
 * oversight: the worker resolves the version under
 * `workspace_id=eq.{run.workspace_id}`, so a public feed handed over here would
 * resolve to nothing on the far side and the run would refuse for a reason that
 * pointed at the wrong thing. One tenancy rule, stated the same way on both
 * sides of the seam.
 */
export async function prepareTransitFeedHandoff(
  args: PrepareTransitFeedHandoffArgs
): Promise<TransitFeedStamp> {
  const { client, workspaceId, feedId, corridorGeojson, launchDateIso } = args;

  if (!feedId) return transitFeedNotSelectedStamp();

  try {
    const feedResult = await client
      .from("gtfs_feeds")
      .select(TRANSIT_FEED_HANDOFF_FEED_COLUMNS)
      .eq("id", feedId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (feedResult.error) {
      return transitFeedHandoffFailedStamp(
        `The transit feed named for this run could not be read (${feedResult.error.message}), so no feed ` +
          "from this workspace was handed to the modeling worker.",
        feedId
      );
    }

    const feed = feedResult.data as unknown as FeedRow | null;
    if (!feed) {
      return {
        version: TRANSIT_FEED_STAMP_VERSION,
        ...EMPTY_IDENTITY,
        status: "unavailable",
        feedId,
        reason:
          "The transit feed named for this run is not one of this workspace's feeds. It may have been " +
          "deleted, or it may be a feed shared across the deployment rather than one this workspace " +
          "ingested — the modeling worker can only read a workspace's own feeds.",
      };
    }

    // THE ONE EXPRESSION OF "the feed this workspace analyses with". Filtering
    // on `is_current` alone would hand the worker a version that was promoted
    // and later failed; filtering on `status` alone would match every
    // successful ingest this feed has ever had.
    const versionResult = await filterToCurrentReadyVersion(
      client
        .from("gtfs_feed_versions")
        .select(TRANSIT_FEED_HANDOFF_VERSION_COLUMNS)
        .eq("feed_id", feed.id)
        .eq("workspace_id", workspaceId)
    ).maybeSingle();

    if (versionResult.error) {
      return transitFeedHandoffFailedStamp(
        `The ingest currently in use for this transit feed could not be read (${versionResult.error.message}), ` +
          "so no feed from this workspace was handed to the modeling worker.",
        feed.id
      );
    }

    const version = versionResult.data as unknown as VersionRow | null;
    const identity = {
      feedId: feed.id,
      agencyName: feed.agency_name ?? null,
    };

    if (!version) {
      return {
        version: TRANSIT_FEED_STAMP_VERSION,
        ...EMPTY_IDENTITY,
        ...identity,
        status: "unavailable",
        reason:
          "This transit feed has no completed ingest in use, so there is nothing for the modeling worker " +
          "to read. Bring the feed in again from the Data Hub, then relaunch this run.",
      };
    }

    const detail = {
      ...identity,
      sourceKind: asSourceKind(version.source_kind),
      sourceUrl: version.source_url ?? null,
      serviceStartDate: isoDate(version.service_start_date),
      serviceEndDate: isoDate(version.service_end_date),
      scheduleExpiredAtLaunch: scheduleExpiredAt(isoDate(version.service_end_date), launchDateIso),
      // Disclosed on every outcome, including the refusals — a planner deciding
      // whether to re-ingest is owed the same facts as one about to launch.
      frequencyTripCount: tripCount(version.frequency_trip_count),
      scheduledTripCount: tripCount(version.scheduled_trip_count),
    };

    // WERE THE BYTES KEPT. This is the one question the byte-pinning design
    // turns on, and `storage_path` is the fact that answers it. Reduced to a
    // boolean HERE, on the line it is read, so the path itself never travels
    // into a stamp that a workspace member could later hand back to a
    // service-role reader.
    const archiveWasKept =
      typeof version.storage_path === "string" && version.storage_path.trim().length > 0;

    if (!archiveWasKept) {
      return {
        version: TRANSIT_FEED_STAMP_VERSION,
        ...EMPTY_IDENTITY,
        ...detail,
        status: "unavailable",
        reason:
          "The archive behind this feed's current ingest was not kept, so the modeling worker cannot be " +
          "given the exact bytes OpenPlan read. Bring the feed in again from the Data Hub — a fresh " +
          "ingest stores them — then relaunch this run.",
      };
    }

    if (!version.checksum_sha256) {
      return {
        version: TRANSIT_FEED_STAMP_VERSION,
        ...EMPTY_IDENTITY,
        ...detail,
        status: "unavailable",
        reason:
          "The archive behind this feed's current ingest was kept, but no checksum was recorded for it, " +
          "so the modeling worker could not prove the bytes it read are the ones OpenPlan parsed. Bring " +
          "the feed in again from the Data Hub, then relaunch this run.",
      };
    }

    // Advisory only, and computed AFTER every refusal above so a feed that was
    // never going to be handed over does not pay for a count query.
    const bbox = zoneAttributeBboxFromGeojson(corridorGeojson);
    const coverage = bbox
      ? await assessFeedVersionCoverage({
          client: client as unknown as CoverageQueryClient,
          feedVersionId: version.id,
          bbox,
        })
      : {
          coverage: "not_determined" as StudyAreaCoverage,
          stopServiceRowsInStudyArea: null,
          reason: null,
        };

    return {
      version: TRANSIT_FEED_STAMP_VERSION,
      ...detail,
      status: "selected",
      feedVersionId: version.id,
      checksumSha256: version.checksum_sha256,
      coversStudyArea: coverage.coverage,
      reason: null,
    };
  } catch (error) {
    return transitFeedHandoffFailedStamp(
      `Resolving the transit feed for this run failed unexpectedly (${
        error instanceof Error ? error.message : String(error)
      }).`,
      feedId
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Reading a stamp back off a stored run                                       */
/* -------------------------------------------------------------------------- */

/**
 * The feed a stored run was launched against, or null when it named none.
 *
 * This is what makes the relaunch recovery real: the RELAUNCH re-resolves the
 * same FEED to whatever version is current NOW, so a run stamped "the archive
 * was not kept" becomes `selected` after a re-ingest with nothing for the
 * planner to pick again. Reading `feedVersionId` instead would pin the run to a
 * version that is no longer the one in use.
 *
 * Defensive about shape on purpose — `input_snapshot_json` is JSONB the
 * database does not constrain, and a run written by an older build carries no
 * `transitFeed` key at all.
 */
export function transitFeedIdFromSnapshot(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const stamp = (snapshot as Record<string, unknown>).transitFeed;
  if (!stamp || typeof stamp !== "object" || Array.isArray(stamp)) return null;
  const feedId = (stamp as Record<string, unknown>).feedId;
  return typeof feedId === "string" && feedId.length > 0 ? feedId : null;
}

/**
 * A stored stamp, shaped enough for a surface to render, or null.
 *
 * Returns the raw record rather than a parsed `TransitFeedStamp` because a run
 * launched by a future build may carry fields this build does not know, and
 * dropping them on the way to a display would make the evidence panel quietly
 * narrower than the record it is displaying.
 */
export function transitFeedStampFromSnapshot(snapshot: unknown): Record<string, unknown> | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const stamp = (snapshot as Record<string, unknown>).transitFeed;
  if (!stamp || typeof stamp !== "object" || Array.isArray(stamp)) return null;
  return stamp as Record<string, unknown>;
}
