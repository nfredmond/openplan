"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/**
 * The campaign Setup tab's "Advanced" group: everything a planner does not need
 * to publish, collapsed until opened.
 *
 * It is still in the page, so every control in it stays reachable, and it opens
 * itself when the URL fragment names something inside it. The rest of the
 * product links here by anchor (`#public-share-controls`,
 * `#campaign-control-title`, a context layer's row), and a link that scrolls to
 * a closed disclosure lands on nothing. `PageTabAnchorRouter` has already put
 * the reader on the right tab by the time this runs; this only opens the group
 * and scrolls, on arrival and on every later hash change.
 *
 * `summary` names what is inside, so a planner looking for translations or the
 * RTP attachment can tell this is where they went.
 */
export function SetupAdvancedGroup({ summary, children }: { summary: string; children: ReactNode }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function openForHash() {
      const details = detailsRef.current;
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!details || !id) return;
      const target = document.getElementById(id);
      if (!target || !details.contains(target)) return;
      details.open = true;
      // jsdom has no scrollIntoView; a browser always does.
      target.scrollIntoView?.({ block: "start" });
    }

    openForHash();
    window.addEventListener("hashchange", openForHash);
    return () => window.removeEventListener("hashchange", openForHash);
  }, []);

  return (
    <details ref={detailsRef} className="group border-t border-border pt-6" data-testid="setup-advanced">
      <summary className="flex cursor-pointer list-none items-start gap-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition group-open:rotate-90"
        />
        <span className="min-w-0">
          <span className="block text-base font-semibold text-foreground">Advanced</span>
          <span className="block text-sm text-muted-foreground">{summary}</span>
        </span>
      </summary>
      <div className="mt-6 min-w-0 space-y-6">{children}</div>
    </details>
  );
}
