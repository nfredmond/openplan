import * as React from "react";

/**
 * Test stand-in for `PageTabPanel` that renders the open tab and nothing else.
 *
 * The real panel wraps each tab in React's `Activity`, which in jsdom renders a
 * closed tab hidden but present. A page test that looks for text with
 * `getByText` would then find it on whichever tab it opened, so pointing a test
 * at the wrong tab would still pass. With this stand-in, a page test passes only
 * when it opens the tab that holds what it checks. The real panel's hiding,
 * server omission and draft keeping are tested in
 * `page-tabs-nav-and-panels.test.tsx`.
 *
 * Use it from a page test with:
 * `vi.mock("@/components/ui/page-tab-panel", () => import("@/test/helpers/open-tab-only"));`
 */
export function PageTabPanel({
  tabKey,
  active,
  className,
  children,
}: {
  tabKey: string;
  active: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  if (!active) return null;
  return (
    <div className={className ?? "contents"} data-page-tab-panel={tabKey} data-page-tab-panel-state="open">
      {children}
    </div>
  );
}
