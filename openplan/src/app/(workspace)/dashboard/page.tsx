import Link from "next/link";
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

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces(name, plan, created_at)")
    .eq("user_id", user!.id)
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
      title: "Open Corridor Analysis",
      description: "Start a new run and move from corridor geometry to scored output.",
    },
    {
      href: "/billing",
      title: "Open Billing",
      description: "Initialize Starter/Professional checkout and review subscription status.",
    },
    {
      href: "/sign-up",
      title: "Add a Test User",
      description: "Validate workspace bootstrap and role assignment with a second account.",
    },
  ];

  const kpiCards = [
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

  return (
    <section className="space-y-6">
      <header className="space-y-2.5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Workspace Dashboard</p>
        <h1 className="text-3xl font-semibold tracking-tight">{workspaceName}</h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          Signed in as {user?.email}. Sprint focus: route protection, reproducible analysis runs, and client-safe reporting.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="info">{workspaceRole}</StatusBadge>
          <StatusBadge tone="neutral">Plan: {workspacePlan}</StatusBadge>
          <p className="text-[0.72rem] uppercase tracking-[0.08em] text-muted-foreground">
            Workspace ID: <span className="font-mono text-foreground">{workspaceIdSnippet}</span>
          </p>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {kpiCards.map((card) => (
          <article
            key={card.label}
            className="rounded-2xl border border-border/80 bg-card p-5 shadow-[0_10px_24px_rgba(20,33,43,0.06)]"
          >
            <p className="text-[0.72rem] uppercase tracking-[0.08em] text-muted-foreground">{card.label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{card.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{card.detail}</p>
          </article>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="rounded-2xl border border-border/80 bg-card p-5 shadow-[0_10px_24px_rgba(20,33,43,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40"
          >
            <h2 className="text-base font-semibold tracking-tight">{action.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{action.description}</p>
          </Link>
        ))}
      </div>

      <article className="rounded-2xl border border-border/80 bg-card p-5 shadow-[0_10px_24px_rgba(20,33,43,0.06)]">
        <h2 className="text-lg font-semibold tracking-tight">Current Baseline</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>Supabase auth flow is live for sign-up, sign-in, and protected routes.</li>
          <li>Analysis API supports validated corridor scoring requests.</li>
          <li>Runs persist and reload cleanly at workspace scope.</li>
          <li>Report endpoint returns structured HTML/PDF-ready output.</li>
          <li>Core layers now use GTFS, crashes, Census, and LODES inputs.</li>
          <li>KPI instrumentation tracks completion, reporting, and time-to-first-result.</li>
        </ul>
      </article>

      <RunHistory workspaceId={workspaceId} />
    </section>
  );
}
