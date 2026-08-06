/**
 * WHAT THE DATA HUB MAY SAY ABOUT THIS WORKSPACE'S TRANSIT FEEDS.
 *
 * THE DEFECT THIS REPLACES. The Data Hub's "Foundation sources" panel carried a
 * card reading "GTFS uploads — Transit feed storage already exists in the
 * current architecture and can fold into this registry", inside an array named
 * `liveFoundations` and rendered under the heading "Visible system component".
 * A planner reads that and concludes they can bring their agency's feed in
 * today. They cannot: there is no upload route, no ingest worker, no parser and
 * no writer anywhere in `src/`. Nine GTFS tables have existed since migration
 * `20260219000001_gtfs_schema.sql` and not one line of application code reads or
 * writes any of them. The card described a SCHEMA as though it were a FEATURE,
 * which is the most expensive kind of wrong an honest product can be — it costs
 * the reader a search for a button that was never built.
 *
 * So this module says only what a read of `gtfs_feeds` supports, and it
 * distinguishes the three answers that a card of this kind always confuses:
 * the question failed, the answer is none, the answer is a feed.
 *
 * A FAILED READ IS NOT AN EMPTY ONE. `data ?? []` collapses them, and the
 * collapsed version reads as "this workspace has no transit feed" — a statement
 * about the agency's own data, made on the strength of a question the database
 * never answered. Callers pass `readFailed` and get a card that declines to
 * claim anything.
 *
 * NO I/O HERE ON PURPOSE. The page owns the query (and its `workspace_id`
 * scope); this owns the wording. That split is what lets the wording be tested
 * without a database and lets the projection be asserted without a renderer.
 *
 * ============================== WHAT CHANGED WHEN THE INGEST LANE WAS BUILT
 *
 * The no-feed branch used to end "OpenPlan does not have a feed upload path
 * yet, so this is the expected state rather than a setup step you have missed."
 * That sentence was true when it was written and became a LIE the moment
 * `/api/gtfs/feeds`, `/api/gtfs/feeds/upload` and `/api/gtfs/catalog/search`
 * shipped — and it is the more expensive direction of wrong, because it talks a
 * planner out of looking for a control that is now on the same page. It now
 * names the three doors.
 *
 * AND THE SAME RULE APPLIES TO THE SECOND TABLE, WHICH IS WHERE IT WAS BROKEN.
 * The caller threaded `readFailed` from the `gtfs_feeds` read only, and
 * collapsed the `gtfs_feed_versions` rows with `data ?? []`. So a failed
 * VERSION read produced "No ingest of this feed has been adopted yet" beside a
 * green "loaded" badge, and the expired-schedule warning simply vanished — the
 * exact defect this module was written to prevent, one table over, and in the
 * reassuring direction. `versionReadFailed` is its own flag with its own
 * sentence and its own tone, because an unread version is neither an absent one
 * nor a current one.
 *
 * AND THE CARD LEARNED TO SAY WHETHER THE SCHEDULE IS STILL IN EFFECT. A GTFS
 * feed states the window its schedule covers, and that window EXPIRES — three of
 * the four real Sacramento-area catalog feeds measured on 2026-08-05 had ended,
 * SacRT's on 2025-04-05, sixteen months earlier. Expiry is the NORMAL case, not
 * an edge case. A card that reports "loaded" over a schedule that stopped a year
 * ago is reporting on the ingest and letting the reader infer the service, so
 * `describeGtfsServiceWindow` states the window and its state in one place that
 * both this card and the ingest panel read.
 */

/** The tones the Data Hub's `StatusBadge` accepts. Kept narrow deliberately. */
export type TransitFeedRegistryTone = "info" | "success" | "warning" | "neutral";

/**
 * The `gtfs_feeds` columns this card reads.
 *
 * `workspace_id` is here even though the caller filters on it, and that is the
 * point — see `describeTransitFeedRegistry`. Every field is nullable except the
 * id because the table imposes almost nothing: `status` carries a default and
 * no CHECK, and `loaded_at` stays null until something loads the feed, which at
 * present nothing does.
 */
export type TransitFeedRow = {
  id: string;
  workspace_id: string | null;
  agency_name: string | null;
  status: string | null;
  loaded_at: string | null;
};

/**
 * The `gtfs_feed_versions` columns this card reads off the version a workspace
 * actually analyses with (`is_current AND status = 'ready'` — see
 * `filterToCurrentReadyVersion`, which is the one expression of that predicate).
 *
 * `service_end_date` is the reason this type exists. Everything else here is
 * context for it.
 */
export type TransitFeedVersionRow = {
  feed_id: string;
  workspace_id: string | null;
  service_start_date: string | null;
  service_end_date: string | null;
  route_service_level_rows: number | null;
  stop_service_level_rows: number | null;
};

/**
 * What a feed's stated service window is doing relative to a given day.
 *
 * `unstated` is a fourth case and not a variant of `current`: a feed that
 * publishes no `calendar.txt` end date has told us nothing, and answering
 * "still in effect" from silence is the same class of error as reporting a
 * failed read as an empty one.
 */
export type GtfsServiceWindowState = "unstated" | "expired" | "current" | "not_started";

export type GtfsServiceWindowDescription = {
  state: GtfsServiceWindowState;
  /** One sentence, safe to print beside a headway. */
  text: string;
};

/** Is this a `YYYY-MM-DD` calendar date, the shape a Postgres DATE comes back as? */
function isIsoDate(value: string | null | undefined): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test((value ?? "").trim());
}

/** Whole days between two `YYYY-MM-DD` dates, or null if either is unreadable. */
function daysBetweenIsoDates(from: string, to: string): number | null {
  const parse = (value: string): number | null => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const stamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isFinite(stamp) ? stamp : null;
  };
  const start = parse(from);
  const end = parse(to);
  if (start === null || end === null) return null;
  return Math.round((end - start) / 86_400_000);
}

/**
 * "16 months ago" / "9 days ago", from a whole-day count.
 *
 * Deliberately coarse above a month. The precision a planner needs from an
 * expired feed is the order of magnitude — last week versus last year — and a
 * day count in the hundreds is arithmetic the reader has to do themselves.
 */
function describeElapsed(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 45) return `${days} days ago`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${months} months ago`;
  return `${Math.round(days / 365.25)} years ago`;
}

/**
 * WHETHER THE SCHEDULE THIS FEED DESCRIBES IS STILL RUNNING.
 *
 * Pure, and shared by the Data Hub card and the ingest panel, because expiry is
 * exactly the fact two surfaces would otherwise word differently — and the
 * weaker wording is the one a planner would quote. Dates are compared as
 * `YYYY-MM-DD` STRINGS: they are DATE columns with no time zone, and parsing
 * them into `Date` objects introduces a local-midnight offset that can move an
 * end date across a day boundary for readers on either side of UTC.
 */
export function describeGtfsServiceWindow(input: {
  startDate: string | null;
  endDate: string | null;
  /** The day to judge against, as `YYYY-MM-DD`. Passed in, never read from a clock. */
  today: string;
}): GtfsServiceWindowDescription {
  const start = isIsoDate(input.startDate) ? (input.startDate as string).trim() : null;
  const end = isIsoDate(input.endDate) ? (input.endDate as string).trim() : null;

  if (!end) {
    /**
     * A MALFORMED END DATE LANDS HERE TOO, AND THAT IS THE POINT.
     *
     * These are compared as strings, so `"not-a-date" < "2026-08-05"` is FALSE
     * and an unreadable value would otherwise fall through to "in effect
     * today" — a claim about current service manufactured out of garbage, in
     * the reassuring direction. Anything that is not a `YYYY-MM-DD` is an
     * unknown, and an unknown is what gets said.
     */
    return {
      state: "unstated",
      text:
        "This feed states no readable service end date, so OpenPlan cannot say whether its schedule is still in " +
        "effect. Check the date the agency published it before citing anything derived from it.",
    };
  }

  const span = start ? `${start} to ${end}` : `an unstated start date to ${end}`;

  if (end < input.today) {
    const days = daysBetweenIsoDates(end, input.today);
    const ago = days === null ? "before today" : describeElapsed(days);
    return {
      state: "expired",
      text:
        `Service window ${span} — that schedule ENDED ${ago}. These are historic service levels, ` +
        "not the service running today. Ingest the agency's current feed before using them.",
    };
  }

  if (start && start > input.today) {
    return {
      state: "not_started",
      text: `Service window ${span} — this schedule has not started yet, so it describes planned service rather than today's.`,
    };
  }

  return {
    state: "current",
    text: `Service window ${span} — in effect today.`,
  };
}

export type TransitFeedRegistryState =
  /** The registry could not be read. Nothing is claimed about feeds. */
  | "read-failed"
  /** The read succeeded and this workspace owns no feed. The true state today. */
  | "no-feed"
  /** The read succeeded and at least one feed belongs to this workspace. */
  | "feed-present";

export type TransitFeedRegistryCard = {
  label: string;
  detail: string;
  tone: TransitFeedRegistryTone;
  state: TransitFeedRegistryState;
};

/**
 * What a loaded feed makes possible.
 *
 * WAS A CONDITIONAL, IS NOW A CAPABILITY, and the change is load-bearing rather
 * than cosmetic. "would" was correct while nothing could ingest a feed; leaving
 * it in place once the ingest lane shipped would describe working software as
 * hypothetical, which sends a planner looking elsewhere for something that is on
 * this page. The claim is still bounded to what the lane actually derives —
 * SERVICE LEVELS, never a timetable (see `caveats.ts`).
 */
const WHAT_A_FEED_UNLOCKS =
  "A loaded feed gives this workspace its own routes and stops to map, and lets transit access be measured " +
  "from the agency's own published service rather than proxied from OpenStreetMap.";

/**
 * The three doors, named. A planner who is told a capability exists and not
 * where it is has been told nothing they can act on.
 */
const HOW_TO_INGEST_A_FEED =
  "Add one in the transit feed panel on this page: search the public feed catalog for the area you are " +
  "studying, paste an operator's GTFS address, or upload a GTFS .zip.";

/**
 * Feed statuses whose wording is known. Anything else is passed through as the
 * operator wrote it — the column is unconstrained TEXT, so inventing a
 * vocabulary here would misreport values the database happily stores.
 */
function toneForFeedStatus(status: string | null): TransitFeedRegistryTone {
  const normalized = (status ?? "").trim().toLowerCase();
  if (normalized === "loaded" || normalized === "ready" || normalized === "active") return "success";
  if (normalized === "error" || normalized === "failed") return "warning";
  if (normalized === "pending" || normalized === "queued" || normalized === "processing") return "info";
  return "neutral";
}

function describeFeedStatus(status: string | null): string {
  const trimmed = (status ?? "").trim();
  return trimmed.length > 0 ? trimmed : "no recorded status";
}

export function describeTransitFeedRegistry(input: {
  /**
   * The workspace whose feeds this card speaks for.
   *
   * WHY THE HELPER FILTERS AGAIN even though the caller already did.
   * `gtfs_feeds.workspace_id` is NULLABLE, and the migration states what a null
   * means: a PUBLIC preloaded feed, shared by every deployment. A dropped or
   * mistyped `.eq("workspace_id", …)` would therefore not fail loudly — it would
   * quietly hand this workspace somebody else's agency name and present it as
   * their own ingested feed. Re-checking here makes that misattribution
   * impossible rather than merely unlikely, and costs one comparison.
   */
  workspaceId: string;
  /** True when the `gtfs_feeds` read errored. See the module comment. */
  readFailed: boolean;
  /** Rows from `gtfs_feeds`. Ignored entirely when `readFailed`. */
  feeds: readonly TransitFeedRow[];
  /**
   * The `is_current AND ready` version rows, keyed to their feeds.
   *
   * Separate from `feeds` because they are a separate table and a separate
   * read: a feed row can exist with no adopted version (every ingest failed, or
   * one is still running), and that is a different sentence from a feed whose
   * schedule expired.
   */
  currentVersions?: readonly TransitFeedVersionRow[];
  /**
   * True when the `gtfs_feed_versions` read errored.
   *
   * SEPARATE FROM `readFailed` ON PURPOSE. The feed read can succeed while the
   * version read fails — different table, different policy, different
   * statement — and the two failures produce different sentences. Passing the
   * feed's flag for both would report a workspace WITH a feed as having none;
   * passing neither reports an unknown schedule as an unadopted one.
   */
  versionReadFailed?: boolean;
  /** The day expiry is judged against, as `YYYY-MM-DD`. See `describeGtfsServiceWindow`. */
  today?: string;
  /** The caller's own timestamp formatter, so this module stays locale-free. */
  formatTimestamp: (value: string | null) => string;
}): TransitFeedRegistryCard {
  const label = "Transit feeds (GTFS)";

  if (input.readFailed) {
    return {
      label,
      tone: "warning",
      state: "read-failed",
      detail:
        "The transit feed registry could not be read, so nothing here states whether this workspace has a feed. " +
        "A question the database did not answer is not the same as an answer of none.",
    };
  }

  const ownFeeds = input.feeds.filter((feed) => feed.workspace_id === input.workspaceId);

  if (ownFeeds.length === 0) {
    return {
      label,
      tone: "neutral",
      state: "no-feed",
      detail:
        `No transit feed has been ingested for this workspace yet. ${HOW_TO_INGEST_A_FEED} ` +
        WHAT_A_FEED_UNLOCKS,
    };
  }

  // Most recently loaded first; a feed that has never been loaded sorts last,
  // because `loaded_at` is null until something loads it and nothing does yet.
  const sorted = [...ownFeeds].sort((a, b) => (b.loaded_at ?? "").localeCompare(a.loaded_at ?? ""));
  const lead = sorted[0];
  const agencyName = (lead.agency_name ?? "").trim() || "an unnamed agency";
  const others =
    ownFeeds.length > 1
      ? ` ${ownFeeds.length - 1} other feed${ownFeeds.length - 1 === 1 ? " is" : "s are"} registered for this workspace.`
      : "";

  /**
   * THE SERVICE WINDOW IS PART OF THE SENTENCE, NOT A DETAIL BELOW IT.
   *
   * `status = 'loaded'` describes the INGEST. It says nothing about whether the
   * schedule inside the feed is still running, and on real catalog feeds it
   * usually is not. Printing the ingest status alone leaves the reader to infer
   * the service, which is the inference this module exists to stop.
   *
   * The version is matched on BOTH ids. `gtfs_feed_versions.workspace_id` is
   * nullable for the same reason the feed's is — a public preloaded feed — so
   * matching on `feed_id` alone would let a public version's window be printed
   * under this workspace's feed.
   */
  const leadVersion = (input.currentVersions ?? []).find(
    (version) => version.feed_id === lead.id && version.workspace_id === input.workspaceId
  );
  const window =
    leadVersion && input.today
      ? describeGtfsServiceWindow({
          startDate: leadVersion.service_start_date,
          endDate: leadVersion.service_end_date,
          today: input.today,
        })
      : null;

  /**
   * A VERSION READ THAT FAILED IS NOT A FEED WITH NO ADOPTED VERSION.
   *
   * This is checked before the rows are consulted at all, because when the read
   * failed there are no rows — `data ?? []` hands this function an empty array
   * that is indistinguishable from a workspace whose ingests have all failed.
   * The answer must not be either of the two sentences below: not the adopted-
   * nothing one, which is a claim about this feed's ingests, and certainly not
   * a service window, which there is nothing to compute one from.
   */
  const versionReadFailed = Boolean(input.versionReadFailed);

  // An expired schedule outranks a green ingest. "loaded" over service that
  // stopped a year ago is the reassuring half of a two-part fact — and so is
  // "loaded" over a schedule nobody could read the dates of.
  const tone: TransitFeedRegistryTone = versionReadFailed
    ? "warning"
    : window?.state === "expired"
      ? "warning"
      : toneForFeedStatus(lead.status);

  const serviceSentence = versionReadFailed
    ? " The adopted version of this feed could not be read, so nothing here says whether this schedule is still in " +
      "effect. That is a question the database did not answer, not an answer that no ingest has been adopted."
    : leadVersion
      ? window
        ? ` ${window.text}`
        : ""
      : " No ingest of this feed has been adopted yet, so it derives no service levels.";

  return {
    label,
    tone,
    state: "feed-present",
    detail:
      `${agencyName} — ${describeFeedStatus(lead.status)}, ` +
      `${lead.loaded_at ? `loaded ${input.formatTimestamp(lead.loaded_at)}` : "not loaded yet"}.` +
      `${serviceSentence}${others}`,
  };
}
