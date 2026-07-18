import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type DashboardQuickAction = {
  key: string;
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
};

export function DashboardQuickActions({ actions }: { actions: DashboardQuickAction[] }) {
  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Quick actions</p>
          <h2 className="module-section-title">Move into the work</h2>
        </div>
      </div>

      <div className="mt-3 space-y-1">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.key}
              href={action.href}
              className="flex items-start gap-3 rounded-[0.375rem] border border-border/70 bg-card px-3 py-2.5 transition-colors hover:border-emerald-600/40 hover:bg-emerald-500/[0.06]"
            >
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-emerald-600/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[0.87rem] font-semibold text-foreground">{action.title}</p>
                <p className="mt-0.5 text-[0.77rem] leading-snug text-muted-foreground">{action.description}</p>
              </div>
              <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </Link>
          );
        })}
      </div>
    </article>
  );
}
