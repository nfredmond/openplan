import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export function WorkspaceMembershipRequired({
  moduleLabel,
  title,
  description,
  primaryHref = "/projects",
  primaryLabel = "Open Projects",
  secondaryHref = "/dashboard",
  secondaryLabel = "Back to overview",
}: {
  moduleLabel: string;
  title?: string;
  description?: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return (
    <section className="module-page">
      <article className="module-intro-card">
        <div className="module-intro-kicker">
          <AlertTriangle className="h-3.5 w-3.5" />
          Workspace membership required
        </div>
        <div className="module-intro-body">
          <h1 className="module-intro-title">{title ?? `${moduleLabel} needs a provisioned workspace`}</h1>
          <p className="module-intro-description">
            {description ??
              `${moduleLabel} records are workspace-scoped. You are signed in, but this account is not attached to a workspace yet. Create a project workspace first or ask an owner/admin to add you to the correct workspace.`}
          </p>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href={primaryHref}
            className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/85 px-4 py-2.5 text-sm font-semibold transition hover:border-primary/35 hover:text-primary"
          >
            {primaryLabel}
          </Link>
          <Link
            href={secondaryHref}
            className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/80 px-4 py-2.5 text-sm font-semibold text-muted-foreground transition hover:border-primary/35 hover:text-primary"
          >
            {secondaryLabel}
          </Link>
        </div>
      </article>
    </section>
  );
}
