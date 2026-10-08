import * as React from "react";

/**
 * The top of an index page: its name, one sentence, and its one primary action.
 *
 * Index pages (Projects, Plans, Reports, Grants and the rest) each opened with a
 * two-card header: an "intro" card holding a kicker, the title, a description
 * and the stat tiles, and beside it a dark "operator" card of explanatory text.
 * The primary "New" button was an anchor link to a card further down the page.
 * This is the one header for all of them. It is not a card.
 *
 * `title` should equal the page's rail label, so a planner who clicked
 * "Programming Cycles" lands on a page called "Programming Cycles".
 */
export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  /** One plain sentence. What this page holds, not how it works. */
  description?: React.ReactNode;
  /** The page's primary action, and at most one secondary. */
  actions?: React.ReactNode;
  /** Optional row under the title, for example stat tiles. */
  children?: React.ReactNode;
}) {
  return (
    <header className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]">{title}</h1>
          {description ? <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
