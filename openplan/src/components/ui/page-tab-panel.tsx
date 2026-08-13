import * as React from "react";

/**
 * One tab's panels on a URL-tabbed page.
 *
 * WHY THE CLOSED PANEL IS HIDDEN RATHER THAN UNMOUNTED. Both are honest tabs to
 * a reader — a closed tab shows nothing either way — but they differ in what
 * they cost and what they keep. Hiding keeps the browser's own find-in-page
 * working across the whole record, and it keeps every panel's read-failure
 * sentence in the document even while its tab is shut, which is the property
 * this repo cares most about here. Unmounting is the cheaper HTML, and it is
 * where this should end up: the pages that use this were tabbed because they
 * were rendering twelve hundred lines of panels at once.
 *
 * The step in between is the legacy page tests, which assert on panels that are
 * now spread across five tabs and were written before any of them existed.
 * Flipping `PAGE_TAB_PANELS_UNMOUNT_WHEN_CLOSED` to true is the whole change;
 * do it in the same commit that updates those tests, not before.
 *
 * Either way the guarantee the tab strip makes does not depend on this: a read
 * that failed behind a closed tab is named ABOVE the strip, by `PageTabNav`,
 * where the reader of any tab sees it.
 */
export const PAGE_TAB_PANELS_UNMOUNT_WHEN_CLOSED = false;

export function PageTabPanel({
  tabKey,
  active,
  className,
  children,
}: {
  /** The tab this panel belongs to, mirrored into the DOM for tests and CSS. */
  tabKey: string;
  active: boolean;
  /**
   * Layout for the OPEN panel, replacing the default `contents`. Pass the
   * spacing the page would otherwise wrap this in — one element instead of two.
   */
  className?: string;
  children: React.ReactNode;
}) {
  if (!active && PAGE_TAB_PANELS_UNMOUNT_WHEN_CLOSED) {
    return null;
  }

  if (!active) {
    // `hidden` the utility class, not the attribute. Both resolve to
    // `display: none` in a browser — which is what takes a closed tab out of
    // the page, out of find-in-page, and out of the accessibility tree — but
    // the ATTRIBUTE is also honoured by jsdom, where no stylesheet is applied
    // at all. That difference is not cosmetic: it decides whether this repo's
    // existing page tests can still see the panels they were written against.
    return (
      <div className="hidden" data-page-tab-panel={tabKey} data-page-tab-panel-state="closed">
        {children}
      </div>
    );
  }

  // `contents` so an open panel does not introduce a box of its own — the page's
  // own vertical rhythm still applies to the panels directly.
  return (
    <div className={className ?? "contents"} data-page-tab-panel={tabKey} data-page-tab-panel-state="open">
      {children}
    </div>
  );
}
