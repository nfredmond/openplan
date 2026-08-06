/**
 * THE INGEST SEQUENCE — ONE COPY, THREE DOORS.
 *
 * A transit feed can enter OpenPlan three ways: a planner picks an agency out
 * of the feed catalog, a planner pastes their agency's own download URL, or a
 * planner uploads a `.zip` an agency emailed them. After the bytes are in hand
 * those three are the SAME OPERATION — begin, fetch, store, parse, write,
 * promote, rename — and every one of the seven steps has a failure path that
 * must leave the database honest.
 *
 * WHY THIS IS A MODULE AND NOT THREE ROUTE BODIES. CLAUDE.md records the defect
 * plainly, and this repository has shipped it twice: *a shared capability that
 * lives inside one of its callers will be reimplemented wrongly by the other*.
 * The two instances that cost the most were a submission geofence enforced on
 * one of two doors, and artifact custody no page could display — both invisible
 * from inside either lane. The specific divergence waiting here is the cleanup:
 * an ingest that fails after storing an object must remove that object, and an
 * ingest that fails after writing derived rows must delete them. A door that
 * forgets one leaves a `parsing` row nothing resolves and a private bucket that
 * grows forever, and nothing about the other two doors would look wrong.
 *
 * ============================================== THE ORDER, AND WHY IT IS THIS
 *
 *   1. `beginGtfsFeedVersion` — the version row, `pending`, BEFORE ANY NETWORK
 *      WORK. `persist.ts` argues this at length and it is the whole design: a
 *      fetch that hangs or a process that is killed then leaves a row that says
 *      `pending`, which the scheduled reaper can find and a planner can be told
 *      about. Fetching first would leave nothing, and "no row" is
 *      indistinguishable from "never started".
 *   2. `fetching` — so a stuck ingest says which step it is stuck on.
 *   3. the bytes — downloaded through the SSRF-checked, size-capped,
 *      time-bounded fetch lane, or handed in by the upload door.
 *   4. the object — upload door only, and the OBJECT GOES FIRST, then the row
 *      that points at it. An object with no row is garbage a sweep can find; a
 *      row pointing at an object that was never written is a version that
 *      cannot explain itself.
 *   5. `parsing`.
 *   6. `parseGtfsFeed` — in memory, and it keeps no timetable.
 *   7. `writeParsedFeedVersion` — derived rows, then `ready` and the counts in
 *      ONE statement, which is what makes the database's
 *      `ready`-is-not-empty CHECK meaningful.
 *   8. `promoteGtfsFeedVersion` — `is_current` last, through the SQL function,
 *      and it may decline (see the collapse rule).
 *   9. `syncFeedDisplayName` — presentation, after the promotion it describes.
 *
 * =========================================== WHAT A FAILURE IS, AND IS NOT
 *
 * A FEED THAT WILL NOT PARSE IS NOT A SERVER ERROR. It is a 422 that names what
 * is wrong with the feed, because the person reading it is a planner who can
 * act on "this archive has no stop_times.txt" and can do nothing at all with
 * "500". `GTFS_FAILURE_HTTP_STATUS` maps the closed failure vocabulary onto
 * statuses exhaustively — a new code will not compile until someone decides
 * what it means over HTTP, which is the point.
 *
 * ============================== THE DIAGNOSTIC NEVER COMES BACK AS A VALUE
 *
 * `fetch.ts` splits a refusal into `detail` (safe to show a planner) and
 * `diagnostic` (the same sentence with the resolved address left in). A route
 * that renders the second turns the feed-URL field into a DNS-mapping oracle
 * for anyone holding a workspace login. So this module does not return the
 * diagnostic at all — it hands it to an `onDiagnostic` callback. That is a
 * structural difference, not a stylistic one: a value on the outcome object
 * could be spread into a response body by a route author who never read this
 * paragraph, and a callback cannot be.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { writeMatchedNoRows } from "@/lib/http/write-outcome";

import { selectGtfsCaveats } from "./caveats";
import { fetchGtfsFeedBytes, type GtfsFetchOptions } from "./fetch";
import { resolveGtfsLimits } from "./limits";
import { parseGtfsFeed } from "./parse";
import {
  beginGtfsFeedVersion,
  failGtfsFeedVersion,
  markGtfsFeedVersionStage,
  promoteGtfsFeedVersion,
  syncFeedDisplayName,
  writeParsedFeedVersion,
  GTFS_UPLOADS_BUCKET,
  type CollapseAssessment,
} from "./persist";
import { gtfsCaveatContextFromVersionRow } from "./route-projections";
import type { GtfsFailureCode, GtfsParseWarning } from "./types";

/* -------------------------------------------------------------------------- */
/* Failure codes over HTTP                                                      */
/* -------------------------------------------------------------------------- */

/**
 * THE CLOSED FAILURE VOCABULARY, MAPPED ONTO STATUSES EXHAUSTIVELY.
 *
 * `Record<GtfsFailureCode, …>` rather than a lookup with a default, so adding a
 * code to `types.ts` fails the build here until somebody decides what it means
 * to an HTTP caller. A default would silently classify the next failure as
 * whatever the default happens to be.
 *
 * The distinctions that are load-bearing:
 *
 *   422 — the feed is the problem. The planner can act: get a complete archive,
 *         ask their agency to republish, pick a different catalog entry. This is
 *         most of the vocabulary, and none of it is a 500.
 *   400 — the REQUEST is the problem. `host_not_allowed` is the planner's URL
 *         pointing somewhere this deployment will not fetch from; that is about
 *         what they typed, not about their agency.
 *   502 — the far end is the problem. The address was accepted, the deployment
 *         asked, and the agency's server did not answer or answered too slowly.
 *         Reporting that as 422 would tell a planner their feed is broken when
 *         their feed is fine and someone else's server is down.
 *   503 — THIS deployment could not consult the catalog. Transient, retryable,
 *         and — critically — not evidence about the planner's area at all.
 *   500 — `partial_write` only. The parse succeeded and the database did not,
 *         which is the one case in this list that is genuinely OpenPlan's fault.
 */
export const GTFS_FAILURE_HTTP_STATUS: Record<GtfsFailureCode, number> = {
  too_large: 422,
  not_a_zip: 422,
  ambiguous_archive: 422,
  missing_required_file: 422,
  no_usable_stops: 422,
  no_usable_service: 422,
  fetch_failed: 502,
  fetch_timed_out: 504,
  host_not_allowed: 400,
  catalog_unavailable: 503,
  catalog_entry_requires_key: 422,
  catalog_entry_deprecated: 422,
  partial_write: 500,
  abandoned: 422,
};

/* -------------------------------------------------------------------------- */
/* Normalising a source address                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The form of a feed URL that `gtfs_feeds.normalized_source_url` is keyed on.
 *
 * WHAT THIS IS FOR. 20260805000006 replaced the global `UNIQUE (city,
 * agency_name)` — a cross-tenant denial of service waiting to happen — with
 * workspace-scoped partial unique indexes on SOURCE IDENTITY. Two feeds are the
 * same feed when they came from the same address, and "the same address" has to
 * survive a planner pasting `HTTPS://Example.ORG/gtfs.zip#download` on Tuesday
 * and `https://example.org/gtfs.zip` on Thursday. Without normalisation the
 * index sees two feeds and the workspace collects duplicates of its own agency.
 *
 * WHAT IS DELIBERATELY LEFT ALONE. The query string is kept verbatim and is
 * NOT reordered. Reordering is the obvious next step and it is wrong: query
 * parameters are ordered data to some servers, several agencies publish feeds
 * behind a signed or tokenised URL where the parameter order is part of what is
 * signed, and a normaliser that rewrites those makes two genuinely different
 * addresses collide. The path is not lowercased for the same reason — paths are
 * case-sensitive on most servers, and folding them would let one workspace's
 * `/GTFS.zip` silently overwrite another's `/gtfs.zip`.
 *
 * Returns null for anything that is not an http(s) URL. A null simply means the
 * partial index does not apply to this feed, which is the correct outcome for
 * an uploaded `.zip` that has no address at all.
 */
export function normalizeGtfsSourceUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  // `URL` already drops a port that is the protocol's default; this drops one
  // written out explicitly on the non-default protocol, so `https://x:443/` and
  // `https://x/` are one feed.
  if (
    (parsed.protocol === "http:" && parsed.port === "80") ||
    (parsed.protocol === "https:" && parsed.port === "443")
  ) {
    parsed.port = "";
  }
  if (parsed.pathname === "/") parsed.pathname = "";

  return parsed.toString();
}

/**
 * A name to call the feed until the parse tells us what it really is.
 *
 * NEVER A GUESS AT AN AGENCY. `beginGtfsFeedVersion` documents this and it
 * matters: `gtfs_feeds.agency_name` is NOT NULL and is what a Data Hub card
 * renders, so whatever goes in here is displayed to a planner for as long as
 * the ingest runs and forever if it fails. A hostname is a fact about the
 * address the planner supplied. "Sacramento Regional Transit" inferred from a
 * URL is a claim OpenPlan has not established.
 */
export function provisionalFeedNameFromUrl(raw: string): string {
  try {
    return new URL(raw).hostname || raw.slice(0, 120);
  } catch {
    return raw.slice(0, 120);
  }
}

/* -------------------------------------------------------------------------- */
/* The ingest                                                                   */
/* -------------------------------------------------------------------------- */

/** Where the bytes come from. One variant per door. */
export type GtfsIngestSource =
  | {
      kind: "catalog";
      /** Read off the resolved CATALOG ROW by the route, never off the request. */
      downloadUrl: string;
      catalogProvider: string | null;
      catalogSourceId: string;
      /** The catalog's own word for this entry, verbatim. Never interpreted. */
      catalogRowStatus: string | null;
    }
  | { kind: "url"; downloadUrl: string }
  | {
      kind: "upload";
      bytes: Uint8Array;
      /** Must be one of the `gtfs-uploads` bucket's allowed mime types. */
      contentType: string;
      filename: string | null;
    };

export type RunGtfsIngestParams = {
  /**
   * MUST be a service-role client. Every write in this lane is service-role by
   * design — the three tables carry a SELECT policy and nothing else (see
   * 20260805000006 section 6) — and `write-policy-coverage-guard.test.ts`
   * proves the claim by resolving the client at every call site.
   */
  service: SupabaseClient;
  workspaceId: string;
  /** An existing feed to add a version to (a refresh), or null to create one. */
  feedId?: string | null;
  source: GtfsIngestSource;
  /** What to call the feed until the parse names it. */
  provisionalName: string;
  requestedBy: string | null;
  /**
   * ADOPT A MATERIALLY SMALLER REFETCH ANYWAY.
   *
   * Reserved for a person who has been shown `CollapseAssessment.detail` and
   * said yes. It must never become reachable by an assistant action: an agent
   * optimising for "the refresh completed" would set it every time, which is
   * precisely the incentive the collapse rule exists to defeat. Any future
   * `refresh_gtfs_feed` action must therefore go through
   * `refuseOutOfScopeAgentRequest` — the route is wider than the action, and
   * the approval hash covers the action the route rebuilds, not the body.
   */
  adoptDespiteCollapse?: boolean;
  /** Test seam. Defaults to the real network, the real clock, the real DNS. */
  fetchOptions?: GtfsFetchOptions;
  /**
   * Where the unredacted refusal goes when the fetch lane withholds one. LOGS
   * ONLY — see the module header for why this is a callback and not a field.
   */
  onDiagnostic?: (diagnostic: string) => void;
};

/** Whether the new version became the one this workspace analyses with. */
export type GtfsIngestAdoption =
  | { adopted: true }
  | {
      /** The refetch is smaller than the feed in use, so it was NOT adopted. */
      adopted: false;
      reason: "withheld_for_collapse";
      assessment: CollapseAssessment & { collapsed: true };
    }
  | {
      /** The data is stored and `ready`; the promotion itself did not land. */
      adopted: false;
      reason: "promotion_failed";
      detail: string;
    };

export type GtfsIngestResult =
  | {
      ok: true;
      feedId: string;
      versionId: string;
      createdFeed: boolean;
      adoption: GtfsIngestAdoption;
      displayName: string | null;
      routeServiceLevelRows: number;
      stopServiceLevelRows: number;
      /**
       * Derived stop levels that could not be stored because the feed never
       * placed the stop. Reported rather than absorbed — see
       * `StopRowMappingResult`.
       */
      droppedForMissingCoordinates: number;
      warnings: GtfsParseWarning[];
      /** The qualifications that travel with every number derived from this feed. */
      caveats: string[];
      checksumSha256: string | null;
      byteSize: number;
    }
  | {
      ok: false;
      status: number;
      code: GtfsFailureCode;
      /** One sentence a planner can act on. Safe to return verbatim. */
      detail: string;
      /** Null only when the version row itself could not be written. */
      versionId: string | null;
      feedId: string | null;
      createdFeed: boolean;
    };

/** The object key for an uploaded archive, scoped by workspace and version. */
export function gtfsUploadObjectPath(
  workspaceId: string,
  feedId: string,
  versionId: string
): string {
  return `${workspaceId}/${feedId}/${versionId}.zip`;
}

/**
 * Point the version row at the object that was just stored.
 *
 * WHY THIS WRITE IS HERE AND NOT INSIDE `writeParsedFeedVersion`, which also
 * accepts a `storagePath`. That function runs AFTER a successful parse. An
 * ingest killed between the upload and the end of the parse would therefore
 * leave an object in a private bucket with nothing in the database naming it —
 * `reapAbandonedGtfsIngests` removes an abandoned ingest's object by reading
 * `storage_path` off the row, so a path that has not reached the row yet is a
 * path nothing can ever clean up. Recording it immediately is what makes the
 * reaper's cleanup complete rather than best-effort.
 *
 * A miss here is NOT fatal to the ingest and is reported rather than thrown:
 * the parse can still succeed, and `writeParsedFeedVersion` writes the same
 * path again on success. What must not happen is the miss going unobserved,
 * which is how an UPDATE over zero rows becomes indistinguishable from success.
 */
async function recordUploadedObject(
  service: SupabaseClient,
  versionId: string,
  storagePath: string,
  byteSize: number,
  checksumSha256: string
): Promise<boolean> {
  const result = await service
    .from("gtfs_feed_versions")
    .update({
      storage_path: storagePath,
      byte_size: byteSize,
      checksum_sha256: checksumSha256,
      last_checked_at: new Date().toISOString(),
    })
    .eq("id", versionId)
    .select("id")
    .maybeSingle();

  return !writeMatchedNoRows(result);
}

/**
 * Run one feed ingest, end to end, and leave nothing half-written behind it.
 */
export async function runGtfsIngest(params: RunGtfsIngestParams): Promise<GtfsIngestResult> {
  const { service, workspaceId, source } = params;

  const sourceUrl = source.kind === "upload" ? null : source.downloadUrl;

  const begun = await beginGtfsFeedVersion({
    service,
    workspaceId,
    feedId: params.feedId ?? null,
    sourceKind: source.kind,
    sourceUrl,
    normalizedSourceUrl: normalizeGtfsSourceUrl(sourceUrl),
    catalogProvider: source.kind === "catalog" ? source.catalogProvider : null,
    catalogSourceId: source.kind === "catalog" ? source.catalogSourceId : null,
    catalogRowStatus: source.kind === "catalog" ? source.catalogRowStatus : null,
    provisionalName: params.provisionalName,
    requestedBy: params.requestedBy,
  });

  if (!begun.ok) {
    return {
      ok: false,
      status: 500,
      code: "partial_write",
      detail: begun.detail,
      versionId: null,
      feedId: params.feedId ?? null,
      createdFeed: false,
    };
  }

  const { feedId, versionId, createdFeed } = begun;
  // Passed to `failGtfsFeedVersion` only when this ingest CREATED the feed, so
  // a failed refresh cannot move the status of a feed whose current version is
  // perfectly good. See that function's comment about the mirror guard.
  const feedIdForFailure = createdFeed ? feedId : null;

  /** Record the failure, clean up after it, and shape the answer. */
  const refuse = async (
    code: GtfsFailureCode,
    detail: string,
    storagePath: string | null
  ): Promise<GtfsIngestResult> => {
    await failGtfsFeedVersion({
      service,
      versionId,
      code,
      detail,
      feedId: feedIdForFailure,
      storagePath,
    });
    return {
      ok: false,
      status: GTFS_FAILURE_HTTP_STATUS[code],
      code,
      detail,
      versionId,
      feedId,
      createdFeed,
    };
  };

  await markGtfsFeedVersionStage(service, versionId, "fetching");

  /* ---------------------------------------------------------------------- */
  /* The bytes                                                               */
  /* ---------------------------------------------------------------------- */

  let bytes: Uint8Array;
  let checksumSha256: string;
  let fetchedAt: Date;

  if (source.kind === "upload") {
    bytes = source.bytes;
    checksumSha256 = createHash("sha256").update(bytes).digest("hex");
    fetchedAt = new Date();
  } else {
    const fetched = await fetchGtfsFeedBytes(source.downloadUrl, params.fetchOptions ?? {});
    if (!fetched.ok) {
      // The unredacted sentence goes to the deployment's own logs and no
      // further. `detail` is the half that may be shown to a planner.
      if (fetched.diagnostic) params.onDiagnostic?.(fetched.diagnostic);
      return refuse(fetched.code, fetched.detail, null);
    }
    bytes = fetched.bytes;
    checksumSha256 = fetched.checksumSha256;
    fetchedAt = new Date();
  }

  const byteSize = bytes.byteLength;
  if (byteSize === 0) {
    return refuse(
      "not_a_zip",
      "This feed is empty — nothing was received. A GTFS feed is a `.zip` archive of `.txt` files.",
      null
    );
  }

  // The DOMAIN bound, applied before anything is stored. `openGtfsZip` refuses
  // the same limit a moment later with the same code, so this cannot disagree
  // with the parser; what it buys is not writing 190 MB into a private bucket
  // in order to find out.
  const limits = resolveGtfsLimits();
  if (byteSize > limits.maxArchiveBytes) {
    return refuse(
      "too_large",
      `This feed is ${Math.round(byteSize / (1024 * 1024))} MB, and this deployment accepts ` +
        `archives up to ${Math.round(limits.maxArchiveBytes / (1024 * 1024))} MB. An operator can ` +
        "raise the limit with OPENPLAN_GTFS_MAX_ARCHIVE_BYTES.",
      null
    );
  }

  /* ---------------------------------------------------------------------- */
  /* The object (upload door only)                                           */
  /* ---------------------------------------------------------------------- */

  let storagePath: string | null = null;

  if (source.kind === "upload") {
    const path = gtfsUploadObjectPath(workspaceId, feedId, versionId);
    const uploaded = await service.storage
      .from(GTFS_UPLOADS_BUCKET)
      .upload(path, bytes, { contentType: source.contentType, upsert: false });

    if (uploaded.error) {
      return refuse(
        "partial_write",
        `The feed was received but could not be stored: ${uploaded.error.message}`,
        null
      );
    }

    // From here on every failure path must carry the path so the object is
    // removed with the failure. `refuse` takes it as an argument for exactly
    // that reason rather than closing over a mutable variable.
    storagePath = path;
    await recordUploadedObject(service, versionId, path, byteSize, checksumSha256);
  }

  /* ---------------------------------------------------------------------- */
  /* The parse                                                               */
  /* ---------------------------------------------------------------------- */

  await markGtfsFeedVersionStage(service, versionId, "parsing");

  const parsed = await parseGtfsFeed(bytes, { limits });
  if (!parsed.ok) {
    return refuse(parsed.code, parsed.detail, storagePath);
  }

  const written = await writeParsedFeedVersion({
    service,
    versionId,
    workspaceId,
    feed: parsed.feed,
    storagePath,
    checksumSha256,
    byteSize,
    fetchedAt,
  });
  if (!written.ok) {
    return refuse(written.code, written.detail, storagePath);
  }

  /* ---------------------------------------------------------------------- */
  /* Adoption                                                                */
  /* ---------------------------------------------------------------------- */

  const promoted = await promoteGtfsFeedVersion({
    service,
    feedId,
    versionId,
    adoptDespiteCollapse: params.adoptDespiteCollapse,
  });

  let adoption: GtfsIngestAdoption;
  if (!promoted.ok) {
    // NOT a failure of the ingest, and deliberately not recorded as one. The
    // version is `ready` and its derived rows are correct and complete; only
    // the pointer did not move. Calling `failGtfsFeedVersion` here would delete
    // good data because a bookkeeping statement missed.
    adoption = { adopted: false, reason: "promotion_failed", detail: promoted.detail };
  } else if (!promoted.promoted) {
    adoption = { adopted: false, reason: "withheld_for_collapse", assessment: promoted.withheld };
  } else {
    adoption = { adopted: true };
    // The parsed agency's name is only true of the version that is now current,
    // so the rename moves with the promotion — never at write time, where it
    // would rename a feed on the strength of an ingest nobody adopted.
    await syncFeedDisplayName(service, feedId, written.displayName);
  }

  return {
    ok: true,
    feedId,
    versionId,
    createdFeed,
    adoption,
    displayName: written.displayName,
    routeServiceLevelRows: written.routeServiceLevelRows,
    stopServiceLevelRows: written.stopServiceLevelRows,
    droppedForMissingCoordinates: written.droppedForMissingCoordinates,
    warnings: parsed.feed.warnings,
    // Built from the values that were just WRITTEN to the version row, through
    // the same function the detail route uses when it reads that row back, so
    // the caveats a planner sees on ingest and the caveats they see on their
    // next visit cannot disagree. See `gtfsCaveatContextFromVersionRow`.
    caveats: selectGtfsCaveats(
      gtfsCaveatContextFromVersionRow({
        frequency_trip_count: parsed.feed.stats.frequencyTrips,
        parse_warnings: parsed.feed.warnings,
        route_service_level_rows: written.routeServiceLevelRows,
      })
    ),
    checksumSha256,
    byteSize,
  };
}
