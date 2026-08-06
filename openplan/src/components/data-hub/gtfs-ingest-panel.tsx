"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StudyAreaPicker } from "@/components/models/study-area-picker";
import { summarizeCorridorText } from "@/lib/models/study-area";
import { describeGtfsServiceWindow } from "@/lib/transit/feed-registry-card";

/**
 * THE THREE DOORS INTO A TRANSIT FEED, AND WHAT THE WORKSPACE ALREADY HAS.
 *
 * Nine GTFS tables existed for months with no application code touching them,
 * and the Data Hub card that described them said so. This panel is the path
 * that makes the card's new sentence true: catalog search by geography, an
 * operator's feed address, or a `.zip` upload — all three landing in the same
 * ingest through `/api/gtfs/*`.
 *
 * ==================================== WHY IT NEVER PRINTS THE POST'S COUNTS
 *
 * An ingest can partially succeed. `runGtfsIngest` writes route rows and stop
 * rows in separate statements and reports what it wrote, so a response saying
 * "412 route rows" after a `partial_write` is a truthful account of a broken
 * state that READS as a success. Every number on this panel therefore comes
 * from a RE-READ of `/api/gtfs/feeds` issued after the write settles — on
 * failure as much as on success, because after a failure is exactly when a
 * planner needs to know what is actually stored. The POST's own body is used
 * only for the things a re-read cannot recover: which failure code came back,
 * and whether the new version was adopted. Same pattern as
 * `census-tract-coverage-control.tsx`, for the same reason.
 *
 * ====================== WHY AN UPLOADED FEED HAS ITS OWN UPLOAD CONTROL
 *
 * This panel used to tell a planner "Upload a newer archive to this feed to
 * refresh it" and then give them nowhere to do it. The only upload control was
 * the door at the bottom, which sends no `feedId` — so following the sentence
 * created a SECOND `gtfs_feeds` row for the same agency, left the expired
 * version adopted on the first, and skipped the collapse check entirely
 * (nothing to compare against on a brand-new feed). `/api/gtfs/feeds/upload`
 * has accepted `?feedId=` since it shipped and verifies the feed belongs to the
 * workspace; the capability was there and the path to it was not. Each
 * upload-sourced feed now carries its own archive picker, and both it and the
 * bottom door go through ONE function, so the size ceiling and the re-read
 * cannot be implemented twice and differently.
 *
 * ==================== WHY A SEARCH RESULT IS KEYED TO THE AREA IT ANSWERS
 *
 * The result was held in state and the study area was not part of it, so a
 * planner who searched area A and then picked area B kept reading A's answer as
 * B's — including "Nothing in the catalog publishes a service area covering
 * this area", which is the one branch that is a statement about the world and
 * was then simply false. Every search now records the bounding box it was run
 * for and is rendered only while that is still the area on screen. Keying it
 * rather than clearing it on change also settles the in-flight case for free: a
 * response for the old area arrives, fails to match, and is never drawn.
 *
 * ============================ WHY THE PER-FEED INGEST HISTORY IS A SECOND READ
 *
 * `/api/gtfs/feeds` caps its version read at 200 rows across the WHOLE
 * workspace, newest first, so a workspace with several busy feeds can push an
 * older feed's attempts out of that window entirely. `/api/gtfs/feeds/[feedId]`
 * answers with up to 50 versions of ONE feed regardless of what the others are
 * doing, which is the only way a planner can see a run of failures on a quiet
 * feed. It is fetched on demand rather than on mount because most planners
 * never need it.
 *
 * ============================ WHY THE FOUR CATALOG OUTCOMES LOOK DIFFERENT
 *
 * `findGtfsFeedsForArea` answers with four statuses and three of them carry no
 * `feeds` field, precisely so a surface cannot collapse them into an empty
 * list. Collapsing them here would rebuild the lie one layer up:
 *
 *   - `catalog_unavailable` is an UNKNOWN about OpenPlan's own network, and
 *     must never be drawn as "your area has no transit".
 *   - `covered_but_unusable` means feeds DO serve this area and every one was
 *     withheld — behind a key, withdrawn, or published with no address. The
 *     agencies are named and the next move differs per reason.
 *   - `no_covering_feed` is the only branch that is a statement about the world.
 *
 * ============================================= WHY THE PICKER IS NOT REBUILT
 *
 * `StudyAreaPicker` is the app's one geography front door (product
 * non-negotiable: do not invent a second one). Its bbox is derived from the
 * GeoJSON text with `summarizeCorridorText`, NOT from `onPlaceResolved` —
 * that callback fires only for a searched place and passes `null` for a
 * hand-drawn polygon, so a planner who draws their study area would otherwise
 * get a search button that never enables.
 *
 * ================================================== WHAT IS NOT IMPORTED HERE
 *
 * `@/lib/http/body-limit` pulls `next/server` into the browser bundle and
 * `@/lib/http/outbound-url` imports `node:dns`; `@/lib/gtfs/catalog` reaches the
 * second through `fetch.ts`. The upload ceiling therefore arrives as a PROP
 * (the pattern `network-package-upload-form.tsx` already uses) and the catalog
 * shapes below are declared against the WIRE rather than imported. They are
 * narrow on purpose — this file reads what it renders and nothing more.
 */

/* -------------------------------------------------------------------------- */
/* Wire shapes                                                                  */
/* -------------------------------------------------------------------------- */

type FeedRow = {
  id: string;
  workspace_id: string | null;
  agency_name: string | null;
  city: string | null;
  state: string | null;
  status: string | null;
  source_kind: string | null;
  feed_url: string | null;
  catalog_provider: string | null;
  catalog_source_id: string | null;
  current_version_id: string | null;
  created_at: string | null;
  loaded_at: string | null;
};

type VersionRow = {
  id: string;
  feed_id: string;
  workspace_id: string | null;
  status: string | null;
  failure_code: string | null;
  failure_detail: string | null;
  service_start_date: string | null;
  service_end_date: string | null;
  route_service_level_rows: number | null;
  stop_service_level_rows: number | null;
  route_count: number | null;
  stop_count: number | null;
  trip_count: number | null;
  frequency_trip_count: number | null;
  created_at: string | null;
};

type CatalogEntry = {
  catalogId: string;
  provider: string | null;
  name: string | null;
  statedLocation: {
    countryCode: string | null;
    subdivisionName: string | null;
    municipality: string | null;
  };
  feedContactEmail: string | null;
};

type CatalogDisclosure = {
  staticEntriesConsidered: number;
  supersededOrInactiveCoveringArea: number;
  requiringApiKey: number;
  withoutDownloadUrl: number;
  /** WHOLE-CATALOG, WORLDWIDE. Never render this as a count of feeds near here. */
  entriesWithNoPublishedServiceAreaAnywhere: number;
};

type WithheldFeed = {
  entry: CatalogEntry;
  reason: "superseded" | "requires_api_key" | "no_download_url";
};

type CatalogSearchBody =
  | {
      status: "matched";
      feeds: Array<{ entry: CatalogEntry; serviceAreaSpread: number; focusOffsetDegrees: number }>;
      disclosure: CatalogDisclosure;
      catalogUrl: string;
    }
  | { status: "covered_but_unusable"; withheld: WithheldFeed[]; disclosure: CatalogDisclosure; catalogUrl: string }
  | { status: "no_covering_feed"; disclosure: CatalogDisclosure; catalogUrl: string }
  | { status: "catalog_unavailable"; code: string; detail: string; catalogUrl: string };

type IngestAdoption =
  | { adopted: true }
  | { adopted: false; reason: "withheld_for_collapse"; assessment: { detail: string } }
  | { adopted: false; reason: "promotion_failed"; detail: string };

type IngestBody = {
  feedId?: string;
  versionId?: string;
  createdFeed?: boolean;
  adoption?: IngestAdoption;
  displayName?: string | null;
  error?: string;
  code?: string;
  detail?: string;
  maxBytes?: number;
  /**
   * WHETHER THIS FEED CAN REACH A MODEL RUN. Every door stores its archive to
   * the private `gtfs-uploads` bucket since 2026-08-06, because the travel model
   * is handed the exact bytes OpenPlan parsed rather than an address the worker
   * refetches. A catalog or URL ingest whose object write missed still produces
   * correct and complete service levels — so the ingest is `ok`, and the API has
   * been returning this flag since it shipped with NOTHING rendering it.
   *
   * That silence is the defect: the run handoff refuses such a version by name,
   * and the planner would meet the refusal at launch time, days later, on a
   * feed the Data Hub had reported as a success.
   */
  bytesStored?: boolean;
  bytesNotStoredReason?: string | null;
};

type RegistryState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | {
      status: "ready";
      feeds: FeedRow[];
      currentVersions: VersionRow[];
      recentVersions: VersionRow[];
      caveatsByFeedId: Record<string, string[]>;
    };

/** What the last write said. Never carries a row count — see the header. */
type Outcome = {
  tone: "ok" | "warn" | "bad";
  headline: string;
  lines: string[];
  /** Set when a refetch was withheld for collapse, so adoption can be offered. */
  collapsedFeedId?: string;
};

type Door = "catalog" | "url" | "upload";

/**
 * Every ingest attempt on ONE feed, read from `/api/gtfs/feeds/[feedId]`.
 *
 * Three states and not two, for the reason the registry read has three: a
 * detail read that failed is not a feed with no ingests, and an empty list
 * under a heading is exactly how the two get confused.
 */
type HistoryState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; versions: VersionRow[] };

/**
 * The bounding box a search answers about, as one comparable string.
 *
 * A search result is only true of the area it was run for — see the header.
 * Null when the drawn geometry is not usable, which is also a mismatch, so a
 * result cannot survive the area becoming unreadable either.
 */
function areaKey(bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number } | null): string | null {
  return bbox ? `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}` : null;
}

/* -------------------------------------------------------------------------- */
/* Wording                                                                      */
/* -------------------------------------------------------------------------- */

function entryLabel(entry: CatalogEntry): string {
  return (entry.provider ?? "").trim() || (entry.name ?? "").trim() || `Catalog entry ${entry.catalogId}`;
}

function entryPlace(entry: CatalogEntry): string {
  const parts = [
    entry.statedLocation.municipality,
    entry.statedLocation.subdivisionName,
    entry.statedLocation.countryCode,
  ]
    .map((part) => (part ?? "").trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(", ") : "no stated location";
}

/**
 * What a planner DOES about each withheld reason. A refusal that does not name
 * the next move is a dead end dressed as an explanation.
 */
function describeWithheldReason(withheld: WithheldFeed): string {
  switch (withheld.reason) {
    case "superseded":
      return (
        "The catalog has withdrawn this entry. It usually names a replacement, and OpenPlan follows that " +
        "redirect automatically when the entry is ingested — so this agency may still be reachable."
      );
    case "requires_api_key":
      return (
        "This feed is published behind an API key that this OpenPlan deployment does not hold. Ask the agency " +
        `for access${withheld.entry.feedContactEmail ? ` (${withheld.entry.feedContactEmail})` : ""}, then bring the ` +
        "feed in through the feed-address door with the key in the URL."
      );
    case "no_download_url":
      return (
        "The catalog lists this agency and publishes no download address for their feed. Ask them where they " +
        "publish their GTFS, then use the feed-address or upload door."
      );
  }
}

/**
 * The counts that qualify a search result, worded so none of them can be read
 * as "N feeds near you".
 */
function disclosureLines(disclosure: CatalogDisclosure): string[] {
  const lines: string[] = [
    `${disclosure.staticEntriesConsidered} static GTFS entries in the catalog were considered.`,
  ];
  if (disclosure.supersededOrInactiveCoveringArea > 0) {
    lines.push(
      `${disclosure.supersededOrInactiveCoveringArea} entries covering this area have been withdrawn from the catalog and were not offered.`
    );
  }
  if (disclosure.requiringApiKey > 0) {
    lines.push(
      `${disclosure.requiringApiKey} entries covering this area require an API key this deployment does not hold.`
    );
  }
  if (disclosure.withoutDownloadUrl > 0) {
    lines.push(
      `${disclosure.withoutDownloadUrl} entries covering this area publish no download address at all.`
    );
  }
  if (disclosure.entriesWithNoPublishedServiceAreaAnywhere > 0) {
    // DELIBERATE WORDING. This counter is worldwide and whole-catalog. Calling
    // it "near you" would invent a relationship the data does not have — the
    // exact sentence the field was renamed to prevent.
    lines.push(
      `${disclosure.entriesWithNoPublishedServiceAreaAnywhere} feeds anywhere in the worldwide catalog publish no service ` +
        "area at all, so they could not be matched against any area — including this one. That is a catalog-wide " +
        "count, not a count of feeds near this area."
    );
  }
  return lines;
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                        */
/* -------------------------------------------------------------------------- */

export function GtfsIngestPanel({
  workspaceId,
  maxUploadBytes,
  today,
  readOnly = false,
}: {
  workspaceId: string;
  /** `BODY_LIMITS.gtfsFeedRaw`, threaded from the server. See the header. */
  maxUploadBytes: number;
  /** `YYYY-MM-DD`, from the server, so expiry does not depend on a browser clock. */
  today: string;
  /** Viewers may search the public catalog and may not write. */
  readOnly?: boolean;
}) {
  const [registry, setRegistry] = useState<RegistryState>({ status: "loading" });
  const [door, setDoor] = useState<Door>("catalog");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const [corridorText, setCorridorText] = useState("");
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);
  /** Every branch but `idle` carries the AREA it belongs to. See the header. */
  const [search, setSearch] = useState<
    | { status: "idle" }
    | { status: "searching"; area: string }
    | { status: "error"; area: string; message: string }
    | { status: "done"; area: string; body: CatalogSearchBody }
  >({ status: "idle" });

  const [feedUrl, setFeedUrl] = useState("");
  const [feedLabel, setFeedLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadLabel, setUploadLabel] = useState("");
  /** The newer archive chosen for one existing uploaded feed, if any. */
  const [newArchive, setNewArchive] = useState<{ feedId: string; file: File } | null>(null);

  const [historyFeedId, setHistoryFeedId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryState>({ status: "loading" });
  /**
   * Which feed's history the planner is actually looking at, readable from
   * inside an in-flight fetch. Two quick clicks on two feeds resolve in
   * whatever order the network chooses, and without this the slower answer
   * would be printed under the other feed's name.
   */
  const openHistoryRef = useRef<string | null>(null);

  // The bbox comes from the GeoJSON, never from `onPlaceResolved` — see header.
  const bbox = useMemo(() => {
    const summary = summarizeCorridorText(corridorText);
    return summary.valid && summary.bbox ? summary.bbox : null;
  }, [corridorText]);

  const currentArea = areaKey(bbox);

  /**
   * THE SEARCH STATE, BUT ONLY WHILE IT STILL ANSWERS THE AREA ON SCREEN.
   *
   * A result computed for another bounding box is not a weaker answer about
   * this one, it is an answer to a different question — so it is not softened,
   * it is not shown. Deriving this rather than clearing state on change keeps
   * one source of truth and makes a late response for the previous area
   * harmless.
   */
  const searchForCurrentArea =
    search.status === "idle" || search.area === currentArea ? search : ({ status: "idle" } as const);

  const loadRegistry = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(`/api/gtfs/feeds?workspaceId=${encodeURIComponent(workspaceId)}`);
      const body = (await response.json().catch(() => ({}))) as {
        feeds?: FeedRow[];
        currentVersions?: VersionRow[];
        recentVersions?: VersionRow[];
        caveatsByFeedId?: Record<string, string[]>;
        error?: string;
      };
      if (!response.ok) {
        setRegistry({ status: "failed", message: body.error || `The feed registry could not be read (${response.status}).` });
        return;
      }
      setRegistry({
        status: "ready",
        feeds: body.feeds ?? [],
        currentVersions: body.currentVersions ?? [],
        recentVersions: body.recentVersions ?? [],
        caveatsByFeedId: body.caveatsByFeedId ?? {},
      });
    } catch (error) {
      setRegistry({
        status: "failed",
        message: error instanceof Error ? error.message : "The feed registry could not be read.",
      });
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadRegistry();
  }, [loadRegistry]);

  /**
   * Turn an ingest response into an outcome, then RE-READ.
   *
   * The re-read happens on both paths and its result is what every number on
   * screen comes from. See the header.
   */
  async function settleIngest(response: Response, body: IngestBody, what: string): Promise<void> {
    await loadRegistry();
    // An open ingest history is a read of the same rows this write just changed.
    // Leaving it on screen would show the state before the attempt, beside an
    // outcome describing the attempt.
    if (openHistoryRef.current) await loadHistory(openHistoryRef.current);

    if (!response.ok) {
      const lines = [body.detail ?? "", body.code ? `Failure code: ${body.code}.` : ""].filter(Boolean);
      if (response.status === 413 && typeof body.maxBytes === "number") {
        lines.push(`This deployment accepts uploads up to ${(body.maxBytes / (1024 * 1024)).toFixed(0)} MB.`);
      }
      lines.push("The feed list above was re-read after the failure, so it shows what is actually stored.");
      setOutcome({
        tone: "bad",
        headline: body.error || `${what} failed (${response.status}).`,
        lines,
      });
      return;
    }

    const adoption = body.adoption;
    if (adoption && !adoption.adopted && adoption.reason === "withheld_for_collapse") {
      setOutcome({
        tone: "warn",
        headline: `${what} succeeded, and the result was NOT adopted.`,
        lines: [adoption.assessment.detail],
        collapsedFeedId: body.feedId,
      });
      return;
    }
    if (adoption && !adoption.adopted && adoption.reason === "promotion_failed") {
      setOutcome({
        tone: "warn",
        headline: `${what} succeeded, and this workspace is still analysing with the previous feed.`,
        lines: [
          adoption.detail,
          "The new ingest is stored and complete; only the statement that switches it into use did not land. Try again.",
        ],
      });
      return;
    }

    // THE ARCHIVE WAS NOT KEPT. Reported as a WARNING on an otherwise successful
    // ingest, because that is exactly what it is: the service levels on this page
    // are correct and complete, and the only thing that is missing is the copy a
    // model run needs. Saying nothing would let a planner discover it at launch,
    // days later, as a refusal on a feed this panel had called a success.
    if (body.bytesStored === false) {
      setOutcome({
        tone: "warn",
        headline: `${what} succeeded${body.displayName ? ` — ${body.displayName}` : ""}, and a copy of the feed was NOT kept.`,
        lines: [
          "This feed's service levels, routes and stops are complete and correct — everything on this page " +
            "is usable.",
          "What is missing is the archive itself. A model run is handed the exact bytes OpenPlan parsed, " +
            "verified against their checksum, rather than an address the modeling worker refetches — so a " +
            "run that names this feed will refuse to model transit from it until the feed is brought in again.",
          body.bytesNotStoredReason
            ? `The archive could not be stored: ${body.bytesNotStoredReason}`
            : "The archive could not be stored, and no reason was returned.",
        ],
      });
      return;
    }

    setOutcome({
      tone: "ok",
      headline: `${what} succeeded${body.displayName ? ` — ${body.displayName}` : ""}.`,
      lines: ["The feed list above is re-read from the database, so its figures are what is stored rather than what the ingest reported."],
    });
  }

  async function runSearch(): Promise<void> {
    if (!bbox || !currentArea) return;
    // Captured, not re-read on return: the planner may have moved the area
    // while this was in flight, and the answer belongs to the area it was asked
    // about either way.
    const area = currentArea;
    setSearch({ status: "searching", area });
    setOutcome(null);
    try {
      const params = new URLSearchParams({
        workspaceId,
        minLon: String(bbox.minLon),
        minLat: String(bbox.minLat),
        maxLon: String(bbox.maxLon),
        maxLat: String(bbox.maxLat),
      });
      const response = await fetch(`/api/gtfs/catalog/search?${params.toString()}`);
      const body = (await response.json().catch(() => ({}))) as CatalogSearchBody & { error?: string };
      if (!response.ok && body.status !== "catalog_unavailable") {
        setSearch({ status: "error", area, message: body.error || `The catalog search failed (${response.status}).` });
        return;
      }
      setSearch({ status: "done", area, body });
    } catch (error) {
      setSearch({
        status: "error",
        area,
        message: error instanceof Error ? error.message : "The catalog search could not be sent.",
      });
    }
  }

  /**
   * EVERY INGEST OF ONE FEED, INCLUDING THE ONES THAT FAILED.
   *
   * The list read this panel mounts with holds 200 version rows for the whole
   * workspace; this is the only read that answers for a single feed no matter
   * how busy its neighbours are. See the header.
   */
  async function toggleHistory(feedId: string): Promise<void> {
    if (historyFeedId === feedId) {
      setHistoryFeedId(null);
      openHistoryRef.current = null;
      return;
    }
    setHistoryFeedId(feedId);
    openHistoryRef.current = feedId;
    await loadHistory(feedId);
  }

  async function loadHistory(feedId: string): Promise<void> {
    setHistory({ status: "loading" });
    try {
      const response = await fetch(
        `/api/gtfs/feeds/${encodeURIComponent(feedId)}?workspaceId=${encodeURIComponent(workspaceId)}`
      );
      const body = (await response.json().catch(() => ({}))) as { versions?: VersionRow[]; error?: string };
      // A slower answer for a feed the planner has since closed or swapped away
      // from is dropped rather than printed under the wrong agency's name.
      if (openHistoryRef.current !== feedId) return;
      setHistory(
        response.ok
          ? { status: "ready", versions: body.versions ?? [] }
          : { status: "failed", message: body.error || `This feed's ingests could not be read (${response.status}).` }
      );
    } catch (error) {
      if (openHistoryRef.current !== feedId) return;
      setHistory({
        status: "failed",
        message: error instanceof Error ? error.message : "This feed's ingests could not be read.",
      });
    }
  }

  /**
   * ONE UPLOAD, TWO DOORS INTO IT.
   *
   * The bottom door creates a feed; the per-feed control adds a version to an
   * existing one by sending `feedId`. Everything else — the ceiling checked
   * before a byte leaves the browser, the content type, the re-read afterwards
   * — is identical, and a shared capability that lives inside one of its two
   * callers gets reimplemented wrongly by the other. It lives here instead.
   */
  async function postArchive(input: {
    file: File;
    busyKey: string;
    what: string;
    /** Present only when this archive is a NEW VERSION of a feed that exists. */
    feedId?: string;
    label?: string;
  }): Promise<void> {
    if (input.file.size > maxUploadBytes) {
      setOutcome({
        tone: "bad",
        headline: "That archive is larger than this deployment accepts.",
        lines: [
          `${(input.file.size / (1024 * 1024)).toFixed(1)} MB was chosen and the ceiling is ` +
            `${(maxUploadBytes / (1024 * 1024)).toFixed(0)} MB. Nothing was uploaded.`,
        ],
      });
      return;
    }
    setBusy(input.busyKey);
    setOutcome(null);
    try {
      const params = new URLSearchParams({ workspaceId, filename: input.file.name });
      if (input.feedId) params.set("feedId", input.feedId);
      if (input.label) params.set("label", input.label);
      const response = await fetch(`/api/gtfs/feeds/upload?${params.toString()}`, {
        method: "POST",
        headers: { "content-type": input.file.type || "application/zip" },
        body: input.file,
      });
      const body = (await response.json().catch(() => ({}))) as IngestBody;
      await settleIngest(response, body, input.what);
    } catch (error) {
      await loadRegistry();
      setOutcome({
        tone: "bad",
        headline: "The upload could not be sent.",
        lines: [error instanceof Error ? error.message : "Unknown error."],
      });
    } finally {
      setBusy(null);
    }
  }

  async function ingestFromCatalog(catalogId: string): Promise<void> {
    setBusy(`catalog:${catalogId}`);
    setOutcome(null);
    try {
      const response = await fetch(`/api/gtfs/feeds`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "catalog",
          workspaceId,
          catalogId,
          ...(bbox ? { area: bbox } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as IngestBody;
      await settleIngest(response, body, "Ingesting this catalog feed");
    } catch (error) {
      await loadRegistry();
      setOutcome({
        tone: "bad",
        headline: "The ingest request could not be sent.",
        lines: [error instanceof Error ? error.message : "Unknown error."],
      });
    } finally {
      setBusy(null);
    }
  }

  async function ingestFromUrl(): Promise<void> {
    const url = feedUrl.trim();
    if (!url) return;
    setBusy("url");
    setOutcome(null);
    try {
      const response = await fetch(`/api/gtfs/feeds`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "url",
          workspaceId,
          url,
          ...(feedLabel.trim() ? { label: feedLabel.trim() } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as IngestBody;
      await settleIngest(response, body, "Fetching this feed address");
    } catch (error) {
      await loadRegistry();
      setOutcome({
        tone: "bad",
        headline: "The ingest request could not be sent.",
        lines: [error instanceof Error ? error.message : "Unknown error."],
      });
    } finally {
      setBusy(null);
    }
  }

  async function ingestFromUpload(): Promise<void> {
    if (!file) return;
    await postArchive({
      file,
      busyKey: "upload",
      what: "Reading this uploaded archive",
      ...(uploadLabel.trim() ? { label: uploadLabel.trim() } : {}),
    });
  }

  /**
   * A NEWER ARCHIVE FOR A FEED THAT IS ALREADY HERE.
   *
   * `feedId` is the whole difference, and it is the difference between one
   * agency with a fresh version and two rows for the same agency with the stale
   * one still in use. The route verifies the feed belongs to this workspace.
   */
  async function uploadNewVersion(feedId: string): Promise<void> {
    if (!newArchive || newArchive.feedId !== feedId) return;
    await postArchive({
      file: newArchive.file,
      feedId,
      busyKey: `upload:${feedId}`,
      what: "Reading the newer archive for this feed",
    });
  }

  async function refreshFeed(feedId: string, adoptDespiteCollapse = false): Promise<void> {
    setBusy(`refresh:${feedId}`);
    setOutcome(null);
    try {
      const response = await fetch(`/api/gtfs/feeds/${encodeURIComponent(feedId)}/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, ...(adoptDespiteCollapse ? { adoptDespiteCollapse: true } : {}) }),
      });
      const body = (await response.json().catch(() => ({}))) as IngestBody;
      await settleIngest(response, body, "Refetching this feed from its stored address");
    } catch (error) {
      await loadRegistry();
      setOutcome({
        tone: "bad",
        headline: "The refresh request could not be sent.",
        lines: [error instanceof Error ? error.message : "Unknown error."],
      });
    } finally {
      setBusy(null);
    }
  }

  async function deleteFeed(feedId: string): Promise<void> {
    setBusy(`delete:${feedId}`);
    setOutcome(null);
    try {
      const response = await fetch(
        `/api/gtfs/feeds/${encodeURIComponent(feedId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
        { method: "DELETE" }
      );
      const body = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
      await loadRegistry();
      setConfirmingDelete(null);
      // Its ingests went with it; an open history of them would be a list of
      // rows that no longer exist. Only on success — a refused removal changed
      // nothing, and closing the panel would suggest it had.
      if (response.ok && openHistoryRef.current === feedId) {
        setHistoryFeedId(null);
        openHistoryRef.current = null;
      }
      setOutcome(
        response.ok
          ? { tone: "ok", headline: "The feed and its derived service levels were removed.", lines: [body.detail ?? ""].filter(Boolean) }
          : { tone: "bad", headline: body.error || `Removal failed (${response.status}).`, lines: [body.detail ?? ""].filter(Boolean) }
      );
    } catch (error) {
      await loadRegistry();
      setOutcome({
        tone: "bad",
        headline: "The removal request could not be sent.",
        lines: [error instanceof Error ? error.message : "Unknown error."],
      });
    } finally {
      setBusy(null);
    }
  }

  const currentVersionByFeed = useMemo(() => {
    const map = new Map<string, VersionRow>();
    if (registry.status !== "ready") return map;
    for (const version of registry.currentVersions) {
      // Both ids, for the same reason the Data Hub card re-checks: a version
      // row with a null workspace belongs to a public preloaded feed.
      if (version.workspace_id === workspaceId) map.set(version.feed_id, version);
    }
    return map;
  }, [registry, workspaceId]);

  const latestFailureByFeed = useMemo(() => {
    const map = new Map<string, VersionRow>();
    if (registry.status !== "ready") return map;
    for (const version of registry.recentVersions) {
      if (version.status !== "failed" || map.has(version.feed_id)) continue;
      map.set(version.feed_id, version);
    }
    return map;
  }, [registry]);

  return (
    <article className="module-section-surface" data-testid="gtfs-ingest-panel">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Transit feeds (GTFS)</p>
          <h2 className="module-section-title">Bring an agency&apos;s published schedule into this workspace</h2>
          <p className="module-section-description">
            OpenPlan reads a GTFS feed and keeps how often service runs — trip counts, headways and a derived peak
            hour. It deliberately does not store individual departure times, so it can never tell a rider when the
            next vehicle leaves.
          </p>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* What this workspace already has                                   */}
      {/* ---------------------------------------------------------------- */}

      <div className="mt-5 space-y-3">
        {registry.status === "loading" && (
          <p className="text-sm text-muted-foreground">Reading this workspace&apos;s transit feeds…</p>
        )}

        {registry.status === "failed" && (
          <div className="module-note text-sm">
            <p className="font-semibold">The transit feed registry could not be read.</p>
            <p className="mt-1 text-muted-foreground">{registry.message}</p>
            <p className="mt-1 text-muted-foreground">
              Nothing here states whether this workspace has a feed — a question the database did not answer is not
              an answer of none.
            </p>
          </div>
        )}

        {registry.status === "ready" && registry.feeds.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No transit feed has been ingested for this workspace yet. Use one of the three doors below.
          </p>
        )}

        {registry.status === "ready" &&
          registry.feeds.map((feed) => {
            const version = currentVersionByFeed.get(feed.id);
            const failure = latestFailureByFeed.get(feed.id);
            const isOwn = feed.workspace_id === workspaceId;
            const window = version
              ? describeGtfsServiceWindow({
                  startDate: version.service_start_date,
                  endDate: version.service_end_date,
                  today,
                })
              : null;
            const caveats = registry.caveatsByFeedId[feed.id] ?? [];

            return (
              <div key={feed.id} className="module-subpanel" data-testid={`gtfs-feed-${feed.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{(feed.agency_name ?? "").trim() || "Unnamed feed"}</p>
                  <span className="module-record-chip">{(feed.status ?? "").trim() || "no recorded status"}</span>
                  <span className="module-record-chip">{(feed.source_kind ?? "unknown source").trim()}</span>
                  {window?.state === "expired" && (
                    <span className="module-record-chip text-amber-700 dark:text-amber-300">Schedule expired</span>
                  )}
                </div>

                {version ? (
                  <>
                    <p className="mt-2 text-sm text-muted-foreground">{window?.text}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {version.route_service_level_rows ?? 0} route and {version.stop_service_level_rows ?? 0} stop
                      service-level rows derived from {version.route_count ?? 0} routes, {version.stop_count ?? 0}{" "}
                      stops and {version.trip_count ?? 0} trips.
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No ingest of this feed has been adopted, so it derives no service levels yet.
                  </p>
                )}

                {failure && (
                  <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                    The most recent ingest attempt failed ({failure.failure_code ?? "no code"}).{" "}
                    {failure.failure_detail ?? ""}
                  </p>
                )}

                {caveats.length > 0 && (
                  <details className="mt-2 text-sm text-muted-foreground">
                    <summary className="cursor-pointer">
                      What every number from this feed comes with ({caveats.length})
                    </summary>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {caveats.map((caveat) => (
                        <li key={caveat}>{caveat}</li>
                      ))}
                    </ul>
                  </details>
                )}

                {/*
                  EVERY INGEST OF THIS FEED, INCLUDING THE FAILED ONES.

                  Offered to viewers too, because it is a read, and only for a
                  feed this workspace owns: the detail route scopes its query to
                  the workspace, so asking it about a shared preloaded feed
                  would answer 404 and the control would be a dead end.
                */}
                {isOwn && (
                  <div className="mt-2">
                    <button
                      type="button"
                      className="module-inline-item"
                      onClick={() => void toggleHistory(feed.id)}
                      aria-expanded={historyFeedId === feed.id}
                    >
                      {historyFeedId === feed.id
                        ? "Hide this feed's ingest history"
                        : "Show every ingest of this feed"}
                    </button>
                  </div>
                )}

                {historyFeedId === feed.id && (
                  <div className="mt-2 text-sm" data-testid={`gtfs-feed-history-${feed.id}`}>
                    {history.status === "loading" && (
                      <p className="text-muted-foreground">Reading this feed&apos;s ingests…</p>
                    )}
                    {history.status === "failed" && (
                      <div className="module-note">
                        <p className="font-semibold">This feed&apos;s ingests could not be read.</p>
                        <p className="mt-1 text-muted-foreground">{history.message}</p>
                        <p className="mt-1 text-muted-foreground">
                          Nothing here says how many times this feed has been ingested — a question the database did
                          not answer is not an answer of none.
                        </p>
                      </div>
                    )}
                    {history.status === "ready" && history.versions.length === 0 && (
                      <p className="text-muted-foreground">
                        This feed has no recorded ingest attempts at all, so nothing has ever been read from it.
                      </p>
                    )}
                    {history.status === "ready" && history.versions.length > 0 && (
                      <ul className="space-y-1">
                        {history.versions.map((historyVersion) => (
                          <li key={historyVersion.id} className="text-muted-foreground">
                            <span className="font-medium">
                              {(historyVersion.created_at ?? "").slice(0, 10) || "undated"}
                            </span>{" "}
                            — {(historyVersion.status ?? "").trim() || "no recorded status"}
                            {historyVersion.id === feed.current_version_id ? " (in use)" : ""}
                            {historyVersion.status === "failed"
                              ? ` — ${historyVersion.failure_code ?? "no code"}. ${historyVersion.failure_detail ?? ""}`
                              : ` — ${historyVersion.route_service_level_rows ?? 0} route and ` +
                                `${historyVersion.stop_service_level_rows ?? 0} stop service-level rows.`}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {!readOnly && isOwn && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {feed.source_kind === "upload" ? (
                      /*
                        THE SENTENCE AND THE CONTROL, TOGETHER.

                        This read "Upload a newer archive to this feed to
                        refresh it" and offered no way to do it — the only
                        upload control on the page creates a NEW feed. A planner
                        who followed it ended up with two rows for one agency.
                        This picker sends `feedId`, so the archive becomes
                        another version of THIS feed and is compared against the
                        version in use before anything is adopted.
                      */
                      <div className="flex w-full flex-col gap-2">
                        <span className="text-xs text-muted-foreground">
                          An uploaded feed has no address to refetch, so a newer archive is how it is refreshed.
                          Choose one here and it becomes a new version of this feed — uploading it through the door
                          below would register a second feed for the same agency instead.
                        </span>
                        <input
                          type="file"
                          accept=".zip,application/zip"
                          aria-label={`Newer GTFS archive for ${(feed.agency_name ?? "").trim() || "this feed"}`}
                          className="block text-sm"
                          onChange={(event) => {
                            const chosen = event.target.files?.[0] ?? null;
                            setNewArchive(chosen ? { feedId: feed.id, file: chosen } : null);
                          }}
                        />
                        <button
                          type="button"
                          className="module-inline-item self-start"
                          disabled={busy !== null || newArchive?.feedId !== feed.id}
                          onClick={() => void uploadNewVersion(feed.id)}
                        >
                          {busy === `upload:${feed.id}`
                            ? "Reading the archive…"
                            : "Upload a newer archive to this feed"}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="module-inline-item"
                        disabled={busy !== null}
                        onClick={() => void refreshFeed(feed.id)}
                      >
                        {busy === `refresh:${feed.id}` ? "Refetching…" : "Refresh from source"}
                      </button>
                    )}

                    {confirmingDelete === feed.id ? (
                      <>
                        <span className="text-xs text-muted-foreground">
                          Removing this feed deletes every service level derived from it. Anything reading its
                          frequencies will have nothing to read.
                        </span>
                        <button
                          type="button"
                          className="module-inline-item"
                          disabled={busy !== null}
                          onClick={() => void deleteFeed(feed.id)}
                        >
                          {busy === `delete:${feed.id}` ? "Removing…" : "Confirm removal"}
                        </button>
                        <button type="button" className="module-inline-item" onClick={() => setConfirmingDelete(null)}>
                          Keep it
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="module-inline-item"
                        disabled={busy !== null}
                        onClick={() => setConfirmingDelete(feed.id)}
                      >
                        Remove feed
                      </button>
                    )}
                  </div>
                )}

                {!readOnly && !isOwn && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    This is a shared preloaded feed. Every workspace on this deployment reads it, so it is refreshed
                    and removed by whoever operates the deployment.
                  </p>
                )}
              </div>
            );
          })}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* The outcome of the last write                                     */}
      {/* ---------------------------------------------------------------- */}

      {outcome && (
        <div className="module-note mt-5 text-sm" role="status" data-testid="gtfs-ingest-outcome">
          <p className="font-semibold">{outcome.headline}</p>
          {outcome.lines.map((line) => (
            <p key={line} className="mt-1 text-muted-foreground">
              {line}
            </p>
          ))}
          {outcome.collapsedFeedId && !readOnly && (
            <button
              type="button"
              className="module-inline-item mt-2"
              disabled={busy !== null}
              onClick={() => void refreshFeed(outcome.collapsedFeedId as string, true)}
            >
              I have checked the agency&apos;s feed — adopt the smaller version anyway
            </button>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* The three doors                                                   */}
      {/* ---------------------------------------------------------------- */}

      {readOnly ? (
        <p className="module-note mt-5 text-sm">
          You have read-only access to this workspace, so you can see which feeds are loaded and search the public
          catalog, but not ingest one. An editor or owner can add a feed.
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="How to add a transit feed">
        <button
          type="button"
          role="tab"
          aria-selected={door === "catalog"}
          className="module-inline-item"
          onClick={() => setDoor("catalog")}
        >
          Search the feed catalog
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={door === "url"}
          className="module-inline-item"
          onClick={() => setDoor("url")}
        >
          Paste a feed address
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={door === "upload"}
          className="module-inline-item"
          onClick={() => setDoor("upload")}
        >
          Upload a GTFS .zip
        </button>
      </div>

      {door === "catalog" && (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Choose the area you are studying. OpenPlan searches a public transit feed catalog for operators whose
            own published service area covers it — the catalog does not know which agency is yours, so it offers
            candidates rather than picking one.
          </p>

          <StudyAreaPicker
            corridorText={corridorText}
            onCorridorChange={setCorridorText}
            onPlaceResolved={(place) => setPlaceLabel(place?.label ?? null)}
            showRunEngineHint={false}
            externalLabel={placeLabel}
          />

          <button
            type="button"
            className="module-inline-item"
            disabled={!bbox || searchForCurrentArea.status === "searching"}
            onClick={() => void runSearch()}
          >
            {searchForCurrentArea.status === "searching"
              ? "Searching the catalog…"
              : "Search the feed catalog for this area"}
          </button>
          {!bbox && (
            <p className="text-xs text-muted-foreground">
              Pick or draw an area first — the search is by geography and there is nothing to search without one.
            </p>
          )}

          {searchForCurrentArea.status === "error" && (
            <div className="module-note text-sm">
              <p className="font-semibold">The catalog search could not be completed.</p>
              <p className="mt-1 text-muted-foreground">{searchForCurrentArea.message}</p>
            </div>
          )}

          {searchForCurrentArea.status === "done" && (
            <CatalogOutcome
              body={searchForCurrentArea.body}
              readOnly={readOnly}
              busy={busy}
              onIngest={ingestFromCatalog}
            />
          )}
        </div>
      )}

      {door === "url" && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            If you already know where the agency publishes their GTFS, paste the address of the .zip. OpenPlan
            downloads it from the server, so an address only reachable inside your own network will be refused.
          </p>
          <label className="block text-sm">
            <span className="text-muted-foreground">GTFS feed address</span>
            <input
              type="url"
              className="mt-1 w-full rounded-[0.4rem] border px-3 py-2 text-sm"
              placeholder="https://example.org/gtfs.zip"
              value={feedUrl}
              onChange={(event) => setFeedUrl(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">What to call it until the feed names itself (optional)</span>
            <input
              type="text"
              className="mt-1 w-full rounded-[0.4rem] border px-3 py-2 text-sm"
              value={feedLabel}
              onChange={(event) => setFeedLabel(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="module-inline-item"
            disabled={readOnly || busy !== null || feedUrl.trim().length === 0}
            onClick={() => void ingestFromUrl()}
          >
            {busy === "url" ? "Fetching and reading the feed…" : "Fetch and read this feed"}
          </button>
        </div>
      )}

      {door === "upload" && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Upload the agency&apos;s GTFS archive directly. This is the door for a feed that is emailed, sits behind
            a login, or is not published on the open web at all. Up to{" "}
            {(maxUploadBytes / (1024 * 1024)).toFixed(0)} MB.
          </p>
          <input
            type="file"
            accept=".zip,application/zip"
            aria-label="GTFS archive"
            className="block text-sm"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <label className="block text-sm">
            <span className="text-muted-foreground">What to call it until the feed names itself (optional)</span>
            <input
              type="text"
              className="mt-1 w-full rounded-[0.4rem] border px-3 py-2 text-sm"
              value={uploadLabel}
              onChange={(event) => setUploadLabel(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="module-inline-item"
            disabled={readOnly || busy !== null || file === null}
            onClick={() => void ingestFromUpload()}
          >
            {busy === "upload" ? "Reading the archive…" : "Upload and read this archive"}
          </button>
        </div>
      )}
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/* The four catalog outcomes, each with its own shape                          */
/* -------------------------------------------------------------------------- */

function CatalogOutcome({
  body,
  readOnly,
  busy,
  onIngest,
}: {
  body: CatalogSearchBody;
  readOnly: boolean;
  busy: string | null;
  onIngest: (catalogId: string) => Promise<void>;
}) {
  if (body.status === "catalog_unavailable") {
    return (
      <div className="module-note text-sm" data-testid="catalog-outcome-catalog_unavailable">
        <p className="font-semibold">OpenPlan could not read the transit feed catalog.</p>
        <p className="mt-1 text-muted-foreground">{body.detail}</p>
        <p className="mt-1 text-muted-foreground">
          This is a statement about this deployment&apos;s own connection, and says NOTHING about whether transit
          serves your area. Try again shortly, or use the feed-address or upload door if you already know where the
          agency publishes.
        </p>
      </div>
    );
  }

  if (body.status === "covered_but_unusable") {
    /**
     * A WITHDRAWN ENTRY IS NOT AN UNINGESTABLE ONE, AND THIS BRANCH SAID IT WAS.
     *
     * The headline read "none of them can be ingested from the catalog" while
     * `describeWithheldReason("superseded")` — two paragraphs below it — said
     * the catalog "usually names a replacement, and OpenPlan follows that
     * redirect automatically when the entry is ingested". Both were on screen
     * at once, the stronger one was the headline, and no control was rendered
     * to settle it. `resolveGtfsCatalogRedirect` does follow the chain, so the
     * POST route can ingest exactly these entries; it refuses only when the
     * redirect leads nowhere, which is a 422 the planner reads afterwards.
     *
     * `requires_api_key` and `no_download_url` are genuinely different: there
     * is no address for this deployment to fetch, so they carry their
     * explanation and no button. The headline is qualified rather than dropped,
     * because "feeds cover this area" is still the fact that matters most.
     */
    const followable = body.withheld.filter((withheld) => withheld.reason === "superseded");

    return (
      <div className="module-note text-sm" data-testid="catalog-outcome-covered_but_unusable">
        <p className="font-semibold">
          {body.withheld.length} transit {body.withheld.length === 1 ? "feed covers" : "feeds cover"} this area, and
          the catalog did not offer {body.withheld.length === 1 ? "it" : "any of them"} directly.
        </p>
        <p className="mt-1 text-muted-foreground">
          Your area has transit. The catalog simply did not hand OpenPlan {body.withheld.length === 1 ? "this feed" : "these feeds"}, and each one has a
          different next step.
        </p>
        {followable.length > 0 && (
          <p className="mt-1 text-muted-foreground">
            {followable.length === 1 ? "One of them was" : `${followable.length} of them were`} withdrawn from the
            catalog rather than made unreachable. A withdrawn entry usually names its replacement and OpenPlan follows
            that redirect, so {followable.length === 1 ? "it" : "they"} can still be tried from here.
          </p>
        )}
        <ul className="mt-3 space-y-3">
          {body.withheld.map((withheld) => (
            <li key={`${withheld.entry.catalogId}-${withheld.reason}`}>
              <p className="font-semibold">{entryLabel(withheld.entry)}</p>
              <p className="text-muted-foreground">{entryPlace(withheld.entry)}</p>
              <p className="text-muted-foreground">{describeWithheldReason(withheld)}</p>
              {withheld.reason === "superseded" && (
                <button
                  type="button"
                  className="module-inline-item mt-2"
                  disabled={readOnly || busy !== null}
                  onClick={() => void onIngest(withheld.entry.catalogId)}
                >
                  {busy === `catalog:${withheld.entry.catalogId}`
                    ? "Following the catalog's redirect…"
                    : "Follow the catalog's redirect and ingest this feed"}
                </button>
              )}
            </li>
          ))}
        </ul>
        <Disclosure disclosure={body.disclosure} catalogUrl={body.catalogUrl} />
      </div>
    );
  }

  if (body.status === "no_covering_feed") {
    return (
      <div className="module-note text-sm" data-testid="catalog-outcome-no_covering_feed">
        <p className="font-semibold">Nothing in the catalog publishes a service area covering this area.</p>
        <p className="mt-1 text-muted-foreground">
          Every entry the catalog does place on a map was checked and none of their published service areas contain
          this area. That is the catalog&apos;s coverage, not a certainty about the ground: an operator who does not
          list their feed, or lists it without a service area, would not appear. If you know your agency publishes a
          GTFS feed, use the feed-address or upload door.
        </p>
        <Disclosure disclosure={body.disclosure} catalogUrl={body.catalogUrl} />
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="catalog-outcome-matched">
      <p className="text-sm font-semibold">
        {body.feeds.length} {body.feeds.length === 1 ? "feed publishes" : "feeds publish"} a service area covering
        this area.
      </p>
      <p className="text-sm text-muted-foreground">
        Smallest published service area first, because a feed drawn tightly around your area is more likely to be
        the local operator than a statewide one. Only you know which agency is yours.
      </p>
      <ul className="space-y-3">
        {body.feeds.map((ranked) => (
          <li key={ranked.entry.catalogId} className="module-subpanel">
            <p className="text-sm font-semibold">{entryLabel(ranked.entry)}</p>
            <p className="text-sm text-muted-foreground">{entryPlace(ranked.entry)}</p>
            <p className="text-xs text-muted-foreground">
              Published service area spans {ranked.serviceAreaSpread.toFixed(2)} square degrees.
            </p>
            <button
              type="button"
              className="module-inline-item mt-2"
              disabled={readOnly || busy !== null}
              onClick={() => void onIngest(ranked.entry.catalogId)}
            >
              {busy === `catalog:${ranked.entry.catalogId}` ? "Reading this feed…" : "Ingest this feed"}
            </button>
          </li>
        ))}
      </ul>
      <div className="module-note text-sm">
        <Disclosure disclosure={body.disclosure} catalogUrl={body.catalogUrl} />
      </div>
    </div>
  );
}

function Disclosure({ disclosure, catalogUrl }: { disclosure: CatalogDisclosure; catalogUrl: string }) {
  return (
    <details className="mt-3 text-sm text-muted-foreground" data-testid="catalog-disclosure">
      <summary className="cursor-pointer">What this search did not show you</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {disclosureLines(disclosure).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="mt-2 break-all">Catalog read from {catalogUrl}</p>
    </details>
  );
}
