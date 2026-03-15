import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, FileText, FolderKanban, Radar, ShieldCheck } from "lucide-react";
import { RunHistory } from "@/components/runs/RunHistory";
import { StatusBadge } from "@/components/ui/status-badge";
import { buildWorkspaceKpis, formatTimeToFirstResult } from "@/lib/metrics/workspace-kpis";
import { createClient } from "@/lib/supabase/server";

type MembershipRow = {
  workspace_id: string;
  role: string;
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

function fmtPct(value: number | null): string {
  return value === null ? "N/A" : `${value}%`;
}

function fmtDate(value: string | null): string {
  if (!value) {
    return "Not available";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces(name, plan, created_at)")
    .eq("user_id", user.id)
    .limit(1);

  const membership = memberships?.[0] as MembershipRow | undefined;

  const workspace = Array.isArray(membership?.workspaces)
    ? membership?.workspaces[0] ?? null
    : membership?.workspaces ?? null;

  const workspaceName = workspace?.name ?? "Your workspace";
  const workspacePlan = workspace?.plan ?? "pilot";
  const workspaceCreatedAt = workspace?.created_at ?? null;
  const workspaceRole = membership?.role ?? "member";
  const workspaceId = membership?.workspace_id ?? "";
  const workspaceIdSnippet = workspaceId ? workspaceId.slice(0, 8) : "unavailable";

  const { data: runsData } = workspaceId
    ? await supabase
        .from("runs")
        .select("created_at, metrics, summary_text, report_generated_count")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true })
        .limit(500)
    : { data: [] };

  const kpis = buildWorkspaceKpis({
    workspaceCreatedAt,
    runs: (runsData ?? []) as Array<{
      created_at: string;
      metrics: Record<string, unknown> | null;
      summary_text: string | null;
      report_generated_count: number | null;
    }>,
  });

  const actions = [
    {
      href: "/explore",
      title: "Open Analysis Studio",
      description: "Run the corridor workflow inside the Planning OS shell with map, metrics, and report posture intact.",
      icon: Radar,
    },
    {
      href: "/projects",
      title: "Open Projects Module",
      description: "Move into the project control rooms for deliverables, risks, decisions, issues, and meetings.",
      icon: FolderKanban,
    },
    {
      href: "/reports",
      title: "Open Reports Surface",
      description: "Review where evidence packs, board-ready exports, and grant artifacts will converge.",
      icon: FileText,
    },
  ];

  const kpiCards = [
    {
      label: "Total runs",
      value: `${kpis.totalRuns || 0}`,
      detail: `${kpis.completedRuns} completed runs in this workspace`,
    },
    {
      label: "Run completion rate",
      value: fmtPct(kpis.runCompletionRate),
      detail: `${kpis.completedRuns}/${kpis.totalRuns || 0} runs completed`,
    },
    {
      label: "Report generation rate",
      value: fmtPct(kpis.reportGenerationRate),
      detail: `${kpis.runsWithReports}/${kpis.totalRuns || 0} runs exported`,
    },
    {
      label: "Time to first result",
      value: formatTimeToFirstResult(kpis.timeToFirstResultHours),
      detail: `First run at ${fmtDate(kpis.firstRunAt)}`,
    },
  ];

  const baselineItems = [
    "Supabase auth flow is live for sign-up, sign-in, and protected routes.",
    "Analysis API supports validated corridor scoring requests.",
    "Runs persist and reload cleanly at workspace scope.",
    "Report endpoint returns structured HTML / PDF-ready output.",
    "Core layers now use GTFS, crashes, Census, and LODES inputs.",
    "KPI instrumentation tracks completion, reporting, and time-to-first-result.",
  ];

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">Workspace Dashboard</div>
          <div className="module-intro-body">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="info">{workspaceRole}</StatusBadge>
              <StatusBadge tone="neutral">Plan: {workspacePlan}</StatusBadge>
              <p className="text-[0.72rem] uppercase tracking-[0.16em] text-muted-foreground">
                Workspace ID <span className="font-mono text-foreground">{workspaceIdSnippet}</span>
              </p>
            </div>
            <h1 className="module-intro-title">{workspaceName}</h1>
            <p className="module-intro-description">
              Signed in as {user.email}. Overview now behaves like the front desk of the Planning OS: high-level workspace
              signal up top, operational paths below, and deeper history where it belongs.
            </p>
          </div>

          <div className="module-summary-grid cols-4">
            {kpiCards.map((card) => (
              <div key={card.label} className="module-summary-card">
                <p className="module-summary-label">{card.label}</p>
                <p className="module-summary-value">{card.value}</p>
                <p className="module-summary-detail">{card.detail}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Operator posture</p>
              <h2 className="module-operator-title">Overview should orient, not compete</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            This surface is now intentionally structured as the calm top of the stack: summary metrics first, module entry
            points second, detailed run history after that.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">
              <strong className="text-slate-100">Current priority:</strong> keep the dashboard legible as a control surface
              instead of turning it into a second analysis page.
            </div>
            <div className="module-operator-item">
              <strong className="text-slate-100">Best next move:</strong> open Projects to work at the project-control-room
              layer, or Analysis Studio to produce fresh evidence.
            </div>
            <div className="module-operator-item">
              <strong className="text-slate-100">Activation signal:</strong> time to first result is
              {" "}
              {formatTimeToFirstResult(kpis.timeToFirstResultHours)}.
            </div>
          </div>
        </article>
      </header>

      <div className="grid gap-6 xl:grid-cols-[1.04fr_0.96fr]">
        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Quick actions</p>
              <h2 className="module-section-title">Move into the right module lane</h2>
              <p className="module-section-description">
                Each surface below is intentionally framed as a next action rather than a decorative promo tile.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.href}
                  href={action.href}
                  className="module-subpanel group transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[0_16px_36px_rgba(4,12,20,0.08)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                      <Icon className="h-4.5 w-4.5" />
                    </span>
                    <ArrowRight className="mt-1 h-4.5 w-4.5 text-muted-foreground transition group-hover:text-primary" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold tracking-tight text-foreground group-hover:text-primary">
                    {action.title}
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">{action.description}</p>
                </Link>
              );
            })}
          </div>
        </article>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Current baseline</p>
              <h2 className="module-section-title">What is already live</h2>
              <p className="module-section-description">
                This is the grounded product floor beneath the broader Planning OS language.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            {baselineItems.map((item) => (
              <div key={item} className="module-subpanel text-sm text-muted-foreground">
                {item}
              </div>
            ))}
          </div>
        </article>
      </div>

      <RunHistory workspaceId={workspaceId} />
    </section>
  );
}
