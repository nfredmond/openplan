import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, FolderKanban, GitCompareArrows, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScenarioSetCreator } from "@/components/scenarios/scenario-set-creator";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { scenarioStatusTone, titleizeScenarioValue } from "@/lib/scenarios/catalog";

type ScenariosPageSearchParams = Promise<{
  projectId?: string;
  status?: string;
}>;

type ScenarioSetRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  summary: string | null;
  planning_question: string | null;
  status: string;
  baseline_entry_id: string | null;
  created_at: string;
  updated_at: string;
  projects:
    | {
        id: string;
        name: string;
      }
    | Array<{
        id: string;
        name: string;
      }>
    | null;
};

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export default async function ScenariosPage({
  searchParams,
}: {
  searchParams: ScenariosPageSearchParams;
}) {
  const filters = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { membership, workspace } = await loadCurrentWorkspaceMembership(supabase, user.id);

  if (!membership || !workspace) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="Scenarios"
        title="Scenarios need a provisioned workspace"
        description="Scenario-set records are tied to project and workspace ownership. Without a provisioned workspace, this list would only appear empty instead of telling you what is actually missing."
      />
    );
  }

  const [{ data: scenarioSetsData }, { data: projectsData }, { data: entriesData }] = await Promise.all([
    supabase
      .from("scenario_sets")
      .select(
        "id, workspace_id, project_id, title, summary, planning_question, status, baseline_entry_id, created_at, updated_at, projects(id, name)"
      )
      .order("updated_at", { ascending: false }),
    supabase.from("projects").select("id, workspace_id, name").order("updated_at", { ascending: false }),
    supabase.from("scenario_entries").select("scenario_set_id, entry_type"),
  ]);

  const counts = new Map<string, { baselineCount: number; alternativeCount: number }>();
  for (const entry of entriesData ?? []) {
    const current = counts.get(entry.scenario_set_id) ?? { baselineCount: 0, alternativeCount: 0 };
    if (entry.entry_type === "baseline") {
      current.baselineCount += 1;
    } else {
      current.alternativeCount += 1;
    }
    counts.set(entry.scenario_set_id, current);
  }

  const scenarioSets = ((scenarioSetsData ?? []) as ScenarioSetRow[])
    .map((scenarioSet) => ({
      ...scenarioSet,
      project: Array.isArray(scenarioSet.projects) ? scenarioSet.projects[0] ?? null : scenarioSet.projects ?? null,
      counts: counts.get(scenarioSet.id) ?? { baselineCount: 0, alternativeCount: 0 },
    }))
    .filter((scenarioSet) => (filters.projectId ? scenarioSet.project_id === filters.projectId : true))
    .filter((scenarioSet) => (filters.status ? scenarioSet.status === filters.status : true));

  const activeCount = scenarioSets.filter((scenarioSet) => scenarioSet.status === "active").length;
  const withBaselineCount = scenarioSets.filter((scenarioSet) => scenarioSet.counts.baselineCount > 0).length;
  const totalAlternatives = scenarioSets.reduce((sum, scenarioSet) => sum + scenarioSet.counts.alternativeCount, 0);

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <GitCompareArrows className="h-3.5 w-3.5" />
            Scenario planning
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">Scenarios</h1>
            <p className="module-intro-description">
              Compare alternatives, keep a clear baseline, and revisit earlier scenario work when a project changes.
            </p>
          </div>

          <div className="module-summary-grid cols-3">
            <div className="module-summary-card">
              <p className="module-summary-label">Scenario sets</p>
              <p className="module-summary-value">{scenarioSets.length}</p>
              <p className="module-summary-detail">Saved scenario groups linked to projects and plans.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Active</p>
              <p className="module-summary-value">{activeCount}</p>
              <p className="module-summary-detail">Scenario sets currently being reviewed or compared.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Alternatives</p>
              <p className="module-summary-value">{totalAlternatives}</p>
              <p className="module-summary-detail">{withBaselineCount} sets already have a registered baseline.</p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Audit posture</p>
              <h2 className="module-operator-title">Scenario framing stays attached to evidence</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            Every entry records its type, linked run, assumptions payload, and readiness status. This pass is intentionally
            registry-first, not a second comparison engine.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">One baseline per scenario set is enforced in both the app layer and the database.</div>
            <div className="module-operator-item">Alternative entries can attach saved runs without losing the project-level audit chain.</div>
            <div className="module-operator-item">Comparison readiness is explicit: ready when both sides have runs, missing-run otherwise.</div>
          </div>
        </article>
      </header>

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <ScenarioSetCreator projects={projectsData ?? []} />

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Catalog</p>
              <h2 className="module-section-title">Scenario sets in this workspace</h2>
              <p className="module-section-description">
                Filter by status to narrow the catalog to the records that need attention.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <FolderKanban className="h-3.5 w-3.5" />
              {scenarioSets.length} total
            </span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-1.5 border-b border-slate-100 pb-3 text-[0.78rem]">
            <Link href="/scenarios" className={cn("rounded px-2 py-0.5 transition-colors", !filters.status ? "bg-emerald-50 font-semibold text-emerald-700" : "text-slate-500 hover:text-slate-800")}>
              All ({scenarioSets.length})
            </Link>
            {[
              { value: "draft", label: "Draft" },
              { value: "active", label: "Active" },
              { value: "archived", label: "Archived" },
            ].map((opt) => (
              <Link key={opt.value} href={`/scenarios?status=${opt.value}`} className={cn("rounded px-2 py-0.5 transition-colors", filters.status === opt.value ? "bg-emerald-50 font-semibold text-emerald-700" : "text-slate-500 hover:text-slate-800")}>
                {opt.label} ({scenarioSets.filter((s) => s.status === opt.value).length})
              </Link>
            ))}
          </div>

          {scenarioSets.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                title="No scenario sets yet"
                description="Create the first scenario set to establish a baseline-versus-alternatives registry for a project."
              />
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {scenarioSets.map((scenarioSet) => (
                <Link
                  key={scenarioSet.id}
                  href={`/scenarios/${scenarioSet.id}`}
                  className="module-record-row is-interactive group block"
                >
                  <div className="module-record-head">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <StatusBadge tone={scenarioStatusTone(scenarioSet.status)}>
                          {titleizeScenarioValue(scenarioSet.status)}
                        </StatusBadge>
                        <StatusBadge tone={scenarioSet.counts.baselineCount > 0 ? "success" : "warning"}>
                          {scenarioSet.counts.baselineCount > 0 ? "Baseline set" : "Baseline missing"}
                        </StatusBadge>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="module-record-title text-[1.05rem] transition group-hover:text-primary">
                            {scenarioSet.title}
                          </h3>
                          <p className="module-record-stamp">Updated {fmtDateTime(scenarioSet.updated_at)}</p>
                        </div>
                        <p className="module-record-summary line-clamp-2">
                          {scenarioSet.summary ||
                            "No summary yet. Open the scenario set to define the planning question, baseline, and alternatives."}
                        </p>
                      </div>
                    </div>

                    <ArrowRight className="mt-0.5 h-4.5 w-4.5 text-muted-foreground transition group-hover:text-primary" />
                  </div>

                  <p className="mt-1.5 text-[0.73rem] text-muted-foreground">
                    {scenarioSet.project?.name ?? "No project"} · {scenarioSet.counts.alternativeCount} alternatives · {scenarioSet.planning_question ? "Planning question captured" : "Planning question pending"} · Updated {fmtDateTime(scenarioSet.updated_at)}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
