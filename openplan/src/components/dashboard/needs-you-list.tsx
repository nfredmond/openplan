import Link from "next/link";

import type { NeedsYouItem } from "@/lib/dashboard/coming-up";

/**
 * Needs you: work with no date that is waiting on someone here. Blocked
 * projects come first, then reviews, then the workspace's next steps. A source
 * that could not be read is named in the list, so a failed read never looks
 * like a clear desk.
 */
export function NeedsYouList({
  items,
  limit,
  failedSentence,
  incompleteSentence,
  moreHref,
}: {
  items: readonly NeedsYouItem[];
  limit: number;
  failedSentence: string | null;
  incompleteSentence: string | null;
  moreHref: string;
}) {
  const shown = items.slice(0, limit);
  const remaining = items.length - shown.length;

  return (
    <section className="dashboard-panel" aria-labelledby="dashboard-needs-you">
      <header className="dashboard-panel-header">
        <h2 id="dashboard-needs-you" className="dashboard-panel-title">
          Needs you
        </h2>
        {items.length > 0 ? <span className="dashboard-panel-aside">{items.length} open</span> : null}
      </header>

      {failedSentence ? (
        <p className="dashboard-read-failed" role="status">
          {failedSentence}
        </p>
      ) : null}

      {shown.length > 0 ? (
        <ul className="dashboard-needs">
          {shown.map((item) => (
            <li key={item.key} className="dashboard-needs-item">
              <Link href={item.href} className="dashboard-needs-title">
                {item.title}
              </Link>
              <span className="dashboard-needs-meta">
                <span>{item.label}</span>
                {item.projectName ? <span className="truncate">{item.projectName}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : failedSentence ? null : (
        <p className="dashboard-empty">Nothing is waiting on anyone here.</p>
      )}

      {incompleteSentence ? <p className="dashboard-note">{incompleteSentence}</p> : null}

      <Link href={moreHref} className="dashboard-more-link">
        {remaining > 0 ? `${remaining} more in My Work` : "Everything in My Work"}
      </Link>
    </section>
  );
}
