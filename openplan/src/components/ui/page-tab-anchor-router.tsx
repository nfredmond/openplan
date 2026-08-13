"use client";

import * as React from "react";

import { PAGE_TAB_QUERY_KEY, pageTabForAnchor, type PageTabDefinition } from "@/lib/ui/page-tabs";

/**
 * Sends a fragment to the tab that contains it.
 *
 * A URL fragment is never transmitted to the server, so a tabbed page cannot
 * resolve `#project-invoices` while it renders — it can only find out on the
 * client, after landing on whichever tab the query string asked for. This
 * listens for that: on mount and on every later hash change, it resolves the
 * fragment against the page's own tab definitions and, when the anchor lives in
 * a different tab, navigates there with the fragment intact.
 *
 * WHY `location`, NOT `useRouter`. The navigation happens at most once per
 * arrival and only for cross-tab links, so a soft transition buys nothing worth
 * a dependency on `next/navigation` — whose hooks are, in this repo, the thing
 * that turns a narrowly-mocked page test into a crash. Assigning `location`
 * also hands the scroll back to the browser, which does it correctly for the
 * freshly rendered panel; the same-tab branch has to do that itself, because
 * the browser already tried and failed before React had mounted the target.
 */
export function PageTabAnchorRouter<Key extends string>({
  tabs,
  activeKey,
}: {
  tabs: readonly PageTabDefinition<Key>[];
  activeKey: Key;
}) {
  React.useEffect(() => {
    function settleHash() {
      const hash = window.location.hash.slice(1);
      if (!hash) return;

      const target = pageTabForAnchor(tabs, hash);
      if (target && target !== activeKey) {
        const url = new URL(window.location.href);
        url.searchParams.set(PAGE_TAB_QUERY_KEY, target);
        url.hash = hash;
        window.location.replace(url.toString());
        return;
      }

      document.getElementById(hash)?.scrollIntoView({ block: "start" });
    }

    settleHash();
    window.addEventListener("hashchange", settleHash);
    return () => window.removeEventListener("hashchange", settleHash);
  }, [tabs, activeKey]);

  return null;
}
