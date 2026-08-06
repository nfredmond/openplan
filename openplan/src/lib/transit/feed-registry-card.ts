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
 * What a loaded feed would make possible, stated as a conditional rather than
 * as a capability. The distinction is the entire fix: "would" describes work
 * not yet built, "can" described work that does not exist.
 */
const WHAT_A_FEED_WOULD_UNLOCK =
  "A loaded feed would give this workspace its own routes and stops to map, and would let transit access be " +
  "measured from the agency's own service rather than proxied from OpenStreetMap.";

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
        "No transit feed has been ingested for this workspace. OpenPlan does not have a feed upload path yet, " +
        `so this is the expected state rather than a setup step you have missed. ${WHAT_A_FEED_WOULD_UNLOCK}`,
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

  return {
    label,
    tone: toneForFeedStatus(lead.status),
    state: "feed-present",
    detail:
      `${agencyName} — ${describeFeedStatus(lead.status)}, ` +
      `${lead.loaded_at ? `loaded ${input.formatTimestamp(lead.loaded_at)}` : "not loaded yet"}.${others}`,
  };
}
