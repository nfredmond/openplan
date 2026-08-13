import * as React from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { StateBlock } from "@/components/ui/state-block";
import { PageTabAnchorRouter } from "@/components/ui/page-tab-anchor-router";
import { cn } from "@/lib/utils";
import {
  describeUnreadableTabs,
  pageTabHasUnreadable,
  pageTabHref,
  type PageTabDefinition,
} from "@/lib/ui/page-tabs";

/**
 * The tab strip for a URL-tabbed detail page, plus the two things a tab strip
 * on this repo's pages must not ship without.
 *
 * 1. FRAGMENTS OPEN THEIR TAB. A fragment never reaches the server, so a link
 *    like `/projects/<id>#project-invoices` would land on the default tab with
 *    its target unrendered. `PageTabAnchorRouter` resolves the fragment on the
 *    client and sends the reader to the tab that declares it.
 * 2. A CLOSED TAB THAT FAILED TO READ SAYS SO. Every failing tab is marked in
 *    the strip and named in a notice above it, because the panel that would
 *    have disclosed the failure is not rendered while its tab is closed.
 *
 * A SERVER COMPONENT ON PURPOSE. The href of every trigger is knowable during
 * rendering — the page already has `searchParams` — so nothing here needs
 * `usePathname`/`useSearchParams`. Keeping the strip on the server also keeps
 * it out of the way of the page tests, which render these server components
 * directly against a narrow `next/navigation` mock; a hook the mock does not
 * export takes the whole page down rather than the one control that used it.
 */
export function PageTabNav<Key extends string>({
  tabs,
  activeKey,
  basePath,
  searchParams,
  ariaLabel,
  pageAnchors,
  className,
}: {
  tabs: readonly PageTabDefinition<Key>[];
  activeKey: Key;
  /** The page's own path — `/projects/<id>`, never a hardcoded route. */
  basePath: string;
  /**
   * Everything else in the query string, preserved across a tab change so a
   * reader does not lose a `backTo` or a filter by clicking a tab.
   */
  searchParams?: Record<string, string | string[] | undefined>;
  /** Names what is being tabbed, for screen readers: "Project sections". */
  ariaLabel: string;
  /**
   * Anchor ids the page renders ABOVE this strip, on chrome that is visible
   * whichever tab is open. Declaring them here is how a deep link to one stops
   * being a tab switch: `pageTabForAnchor` answers "no tab" for them, so the
   * router scrolls and leaves the requested tab alone.
   */
  pageAnchors?: readonly string[];
  className?: string;
}) {
  const carried = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (typeof value === "string") carried.set(key, value);
    else if (Array.isArray(value) && typeof value[0] === "string") carried.set(key, value[0]);
  }

  const unreadableSentence = describeUnreadableTabs(tabs);

  return (
    <div className={cn("space-y-3", className)}>
      {unreadableSentence ? (
        <StateBlock
          tone="danger"
          compact
          title="Part of this record could not be read"
          description={unreadableSentence}
          testId="page-tabs-unreadable-notice"
        />
      ) : null}

      <nav aria-label={ariaLabel} className="module-tabs-list inline-flex items-center" data-testid="page-tabs-nav">
        {tabs.map((tab) => {
          const isActive = tab.key === activeKey;
          const failed = pageTabHasUnreadable(tab);
          return (
            <Link
              key={tab.key}
              href={pageTabHref(basePath, tab.key, carried)}
              data-state={isActive ? "active" : "inactive"}
              data-page-tab={tab.key}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "module-tab-trigger inline-flex items-center whitespace-nowrap text-sm font-medium transition",
                isActive ? "text-foreground" : "text-foreground/60 hover:text-foreground",
              )}
            >
              {tab.label}
              {failed ? (
                <span
                  className="inline-flex items-center gap-1 text-destructive"
                  data-testid={`page-tab-unreadable-${tab.key}`}
                >
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="sr-only">could not be fully read</span>
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <PageTabAnchorRouter tabs={tabs} activeKey={activeKey} pageAnchors={pageAnchors} />
    </div>
  );
}
