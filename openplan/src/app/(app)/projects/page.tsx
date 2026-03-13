import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, FolderKanban, Layers3, Sparkles } from "lucide-react";
import { ProjectWorkspaceCreator } from "@/components/projects/project-workspace-creator";
import { StatusBadge } from "@/components/ui/status-badge";
import { createClient } from "@/lib/supabase/server";

type ProjectRow = {
  id: string;
  workspace_id: string;
  name: string;
  summary: string | null;
  status: string;
  plan_type: string;
  delivery_phase: string;
  created_at: string;
  updated_at: string;
  workspaces:
    | {
        name: string | null;
        plan: string | null;
        created_at: string | null;
      }
    | Array<{
        name: string | null;
        plan: string | null;
        created_at: string | null;
      }>
    | null;
};

function titleize(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function toneForStatus(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "active") return "success";
  if (status === "draft") return "neutral";
  if (status === "on_hold") return "warning";
  if (status === "complete") return "info";
  return "neutral";
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

export default async function ProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: projectsData } = await supabase
    .from("projects")
    .select(
      "id, workspace_id, name, summary, status, plan_type, delivery_phase, created_at, updated_at, workspaces(name, plan, created_at)"
    )
    .order("updated_at", { ascending: false });

  const projects = ((projectsData ?? []) as ProjectRow[]).map((project) => ({
    ...project,
    workspace: Array.isArray(project.workspaces) ? project.workspaces[0] ?? null : project.workspaces ?? null,
  }));

  const activeCount = projects.filter((project) => project.status === "active").length;
  const planningTypes = new Set(projects.map((project) => project.plan_type)).size;

  return (
    <section className="space-y-6">
      <header className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)] sm:p-7">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/8 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-300">
            <Sparkles className="h-3.5 w-3.5" />
            Projects module live
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Projects are now a real data-backed module</h1>
          <p className="mt-3 max-w-3xl text-sm text-muted-foreground sm:text-base">
            This first pass gives OpenPlan a genuine project layer: project records, creation flow, workspace attachment,
            module detail pages, and a more credible operating-system center of gravity.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
              <p className="text-[0.72rem] uppercase tracking-[0.12em] text-muted-foreground">Projects</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">{projects.length}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
              <p className="text-[0.72rem] uppercase tracking-[0.12em] text-muted-foreground">Active</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">{activeCount}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
              <p className="text-[0.72rem] uppercase tracking-[0.12em] text-muted-foreground">Plan types</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">{planningTypes}</p>
            </div>
          </div>
        </article>

        <article className="rounded-[28px] border border-border/70 bg-[linear-gradient(180deg,rgba(13,24,34,0.96),rgba(8,15,21,0.94))] p-6 text-slate-100 shadow-[0_30px_70px_rgba(0,0,0,0.24)]">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <Layers3 className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Transition state</p>
              <h2 className="text-xl font-semibold tracking-tight">Projects now anchor the Planning OS</h2>
            </div>
          </div>
          <ul className="mt-4 space-y-3 text-sm text-slate-300/82">
            <li className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">Each new project creates a real project record plus attached workspace shell.</li>
            <li className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">Project details can now host runs, stage-gate activity, deliverables, risks, and decisions over time.</li>
            <li className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">Next wave: add deliverables, issue/risk tracking, and richer project timelines.</li>
          </ul>
        </article>
      </header>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <ProjectWorkspaceCreator />

        <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Portfolio</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight">Current project records</h2>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <FolderKanban className="h-3.5 w-3.5" />
              {projects.length} total
            </span>
          </div>

          {projects.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-border/80 bg-background/70 p-6 text-sm text-muted-foreground">
              No project records yet. Use the creation panel to establish the first Planning OS project container.
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="group block rounded-[24px] border border-border/80 bg-background/80 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[0_18px_44px_rgba(4,12,20,0.08)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone={toneForStatus(project.status)}>{titleize(project.status)}</StatusBadge>
                        <StatusBadge tone="info">{titleize(project.plan_type)}</StatusBadge>
                        <StatusBadge tone="neutral">{titleize(project.delivery_phase)}</StatusBadge>
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold tracking-tight text-foreground group-hover:text-primary">{project.name}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {project.summary || "No summary yet — this project workspace is ready for planning, reporting, and analysis activity."}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="mt-1 h-5 w-5 text-muted-foreground transition group-hover:text-primary" />
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                    <span className="rounded-full border border-border/70 bg-card px-2.5 py-1">
                      Workspace: {project.workspace?.name ?? "Unknown"}
                    </span>
                    <span className="rounded-full border border-border/70 bg-card px-2.5 py-1">
                      Tier: {titleize(project.workspace?.plan ?? "pilot")}
                    </span>
                    <span className="rounded-full border border-border/70 bg-card px-2.5 py-1">
                      Updated: {fmtDate(project.updated_at)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
