import { notFound, redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardCheck,
  Clock3,
  Database,
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

type LinkedDatasetItem = {
  datasetId: string;
  name: string;
  status: string;
  relationshipType: string;
  connectorLabel: string | null;
  vintageLabel: string | null;
  lastRefreshedAt: string | null;
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

function toneForDatasetStatus(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "ready") return "success";
  if (status === "refreshing") return "info";
  if (status === "stale") return "warning";
  if (status === "error") return "danger";
  return "neutral";
}

function looksLikePendingSchema(message: string | null | undefined): boolean {
  return /relation .* does not exist|could not find the table|schema cache/i.test(message ?? "");
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

  const datasetLinksResult = await supabase
    .from("data_dataset_project_links")
    .select("dataset_id, relationship_type, linked_at")
    .eq("project_id", project.id)
    .order("linked_at", { ascending: false });

  const datasetLinkRows = looksLikePendingSchema(datasetLinksResult.error?.message)
    ? []
    : ((datasetLinksResult.data ?? []) as Array<{
        dataset_id: string;
        relationship_type: string;
        linked_at: string;
      }>);

  const linkedDatasetIds = datasetLinkRows.map((item) => item.dataset_id);

  const datasetsResult = linkedDatasetIds.length
    ? await supabase
        .from("data_datasets")
        .select("id, connector_id, name, status, vintage_label, last_refreshed_at")
        .in("id", linkedDatasetIds)
    : { data: [], error: null };

  const linkedDatasetRows = looksLikePendingSchema(datasetsResult.error?.message)
    ? []
    : ((datasetsResult.data ?? []) as Array<{
        id: string;
        connector_id: string | null;
        name: string;
        status: string;
        vintage_label: string | null;
        last_refreshed_at: string | null;
      }>);

  const linkedConnectorIds = linkedDatasetRows
    .map((item) => item.connector_id)
    .filter((value): value is string => Boolean(value));

  const connectorsResult = linkedConnectorIds.length
    ? await supabase.from("data_connectors").select("id, display_name").in("id", linkedConnectorIds)
    : { data: [], error: null };

  const connectorMap = new Map(
    (looksLikePendingSchema(connectorsResult.error?.message)
      ? []
      : ((connectorsResult.data ?? []) as Array<{ id: string; display_name: string }>)).map((connector) => [
      connector.id,
      connector.display_name,
    ])
  );

  const datasetMap = new Map(linkedDatasetRows.map((dataset) => [dataset.id, dataset]));
  const linkedDatasets: LinkedDatasetItem[] = datasetLinkRows
    .map((link) => {
      const dataset = datasetMap.get(link.dataset_id);
      if (!dataset) return null;
      return {
        datasetId: dataset.id,
        name: dataset.name,
        status: dataset.status,
        relationshipType: link.relationship_type,
        connectorLabel: dataset.connector_id ? connectorMap.get(dataset.connector_id) ?? null : null,
        vintageLabel: dataset.vintage_label,
        lastRefreshedAt: dataset.last_refreshed_at,
      } satisfies LinkedDatasetItem;
    })
    .filter((item): item is LinkedDatasetItem => Boolean(item))
    .slice(0, 6);

  const dataHubMigrationPending = looksLikePendingSchema(datasetLinksResult.error?.message);

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

  const openRiskCount = (risks ?? []).filter((risk) => risk.status !== "closed" && risk.status !== "mitigated").length;
  const openIssueCount = (issues ?? []).filter((issue) => issue.status !== "resolved").length;

  return (
    <section className="module-page">
      <div className="module-breadcrumb">
        <Link href="/projects" className="transition hover:text-foreground">
          Projects
        </Link>
        <ArrowRight className="h-4 w-4" />
        <span className="text-foreground">{project.name}</span>
      </div>

      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={toneForStatus(project.status)}>{titleize(project.status)}</StatusBadge>
            <StatusBadge tone="info">{titleize(project.plan_type)}</StatusBadge>
            <StatusBadge tone="neutral">{titleize(project.delivery_phase)}</StatusBadge>
            <p className="text-[0.72rem] uppercase tracking-[0.16em] text-muted-foreground">
              Workspace {workspaceData?.name ?? "Unknown"} · Updated {fmtDateTime(project.updated_at)}
            </p>
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">{project.name}</h1>
            <p className="module-intro-description">
              {project.summary ||
                "This project now has a real record inside OpenPlan. Use this detail view as the anchor point for runs, stage gates, deliverables, risks, issues, decisions, meetings, and linked datasets."}
            </p>
          </div>

          <div className="module-summary-grid cols-4">
            <div className="module-summary-card">
              <p className="module-summary-label">Deliverables</p>
              <p className="module-summary-value">{deliverables?.length ?? 0}</p>
              <p className="module-summary-detail">Outputs actively tracked in this control room.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Open risks</p>
              <p className="module-summary-value">{openRiskCount}</p>
              <p className="module-summary-detail">Risks still requiring active attention or mitigation.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Open issues</p>
              <p className="module-summary-value">{openIssueCount}</p>
              <p className="module-summary-detail">Current blockers surfaced for delivery and analysis flow.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Data links</p>
              <p className="module-summary-value">{linkedDatasets.length}</p>
              <p className="module-summary-detail">Linked source records currently visible from Data Hub.</p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <FolderKanban className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Project control room</p>
              <h2 className="module-operator-title">Operating core is now structurally consistent</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            This page now uses the same page-intro and section hierarchy as Dashboard, Projects, and Data Hub, so the
            module feels like part of one system instead of a custom internal screen.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Workspace tier: {titleize(workspaceData?.plan ?? "pilot")}</div>
            <div className="module-operator-item">
              Stage-gate template: {workspaceData?.stage_gate_template_id ?? "Not available"}
            </div>
            <div className="module-operator-item">
              Template version: {workspaceData?.stage_gate_template_version ?? "Not available"} · Workspace slug:{" "}
              {workspaceData?.slug ?? "Unknown"}
            </div>
          </div>
        </article>
      </header>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <ProjectRecordComposer projectId={project.id} />

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Governance</p>
                <h2 className="module-section-title">Stage-gate decisions</h2>
                <p className="module-section-description">
                  Governance remains prominent, but no longer visually competes with the page intro or dense record lanes.
                </p>
              </div>
            </div>
          </div>

          {!recentGateDecisions || recentGateDecisions.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">
              No stage-gate decisions recorded yet for this project workspace.
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {recentGateDecisions.map((decision) => (
                <div key={decision.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForDecision(decision.decision)}>{decision.decision}</StatusBadge>
                      <StatusBadge tone="neutral">{decision.gate_id}</StatusBadge>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{decision.gate_id}</h3>
                        <p className="module-record-stamp">{fmtDateTime(decision.decided_at)}</p>
                      </div>
                      <p className="module-record-summary">{decision.rationale}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="module-note mt-5 text-sm">
            Project-level records are now active below this layer. The next goal is to bind them into evidence packs,
            reporting, and project lifecycle governance.
          </div>
        </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <ClipboardCheck className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Deliverables</p>
                <h2 className="module-section-title">Outputs to ship</h2>
              </div>
            </div>
          </div>
          {!deliverables || deliverables.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">
              No deliverables yet. Add the first required output in the creation lane.
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {deliverables.map((deliverable) => (
                <div key={deliverable.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForDeliverableStatus(deliverable.status)}>
                        {titleize(deliverable.status)}
                      </StatusBadge>
                      {deliverable.owner_label ? <StatusBadge tone="neutral">{deliverable.owner_label}</StatusBadge> : null}
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{deliverable.title}</h3>
                        {deliverable.due_date ? (
                          <p className="module-record-stamp">Due {fmtDateTime(deliverable.due_date)}</p>
                        ) : null}
                      </div>
                      <p className="module-record-summary">{deliverable.summary || "No summary yet."}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Risks</p>
                <h2 className="module-section-title">Threats and mitigations</h2>
              </div>
            </div>
          </div>
          {!risks || risks.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No risks recorded yet.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {risks.map((risk) => (
                <div key={risk.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForRiskSeverity(risk.severity)}>{titleize(risk.severity)}</StatusBadge>
                      <StatusBadge tone="neutral">{titleize(risk.status)}</StatusBadge>
                    </div>
                    <div className="space-y-1.5">
                      <h3 className="module-record-title">{risk.title}</h3>
                      <p className="module-record-summary">{risk.description || "No description yet."}</p>
                    </div>
                    {risk.mitigation ? (
                      <div className="module-record-meta">
                        <span className="module-record-chip">Mitigation {risk.mitigation}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-700 dark:text-rose-300">
                <Siren className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Issues</p>
                <h2 className="module-section-title">Active blockers</h2>
              </div>
            </div>
          </div>
          {!issues || issues.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No issues logged yet.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {issues.map((issue) => (
                <div key={issue.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForRiskSeverity(issue.severity)}>{titleize(issue.severity)}</StatusBadge>
                      <StatusBadge tone="neutral">{titleize(issue.status)}</StatusBadge>
                      {issue.owner_label ? <StatusBadge tone="neutral">{issue.owner_label}</StatusBadge> : null}
                    </div>
                    <div className="space-y-1.5">
                      <h3 className="module-record-title">{issue.title}</h3>
                      <p className="module-record-summary">{issue.description || "No description yet."}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-700 dark:text-violet-300">
                <Scale className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Decisions</p>
                <h2 className="module-section-title">Why the project moved this way</h2>
              </div>
            </div>
          </div>
          {!decisions || decisions.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No decisions logged yet.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {decisions.map((decision) => (
                <div key={decision.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForDecision(decision.status)}>{titleize(decision.status)}</StatusBadge>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{decision.title}</h3>
                        {decision.decided_at ? (
                          <p className="module-record-stamp">{fmtDateTime(decision.decided_at)}</p>
                        ) : null}
                      </div>
                      <p className="module-record-summary">{decision.rationale}</p>
                    </div>
                    {decision.impact_summary ? (
                      <div className="module-record-meta">
                        <span className="module-record-chip">Impact {decision.impact_summary}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-700 dark:text-sky-300">
                <MessagesSquare className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Meetings</p>
                <h2 className="module-section-title">Notes and coordination history</h2>
              </div>
            </div>
          </div>
          {!meetings || meetings.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No meetings logged yet.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {meetings.map((meeting) => (
                <div key={meeting.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone="info">Meeting</StatusBadge>
                      {meeting.attendees_summary ? <StatusBadge tone="neutral">Attendees logged</StatusBadge> : null}
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{meeting.title}</h3>
                        {meeting.meeting_at ? <p className="module-record-stamp">{fmtDateTime(meeting.meeting_at)}</p> : null}
                      </div>
                      {meeting.attendees_summary ? (
                        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                          Attendees: {meeting.attendees_summary}
                        </p>
                      ) : null}
                      <p className="module-record-summary">{meeting.notes || "No notes yet."}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                <Database className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Data dependencies</p>
                <h2 className="module-section-title">Linked datasets</h2>
              </div>
            </div>
          </div>
          {dataHubMigrationPending ? (
            <div className="module-alert mt-5 text-sm">
              Data Hub schema is pending in the current database, so project-linked datasets will appear here after the
              migration is applied.
            </div>
          ) : linkedDatasets.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">
              No datasets linked yet. Use{" "}
              <Link href="/data-hub" className="font-semibold text-foreground underline">
                Data Hub
              </Link>{" "}
              to register a source and connect it back to this project.
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {linkedDatasets.map((dataset) => (
                <div key={dataset.datasetId} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForDatasetStatus(dataset.status)}>{titleize(dataset.status)}</StatusBadge>
                      <StatusBadge tone="info">{titleize(dataset.relationshipType)}</StatusBadge>
                      {dataset.connectorLabel ? <StatusBadge tone="neutral">{dataset.connectorLabel}</StatusBadge> : null}
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{dataset.name}</h3>
                        <p className="module-record-stamp">Refreshed {fmtDateTime(dataset.lastRefreshedAt)}</p>
                      </div>
                      <p className="module-record-summary">
                        {dataset.vintageLabel ? `Vintage: ${dataset.vintageLabel}` : "Vintage not captured yet."}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <Clock3 className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Recent analysis activity</p>
                <h2 className="module-section-title">Latest runs in this project workspace</h2>
              </div>
            </div>
          </div>
          {!recentRuns || recentRuns.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">
              No runs yet. Use{" "}
              <Link href="/explore" className="font-semibold text-foreground underline">
                Analysis Studio
              </Link>{" "}
              to create the first project-linked run.
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {recentRuns.map((run) => (
                <div key={run.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone="success">Analysis run</StatusBadge>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{run.title}</h3>
                        <p className="module-record-stamp">{fmtDateTime(run.created_at)}</p>
                      </div>
                      <p className="module-record-summary">{run.summary_text || "Run created with no summary yet."}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300">
              <FileClock className="h-5 w-5" />
            </span>
            <div className="module-section-heading">
              <p className="module-section-label">Activity timeline</p>
              <h2 className="module-section-title">Everything happening in one feed</h2>
              <p className="module-section-description">
                The feed is intentionally tighter than the page intro: type first, timestamp second, short read after that.
              </p>
            </div>
          </div>
        </div>
        {timelineItems.length === 0 ? (
          <div className="module-empty-state mt-5 text-sm">No project activity yet.</div>
        ) : (
          <div className="mt-5 grid gap-3 xl:grid-cols-2">
            {timelineItems.map((item) => (
              <div key={item.id} className="module-record-row">
                <div className="module-record-main">
                  <div className="module-record-kicker">
                    <StatusBadge tone={item.tone}>{item.badge}</StatusBadge>
                    <span className="module-record-chip">{titleize(item.type)}</span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="module-record-title">{item.title}</h3>
                      <p className="module-record-stamp">{fmtDateTime(item.at)}</p>
                    </div>
                    <p className="module-record-summary">{item.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
