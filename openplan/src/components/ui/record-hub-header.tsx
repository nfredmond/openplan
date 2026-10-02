import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * The top of a record page: where it lives, what it is called, and its state.
 *
 * Record pages (one plan, one program, one model, one scenario set) each had
 * their own header: a kicker card, a second "operator" card beside it, and a
 * "Back to X" link in one of four stylings. This is the one header for all of
 * them. It is deliberately not a card: the title is the page's, not a box's.
 *
 * Tabs go directly under it (`PageTabNav`), and everything else goes in a tab.
 */
export function RecordHubHeader({
  parentHref,
  parentLabel,
  title,
  status,
  description,
}: {
  /** The registry this record belongs to, for the breadcrumb. */
  parentHref: string;
  parentLabel: string;
  title: string;
  /** Status badge and at most a few chips. One line. */
  status?: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <header className="space-y-3">
      <nav aria-label="Breadcrumb" className="module-breadcrumb">
        <Link href={parentHref} className="transition hover:text-foreground">
          {parentLabel}
        </Link>
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
        <span className="text-foreground">{title}</span>
      </nav>
      <h1 className="module-intro-title">{title}</h1>
      {status ? <div className="flex flex-wrap items-center gap-2">{status}</div> : null}
      {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
    </header>
  );
}
