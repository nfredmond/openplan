"use client";

import * as React from "react";

/**
 * One tab's panels on a URL-tabbed page, inside a React `Activity` boundary.
 *
 * A closed tab is left out of the server's HTML, so a record page no longer
 * ships every tab on every load. Once the page is running, React renders the
 * closed tab hidden and keeps it: anything a planner typed into a form survives
 * switching to another tab and back, as it did when closed tabs were hidden
 * with `display: none`. Effects in a closed tab do not run, so a map in a tab
 * nobody has opened is never started.
 *
 * A read that failed behind a closed tab is still named ABOVE the strip, by
 * `PageTabNav`, where the reader of any tab sees it. That guarantee does not
 * depend on the closed panel being in the document.
 */
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
  return (
    <React.Activity mode={active ? "visible" : "hidden"}>
      <div
        className={className ?? "contents"}
        data-page-tab-panel={tabKey}
        data-page-tab-panel-state={active ? "open" : "closed"}
      >
        {children}
      </div>
    </React.Activity>
  );
}
