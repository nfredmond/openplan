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
  const scopingCount = projects.filter((project) => project.delivery_phase === "scoping").length;

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <Sparkles className="h-3.5 w-3.5" />
            Projects module live
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">Projects now read like a coherent portfolio layer</h1>
            <p className="module-intro-description">
              The projects surface is now aligned to the same hierarchy as the rest of OpenPlan: one clear page intro,
              one operator callout, one creation lane, and one portfolio lane with tighter record cards.
            </p>
          </div>

          <div className="module-summary-grid cols-3">
            <div className="module-summary-card">
              <p className="module-summary-label">Projects</p>
              <p className="module-summary-value">{projects.length}</p>
              <p className="module-summary-detail">First-class project records inside the Planning OS shell.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Active</p>
              <p className="module-summary-value">{activeCount}</p>
              <p className="module-summary-detail">Currently in motion across the workspace portfolio.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Plan types</p>
              <p className="module-summary-value">{planningTypes}</p>
              <p className="module-summary-detail">Including {scopingCount} projects still in scoping posture.</p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <Layers3 className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Portfolio posture</p>
              <h2 className="module-operator-title">Projects are the stable center of gravity</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            This module should now feel like the administrative hinge between overview and deep project work—not a one-off
            special page with its own panel logic.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">
              Each new project creates a real project record plus its attached workspace shell.
            </div>
            <div className="module-operator-item">
              Project detail pages now host deliverables, risks, issues, decisions, meetings, runs, and linked datasets.
            </div>
            <div className="module-operator-item">
              Best next layer after this surface pass: portfolio filters, saved views, and owner-based workload lenses.
            </div>
          </div>
        </article>
      </header>

      <div className="grid gap-6 xl:grid-cols-[0.94fr_1.06fr]">
        <ProjectWorkspaceCreator />

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Portfolio</p>
              <h2 className="module-section-title">Current project records</h2>
              <p className="module-section-description">
                Summary cards above give the module signal. The list below stays denser and operational.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <FolderKanban className="h-3.5 w-3.5" />
              {projects.length} total
            </span>
          </div>

          {projects.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">
              No project records yet. Use the creation lane to establish the first Planning OS project container.
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {projects.map((project) => (
                <Link key={project.id} href={`/projects/${project.id}`} className="module-record-row is-interactive group block">
                  <div className="module-record-head">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <StatusBadge tone={toneForStatus(project.status)}>{titleize(project.status)}</StatusBadge>
                        <StatusBadge tone="info">{titleize(project.plan_type)}</StatusBadge>
                        <StatusBadge tone="neutral">{titleize(project.delivery_phase)}</StatusBadge>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="module-record-title text-[1.05rem] transition group-hover:text-primary">
                            {project.name}
                          </h3>
                          <p className="module-record-stamp">Updated {fmtDate(project.updated_at)}</p>
                        </div>
                        <p className="module-record-summary line-clamp-2">
                          {project.summary ||
                            "No summary yet — this project workspace is ready for planning, reporting, and analysis activity."}
                        </p>
                      </div>
                    </div>

                    <ArrowRight className="mt-0.5 h-4.5 w-4.5 text-muted-foreground transition group-hover:text-primary" />
                  </div>

                  <div className="module-record-meta">
                    <span className="module-record-chip">Workspace {project.workspace?.name ?? "Unknown"}</span>
                    <span className="module-record-chip">Tier {titleize(project.workspace?.plan ?? "pilot")}</span>
                    <span className="module-record-chip">Created {fmtDate(project.created_at)}</span>
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
