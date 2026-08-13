import { FileClock } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { fmtDateTime } from "./_helpers";
import type { TimelineItem } from "./_types";

/**
 * The project's one activity feed, lifted out of the evidence panel so it sits
 * with the record it summarises — the risks, issues, decisions and meetings it
 * is largely built from — rather than under the aerial missions.
 *
 * The feed itself is unchanged: same ordering (the page still builds it with
 * `buildProjectTimelineItems`), same empty sentence, same two-column grid.
 */
export function ProjectActivityTimeline({ timelineItems }: { timelineItems: TimelineItem[] }) {
  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-amber-500/10 text-amber-700 dark:text-amber-300">
            <FileClock className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">Activity timeline</p>
            <h2 className="module-section-title">Everything happening in one feed</h2>
            <p className="module-section-description">
              The feed is intentionally tighter than the page intro: type first, timestamp second, short read after that.
            </p>
          </div>
        </div>
      </div>
      {timelineItems.length === 0 ? (
        <div className="module-empty-state mt-5 text-sm">No project activity yet.</div>
      ) : (
        <div className="mt-5 grid gap-3 xl:grid-cols-2">
          {timelineItems.map((item) => (
            <div key={item.id} className="module-record-row">
              <div className="module-record-main">
                <div className="module-record-kicker">
                  <StatusBadge tone={item.tone}>{item.badge}</StatusBadge>
                </div>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h3 className="module-record-title">{item.title}</h3>
                    <p className="module-record-stamp">{fmtDateTime(item.at)}</p>
                  </div>
                  <p className="module-record-summary">{item.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
