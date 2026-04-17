import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  type GrantsQueueCalloutKind,
  resolveGrantsQueueCalloutCopy,
} from "@/lib/operations/grants-links";
import type { WorkspaceCommandQueueItem } from "@/lib/operations/workspace-summary";

export function GrantsQueueCallout({
  kind,
  command,
  className = "mt-5",
  variant = "section",
}: {
  kind: GrantsQueueCalloutKind;
  command: Pick<WorkspaceCommandQueueItem, "detail" | "href" | "tone" | "key" | "targetOpportunityTitle">;
  className?: string;
  variant?: "section" | "hero";
}) {
  const copy = resolveGrantsQueueCalloutCopy(kind, command);
  const classes =
    variant === "hero"
      ? {
          surface:
            "rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-emerald-50/82",
          link: "inline-flex items-center gap-2 font-semibold text-emerald-100 transition hover:text-white",
        }
      : {
          surface:
            "rounded-2xl border border-amber-300/60 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/25 dark:text-amber-100",
          link: "inline-flex items-center gap-2 font-semibold text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]",
        };

  return (
    <div className={`${className} ${classes.surface}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold tracking-tight">{copy.title}</p>
            <StatusBadge tone={command.tone}>{copy.badgeLabel}</StatusBadge>
          </div>
          <p className="mt-1">{command.detail}</p>
        </div>
        <Link href={command.href} className={classes.link}>
          {copy.actionLabel}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
