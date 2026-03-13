import { notFound, redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardCheck,
  Clock3,
  FileClock,
  FolderKanban,
  MessagesSquare,
  Scale,
  ShieldCheck,
  Siren,
} from "lucide-react";
import Link from "next/link";
import { ProjectRecordComposer } from "@/components/projects/project-record-composer";
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
};

type TimelineItem = {
  id: string;
  type: string;
  title: string;
  description: string;
  at: string | null;
  badge: string;
  tone: "info" | "success" | "warning" | "danger" | "neutral";
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

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function toneForStatus(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "active") return "success";
  if (status === "draft") return "neutral";
  if (status === "on_hold") return "warning";
  if (status === "complete") return "info";
  return "neutral";
}

function toneForDecision(decision: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (decision === "PASS" || decision === "approved") return "success";
  if (decision === "HOLD" || decision === "proposed") return "warning";
  if (decision === "rejected") return "danger";
  return "neutral";
}

function toneForDeliverableStatus(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "complete") return "success";
  if (status === "in_progress") return "info";
  if (status === "blocked") return "warning";
  return "neutral";
}

function toneForRiskSeverity(severity: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (severity === "critical") return "danger";
  if (severity === "high") return "warning";
  if (severity === "medium") return "info";
  if (severity === "low") return "success";
  return "neutral";
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: projectData } = await supabase
    .from("projects")
    .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, created_at, updated_at")
    .eq("id", projectId)
    .single();

  if (!projectData) {
    notFound();
  }

  const project = projectData as ProjectRow;

  const { data: workspaceData } = await supabase
    .from("workspaces")
    .select("id, name, plan, slug, stage_gate_template_id, stage_gate_template_version, created_at")
    .eq("id", project.workspace_id)
    .single();

  const { data: recentRuns } = await supabase
    .from("runs")
    .select("id, title, created_at, summary_text")
    .eq("workspace_id", project.workspace_id)
    .order("created_at", { ascending: false })
    .limit(5);

  const { data: recentGateDecisions } = await supabase
    .from("stage_gate_decisions")
    .select("id, gate_id, decision, rationale, decided_at")
    .eq("workspace_id", project.workspace_id)
    .order("decided_at", { ascending: false })
    .limit(5);

  const { data: deliverables } = await supabase
    .from("project_deliverables")
    .select("id, title, summary, owner_label, due_date, status, created_at")
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(6);

  const { data: risks } = await supabase
    .from("project_risks")
    .select("id, title, description, severity, status, mitigation, created_at")
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(6);

  const { data: issues } = await supabase
    .from("project_issues")
    .select("id, title, description, severity, status, owner_label, created_at")
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(6);

  const { data: decisions } = await supabase
    .from("project_decisions")
    .select("id, title, rationale, status, impact_summary, decided_at, created_at")
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(6);

  const { data: meetings } = await supabase
    .from("project_meetings")
    .select("id, title, notes, meeting_at, attendees_summary, created_at")
    .eq("project_id", project.id)
    .order("updated_at", { ascending: false })
    .limit(6);

  const timelineItems: TimelineItem[] = [
    ...(deliverables ?? []).map((item) => ({
      id: `deliverable-${item.id}`,
      type: "deliverable",
      title: item.title,
      description: item.summary || "Deliverable added to project.",
      at: item.created_at,
      badge: `Deliverable · ${titleize(item.status)}`,
      tone: toneForDeliverableStatus(item.status),
    })),
    ...(risks ?? []).map((item) => ({
      id: `risk-${item.id}`,
      type: "risk",
      title: item.title,
      description: item.description || "Risk recorded for this project.",
      at: item.created_at,
      badge: `Risk · ${titleize(item.severity)}`,
      tone: toneForRiskSeverity(item.severity),
    })),
    ...(issues ?? []).map((item) => ({
      id: `issue-${item.id}`,
      type: "issue",
      title: item.title,
      description: item.description || "Issue logged for this project.",
      at: item.created_at,
      badge: `Issue · ${titleize(item.status)}`,
      tone: toneForRiskSeverity(item.severity),
    })),
    ...(decisions ?? []).map((item) => ({
      id: `decision-${item.id}`,
      type: "decision",
      title: item.title,
      description: item.rationale,
      at: item.decided_at || item.created_at,
      badge: `Decision · ${titleize(item.status)}`,
      tone: toneForDecision(item.status),
    })),
    ...(meetings ?? []).map((item) => ({
      id: `meeting-${item.id}`,
      type: "meeting",
      title: item.title,
      description: item.notes || item.attendees_summary || "Meeting logged for this project.",
      at: item.meeting_at || item.created_at,
      badge: "Meeting",
      tone: "info" as const,
    })),
    ...(recentRuns ?? []).map((item) => ({
      id: `run-${item.id}`,
      type: "run",
      title: item.title,
      description: item.summary_text || "Analysis run created.",
      at: item.created_at,
      badge: "Analysis Run",
      tone: "success" as const,
    })),
    ...(recentGateDecisions ?? []).map((item) => ({
      id: `gate-${item.id}`,
      type: "gate",
      title: item.gate_id,
      description: item.rationale,
      at: item.decided_at,
      badge: `Stage Gate · ${item.decision}`,
      tone: toneForDecision(item.decision),
    })),
  ]
    .sort((a, b) => {
      const aTime = a.at ? new Date(a.at).getTime() : 0;
      const bTime = b.at ? new Date(b.at).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 12);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Link href="/projects" className="transition hover:text-foreground">
          Projects
        </Link>
        <ArrowRight className="h-4 w-4" />
        <span className="text-foreground">{project.name}</span>
      </div>

      <header className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)] sm:p-7">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={toneForStatus(project.status)}>{titleize(project.status)}</StatusBadge>
            <StatusBadge tone="info">{titleize(project.plan_type)}</StatusBadge>
            <StatusBadge tone="neutral">{titleize(project.delivery_phase)}</StatusBadge>
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{project.name}</h1>
          <p className="mt-3 max-w-3xl text-sm text-muted-foreground sm:text-base">
            {project.summary || "This project now has a real record inside OpenPlan. Use this detail view as the anchor point for runs, stage gates, deliverables, risks, issues, decisions, and meetings."}
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4"><p className="text-[0.72rem] uppercase tracking-[0.12em] text-muted-foreground">Workspace</p><p className="mt-1 text-sm font-semibold text-foreground">{workspaceData?.name ?? "Unknown"}</p></div>
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4"><p className="text-[0.72rem] uppercase tracking-[0.12em] text-muted-foreground">Tier</p><p className="mt-1 text-sm font-semibold text-foreground">{titleize(workspaceData?.plan ?? "pilot")}</p></div>
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4"><p className="text-[0.72rem] uppercase tracking-[0.12em] text-muted-foreground">Created</p><p className="mt-1 text-sm font-semibold text-foreground">{fmtDateTime(project.created_at)}</p></div>
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4"><p className="text-[0.72rem] uppercase tracking-[0.12em] text-muted-foreground">Updated</p><p className="mt-1 text-sm font-semibold text-foreground">{fmtDateTime(project.updated_at)}</p></div>
          </div>
        </article>

        <article className="rounded-[28px] border border-border/70 bg-[linear-gradient(180deg,rgba(13,24,34,0.96),rgba(8,15,21,0.94))] p-6 text-slate-100 shadow-[0_30px_70px_rgba(0,0,0,0.24)]">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]"><FolderKanban className="h-5 w-5 text-emerald-200" /></span>
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Project control room</p>
              <h2 className="text-xl font-semibold tracking-tight">Operating core is taking shape</h2>
            </div>
          </div>
          <ul className="mt-4 space-y-3 text-sm text-slate-300/82">
            <li className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">Stage-gate template: {workspaceData?.stage_gate_template_id ?? "Not available"}</li>
            <li className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">Template version: {workspaceData?.stage_gate_template_version ?? "Not available"}</li>
            <li className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">Workspace slug: {workspaceData?.slug ?? "Unknown"}</li>
          </ul>
        </article>
      </header>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <ProjectRecordComposer projectId={project.id} />

        <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"><ShieldCheck className="h-5 w-5" /></span>
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Governance</p>
              <h2 className="text-xl font-semibold tracking-tight">Stage-gate decisions</h2>
            </div>
          </div>

          {!recentGateDecisions || recentGateDecisions.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-border/80 bg-background/70 p-5 text-sm text-muted-foreground">No stage-gate decisions recorded yet for this project workspace.</div>
          ) : (
            <div className="mt-5 space-y-3">
              {recentGateDecisions.map((decision) => (
                <div key={decision.id} className="rounded-2xl border border-border/70 bg-background/75 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={toneForDecision(decision.decision)}>{decision.decision}</StatusBadge>
                    <StatusBadge tone="neutral">{decision.gate_id}</StatusBadge>
                    <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{fmtDateTime(decision.decided_at)}</p>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{decision.rationale}</p>
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 rounded-2xl border border-border/70 bg-background/80 p-4 text-sm text-muted-foreground">
            Project-level records are now active below this layer. The next goal is to bind them into evidence packs, reporting, and project lifecycle governance.
          </div>
        </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
          <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><ClipboardCheck className="h-5 w-5" /></span><div><p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Deliverables</p><h2 className="text-xl font-semibold tracking-tight">Outputs to ship</h2></div></div>
          {!deliverables || deliverables.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-border/80 bg-background/70 p-5 text-sm text-muted-foreground">No deliverables yet. Add the first required output in the creation panel.</div> : <div className="mt-5 space-y-3">{deliverables.map((deliverable) => <div key={deliverable.id} className="rounded-2xl border border-border/70 bg-background/75 p-4"><div className="flex flex-wrap items-center gap-2"><StatusBadge tone={toneForDeliverableStatus(deliverable.status)}>{titleize(deliverable.status)}</StatusBadge>{deliverable.owner_label ? <StatusBadge tone="neutral">{deliverable.owner_label}</StatusBadge> : null}{deliverable.due_date ? <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Due {fmtDateTime(deliverable.due_date)}</p> : null}</div><h3 className="mt-2 text-sm font-semibold tracking-tight text-foreground">{deliverable.title}</h3><p className="mt-1 text-sm text-muted-foreground">{deliverable.summary || "No summary yet."}</p></div>)}</div>}
        </article>

        <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
          <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300"><AlertTriangle className="h-5 w-5" /></span><div><p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Risks</p><h2 className="text-xl font-semibold tracking-tight">Threats and mitigations</h2></div></div>
          {!risks || risks.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-border/80 bg-background/70 p-5 text-sm text-muted-foreground">No risks recorded yet.</div> : <div className="mt-5 space-y-3">{risks.map((risk) => <div key={risk.id} className="rounded-2xl border border-border/70 bg-background/75 p-4"><div className="flex flex-wrap items-center gap-2"><StatusBadge tone={toneForRiskSeverity(risk.severity)}>{titleize(risk.severity)}</StatusBadge><StatusBadge tone="neutral">{titleize(risk.status)}</StatusBadge></div><h3 className="mt-2 text-sm font-semibold tracking-tight text-foreground">{risk.title}</h3><p className="mt-1 text-sm text-muted-foreground">{risk.description || "No description yet."}</p>{risk.mitigation ? <p className="mt-2 text-xs text-muted-foreground">Mitigation: {risk.mitigation}</p> : null}</div>)}</div>}
        </article>

        <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
          <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-700 dark:text-rose-300"><Siren className="h-5 w-5" /></span><div><p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Issues</p><h2 className="text-xl font-semibold tracking-tight">Active blockers</h2></div></div>
          {!issues || issues.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-border/80 bg-background/70 p-5 text-sm text-muted-foreground">No issues logged yet.</div> : <div className="mt-5 space-y-3">{issues.map((issue) => <div key={issue.id} className="rounded-2xl border border-border/70 bg-background/75 p-4"><div className="flex flex-wrap items-center gap-2"><StatusBadge tone={toneForRiskSeverity(issue.severity)}>{titleize(issue.severity)}</StatusBadge><StatusBadge tone="neutral">{titleize(issue.status)}</StatusBadge>{issue.owner_label ? <StatusBadge tone="neutral">{issue.owner_label}</StatusBadge> : null}</div><h3 className="mt-2 text-sm font-semibold tracking-tight text-foreground">{issue.title}</h3><p className="mt-1 text-sm text-muted-foreground">{issue.description || "No description yet."}</p></div>)}</div>}
        </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
          <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-700 dark:text-violet-300"><Scale className="h-5 w-5" /></span><div><p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Decisions</p><h2 className="text-xl font-semibold tracking-tight">Why the project moved this way</h2></div></div>
          {!decisions || decisions.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-border/80 bg-background/70 p-5 text-sm text-muted-foreground">No decisions logged yet.</div> : <div className="mt-5 space-y-3">{decisions.map((decision) => <div key={decision.id} className="rounded-2xl border border-border/70 bg-background/75 p-4"><div className="flex flex-wrap items-center gap-2"><StatusBadge tone={toneForDecision(decision.status)}>{titleize(decision.status)}</StatusBadge>{decision.decided_at ? <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{fmtDateTime(decision.decided_at)}</p> : null}</div><h3 className="mt-2 text-sm font-semibold tracking-tight text-foreground">{decision.title}</h3><p className="mt-1 text-sm text-muted-foreground">{decision.rationale}</p>{decision.impact_summary ? <p className="mt-2 text-xs text-muted-foreground">Impact: {decision.impact_summary}</p> : null}</div>)}</div>}
        </article>

        <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
          <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-700 dark:text-sky-300"><MessagesSquare className="h-5 w-5" /></span><div><p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Meetings</p><h2 className="text-xl font-semibold tracking-tight">Notes and coordination history</h2></div></div>
          {!meetings || meetings.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-border/80 bg-background/70 p-5 text-sm text-muted-foreground">No meetings logged yet.</div> : <div className="mt-5 space-y-3">{meetings.map((meeting) => <div key={meeting.id} className="rounded-2xl border border-border/70 bg-background/75 p-4"><div className="flex flex-wrap items-center gap-2"><StatusBadge tone="info">Meeting</StatusBadge>{meeting.meeting_at ? <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{fmtDateTime(meeting.meeting_at)}</p> : null}</div><h3 className="mt-2 text-sm font-semibold tracking-tight text-foreground">{meeting.title}</h3>{meeting.attendees_summary ? <p className="mt-1 text-xs text-muted-foreground">Attendees: {meeting.attendees_summary}</p> : null}<p className="mt-2 text-sm text-muted-foreground">{meeting.notes || "No notes yet."}</p></div>)}</div>}
        </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
          <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><Clock3 className="h-5 w-5" /></span><div><p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Recent analysis activity</p><h2 className="text-xl font-semibold tracking-tight">Latest runs in this project workspace</h2></div></div>
          {!recentRuns || recentRuns.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-border/80 bg-background/70 p-5 text-sm text-muted-foreground">No runs yet. Use <Link href="/explore" className="font-semibold text-foreground underline">Analysis Studio</Link> to create the first project-linked run.</div> : <div className="mt-5 space-y-3">{recentRuns.map((run) => <div key={run.id} className="rounded-2xl border border-border/70 bg-background/75 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold tracking-tight text-foreground">{run.title}</h3><p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{fmtDateTime(run.created_at)}</p></div><p className="mt-2 text-sm text-muted-foreground">{run.summary_text || "Run created with no summary yet."}</p></div>)}</div>}
        </article>

        <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
          <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300"><FileClock className="h-5 w-5" /></span><div><p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Activity timeline</p><h2 className="text-xl font-semibold tracking-tight">Everything happening in one feed</h2></div></div>
          {timelineItems.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-border/80 bg-background/70 p-5 text-sm text-muted-foreground">No project activity yet.</div> : <div className="mt-5 space-y-3">{timelineItems.map((item) => <div key={item.id} className="rounded-2xl border border-border/70 bg-background/75 p-4"><div className="flex flex-wrap items-center gap-2"><StatusBadge tone={item.tone}>{item.badge}</StatusBadge><p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{fmtDateTime(item.at)}</p></div><h3 className="mt-2 text-sm font-semibold tracking-tight text-foreground">{item.title}</h3><p className="mt-1 text-sm text-muted-foreground">{item.description}</p></div>)}</div>}
        </article>
      </div>
    </section>
  );
}
