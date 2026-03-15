import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ClipboardList, FolderKanban, ShieldCheck } from "lucide-react";
import { ProgramCreator } from "@/components/programs/program-creator";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { createClient } from "@/lib/supabase/server";
import {
  buildProgramReadiness,
  buildProgramWorkflowSummary,
  formatFiscalWindow,
  formatProgramDateTime,
  formatProgramStatusLabel,
  formatProgramTypeLabel,
  programStatusTone,
} from "@/lib/programs/catalog";

type ProgramsPageSearchParams = Promise<{
  projectId?: string;
  programType?: string;
  status?: string;
}>;

type ProgramRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
  program_type: string;
  status: string;
  cycle_name: string;
  sponsor_agency: string | null;
  fiscal_year_start: number | null;
  fiscal_year_end: number | null;
  nomination_due_at: string | null;
  adoption_target_at: string | null;
  summary: string | null;
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

type ProgramLinkRow = {
  program_id: string;
  link_type: string;
  linked_id: string;
};

export default async function ProgramsPage({
  searchParams,
}: {
  searchParams: ProgramsPageSearchParams;
}) {
  const filters = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const [{ data: programsData }, { data: projectsData }] = await Promise.all([
    supabase
      .from("programs")
      .select(
        "id, workspace_id, project_id, title, program_type, status, cycle_name, sponsor_agency, fiscal_year_start, fiscal_year_end, nomination_due_at, adoption_target_at, summary, created_at, updated_at, projects(id, name)"
      )
      .order("updated_at", { ascending: false }),
    supabase.from("projects").select("id, workspace_id, name").order("updated_at", { ascending: false }),
  ]);

  const programs = (programsData ?? []) as ProgramRow[];
  const programIds = programs.map((program) => program.id);
  const projectIds = [...new Set(programs.map((program) => program.project_id).filter((value): value is string => Boolean(value)))];

  const [linksResult, plansResult, reportsResult, campaignsResult] = await Promise.all([
    programIds.length
      ? supabase.from("program_links").select("program_id, link_type, linked_id").in("program_id", programIds)
      : Promise.resolve({ data: [], error: null }),
    projectIds.length ? supabase.from("plans").select("id, project_id").in("project_id", projectIds) : Promise.resolve({ data: [], error: null }),
    projectIds.length
      ? supabase.from("reports").select("id, project_id, status").in("project_id", projectIds)
      : Promise.resolve({ data: [], error: null }),
    projectIds.length
      ? supabase.from("engagement_campaigns").select("id, project_id").in("project_id", projectIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const linksByProgram = new Map<string, ProgramLinkRow[]>();
  for (const link of (linksResult.data ?? []) as ProgramLinkRow[]) {
    const current = linksByProgram.get(link.program_id) ?? [];
    current.push(link);
    linksByProgram.set(link.program_id, current);
  }

  const planCountsByProject = new Map<string, number>();
  for (const row of plansResult.data ?? []) {
    if (!row.project_id) continue;
    planCountsByProject.set(row.project_id, (planCountsByProject.get(row.project_id) ?? 0) + 1);
  }

  const reportCountsByProject = new Map<string, number>();
  const generatedReportCountsByProject = new Map<string, number>();
  for (const row of reportsResult.data ?? []) {
    if (!row.project_id) continue;
    reportCountsByProject.set(row.project_id, (reportCountsByProject.get(row.project_id) ?? 0) + 1);
    if (row.status === "generated") {
      generatedReportCountsByProject.set(row.project_id, (generatedReportCountsByProject.get(row.project_id) ?? 0) + 1);
    }
  }

  const campaignCountsByProject = new Map<string, number>();
  for (const row of campaignsResult.data ?? []) {
    if (!row.project_id) continue;
    campaignCountsByProject.set(row.project_id, (campaignCountsByProject.get(row.project_id) ?? 0) + 1);
  }

  const typedPrograms = programs
    .map((program) => {
      const project = Array.isArray(program.projects) ? program.projects[0] ?? null : program.projects ?? null;
      const links = linksByProgram.get(program.id) ?? [];
      const explicitPlanCount = links.filter((link) => link.link_type === "plan").length;
      const explicitReportCount = links.filter((link) => link.link_type === "report").length;
      const explicitCampaignCount = links.filter((link) => link.link_type === "engagement_campaign").length;
      const explicitProjectCount = links.filter((link) => link.link_type === "project_record").length;
      const planCount = explicitPlanCount + (program.project_id ? planCountsByProject.get(program.project_id) ?? 0 : 0);
      const reportCount = explicitReportCount + (program.project_id ? reportCountsByProject.get(program.project_id) ?? 0 : 0);
      const engagementCampaignCount =
        explicitCampaignCount + (program.project_id ? campaignCountsByProject.get(program.project_id) ?? 0 : 0);
      const generatedReportCount =
        explicitReportCount + (program.project_id ? generatedReportCountsByProject.get(program.project_id) ?? 0 : 0);
      const readiness = buildProgramReadiness({
        cycleName: program.cycle_name,
        hasProject: Boolean(program.project_id || explicitProjectCount > 0),
        planCount,
        reportCount,
        engagementCampaignCount,
        sponsorAgency: program.sponsor_agency,
        fiscalYearStart: program.fiscal_year_start,
        fiscalYearEnd: program.fiscal_year_end,
        nominationDueAt: program.nomination_due_at,
        adoptionTargetAt: program.adoption_target_at,
      });

      return {
        ...program,
        project,
        readiness,
        linkageCounts: {
          plans: planCount,
          reports: reportCount,
          engagementCampaigns: engagementCampaignCount,
          relatedProjects: explicitProjectCount + (program.project_id ? 1 : 0),
        },
        workflow: buildProgramWorkflowSummary({
          programStatus: program.status,
          readiness,
          planCount,
          reportCount,
          generatedReportCount,
          engagementCampaignCount,
          approvedEngagementItemCount: 0,
          pendingEngagementItemCount: 0,
        }),
      };
    })
    .filter((program) => (filters.projectId ? program.project_id === filters.projectId : true))
    .filter((program) => (filters.programType ? program.program_type === filters.programType : true))
    .filter((program) => (filters.status ? program.status === filters.status : true));

  const activeCount = typedPrograms.filter((program) => ["assembling", "submitted", "programmed"].includes(program.status)).length;
  const readyCount = typedPrograms.filter((program) => program.readiness.ready).length;
  const rtipStipCount = typedPrograms.filter((program) => ["rtip", "stip"].includes(program.program_type)).length;

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <ClipboardList className="h-3.5 w-3.5" />
            Programs module live
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">Programming cycles now have a real system-of-record layer</h1>
            <p className="module-intro-description">
              Track RTIP, STIP, and adjacent funding lanes as explicit package records tied to projects, plans,
              engagement evidence, and packet outputs without pretending OpenPlan is already a full narrative editor.
            </p>
          </div>

          <div className="module-summary-grid cols-3">
            <div className="module-summary-card">
              <p className="module-summary-label">Programs</p>
              <p className="module-summary-value">{typedPrograms.length}</p>
              <p className="module-summary-detail">Cycle and package records in the current workspace catalog.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">In motion</p>
              <p className="module-summary-value">{activeCount}</p>
              <p className="module-summary-detail">{rtipStipCount} focused on RTIP/STIP lanes.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Package ready</p>
              <p className="module-summary-value">{readyCount}</p>
              <p className="module-summary-detail">Transparent readiness only: metadata plus linked package evidence.</p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Programming posture</p>
              <h2 className="module-operator-title">Package readiness stays explicit and auditable</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            This v1 is deliberately metadata-first: cycle timing, fiscal window, sponsor agency, linked plans, packet
            outputs, and engagement evidence in one place.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Primary project links inherit relevant plans, reports, and engagement records.</div>
            <div className="module-operator-item">Additional program links preserve cross-project and cross-record package context.</div>
            <div className="module-operator-item">Missing schedule or packet basis shows up as an explicit gap, never a hidden score.</div>
          </div>
        </article>
      </header>

      <div className="grid gap-6 xl:grid-cols-[0.94fr_1.06fr]">
        <ProgramCreator projects={projectsData ?? []} />

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Catalog</p>
              <h2 className="module-section-title">Programming cycle records</h2>
              <p className="module-section-description">
                Review package posture by status, lane, or linked project and jump straight into the cycle record.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <FolderKanban className="h-3.5 w-3.5" />
              {typedPrograms.length} total
            </span>
          </div>

          {typedPrograms.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                title="No programming cycles yet"
                description="Create a program record to track RTIP/STIP package readiness, timing, and supporting records."
              />
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {typedPrograms.map((program) => (
                <Link
                  key={program.id}
                  href={`/programs/${program.id}`}
                  className="module-record-row is-interactive group block"
                >
                  <div className="module-record-head">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <StatusBadge tone={programStatusTone(program.status)}>
                          {formatProgramStatusLabel(program.status)}
                        </StatusBadge>
                        <StatusBadge tone="info">{formatProgramTypeLabel(program.program_type)}</StatusBadge>
                        <StatusBadge tone={program.readiness.tone}>{program.readiness.label}</StatusBadge>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="module-record-title text-[1.05rem] transition group-hover:text-primary">
                            {program.title}
                          </h3>
                          <p className="module-record-stamp">Updated {formatProgramDateTime(program.updated_at)}</p>
                        </div>
                        <p className="module-record-summary line-clamp-2">
                          {program.summary || program.workflow.reason}
                        </p>
                      </div>
                    </div>

                    <ArrowRight className="mt-0.5 h-4.5 w-4.5 text-muted-foreground transition group-hover:text-primary" />
                  </div>

                  <div className="module-record-meta">
                    <span className="module-record-chip">{program.cycle_name}</span>
                    <span className="module-record-chip">{formatFiscalWindow(program.fiscal_year_start, program.fiscal_year_end)}</span>
                    <span className="module-record-chip">{program.project?.name ?? "No primary project"}</span>
                    <span className="module-record-chip">{program.linkageCounts.plans} plans</span>
                    <span className="module-record-chip">{program.linkageCounts.reports} reports</span>
                    <span className="module-record-chip">{program.linkageCounts.engagementCampaigns} campaigns</span>
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
