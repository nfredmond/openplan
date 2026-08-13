/**
 * Tabs whose state lives in the URL, for the detail pages that had grown to
 * render every panel of a record at once.
 *
 * WHY THE URL AND NOT COMPONENT STATE. The repo already has Radix `Tabs`
 * (`components/ui/tabs.tsx`), and three surfaces use it — but Radix keeps the
 * active tab in React state, which cannot be linked to. A planner who says
 * "look at the funding on this project" has to be able to send the funding tab,
 * not the page plus an instruction. So the active tab is a query parameter,
 * the triggers are links, and the panels are chosen on the server. The visual
 * language (`module-tabs-list`, `module-tab-trigger`) is shared with the Radix
 * surfaces so the two read as one control.
 *
 * WHY ANCHORS ARE DECLARED HERE. Every tab hides part of a page that used to be
 * one scroll, and the repo is full of links into that scroll:
 * `/projects/${id}#project-invoices` appears in the assistant quick links, the
 * workspace command board, and the operations summary. A fragment is never sent
 * to the server, so the tab it belongs to cannot be resolved during rendering —
 * the client resolves it on arrival and switches tabs. That only works if every
 * anchor is claimed by exactly one tab, which is why `anchors`/`anchorPrefixes`
 * are part of the tab definition and why `page-tabs-anchor-coverage` walks the
 * repo's own links to prove nothing was missed.
 */

/** The query parameter every tabbed page uses. One name, so links compose. */
export const PAGE_TAB_QUERY_KEY = "tab";

export type PageTabDefinition<Key extends string = string> = {
  key: Key;
  /** The tab's name, as a planner reads it. */
  label: string;
  /**
   * Exact anchor ids rendered inside this tab's panels. A deep link to one of
   * these opens this tab.
   */
  anchors?: readonly string[];
  /**
   * Anchor id prefixes for the per-row anchors a panel generates
   * (`project-invoice-<uuid>`). Matched only when longer than the prefix, so a
   * prefix never silently claims an exact anchor belonging to another tab.
   */
  anchorPrefixes?: readonly string[];
  /**
   * Reads that FAILED inside this tab, in the planner's words and plural
   * ("funding awards", "risks"). Present so a failure inside a closed tab is
   * still announced: a tab that could not be read must never be
   * indistinguishable from a tab nobody opened. Empty or absent means every
   * read behind this tab succeeded.
   */
  unreadable?: readonly string[];
};

/**
 * The tab a request is asking for.
 *
 * Anything unrecognised — a stale link, a typo, a missing parameter — resolves
 * to `fallback` rather than to an empty page. `requested` takes the raw
 * searchParams value, which Next types as `string | string[] | undefined`.
 */
export function resolvePageTab<Key extends string>(
  tabs: readonly PageTabDefinition<Key>[],
  requested: string | string[] | undefined,
  fallback: Key,
): Key {
  const raw = Array.isArray(requested) ? requested[0] : requested;
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  const match = tabs.find((tab) => tab.key === trimmed);
  return match ? match.key : fallback;
}

/**
 * The tab that contains `anchorId`, or null when no tab claims it.
 *
 * Exact declarations win over prefixes, so a tab may declare
 * `project-invoices` while another declares the `project-invoice-` prefix
 * without the two fighting.
 */
export function pageTabForAnchor<Key extends string>(
  tabs: readonly PageTabDefinition<Key>[],
  anchorId: string,
  pageAnchors: readonly string[] = [],
): Key | null {
  const id = anchorId.replace(/^#/, "").trim();
  if (!id) return null;

  // Page-level chrome first, and it answers "no tab" rather than a tab. An
  // element rendered ABOVE the strip is on screen whatever tab is open, so
  // claiming it for one tab means arriving at `?tab=history#report-controls`
  // silently throws away the tab the reader asked for and lands them on the
  // claimant. Checked before the prefixes because a broad prefix (`report-`)
  // will otherwise sweep the header's ids back into a tab.
  if (pageAnchors.includes(id)) return null;

  const exact = tabs.find((tab) => tab.anchors?.includes(id));
  if (exact) return exact.key;

  const prefixed = tabs.find((tab) =>
    tab.anchorPrefixes?.some((prefix) => id.startsWith(prefix) && id.length > prefix.length),
  );
  return prefixed ? prefixed.key : null;
}

/**
 * The href for a tab, preserving every other query parameter the reader arrived
 * with (`backTo`, a filter, a preview token) and dropping only the tab key.
 */
export function pageTabHref(pathname: string, key: string, currentSearch?: URLSearchParams | string): string {
  const params = new URLSearchParams(
    typeof currentSearch === "string" ? currentSearch : currentSearch ? currentSearch.toString() : "",
  );
  params.set(PAGE_TAB_QUERY_KEY, key);
  return `${pathname}?${params.toString()}`;
}

/**
 * The sentence a page shows above its tab bar when a read failed behind a tab
 * that may well be closed, or null when everything loaded.
 *
 * This is the tabbed form of the repo's read-failure rule
 * (`lib/ui/read-failures.ts`): a failed read may not be rendered as an answer.
 * Tabs add a second way to break it — the panel that would have disclosed the
 * failure is not on screen at all, so an unopened tab and a broken one look
 * identical. Naming the tab and the lane from OUTSIDE the tab strip is the only
 * placement a reader of any tab is guaranteed to see.
 */
export function describeUnreadableTabs<Key extends string>(
  tabs: readonly PageTabDefinition<Key>[],
): string | null {
  const failing = tabs.filter((tab) => (tab.unreadable?.length ?? 0) > 0);
  if (failing.length === 0) return null;

  const clauses = failing.map((tab) => {
    const labels = tab.unreadable as readonly string[];
    const listed =
      labels.length === 1
        ? labels[0]
        : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
    return `${tab.label} — ${listed}`;
  });

  return (
    `Reads that failed behind a tab: ${clauses.join("; ")}. ` +
    `Open ${failing.length === 1 ? "that tab" : "those tabs"} for the detail, and read anything ` +
    "empty there as unavailable rather than as a record that does not exist."
  );
}

/** True when this tab has at least one failed read behind it. */
export function pageTabHasUnreadable(tab: PageTabDefinition<string>): boolean {
  return (tab.unreadable?.length ?? 0) > 0;
}

/**
 * Builds the `unreadable` list from the flags a page already computes.
 *
 * Pages carry read failures as a pile of booleans (`fundingAwardsReadFailed`,
 * `risksReadFailed`); this turns those into the tab's disclosure without each
 * page inventing its own filter.
 */
export function unreadableLanes(
  lanes: ReadonlyArray<readonly [label: string, failed: boolean]>,
): string[] {
  return lanes.filter(([, failed]) => failed).map(([label]) => label);
}
