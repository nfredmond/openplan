"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * "As of when" for a server-rendered job list, plus the only honest way to move
 * it forward.
 *
 * WHY THIS EXISTS AT ALL. The mission page is a server component: what it shows
 * is a snapshot taken when the request was served. A planner watching a running
 * job would otherwise sit in front of a frozen page reading it as live — which
 * is the same defect class as an unread table, arriving a different way. So the
 * page states the moment it was rendered, in words, and offers a way to re-read.
 *
 * WHY `router.refresh()` RATHER THAN POLLING AN API. There is no client-readable
 * jobs endpoint, and inventing one would duplicate the page's own workspace and
 * membership checks in a second place. `router.refresh()` re-runs the server
 * component through the exact same authorization path, so this control can never
 * show a viewer something the page would not.
 *
 * WHY AUTO-REFRESH IS CONDITIONAL. It runs only while at least one job could
 * still receive a callback, and it stops while the tab is hidden. A finished
 * mission does not re-fetch itself forever, and the interval is stated on screen
 * rather than being invisible behavior.
 */

/** Deliberately gentle: a worker callback lands when it lands, and this is a
 *  full server re-render, not a cheap JSON poll. */
const AUTO_REFRESH_INTERVAL_MS = 20_000;

function formatClock(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "an unknown time";
  return parsed.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export function AerialProcessingFreshness({
  renderedAt,
  hasOpenJob,
}: {
  /** ISO timestamp captured by the server on this render. */
  renderedAt: string;
  /** True while a job might still produce a callback. */
  hasOpenJob: boolean;
}) {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);
  /**
   * null = the reader has not chosen, so the default applies. Stored as a
   * choice rather than as a boolean seeded from `hasOpenJob` because
   * `router.refresh()` re-renders this same instance: a boolean seeded once
   * would keep the value from the FIRST render, so a mission that had no open
   * job when the page loaded and has one now would sit with auto-refresh
   * silently off while offering a ticked-looking control.
   */
  const [autoRefreshChoice, setAutoRefreshChoice] = useState<boolean | null>(null);
  const autoRefresh = autoRefreshChoice ?? true;
  const isAutoRefreshing = hasOpenJob && autoRefresh;
  const autoRefreshSeconds = Math.round(AUTO_REFRESH_INTERVAL_MS / 1000);

  const refresh = useCallback(() => {
    setIsRefreshing(true);
    router.refresh();
    // The refresh resolves by replacing this tree; the flag is cleared on a
    // timer so the control does not sit disabled if nothing changed.
    window.setTimeout(() => setIsRefreshing(false), 1200);
  }, [router]);

  useEffect(() => {
    if (!isAutoRefreshing) return;

    const interval = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      router.refresh();
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [isAutoRefreshing, router]);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
      {/*
        The sentence has to match what the page is actually doing. It used to
        say "does not update on its own" unconditionally while auto-refresh was
        ON BY DEFAULT for any mission with an open job — the page contradicting
        itself about its own freshness is the same class of untruth as a stale
        number, and it is the one a reader has no way to check.
      */}
      <span>
        Read from the database at {formatClock(renderedAt)}.{" "}
        {isAutoRefreshing
          ? `It re-reads itself every ${autoRefreshSeconds} seconds while a job is open, and pauses while this tab is hidden.`
          : "This page does not update on its own."}
      </span>
      <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={isRefreshing}>
        <RefreshCw className={isRefreshing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
        {isRefreshing ? "Re-reading…" : "Check for updates"}
      </Button>
      {hasOpenJob ? (
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(event) => setAutoRefreshChoice(event.target.checked)}
          />
          Re-read every {autoRefreshSeconds} seconds while a job is open
        </label>
      ) : null}
    </div>
  );
}
