import Link from "next/link";

import {
  MY_WORK_SCOPES,
  MY_WORK_SCOPE_DESCRIPTIONS,
  MY_WORK_SCOPE_LABELS,
  type MyWorkScope,
} from "@/lib/my-work/types";

/**
 * The three views of the queue, as links.
 *
 * LINKS RATHER THAN CLIENT STATE, deliberately: the scope is in the URL, so a
 * planner can bookmark "unassigned work" or send it to a colleague, and the
 * page re-reads with the scope applied IN THE DATABASE rather than filtering a
 * capped list in the browser — which would quietly show fewer rows than exist.
 *
 * RENDERED TWICE ON PURPOSE. Once under the header, and again inside the empty
 * state — Nathaniel's decision (2026-08-11): "nothing is assigned to you" is a
 * dead end unless the next question is right there.
 */
export function MyWorkScopeToggles({ scope }: { scope: MyWorkScope }) {
  return (
    <nav className="module-filter-rail" aria-label="Which work to show">
      {MY_WORK_SCOPES.map((candidate) => {
        const active = candidate === scope;
        return (
          <Link
            key={candidate}
            href={`/my-work?scope=${candidate}`}
            aria-current={active ? "page" : undefined}
            className={["module-filter-link", active ? "is-active" : ""].filter(Boolean).join(" ")}
            title={MY_WORK_SCOPE_DESCRIPTIONS[candidate]}
          >
            <span className="module-filter-label">{MY_WORK_SCOPE_LABELS[candidate]}</span>
          </Link>
        );
      })}
    </nav>
  );
}
