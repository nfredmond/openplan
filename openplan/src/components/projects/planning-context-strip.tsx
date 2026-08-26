import Link from "next/link";
import { AlertTriangle, ArrowLeft, FolderKanban } from "lucide-react";

import { resolvePlanningContext, type PlanningContext } from "@/lib/projects/planning-context";
import { cn } from "@/lib/utils";

export function PlanningContextStrip({
  context,
  className,
}: {
  context: PlanningContext;
  className?: string;
}) {
  if (context.status === "none") return null;

  if (context.status !== "active") {
    return (
      <aside
        className={cn("flex items-start gap-3 rounded-lg border border-amber-500/45 bg-amber-500/[0.07] p-4 text-sm", className)}
        aria-label="Project context unavailable"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div>
          <p className="font-semibold text-foreground">Project context was not applied</p>
          <p className="mt-1 text-muted-foreground">
            {context.status === "unreadable"
              ? "OpenPlan could not read the requested project. This page has not treated the failure as an empty project or a valid workspace-wide result."
              : "The requested project is missing or does not belong to the active workspace. This page has not silently switched to another project."}
          </p>
          <Link href="/projects" className="mt-2 inline-flex items-center gap-1 font-semibold text-primary hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" />
            Open projects
          </Link>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={cn("flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/[0.06] px-4 py-3", className)}
      aria-label="Active project"
    >
      <div className="flex min-w-0 items-center gap-2">
        <FolderKanban className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Active project
          </p>
          <p className="truncate text-sm font-semibold text-foreground">{context.project.name}</p>
        </div>
      </div>
      <Link
        href={`/projects/${context.project.id}`}
        className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Return to project
      </Link>
    </aside>
  );
}

export function PlanningContextStripForProject({
  requestedProjectId,
  project,
  error,
  className,
}: {
  requestedProjectId: string | string[] | null | undefined;
  project: { id: string; name: string | null } | null | undefined;
  error?: { message?: string | null } | null;
  className?: string;
}) {
  return (
    <PlanningContextStrip
      context={resolvePlanningContext(requestedProjectId, project, error)}
      className={className}
    />
  );
}
