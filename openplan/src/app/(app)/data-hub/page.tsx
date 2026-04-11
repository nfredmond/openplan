import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Database,
  FolderKanban,
  Link2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { DataHubRecordComposer } from "@/components/data-hub/data-hub-record-composer";
import { WorkspaceCommandBoard } from "@/components/operations/workspace-command-board";
import { StatusBadge } from "@/components/ui/status-badge";
import { buildWorkspaceOperationsSummaryFromSourceRows } from "@/lib/operations/workspace-summary";
import { createClient } from "@/lib/supabase/server";

type MembershipRow = {
  workspace_id: string;
  role: string;
  workspaces:
    | {
        name: string | null;
        plan: string | null;
      }
    | Array<{
        name: string | null;
        plan: string | null;
      }>
    | null;
};

type ConnectorRow = {
  id: string;
  key: string;
  display_name: string;
  source_type: string;
  category: string;
  status: string;
  cadence: string;
  auth_mode: string;
  endpoint_url: string | null;
  owner_label: string | null;
  description: string | null;
  policy_monitor_enabled: boolean;
  last_sync_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  updated_at: string;
};

type DatasetRow = {
  id: string;
  connector_id: string | null;
  name: string;
  status: string;
  geography_scope: string;
  geometry_attachment: string;
  thematic_metric_key: string | null;
  thematic_metric_label: string | null;
  coverage_summary: string | null;
  vintage_label: string | null;
  source_url: string | null;
  license_label: string | null;
  citation_text: string | null;
  schema_version: string | null;
  checksum: string | null;
  row_count: number | null;
  refresh_cadence: string;
  last_refreshed_at: string | null;
  notes: string | null;
  updated_at: string;
};

type RefreshJobRow = {
  id: string;
  connector_id: string | null;
  dataset_id: string | null;
  job_name: string;
  job_type: string;
  status: string;
  refresh_mode: string;
  started_at: string | null;
  completed_at: string | null;
  records_written: number | null;
  triggered_by_label: string | null;
  error_summary: string | null;
  created_at: string;
};

type DatasetProjectLinkRow = {
  dataset_id: string;
  project_id: string;
  relationship_type: string;
  linked_at: string;
};

type ProjectRow = {
  id: string;
  name: string;
  status: string;
  delivery_phase: string | null;
  updated_at: string;
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

function toneForConnectorStatus(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "active") return "success";
  if (status === "degraded") return "warning";
  if (status === "offline") return "danger";
  if (status === "draft") return "neutral";
  return "neutral";
}

function toneForDatasetStatus(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "ready") return "success";
  if (status === "refreshing") return "info";
  if (status === "stale") return "warning";
  if (status === "error") return "danger";
  if (status === "archived") return "neutral";
  return "neutral";
}

function toneForRefreshStatus(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "succeeded") return "success";
  if (status === "running") return "info";
  if (status === "queued") return "neutral";
  if (status === "failed") return "danger";
  if (status === "cancelled") return "warning";
  return "neutral";
}

function looksLikePendingSchema(message: string | null | undefined): boolean {
  return /relation .* does not exist|could not find the table|schema cache/i.test(message ?? "");
}

export default async function DataHubPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces(name, plan)")
    .eq("user_id", user.id)
    .limit(1);

  const membership = memberships?.[0] as MembershipRow | undefined;
  const workspace = Array.isArray(membership?.workspaces)
    ? membership?.workspaces[0] ?? null
    : membership?.workspaces ?? null;

  if (!membership) {
    return (
      <section className="module-page">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <ShieldAlert className="h-3.5 w-3.5" />
            Workspace access required
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">Data Hub needs an authenticated workspace membership</h1>
            <p className="module-intro-description">
              Sign into a workspace or create a project workspace first. Data Hub records are scoped to authenticated
              OpenPlan workspaces and are not available in preview mode.
            </p>
          </div>
          <div className="module-inline-list mt-5">
            <Link href="/projects" className="module-inline-item transition hover:text-primary">
              Open Projects
            </Link>
            <Link href="/dashboard" className="module-inline-item transition hover:text-primary">
              Back to Overview
            </Link>
          </div>
        </article>
      </section>
    );
  }

  const workspaceId = membership.workspace_id;

  const [
    connectorsResult,
    datasetsResult,
    refreshJobsResult,
    projectsResult,
    plansResult,
    programsResult,
    reportsResult,
    fundingOpportunitiesResult,
    projectFundingProfilesResult,
  ] = await Promise.all([
    supabase
      .from("data_connectors")
      .select(
        "id, key, display_name, source_type, category, status, cadence, auth_mode, endpoint_url, owner_label, description, policy_monitor_enabled, last_sync_at, last_success_at, last_error_at, last_error_message, updated_at"
      )
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("data_datasets")
      .select(
        "id, connector_id, name, status, geography_scope, geometry_attachment, thematic_metric_key, thematic_metric_label, coverage_summary, vintage_label, source_url, license_label, citation_text, schema_version, checksum, row_count, refresh_cadence, last_refreshed_at, notes, updated_at"
      )
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("data_refresh_jobs")
      .select(
        "id, connector_id, dataset_id, job_name, job_type, status, refresh_mode, started_at, completed_at, records_written, triggered_by_label, error_summary, created_at"
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("projects")
      .select("id, name, status, delivery_phase, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("plans")
      .select("id, title, status, geography_label, horizon_year, project_id, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("programs")
      .select("id, title, status, nomination_due_at, adoption_target_at, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("reports")
      .select("id, title, status, latest_artifact_kind, generated_at, updated_at, metadata_json")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("funding_opportunities")
      .select(
        "id, title, opportunity_status, decision_state, expected_award_amount, closes_at, decision_due_at, program_id, project_id, updated_at"
      )
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("project_funding_profiles")
      .select("project_id, funding_need_amount, local_match_need_amount")
      .eq("workspace_id", workspaceId),
  ]);

  const connectors = ((connectorsResult.data ?? []) as ConnectorRow[]).slice(0, 8);
  const datasets = ((datasetsResult.data ?? []) as DatasetRow[]).slice(0, 10);
  const refreshJobs = (refreshJobsResult.data ?? []) as RefreshJobRow[];
  const projects = (projectsResult.data ?? []) as ProjectRow[];

  const datasetIds = datasets.map((dataset) => dataset.id);
  const datasetLinksResult = datasetIds.length
    ? await supabase
        .from("data_dataset_project_links")
        .select("dataset_id, project_id, relationship_type, linked_at")
        .in("dataset_id", datasetIds)
        .order("linked_at", { ascending: false })
    : { data: [], error: null };

  const pendingSchemaMessages = [
    connectorsResult.error?.message,
    datasetsResult.error?.message,
    refreshJobsResult.error?.message,
    datasetLinksResult.error?.message,
  ].filter((message): message is string => Boolean(message) && looksLikePendingSchema(message));

  const migrationPending = pendingSchemaMessages.length > 0;

  const connectorMap = new Map(connectors.map((connector) => [connector.id, connector]));
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const datasetLinksByDataset = new Map<string, Array<{ project: ProjectRow; relationshipType: string }>>();

  ((datasetLinksResult.data ?? []) as DatasetProjectLinkRow[]).forEach((link) => {
    const project = projectMap.get(link.project_id);
    if (!project) return;
    const current = datasetLinksByDataset.get(link.dataset_id) ?? [];
    current.push({ project, relationshipType: link.relationship_type });
    datasetLinksByDataset.set(link.dataset_id, current);
  });

  const activeConnectors = connectors.filter((connector) => connector.status === "active").length;
  const monitoredConnectors = connectors.filter((connector) => connector.policy_monitor_enabled).length;
  const staleDatasets = datasets.filter((dataset) => dataset.status === "stale" || dataset.status === "error").length;
  const overlayReadyDatasets = datasets.filter(
    (dataset) =>
      dataset.status === "ready" &&
      ["point", "route", "corridor", "tract", "county", "region", "statewide", "national"].includes(
        dataset.geography_scope
      )
  ).length;
  const thematicReadyDatasets = datasets.filter(
    (dataset) =>
      dataset.status === "ready" &&
      Boolean(dataset.thematic_metric_key) &&
      ((dataset.geography_scope === "tract" && dataset.geometry_attachment === "analysis_tracts") ||
        ((dataset.geography_scope === "corridor" || dataset.geography_scope === "route") &&
          dataset.geometry_attachment === "analysis_corridor") ||
        (dataset.geography_scope === "point" && dataset.geometry_attachment === "analysis_crash_points"))
  ).length;
  const runningJobs = refreshJobs.filter((job) => job.status === "running" || job.status === "queued").length;

  const operationsSummary = buildWorkspaceOperationsSummaryFromSourceRows({
    projects,
    plans: (plansResult.data ?? []) as Array<{
      id: string;
      title: string;
      status: string | null;
      geography_label: string | null;
      horizon_year: number | null;
      project_id: string | null;
      updated_at: string | null;
    }>,
    programs: (programsResult.data ?? []) as Array<{
      id: string;
      title: string;
      status: string | null;
      nomination_due_at: string | null;
      adoption_target_at: string | null;
      updated_at: string | null;
    }>,
    reports: (reportsResult.data ?? []) as Array<{
      id: string;
      title: string | null;
      status: string | null;
      latest_artifact_kind: string | null;
      generated_at: string | null;
      updated_at: string | null;
      metadata_json: Record<string, unknown> | null;
    }>,
    fundingOpportunities: (fundingOpportunitiesResult.data ?? []) as Array<{
      id: string;
      title: string;
      opportunity_status: string | null;
      decision_state?: string | null;
      expected_award_amount?: number | string | null;
      closes_at: string | null;
      decision_due_at: string | null;
      program_id: string | null;
      project_id: string | null;
      updated_at: string | null;
    }>,
    projectFundingProfiles: (projectFundingProfilesResult.data ?? []) as Array<{
      project_id: string;
      funding_need_amount: number | string | null;
      local_match_need_amount?: number | string | null;
    }>,
  });

  const liveFoundations = [
    {
      label: "Census / ACS",
      detail: "Analysis Studio already captures corridor demographic retrieval metadata.",
      tone: "success" as const,
    },
    {
      label: "LODES employment",
      detail: "Source posture is surfaced today, even before bulk ingestion becomes fully automated.",
      tone: "info" as const,
    },
    {
      label: "GTFS uploads",
      detail: "Transit feed storage already exists in the current architecture and can fold into this registry.",
      tone: "info" as const,
    },
    {
      label: "Crash / safety inputs",
      detail: "Data Hub now gives these sources a home instead of leaving them implicit in analysis flows.",
      tone: "neutral" as const,
    },
  ];

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <Sparkles className="h-3.5 w-3.5" />
            Data Hub
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">Data Hub now uses the same internal hierarchy as the rest of OpenPlan</h1>
            <p className="module-intro-description">
              This page now reads less like a stack of unrelated cards and more like a governed data-fabric module:
              summary signal first, operator posture second, record-making lane third, and denser registries after that.
            </p>
          </div>

          <div className="module-summary-grid cols-4">
            <div className="module-summary-card">
              <p className="module-summary-label">Connectors</p>
              <p className="module-summary-value">{connectors.length}</p>
              <p className="module-summary-detail">{activeConnectors} active in the current workspace.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Datasets</p>
              <p className="module-summary-value">{datasets.length}</p>
              <p className="module-summary-detail">
                {overlayReadyDatasets} overlay-ready · {thematicReadyDatasets} thematic-ready.
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Refresh jobs</p>
              <p className="module-summary-value">{refreshJobs.length}</p>
              <p className="module-summary-detail">{runningJobs} queued or running right now.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Needs attention</p>
              <p className="module-summary-value">{monitoredConnectors}</p>
              <p className="module-summary-detail">{staleDatasets} datasets currently need attention.</p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Data Hub</p>
              <h2 className="module-operator-title">Keep project data organized for {workspace?.name ?? "Planning Workspace"}</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            Keep datasets, linked projects, and source information organized so teams can find the right information quickly.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Workspace plan: {titleize(workspace?.plan ?? "pilot")}</div>
            <div className="module-operator-item">Datasets stay scoped to the current workspace.</div>
            <div className="module-operator-item">Projects can link directly to the data they rely on.</div>
          </div>
        </article>
      </header>

      {migrationPending ? (
        <article className="module-alert">
          <div className="flex items-start gap-3 text-sm">
            <ShieldAlert className="mt-0.5 h-4.5 w-4.5 shrink-0" />
            <div>
              <p className="font-semibold">The latest Data Hub database update has not been applied yet.</p>
              <p className="mt-1 opacity-90">
                Live records will stay empty until the latest database update is applied. This prevents the page from failing before the schema is ready.
              </p>
            </div>
          </div>
        </article>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.98fr_1.02fr]">
        <div className="space-y-6">
          <DataHubRecordComposer
            workspaceId={workspaceId}
            connectors={connectors.map((connector) => ({ id: connector.id, label: connector.display_name }))}
            projects={projects.map((project) => ({ id: project.id, label: project.name }))}
            datasets={datasets.map((dataset) => ({
              id: dataset.id,
              label: dataset.name,
              connectorId: dataset.connector_id,
            }))}
          />
          <WorkspaceCommandBoard
            summary={operationsSummary}
            label="Workspace command board"
            title="What should move around Data Hub"
            description="Data Hub now inherits the same shared workspace command queue as the rest of the runtime, so packet pressure, funding timing, and setup gaps stay visible while you work provenance, refresh posture, and dataset linkage."
          />
        </div>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Foundation sources</p>
              <h2 className="module-section-title">Analysis inputs now have a governance lane</h2>
              <p className="module-section-description">
                This clarifies what lives as a source registry object versus what stays as downstream interpretation.
              </p>
            </div>
            <span className="module-inline-item">
              <Database className="h-3.5 w-3.5" />
              Connected data workspace
            </span>
          </div>

          <div className="mt-5 space-y-3">
            {liveFoundations.map((item) => (
              <div key={item.label} className="module-subpanel">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={item.tone}>{item.label}</StatusBadge>
                  <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Visible system component</p>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{item.detail}</p>
              </div>
            ))}
          </div>

          <div className="module-note mt-5 text-sm">
            First version deliberately favors traceability over automation theater: operators can now register what exists,
            what changed, who owns it, and which projects rely on it.
          </div>
        </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <Link2 className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Connector registry</p>
                <h2 className="module-section-title">Governed source endpoints</h2>
              </div>
            </div>
          </div>

          {connectors.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">
              No connectors registered yet. Use the creation panel to document the first live source.
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {connectors.map((connector) => (
                <div key={connector.id} className="module-record-row">
                  <div className="module-record-head">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <StatusBadge tone={toneForConnectorStatus(connector.status)}>{titleize(connector.status)}</StatusBadge>
                        <StatusBadge tone="info">{titleize(connector.source_type)}</StatusBadge>
                        <StatusBadge tone="neutral">{titleize(connector.cadence)}</StatusBadge>
                        {connector.policy_monitor_enabled ? <StatusBadge tone="warning">Policy monitor</StatusBadge> : null}
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="module-record-title">{connector.display_name}</h3>
                          <p className="module-record-stamp">Updated {fmtDateTime(connector.updated_at)}</p>
                        </div>
                        <p className="module-record-summary line-clamp-2">
                          {connector.description || "No description yet."}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="module-record-meta">
                    <span className="module-record-chip">Key {connector.key}</span>
                    {connector.owner_label ? <span className="module-record-chip">Owner {connector.owner_label}</span> : null}
                    <span className="module-record-chip">Auth {titleize(connector.auth_mode)}</span>
                    <span className="module-record-chip">Last sync {fmtDateTime(connector.last_sync_at)}</span>
                  </div>

                  {connector.endpoint_url ? (
                    <p className="text-xs text-muted-foreground/85">Endpoint: {connector.endpoint_url}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="module-section-surface xl:col-span-2">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Dataset registry</p>
              <h2 className="module-section-title">Provenance-bearing datasets</h2>
              <p className="module-section-description">
                Summary cards above define the page signal. This lane stays denser because it carries the real record stack.
              </p>
            </div>
            <Link href="/projects" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-primary">
              Project control rooms
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {datasets.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">
              No datasets registered yet. Once records land here, they can expose vintage, license, checksum, cadence,
              and linked projects in one place.
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {datasets.map((dataset) => {
                const connector = dataset.connector_id ? connectorMap.get(dataset.connector_id) : null;
                const links = datasetLinksByDataset.get(dataset.id) ?? [];
                const overlayReady =
                  dataset.status === "ready" &&
                  ["point", "route", "corridor", "tract", "county", "region", "statewide", "national"].includes(
                    dataset.geography_scope
                  );
                const thematicReady =
                  dataset.status === "ready" &&
                  Boolean(dataset.thematic_metric_key) &&
                  ((dataset.geography_scope === "tract" && dataset.geometry_attachment === "analysis_tracts") ||
                    ((dataset.geography_scope === "corridor" || dataset.geography_scope === "route") &&
                      dataset.geometry_attachment === "analysis_corridor") ||
                    (dataset.geography_scope === "point" && dataset.geometry_attachment === "analysis_crash_points"));

                return (
                  <div key={dataset.id} className="module-record-row">
                    <div className="module-record-head">
                      <div className="module-record-main">
                        <div className="module-record-kicker">
                          <StatusBadge tone={toneForDatasetStatus(dataset.status)}>{titleize(dataset.status)}</StatusBadge>
                          <StatusBadge tone="info">{titleize(dataset.geography_scope)}</StatusBadge>
                          <StatusBadge tone={overlayReady ? "success" : "neutral"}>
                            {overlayReady ? "Overlay-ready" : "Coverage-only"}
                          </StatusBadge>
                          {thematicReady ? <StatusBadge tone="warning">Thematic-ready</StatusBadge> : null}
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <h3 className="module-record-title text-[1.04rem]">{dataset.name}</h3>
                            <p className="module-record-stamp">Updated {fmtDateTime(dataset.updated_at)}</p>
                          </div>
                          <p className="module-record-summary line-clamp-2">
                            {dataset.coverage_summary || dataset.notes || "Dataset registered without an operator note yet."}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="module-record-meta">
                      {connector ? (
                        <span className="module-record-chip">Connector {connector.display_name}</span>
                      ) : (
                        <span className="module-record-chip">Manual dataset</span>
                      )}
                      <span className="module-record-chip">Refresh {titleize(dataset.refresh_cadence)}</span>
                      {dataset.vintage_label ? <span className="module-record-chip">Vintage {dataset.vintage_label}</span> : null}
                      {dataset.license_label ? <span className="module-record-chip">License {dataset.license_label}</span> : null}
                      {dataset.row_count !== null ? (
                        <span className="module-record-chip">Rows {dataset.row_count.toLocaleString()}</span>
                      ) : null}
                      {dataset.geometry_attachment !== "none" ? (
                        <span className="module-record-chip">Geometry {titleize(dataset.geometry_attachment)}</span>
                      ) : null}
                      {dataset.thematic_metric_key ? (
                        <span className="module-record-chip">
                          Metric {dataset.thematic_metric_label || titleize(dataset.thematic_metric_key)}
                        </span>
                      ) : null}
                    </div>

                    {links.length > 0 ? (
                      <div className="module-note">
                        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          <FolderKanban className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                          Linked projects
                        </div>
                        <div className="mt-3 module-inline-list">
                          {links.map((link) => (
                            <Link
                              key={`${dataset.id}-${link.project.id}`}
                              href={`/projects/${link.project.id}`}
                              className="module-inline-item transition hover:text-primary"
                            >
                              <strong>{link.project.name}</strong>
                              <span className="text-[0.64rem] text-slate-400">{titleize(link.relationshipType)}</span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="module-record-detail-grid cols-3">
                      <div className="module-note text-sm">
                        <p className="font-medium text-foreground">Overlay posture</p>
                        <p className="mt-2">
                          {thematicReady
                            ? dataset.geometry_attachment === "analysis_corridor"
                              ? `Thematic-ready via ${dataset.thematic_metric_label || titleize(dataset.thematic_metric_key)} on analysis corridor geometry.`
                              : dataset.geometry_attachment === "analysis_crash_points"
                                ? `Thematic-ready via ${dataset.thematic_metric_label || titleize(dataset.thematic_metric_key)} on analysis crash-point geometry.`
                                : `Thematic-ready via ${dataset.thematic_metric_label || titleize(dataset.thematic_metric_key)} on analysis tracts.`
                            : overlayReady
                              ? "Drawable in Analysis Studio as a coverage footprint."
                              : "Registry only for now; not drawable in Analysis Studio yet."}
                        </p>
                      </div>
                      <div className="module-note text-sm">
                        <p className="font-medium text-foreground">Provenance</p>
                        <p className="mt-2">{dataset.citation_text || dataset.source_url || "No provenance note captured yet."}</p>
                      </div>
                      <div className="module-note text-sm">
                        <p className="font-medium text-foreground">Refresh posture</p>
                        <p className="mt-2">Last refreshed: {fmtDateTime(dataset.last_refreshed_at)}</p>
                        <p className="mt-1 break-all">
                          Schema: {dataset.schema_version || "Unknown"}
                          {dataset.checksum ? ` · ${dataset.checksum}` : ""}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-700 dark:text-sky-300">
                <RefreshCw className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Refresh activity</p>
                <h2 className="module-section-title">Recent refresh jobs</h2>
              </div>
            </div>
          </div>

          {refreshJobs.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">
              No refresh jobs logged yet. Use the job lane to make ingestion, validation, and backfill activity visible.
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {refreshJobs.map((job) => {
                const connector = job.connector_id ? connectorMap.get(job.connector_id) : null;
                const dataset = job.dataset_id ? datasets.find((item) => item.id === job.dataset_id) : null;

                return (
                  <div key={job.id} className="module-record-row">
                    <div className="module-record-head">
                      <div className="module-record-main">
                        <div className="module-record-kicker">
                          <StatusBadge tone={toneForRefreshStatus(job.status)}>{titleize(job.status)}</StatusBadge>
                          <StatusBadge tone="neutral">{titleize(job.job_type)}</StatusBadge>
                          <StatusBadge tone="info">{titleize(job.refresh_mode)}</StatusBadge>
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <h3 className="module-record-title">{job.job_name}</h3>
                            <p className="module-record-stamp">Started {fmtDateTime(job.started_at || job.created_at)}</p>
                          </div>
                          <p className="module-record-summary line-clamp-2">
                            {dataset
                              ? `Dataset: ${dataset.name}`
                              : connector
                                ? `Connector: ${connector.display_name}`
                                : "Connector or dataset not attached."}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="module-record-meta">
                      {job.completed_at ? (
                        <span className="module-record-chip">Completed {fmtDateTime(job.completed_at)}</span>
                      ) : null}
                      {typeof job.records_written === "number" ? (
                        <span className="module-record-chip">{job.records_written.toLocaleString()} records</span>
                      ) : null}
                      {job.triggered_by_label ? <span className="module-record-chip">Triggered by {job.triggered_by_label}</span> : null}
                    </div>

                    {job.error_summary ? (
                      <p className="text-sm text-amber-800 dark:text-amber-200">{job.error_summary}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </article>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-700 dark:text-violet-300">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Operating note</p>
                <h2 className="module-section-title">Why this slice matters</h2>
              </div>
            </div>
          </div>

          <div className="mt-5 space-y-3 text-sm text-muted-foreground">
            <div className="module-subpanel">
              Connectors, datasets, and jobs now exist as first-class workspace records instead of scattered assumptions
              inside analysis code paths.
            </div>
            <div className="module-subpanel">
              Provenance fields are visible where operators actually need them: source URL, license posture, schema
              version, checksum, cadence, and last refresh timing.
            </div>
            <div className="module-subpanel">
              Projects can now surface linked datasets, which closes the gap between the new Planning OS shell and the
              geospatial / data-fabric layer under it.
            </div>
            <div className="module-subpanel">
              Next logical wave: automated connector runners, evidence-pack exports, and richer Analysis Studio
              run-to-dataset lineage.
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
