import { notFound, redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardCheck,
  Clock3,
  Database,
  FileClock,
  FileSpreadsheet,
  FolderKanban,
  MessagesSquare,
  Scale,
  ShieldCheck,
  Siren,
  Target,
} from "lucide-react";
import Link from "next/link";
import { ProjectRecordComposer } from "@/components/projects/project-record-composer";
import { StatusBadge } from "@/components/ui/status-badge";
import { summarizeBillingInvoiceRecords } from "@/lib/billing/invoice-records";
import { buildProjectControlsSummary } from "@/lib/projects/controls";
import { createClient } from "@/lib/supabase/server";
import { buildProjectStageGateSummary } from "@/lib/stage-gates/summary";

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

type MilestoneRow = {
  id: string;
  title: string;
  summary: string | null;
  milestone_type: string;
  phase_code: string;
  status: string;
  owner_label: string | null;
  target_date: string | null;
  actual_date: string | null;
  notes: string | null;
  created_at: string;
};

type SubmittalRow = {
  id: string;
  title: string;
  submittal_type: string;
  status: string;
  agency_label: string | null;
  reference_number: string | null;
  due_date: string | null;
  submitted_at: string | null;
  review_cycle: number;
  notes: string | null;
  created_at: string;
};

type BillingInvoiceRow = {
  id: string;
  invoice_number: string;
  consultant_name: string | null;
  billing_basis: string;
  status: string;
  invoice_date: string | null;
  due_date: string | null;
  amount: number | string | null;
  retention_percent: number | string | null;
  retention_amount: number | string | null;
  net_amount: number | string | null;
  supporting_docs_status: string;
  submitted_to: string | null;
  caltrans_posture: string;
  notes: string | null;
  created_at: string;
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

function fmtCurrency(value: number | string | null | undefined): string {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value ?? "0");
  const safeValue = Number.isFinite(parsed) ? parsed : 0;
  return safeValue.toLocaleString("en-US", { style: "currency", currency: "USD" });
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

function toneForMilestoneStatus(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "complete") return "success";
  if (status === "in_progress") return "info";
  if (status === "blocked") return "warning";
  if (status === "scheduled") return "neutral";
  return "neutral";
}

function toneForSubmittalStatus(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "accepted") return "success";
  if (status === "submitted") return "info";
  if (status === "internal_review") return "warning";
  if (status === "revise_and_resubmit") return "danger";
  return "neutral";
}

function toneForInvoiceStatus(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "paid") return "success";
  if (status === "submitted" || status === "approved_for_payment") return "info";
  if (status === "internal_review") return "warning";
  if (status === "rejected") return "danger";
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

function toneForControlHealth(health: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (health === "stable") return "success";
  if (health === "attention") return "warning";
  if (health === "active") return "info";
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
    .select("id, gate_id, decision, rationale, decided_at, missing_artifacts")
    .eq("workspace_id", project.workspace_id)
    .order("decided_at", { ascending: false })
    .limit(200);

  const milestoneResult = await supabase
    .from("project_milestones")
    .select("id, title, summary, milestone_type, phase_code, status, owner_label, target_date, actual_date, notes, created_at")
    .eq("project_id", project.id)
    .order("target_date", { ascending: true })
    .limit(8);
  const milestones = looksLikePendingSchema(milestoneResult.error?.message) ? [] : ((milestoneResult.data ?? []) as MilestoneRow[]);
  const projectMilestonesPending = looksLikePendingSchema(milestoneResult.error?.message);

  const submittalResult = await supabase
    .from("project_submittals")
    .select("id, title, submittal_type, status, agency_label, reference_number, due_date, submitted_at, review_cycle, notes, created_at")
    .eq("project_id", project.id)
    .order("due_date", { ascending: true })
    .limit(8);
  const submittals = looksLikePendingSchema(submittalResult.error?.message) ? [] : ((submittalResult.data ?? []) as SubmittalRow[]);
  const projectSubmittalsPending = looksLikePendingSchema(submittalResult.error?.message);

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

  const invoiceResult = await supabase
    .from("billing_invoice_records")
    .select(
      "id, invoice_number, consultant_name, billing_basis, status, invoice_date, due_date, amount, retention_percent, retention_amount, net_amount, supporting_docs_status, submitted_to, caltrans_posture, notes, created_at"
    )
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(6);
  const projectInvoices = looksLikePendingSchema(invoiceResult.error?.message) ? [] : ((invoiceResult.data ?? []) as BillingInvoiceRow[]);
  const projectInvoicesPending = looksLikePendingSchema(invoiceResult.error?.message);

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

  const stageGateSummary = buildProjectStageGateSummary(recentGateDecisions as Array<{
    gate_id: string;
    decision: string;
    rationale: string | null;
    decided_at: string | null;
    missing_artifacts?: string[] | null;
  }>);

  const projectControlsSummary = buildProjectControlsSummary(milestones, submittals, projectInvoices);
  const invoiceSummary = summarizeBillingInvoiceRecords(projectInvoices);

  const timelineItems: TimelineItem[] = [
    ...milestones.map((item) => ({
      id: `milestone-${item.id}`,
      type: "milestone",
      title: item.title,
      description: item.summary || item.notes || "Milestone added to the project control room.",
      at: item.actual_date || item.target_date || item.created_at,
      badge: `Milestone · ${titleize(item.status)}`,
      tone: toneForMilestoneStatus(item.status),
    })),
    ...submittals.map((item) => ({
      id: `submittal-${item.id}`,
      type: "submittal",
      title: item.title,
      description:
        item.notes ||
        `${titleize(item.submittal_type)}${item.agency_label ? ` · ${item.agency_label}` : ""}`,
      at: item.submitted_at || item.due_date || item.created_at,
      badge: `Submittal · ${titleize(item.status)}`,
      tone: toneForSubmittalStatus(item.status),
    })),
    ...projectInvoices.map((item) => ({
      id: `invoice-${item.id}`,
      type: "invoice",
      title: item.invoice_number,
      description: `${fmtCurrency(item.net_amount)} net${item.submitted_to ? ` · ${item.submitted_to}` : ""}`,
      at: item.invoice_date || item.created_at,
      badge: `Invoice · ${titleize(item.status)}`,
      tone: toneForInvoiceStatus(item.status),
    })),
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
            <StatusBadge tone={toneForControlHealth(projectControlsSummary.controlHealth)}>
              Controls {titleize(projectControlsSummary.controlHealth)}
            </StatusBadge>
            <p className="text-[0.72rem] uppercase tracking-[0.16em] text-muted-foreground">
              Workspace {workspaceData?.name ?? "Unknown"} · Updated {fmtDateTime(project.updated_at)}
            </p>
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">{project.name}</h1>
            <p className="module-intro-description">
              {project.summary ||
                "This project now has a real record inside OpenPlan. Use this detail view as the anchor point for runs, stage gates, milestones, submittals, invoices, deliverables, risks, issues, decisions, meetings, and linked datasets."}
            </p>
          </div>

          <div className="module-summary-grid cols-5">
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
              <p className="module-summary-label">Milestones</p>
              <p className="module-summary-value">{projectControlsSummary.milestoneCount}</p>
              <p className="module-summary-detail">Phase checkpoints and operator deadlines on the record.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Pending submittals</p>
              <p className="module-summary-value">{projectControlsSummary.pendingSubmittalCount}</p>
              <p className="module-summary-detail">Packets still in draft, review, or submitted posture.</p>
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
              <h2 className="module-operator-title">LAPM-oriented controls are now visible, not implied</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            OpenPlan now treats milestones, submittals, and invoice posture as first-class project controls instead of burying them inside generic notes.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Workspace tier: {titleize(workspaceData?.plan ?? "pilot")}</div>
            <div className="module-operator-item">
              Stage-gate template: {workspaceData?.stage_gate_template_id ?? "Not available"}
            </div>
            <div className="module-operator-item">
              Template version: {workspaceData?.stage_gate_template_version ?? "Not available"} · Workspace slug: {workspaceData?.slug ?? "Unknown"}
            </div>
            <div className="module-operator-item">CALTRANS posture is aligned to gate domains and invoice/submittal workflow, while exact exhibit/form IDs remain deferred in v0.1.</div>
          </div>
        </article>
      </header>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <ProjectRecordComposer projectId={project.id} />

        <article id="project-governance" className="module-section-surface scroll-mt-24">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Governance</p>
                <h2 className="module-section-title">Stage-gate compliance cockpit</h2>
                <p className="module-section-description">
                  This is the project-delivery control layer: where LAPM, CEQA/VMT, outreach, and programming readiness stop being abstract and start becoming an explicit workflow.
                </p>
              </div>
            </div>
          </div>

          <div className="module-summary-grid cols-4 mt-5">
            <div className="module-summary-card">
              <p className="module-summary-label">Pass gates</p>
              <p className="module-summary-value">{stageGateSummary.passCount}</p>
              <p className="module-summary-detail">Recorded passes against the active California gate scaffold.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Hold gates</p>
              <p className="module-summary-value">{stageGateSummary.holdCount}</p>
              <p className="module-summary-detail">Gates currently blocked by missing evidence or unresolved rationale.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Not started</p>
              <p className="module-summary-value">{stageGateSummary.notStartedCount}</p>
              <p className="module-summary-detail">Template-defined gates with no recorded decision yet.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Next gate</p>
              <p className="module-summary-value text-base leading-tight">
                {stageGateSummary.nextGate ? `G${String(stageGateSummary.nextGate.sequence).padStart(2, "0")}` : "None"}
              </p>
              <p className="module-summary-detail">{stageGateSummary.nextGate?.name ?? "All gates currently pass."}</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 mt-5">
            <div className="rounded-3xl border border-border/70 bg-background/80 p-5">
              <div className="flex items-center gap-3">
                <FileClock className="h-5 w-5 text-amber-500" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Blocking condition</p>
                  <h3 className="text-sm font-semibold text-foreground">{stageGateSummary.blockedGate?.name ?? "No gate currently on formal hold"}</h3>
                </div>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {stageGateSummary.blockedGate?.rationale ?? "Record the first HOLD decision to surface the exact compliance blockage here."}
              </p>
              {stageGateSummary.blockedGate?.missingArtifacts.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {stageGateSummary.blockedGate.missingArtifacts.map((artifact) => (
                    <StatusBadge key={artifact} tone="warning">Missing {artifact}</StatusBadge>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="rounded-3xl border border-border/70 bg-background/80 p-5">
              <div className="flex items-center gap-3">
                <Clock3 className="h-5 w-5 text-sky-500" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Readiness cue</p>
                  <h3 className="text-sm font-semibold text-foreground">
                    {stageGateSummary.nextGate ? `${stageGateSummary.nextGate.gateId} · ${stageGateSummary.nextGate.name}` : "Gate sequence complete"}
                  </h3>
                </div>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {stageGateSummary.nextGate
                  ? `${stageGateSummary.nextGate.requiredEvidenceCount} required evidence item${stageGateSummary.nextGate.requiredEvidenceCount === 1 ? "" : "s"} defined in the active template. ${stageGateSummary.nextGate.operatorControlEvidenceCount > 0 ? `${stageGateSummary.nextGate.operatorControlEvidenceCount} PM/invoicing operator control profile${stageGateSummary.nextGate.operatorControlEvidenceCount === 1 ? " is" : "s are"} available for the readiness pack.` : "Build the evidence pack before expecting a PASS decision."}`
                  : "Every stage gate in the active template currently has a recorded PASS decision."}
              </p>
            </div>
          </div>

          <div className="mt-5 module-record-list">
            {stageGateSummary.gates.map((gate) => (
              <div key={gate.gateId} className="module-record-row">
                <div className="module-record-main">
                  <div className="module-record-kicker">
                    <StatusBadge tone={gate.workflowState === "pass" ? "success" : gate.workflowState === "hold" ? "warning" : "neutral"}>
                      {gate.decisionLabel}
                    </StatusBadge>
                    <StatusBadge tone="neutral">{gate.gateId}</StatusBadge>
                    <StatusBadge tone="info">{gate.requiredEvidenceCount} required evidence</StatusBadge>
                    {gate.operatorControlEvidenceCount > 0 ? (
                      <StatusBadge tone="info">{gate.operatorControlEvidenceCount} PM/invoicing controls</StatusBadge>
                    ) : null}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="module-record-title">{gate.sequence}. {gate.name}</h3>
                      <p className="module-record-stamp">{gate.decidedAt ? fmtDateTime(gate.decidedAt) : "No decision yet"}</p>
                    </div>
                    <p className="module-record-summary">{gate.rationale}</p>
                  </div>

                  <div className="module-record-meta">
                    {gate.lapmMappings.slice(0, 2).map((item) => (
                      <span key={`${gate.gateId}-lapm-${item}`} className="module-record-chip">LAPM {item}</span>
                    ))}
                    {gate.ceqaVmtMappings.slice(0, 2).map((item) => (
                      <span key={`${gate.gateId}-ceqa-${item}`} className="module-record-chip">CEQA/VMT {item}</span>
                    ))}
                    {gate.outreachMappings.slice(0, 1).map((item) => (
                      <span key={`${gate.gateId}-outreach-${item}`} className="module-record-chip">Outreach {item}</span>
                    ))}
                    {gate.stipRtipMappings.slice(0, 1).map((item) => (
                      <span key={`${gate.gateId}-stip-${item}`} className="module-record-chip">Programming {item}</span>
                    ))}
                  </div>

                  {gate.evidencePreview.length > 0 ? (
                    <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                      <p className="font-medium text-foreground">Evidence preview</p>
                      <ul className="list-disc space-y-1 pl-5">
                        {gate.evidencePreview.map((evidence) => (
                          <li key={evidence.evidence_id}>
                            <div>
                              {evidence.title}
                              {evidence.conditional_required_when ? ` (${evidence.conditional_required_when})` : ""}
                            </div>
                            {evidence.operatorControlTitle ? (
                              <div className="mt-1 space-y-1 pl-1 text-xs text-muted-foreground">
                                <p>
                                  PM/invoicing controls: {evidence.operatorControlTitle} · {evidence.operatorControlFieldCount} field{evidence.operatorControlFieldCount === 1 ? "" : "s"}
                                </p>
                                {evidence.operatorControlGoal ? <p>{evidence.operatorControlGoal}</p> : null}
                                {evidence.operatorControlAcceptancePreview.length > 0 ? (
                                  <ul className="list-disc space-y-1 pl-5">
                                    {evidence.operatorControlAcceptancePreview.map((criterion) => (
                                      <li key={`${evidence.evidence_id}-${criterion}`}>{criterion}</li>
                                    ))}
                                  </ul>
                                ) : null}
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {gate.missingArtifacts.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {gate.missingArtifacts.map((artifact) => (
                        <StatusBadge key={`${gate.gateId}-${artifact}`} tone="warning">Missing {artifact}</StatusBadge>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="module-note mt-5 text-sm">
            California/LAPM alignment is honest here: OpenPlan now tracks gate logic, evidence posture, milestones, submittals, and invoicing cues, but it does not yet generate exact exhibit/form packets automatically.
          </div>
        </article>
      </div>

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <Target className="h-5 w-5" />
            </span>
            <div className="module-section-heading">
              <p className="module-section-label">Project controls</p>
              <h2 className="module-section-title">Milestone, submittal, and invoice readiness</h2>
              <p className="module-section-description">
                This is the operator-facing slice for LAPM-style project controls. It is deliberately honest: workflow posture is live now, while exact Caltrans exhibit/form numbering remains deferred.
              </p>
            </div>
          </div>
        </div>

        <div className="module-summary-grid cols-5 mt-5">
          <div className="module-summary-card">
            <p className="module-summary-label">Delivery phase</p>
            <p className="module-summary-value text-base leading-tight">{titleize(project.delivery_phase)}</p>
            <p className="module-summary-detail">Current top-level phase on the project record.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Milestones</p>
            <p className="module-summary-value">{projectControlsSummary.milestoneCount}</p>
            <p className="module-summary-detail">{projectControlsSummary.completedMilestoneCount} complete · {projectControlsSummary.blockedMilestoneCount} blocked.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Pending submittals</p>
            <p className="module-summary-value">{projectControlsSummary.pendingSubmittalCount}</p>
            <p className="module-summary-detail">{projectControlsSummary.overdueSubmittalCount} overdue for review or agency response.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Overdue controls</p>
            <p className="module-summary-value">{projectControlsSummary.overdueMilestoneCount + projectControlsSummary.overdueSubmittalCount}</p>
            <p className="module-summary-detail">Milestones + submittals currently behind target dates.</p>
          </div>
          <div className="module-summary-card">
            <p className="module-summary-label">Outstanding invoices</p>
            <p className="module-summary-value text-base leading-tight">{fmtCurrency(invoiceSummary.outstandingNetAmount)}</p>
            <p className="module-summary-detail">{invoiceSummary.submittedCount} invoice record(s) still in review or payment flow.</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3 mt-5">
          <div className="rounded-3xl border border-border/70 bg-background/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Next milestone</p>
            <h3 className="mt-2 text-sm font-semibold text-foreground">{projectControlsSummary.nextMilestone?.title ?? "No upcoming milestone recorded"}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {projectControlsSummary.nextMilestone
                ? `${titleize(projectControlsSummary.nextMilestone.phase_code)} · target ${fmtDateTime(projectControlsSummary.nextMilestone.target_date)}`
                : "Add the next phase checkpoint or approval target to make schedule pressure visible."}
            </p>
          </div>
          <div className="rounded-3xl border border-border/70 bg-background/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Next submittal</p>
            <h3 className="mt-2 text-sm font-semibold text-foreground">{projectControlsSummary.nextSubmittal?.title ?? "No upcoming submittal recorded"}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {projectControlsSummary.nextSubmittal
                ? `${titleize(projectControlsSummary.nextSubmittal.submittal_type)} · due ${fmtDateTime(projectControlsSummary.nextSubmittal.due_date)}`
                : "Add the next packet, reimbursement claim, or agency handoff to expose review cadence."}
            </p>
          </div>
          <div className="rounded-3xl border border-border/70 bg-background/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Invoice posture</p>
            <h3 className="mt-2 text-sm font-semibold text-foreground">{invoiceSummary.totalCount ? `${invoiceSummary.totalCount} invoice record(s)` : "No invoice records yet"}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {invoiceSummary.totalCount
                ? `${fmtCurrency(invoiceSummary.paidNetAmount)} paid · ${invoiceSummary.overdueCount} overdue. Net requested ${fmtCurrency(invoiceSummary.totalNetAmount)}.`
                : "The register is ready for consulting/project-delivery invoices instead of SaaS-only subscription state."}
            </p>
          </div>
        </div>

        <div className="module-note mt-5 text-sm">
          Exact CALTRANS/LAPM exhibit/form IDs, claim packet generation, and agency-specific packet templates remain deferred. What works now is the operator control surface: milestone tracking, submittal tracking, and invoice register scaffolding tied to the project record.
        </div>
      </article>

      <div className="grid gap-6 xl:grid-cols-3">
        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-700 dark:text-indigo-300">
                <Target className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Milestones</p>
                <h2 className="module-section-title">Phase checkpoints</h2>
              </div>
            </div>
          </div>
          {projectMilestonesPending ? (
            <div className="module-alert mt-5 text-sm">Project milestones will appear after the Lane C migration is applied to the database.</div>
          ) : milestones.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No milestones recorded yet.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {milestones.map((milestone) => (
                <div key={milestone.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForMilestoneStatus(milestone.status)}>{titleize(milestone.status)}</StatusBadge>
                      <StatusBadge tone="neutral">{titleize(milestone.phase_code)}</StatusBadge>
                      <StatusBadge tone="info">{titleize(milestone.milestone_type)}</StatusBadge>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{milestone.title}</h3>
                        <p className="module-record-stamp">{milestone.target_date ? `Target ${fmtDateTime(milestone.target_date)}` : "No target date"}</p>
                      </div>
                      <p className="module-record-summary">{milestone.summary || milestone.notes || "No milestone summary yet."}</p>
                    </div>
                    <div className="module-record-meta">
                      {milestone.owner_label ? <span className="module-record-chip">Owner {milestone.owner_label}</span> : null}
                      {milestone.actual_date ? <span className="module-record-chip">Actual {fmtDateTime(milestone.actual_date)}</span> : null}
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
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-700 dark:text-sky-300">
                <FileClock className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Submittals</p>
                <h2 className="module-section-title">Packets in review flow</h2>
              </div>
            </div>
          </div>
          {projectSubmittalsPending ? (
            <div className="module-alert mt-5 text-sm">Project submittals will appear after the Lane C migration is applied to the database.</div>
          ) : submittals.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No submittals recorded yet.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {submittals.map((submittal) => (
                <div key={submittal.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForSubmittalStatus(submittal.status)}>{titleize(submittal.status)}</StatusBadge>
                      <StatusBadge tone="info">{titleize(submittal.submittal_type)}</StatusBadge>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{submittal.title}</h3>
                        <p className="module-record-stamp">{submittal.due_date ? `Due ${fmtDateTime(submittal.due_date)}` : "No due date"}</p>
                      </div>
                      <p className="module-record-summary">{submittal.notes || "No submittal notes yet."}</p>
                    </div>
                    <div className="module-record-meta">
                      {submittal.agency_label ? <span className="module-record-chip">Agency {submittal.agency_label}</span> : null}
                      {submittal.reference_number ? <span className="module-record-chip">Ref {submittal.reference_number}</span> : null}
                      <span className="module-record-chip">Cycle {submittal.review_cycle}</span>
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
                <FileSpreadsheet className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Invoices</p>
                <h2 className="module-section-title">Project-linked billing register</h2>
              </div>
            </div>
          </div>
          {projectInvoicesPending ? (
            <div className="module-alert mt-5 text-sm">Invoice records will appear after the Lane C migration is applied to the database.</div>
          ) : projectInvoices.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No invoice records linked to this project yet.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {projectInvoices.map((invoice) => (
                <div key={invoice.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForInvoiceStatus(invoice.status)}>{titleize(invoice.status)}</StatusBadge>
                      <StatusBadge tone="info">{titleize(invoice.billing_basis)}</StatusBadge>
                      <StatusBadge tone="neutral">{titleize(invoice.supporting_docs_status)}</StatusBadge>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{invoice.invoice_number}</h3>
                        <p className="module-record-stamp">{fmtCurrency(invoice.net_amount)}</p>
                      </div>
                      <p className="module-record-summary">
                        {invoice.notes || `${titleize(invoice.caltrans_posture)}${invoice.submitted_to ? ` · ${invoice.submitted_to}` : ""}`}
                      </p>
                    </div>
                    <div className="module-record-meta">
                      {invoice.invoice_date ? <span className="module-record-chip">Invoice {fmtDateTime(invoice.invoice_date)}</span> : null}
                      {invoice.due_date ? <span className="module-record-chip">Due {fmtDateTime(invoice.due_date)}</span> : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <article id="project-deliverables" className="module-section-surface scroll-mt-24">
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
            <div className="module-empty-state mt-5 text-sm">No deliverables yet. Add the first required output in the creation lane.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {deliverables.map((deliverable) => (
                <div key={deliverable.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForDeliverableStatus(deliverable.status)}>{titleize(deliverable.status)}</StatusBadge>
                      {deliverable.owner_label ? <StatusBadge tone="neutral">{deliverable.owner_label}</StatusBadge> : null}
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{deliverable.title}</h3>
                        {deliverable.due_date ? <p className="module-record-stamp">Due {fmtDateTime(deliverable.due_date)}</p> : null}
                      </div>
                      <p className="module-record-summary">{deliverable.summary || "No summary yet."}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article id="project-risks" className="module-section-surface scroll-mt-24">
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

        <article id="project-issues" className="module-section-surface scroll-mt-24">
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
        <article id="project-decisions" className="module-section-surface scroll-mt-24">
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
                        {decision.decided_at ? <p className="module-record-stamp">{fmtDateTime(decision.decided_at)}</p> : null}
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

        <article id="project-meetings" className="module-section-surface scroll-mt-24">
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
                        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Attendees: {meeting.attendees_summary}</p>
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
              Data Hub schema is pending in the current database, so project-linked datasets will appear here after the migration is applied.
            </div>
          ) : linkedDatasets.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">
              No datasets linked yet. Use <Link href="/data-hub" className="font-semibold text-foreground underline">Data Hub</Link> to register a source and connect it back to this project.
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
                      <p className="module-record-summary">{dataset.vintageLabel ? `Vintage: ${dataset.vintageLabel}` : "Vintage not captured yet."}</p>
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
              No runs yet. Use <Link href="/explore" className="font-semibold text-foreground underline">Analysis Studio</Link> to create the first project-linked run.
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
