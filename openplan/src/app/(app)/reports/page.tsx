import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  FileStack,
  FolderKanban,
  ScrollText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { ReportCreator } from "@/components/reports/report-creator";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { createClient } from "@/lib/supabase/server";
import {
  CURRENT_WORKSPACE_MEMBERSHIP_SELECT,
  type WorkspaceMembershipRow,
  unwrapWorkspaceRecord,
} from "@/lib/workspaces/current";
import {
  formatDateTime,
  formatReportStatusLabel,
  formatReportTypeLabel,
  reportStatusTone,
} from "@/lib/reports/catalog";

type ReportRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  report_type: string;
  status: string;
  summary: string | null;
  generated_at: string | null;
  latest_artifact_kind: string | null;
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

export default async function ReportsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select(CURRENT_WORKSPACE_MEMBERSHIP_SELECT)
    .eq("user_id", user.id)
    .limit(1);

  const membership = memberships?.[0] as WorkspaceMembershipRow | undefined;
  const workspace = unwrapWorkspaceRecord(membership?.workspaces);

  if (!membership || !workspace) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="Reports"
        title="Reports need a provisioned workspace"
        description="Report packets, run attachments, and artifact history only exist inside a provisioned workspace. This account is authenticated, but it is not yet attached to one."
      />
    );
  }

  const [{ data: reportsData }, { data: projectsData }, { data: runsData }] =
    await Promise.all([
      supabase
        .from("reports")
        .select(
          "id, workspace_id, project_id, title, report_type, status, summary, generated_at, latest_artifact_kind, created_at, updated_at, projects(id, name)"
        )
        .order("updated_at", { ascending: false }),
      supabase
        .from("projects")
        .select("id, workspace_id, name")
        .order("updated_at", { ascending: false }),
      supabase
        .from("runs")
        .select("id, workspace_id, title, created_at")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

  const reports = ((reportsData ?? []) as ReportRow[]).map((report) => ({
    ...report,
    project: Array.isArray(report.projects)
      ? report.projects[0] ?? null
      : report.projects ?? null,
  }));
  const generatedCount = reports.filter(
    (report) => report.status === "generated"
  ).length;
  const draftCount = reports.filter(
    (report) => report.status === "draft"
  ).length;
  const distinctProjects = new Set(
    reports.map((report) => report.project_id).filter(Boolean)
  ).size;

  return (
    <section className="space-y-6">
      {/* ── Hero row ─────────────────────────────────────────── */}
      <header className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        {/* Left: intro + stats */}
        <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)] sm:p-7">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-amber-800 dark:text-amber-200">
            <ScrollText className="h-3.5 w-3.5" />
            Reports
          </div>

          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Report catalog and packet generation
          </h1>
          <p className="mt-3 max-w-3xl text-[0.9rem] leading-relaxed text-muted-foreground sm:text-base">
            Create structured report packets linked to projects and analysis
            runs. Each report tracks its configured sections, artifact history,
            and audit provenance.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3.5">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Total reports
              </p>
              <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">
                {reports.length}
              </p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3.5">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Generated
              </p>
              <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">
                {generatedCount}
              </p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3.5">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Projects covered
              </p>
              <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">
                {distinctProjects}
              </p>
            </div>
          </div>
        </article>

        {/* Right: auditability posture */}
        <article className="rounded-[28px] border border-border/70 bg-[linear-gradient(180deg,rgba(41,24,15,0.96),rgba(24,14,9,0.94))] p-6 text-amber-50 shadow-[0_30px_70px_rgba(0,0,0,0.24)]">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-amber-200" />
            </span>
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-amber-200/65">
                Auditability
              </p>
              <h2 className="text-xl font-semibold tracking-tight">
                Structured packets with provenance
              </h2>
            </div>
          </div>
          <ul className="mt-5 space-y-2.5 text-[0.84rem] leading-relaxed text-amber-50/82">
            <li className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
              Every report artifact captures its source runs and audit gates so
              reviewers can trace what went into the packet.
            </li>
            <li className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
              HTML packet generation is live. Storage-backed export and PDF
              rendering will follow once export delivery is connected.
            </li>
            <li className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
              Missing source context is surfaced as explicit warnings, never
              silently omitted from the generated output.
            </li>
          </ul>
        </article>
      </header>

      {/* ── Creator + catalog row ────────────────────────────── */}
      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <ReportCreator projects={projectsData ?? []} runs={runsData ?? []} />

        {/* Report catalog */}
        <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
                <FileStack className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Catalog
                </p>
                <h2 className="text-xl font-semibold tracking-tight">
                  Report records
                </h2>
              </div>
            </div>
            {draftCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <Sparkles className="h-3 w-3" />
                {draftCount} draft{draftCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {reports.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                title="No reports yet"
                description="Create a report packet to establish project-linked records, section structure, and artifact history."
              />
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {reports.map((report) => (
                <Link
                  key={report.id}
                  href={`/reports/${report.id}`}
                  className="group block rounded-[22px] border border-border/80 bg-background/80 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[0_18px_44px_rgba(4,12,20,0.08)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-2.5">
                      <h3 className="text-lg font-semibold leading-snug tracking-tight text-foreground group-hover:text-primary">
                        {report.title}
                      </h3>
                      <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                        {report.summary ||
                          "No summary provided. Open the report to add context and generate artifacts."}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge tone={reportStatusTone(report.status)}>
                          {formatReportStatusLabel(report.status)}
                        </StatusBadge>
                        <StatusBadge tone="info">
                          {formatReportTypeLabel(report.report_type)}
                        </StatusBadge>
                        {report.latest_artifact_kind ? (
                          <StatusBadge tone="neutral">
                            {report.latest_artifact_kind.toUpperCase()}
                          </StatusBadge>
                        ) : null}
                      </div>
                    </div>
                    <ArrowRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground/60 transition group-hover:translate-x-0.5 group-hover:text-primary" />
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-3 text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
                    <span className="rounded-full border border-border/60 bg-card px-2.5 py-0.5">
                      {report.project?.name ?? "Unknown project"}
                    </span>
                    <span className="rounded-full border border-border/60 bg-card px-2.5 py-0.5">
                      Updated {formatDateTime(report.updated_at)}
                    </span>
                    {report.generated_at && (
                      <span className="rounded-full border border-border/60 bg-card px-2.5 py-0.5">
                        Generated {formatDateTime(report.generated_at)}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </article>
      </div>

      {/* ── Capability footer ────────────────────────────────── */}
      <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            <FolderKanban className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Capabilities
            </p>
            <h2 className="text-xl font-semibold tracking-tight">
              What&apos;s available in report packets
            </h2>
          </div>
        </div>
        <p className="mt-3 max-w-4xl text-sm leading-relaxed text-muted-foreground">
          Reports include schema-backed records, configured sections, run
          attachments, and HTML artifact generation with audit metadata. PDF
          export and storage-backed delivery will layer onto this record model.
        </p>
      </article>
    </section>
  );
}
