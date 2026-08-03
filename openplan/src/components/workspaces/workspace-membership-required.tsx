import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export function WorkspaceMembershipRequired({
  moduleLabel,
  title,
  description,
  primaryHref = "/dashboard",
  primaryLabel = "Go to your workspace",
  secondaryHref = "/contact",
  secondaryLabel = "Get help",
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
          <h1 className="module-intro-title">{title ?? `${moduleLabel} needs a workspace`}</h1>
          <p className="module-intro-description">
            {description ??
              `${moduleLabel} records belong to a workspace. You are signed in, but this account is not in a workspace yet — a workspace is normally created for you when you sign up. Reload your workspace, or ask an owner/admin to add you to the correct one.`}
          </p>
        </div>
        <div className="mt-5 flex flex-wrap gap-5 border-t border-white/10 pt-4 text-sm">
          <Link href={primaryHref} className="font-semibold text-white transition hover:text-white/78">
            {primaryLabel}
          </Link>
          <Link href={secondaryHref} className="font-semibold text-white/72 transition hover:text-white">
            {secondaryLabel}
          </Link>
        </div>
      </article>
    </section>
  );
}
