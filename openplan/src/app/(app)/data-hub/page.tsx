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
import { StatusBadge } from "@/components/ui/status-badge";
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
      <section className="space-y-6">
        <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)] sm:p-7">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/8 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-amber-700 dark:text-amber-300">
            <ShieldAlert className="h-3.5 w-3.5" />
            Workspace access required
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Data Hub needs an authenticated workspace membership</h1>
          <p className="mt-3 max-w-3xl text-sm text-muted-foreground sm:text-base">
            Sign into a workspace or create a project workspace first. Data Hub records are scoped to authenticated Planning OS workspaces and are not available in preview mode.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/projects" className="inline-flex items-center gap-2 rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm font-semibold transition hover:border-primary/35 hover:text-primary">
              Open Projects
            </Link>
            <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-2xl border border-border/70 bg-card px-4 py-3 text-sm font-semibold text-muted-foreground transition hover:border-primary/35 hover:text-primary">
              Back to Overview
            </Link>
          </div>
        </article>
      </section>
    );
  }

  const workspaceId = membership.workspace_id;

  const [connectorsResult, datasetsResult, refreshJobsResult, projectsResult] = await Promise.all([
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
      .select("id, name, status")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false }),
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
      ["point", "route", "corridor", "tract", "county", "region", "statewide", "national"].includes(dataset.geography_scope)
  ).length;
  const thematicReadyDatasets = datasets.filter(
    (dataset) =>
      dataset.status === "ready" &&
      dataset.geography_scope === "tract" &&
      dataset.geometry_attachment === "analysis_tracts" &&
      Boolean(dataset.thematic_metric_key)
  ).length;
  const runningJobs = refreshJobs.filter((job) => job.status === "running" || job.status === "queued").length;

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
    <section className="space-y-6">
      <header className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)] sm:p-7">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/8 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-300">
            <Sparkles className="h-3.5 w-3.5" />
            Data Hub module live
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Data Hub is now a real authenticated module</h1>
          <p className="mt-3 max-w-3xl text-sm text-muted-foreground sm:text-base">
            OpenPlan now has a first credible data-fabric operator surface inside the Planning OS shell: connector registry,
            dataset records, refresh jobs, provenance notes, and project-linked source visibility for the active workspace.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
              <p className="text-[0.72rem] uppercase tracking-[0.12em] text-muted-foreground">Connectors</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">{connectors.length}</p>
              <p className="mt-1 text-xs text-muted-foreground">{activeConnectors} active</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
              <p className="text-[0.72rem] uppercase tracking-[0.12em] text-muted-foreground">Datasets</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">{datasets.length}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {overlayReadyDatasets} overlay-ready · {thematicReadyDatasets} thematic-ready · {staleDatasets} need attention
              </p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
              <p className="text-[0.72rem] uppercase tracking-[0.12em] text-muted-foreground">Refresh jobs</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">{refreshJobs.length}</p>
              <p className="mt-1 text-xs text-muted-foreground">{runningJobs} queued or running</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
              <p className="text-[0.72rem] uppercase tracking-[0.12em] text-muted-foreground">Policy monitors</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">{monitoredConnectors}</p>
              <p className="mt-1 text-xs text-muted-foreground">Bulletin-aware connectors</p>
            </div>
          </div>
        </article>

        <article className="rounded-[28px] border border-border/70 bg-[linear-gradient(180deg,rgba(13,24,34,0.96),rgba(8,15,21,0.94))] p-6 text-slate-100 shadow-[0_30px_70px_rgba(0,0,0,0.24)]">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Workspace posture</p>
              <h2 className="text-xl font-semibold tracking-tight">Governed data fabric for {workspace?.name ?? "Planning Workspace"}</h2>
            </div>
          </div>
          <ul className="mt-4 space-y-3 text-sm text-slate-300/82">
            <li className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">Workspace plan: {titleize(workspace?.plan ?? "pilot")}</li>
            <li className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">Authenticated records scoped to workspace membership</li>
            <li className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">Projects can now expose linked datasets instead of treating sources as hidden context</li>
          </ul>
        </article>
      </header>

      {migrationPending ? (
        <article className="rounded-[24px] border border-amber-300/50 bg-amber-50/80 p-5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-4.5 w-4.5" />
            <div>
              <p className="font-semibold">Data Hub migration has not been applied to the current database yet.</p>
              <p className="mt-1 text-amber-800/90 dark:text-amber-200/85">
                The UI is wired and build-safe, but live records will remain empty until the latest Supabase migration is applied. This guardrail keeps the module from crashing before the schema lands.
              </p>
            </div>
          </div>
        </article>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.98fr_1.02fr]">
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

        <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Foundation sources</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight">Analysis Studio inputs now have a governance lane</h2>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <Database className="h-3.5 w-3.5" />
              Planning OS fabric
            </span>
          </div>

          <div className="mt-5 space-y-3">
            {liveFoundations.map((item) => (
              <div key={item.label} className="rounded-[24px] border border-border/80 bg-background/80 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={item.tone}>{item.label}</StatusBadge>
                  <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Visible system component</p>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{item.detail}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-2xl border border-border/70 bg-background/80 p-4 text-sm text-muted-foreground">
            First version deliberately favors traceability over automation theater: operators can now register what exists, what changed, who owns it, and which projects rely on it.
          </div>
        </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <Link2 className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Connector registry</p>
              <h2 className="text-xl font-semibold tracking-tight">Governed source endpoints</h2>
            </div>
          </div>

          {connectors.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-border/80 bg-background/70 p-5 text-sm text-muted-foreground">
              No connectors registered yet. Use the creation panel to document the first live source.
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {connectors.map((connector) => (
                <div key={connector.id} className="rounded-2xl border border-border/70 bg-background/75 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={toneForConnectorStatus(connector.status)}>{titleize(connector.status)}</StatusBadge>
                    <StatusBadge tone="info">{titleize(connector.source_type)}</StatusBadge>
                    <StatusBadge tone="neutral">{titleize(connector.cadence)}</StatusBadge>
                  </div>
                  <h3 className="mt-2 text-sm font-semibold tracking-tight text-foreground">{connector.display_name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{connector.description || "No description yet."}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                    <span className="rounded-full border border-border/70 bg-card px-2.5 py-1">Key: {connector.key}</span>
                    {connector.owner_label ? <span className="rounded-full border border-border/70 bg-card px-2.5 py-1">Owner: {connector.owner_label}</span> : null}
                    <span className="rounded-full border border-border/70 bg-card px-2.5 py-1">Auth: {titleize(connector.auth_mode)}</span>
                    {connector.policy_monitor_enabled ? <span className="rounded-full border border-amber-300/50 bg-amber-50 px-2.5 py-1 text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">Policy monitor</span> : null}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Last sync: {fmtDateTime(connector.last_sync_at)}
                    {connector.endpoint_url ? ` · ${connector.endpoint_url}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)] xl:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Dataset registry</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight">Provenance-bearing datasets</h2>
            </div>
            <Link href="/projects" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-primary">
              Project control rooms
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {datasets.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-border/80 bg-background/70 p-5 text-sm text-muted-foreground">
              No datasets registered yet. Once records land here, they can expose vintage, license, checksum, cadence, and linked projects in one place.
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {datasets.map((dataset) => {
                const connector = dataset.connector_id ? connectorMap.get(dataset.connector_id) : null;
                const links = datasetLinksByDataset.get(dataset.id) ?? [];
                const overlayReady =
                  dataset.status === "ready" &&
                  ["point", "route", "corridor", "tract", "county", "region", "statewide", "national"].includes(dataset.geography_scope);
                const thematicReady =
                  dataset.status === "ready" &&
                  dataset.geography_scope === "tract" &&
                  dataset.geometry_attachment === "analysis_tracts" &&
                  Boolean(dataset.thematic_metric_key);

                return (
                  <div key={dataset.id} className="rounded-[24px] border border-border/80 bg-background/80 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={toneForDatasetStatus(dataset.status)}>{titleize(dataset.status)}</StatusBadge>
                          <StatusBadge tone="info">{titleize(dataset.geography_scope)}</StatusBadge>
                          <StatusBadge tone="neutral">{titleize(dataset.refresh_cadence)}</StatusBadge>
                          <StatusBadge tone={overlayReady ? "success" : "neutral"}>
                            {overlayReady ? "Overlay-ready" : "Coverage-only"}
                          </StatusBadge>
                          {thematicReady ? <StatusBadge tone="warning">Thematic-ready</StatusBadge> : null}
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold tracking-tight text-foreground">{dataset.name}</h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {dataset.coverage_summary || dataset.notes || "Dataset registered without an operator note yet."}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      {connector ? <span className="rounded-full border border-border/70 bg-card px-2.5 py-1">Connector: {connector.display_name}</span> : <span className="rounded-full border border-border/70 bg-card px-2.5 py-1">Manual / unbound dataset</span>}
                      {dataset.vintage_label ? <span className="rounded-full border border-border/70 bg-card px-2.5 py-1">Vintage: {dataset.vintage_label}</span> : null}
                      {dataset.license_label ? <span className="rounded-full border border-border/70 bg-card px-2.5 py-1">License: {dataset.license_label}</span> : null}
                      {dataset.row_count !== null ? <span className="rounded-full border border-border/70 bg-card px-2.5 py-1">Rows: {dataset.row_count.toLocaleString()}</span> : null}
                      {dataset.geometry_attachment !== "none" ? (
                        <span className="rounded-full border border-border/70 bg-card px-2.5 py-1">Geometry: {titleize(dataset.geometry_attachment)}</span>
                      ) : null}
                      {dataset.thematic_metric_key ? (
                        <span className="rounded-full border border-border/70 bg-card px-2.5 py-1">
                          Metric: {dataset.thematic_metric_label || titleize(dataset.thematic_metric_key)}
                        </span>
                      ) : null}
                    </div>

                    {links.length > 0 ? (
                      <div className="mt-4 rounded-2xl border border-border/70 bg-card/80 p-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          <FolderKanban className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                          Linked projects
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {links.map((link) => (
                            <Link
                              key={`${dataset.id}-${link.project.id}`}
                              href={`/projects/${link.project.id}`}
                              className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground transition hover:border-primary/35 hover:text-primary"
                            >
                              {link.project.name}
                              <span className="text-[0.64rem] text-slate-400">{titleize(link.relationshipType)}</span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl border border-border/70 bg-card/70 p-4 text-sm text-muted-foreground">
                        <p className="font-medium text-foreground">Overlay posture</p>
                        <p className="mt-2">
                          {thematicReady
                            ? `Thematic-ready via ${dataset.thematic_metric_label || titleize(dataset.thematic_metric_key)} on analysis tracts.`
                            : overlayReady
                              ? "Drawable in Analysis Studio as a coverage footprint."
                              : "Registry only for now; not drawable in Analysis Studio yet."}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-card/70 p-4 text-sm text-muted-foreground">
                        <p className="font-medium text-foreground">Provenance</p>
                        <p className="mt-2">{dataset.citation_text || dataset.source_url || "No provenance note captured yet."}</p>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-card/70 p-4 text-sm text-muted-foreground">
                        <p className="font-medium text-foreground">Refresh posture</p>
                        <p className="mt-2">Last refreshed: {fmtDateTime(dataset.last_refreshed_at)}</p>
                        <p className="mt-1">Schema: {dataset.schema_version || "Unknown"}{dataset.checksum ? ` · ${dataset.checksum}` : ""}</p>
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
        <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-700 dark:text-sky-300">
              <RefreshCw className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Refresh activity</p>
              <h2 className="text-xl font-semibold tracking-tight">Recent refresh jobs</h2>
            </div>
          </div>

          {refreshJobs.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-border/80 bg-background/70 p-5 text-sm text-muted-foreground">
              No refresh jobs logged yet. Use the job lane to make ingestion, validation, and backfill activity visible.
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {refreshJobs.map((job) => {
                const connector = job.connector_id ? connectorMap.get(job.connector_id) : null;
                const dataset = job.dataset_id ? datasets.find((item) => item.id === job.dataset_id) : null;

                return (
                  <div key={job.id} className="rounded-2xl border border-border/70 bg-background/75 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={toneForRefreshStatus(job.status)}>{titleize(job.status)}</StatusBadge>
                      <StatusBadge tone="neutral">{titleize(job.job_type)}</StatusBadge>
                      <StatusBadge tone="info">{titleize(job.refresh_mode)}</StatusBadge>
                    </div>
                    <h3 className="mt-2 text-sm font-semibold tracking-tight text-foreground">{job.job_name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {dataset ? `Dataset: ${dataset.name}` : connector ? `Connector: ${connector.display_name}` : "Connector or dataset not attached."}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Started {fmtDateTime(job.started_at || job.created_at)}
                      {job.completed_at ? ` · Completed ${fmtDateTime(job.completed_at)}` : ""}
                      {typeof job.records_written === "number" ? ` · ${job.records_written.toLocaleString()} records` : ""}
                    </p>
                    {job.triggered_by_label ? <p className="mt-1 text-xs text-muted-foreground">Triggered by: {job.triggered_by_label}</p> : null}
                    {job.error_summary ? <p className="mt-2 text-sm text-amber-800 dark:text-amber-200">{job.error_summary}</p> : null}
                  </div>
                );
              })}
            </div>
          )}
        </article>

        <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-700 dark:text-violet-300">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Operating note</p>
              <h2 className="text-xl font-semibold tracking-tight">Why this slice matters</h2>
            </div>
          </div>

          <div className="mt-5 space-y-3 text-sm text-muted-foreground">
            <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
              Connectors, datasets, and jobs now exist as first-class workspace records instead of scattered assumptions inside analysis code paths.
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
              Provenance fields are visible where operators actually need them: source URL, license posture, schema version, checksum, cadence, and last refresh timing.
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
              Projects can now surface linked datasets, which closes the gap between the new Planning OS shell and the geospatial / data-fabric layer under it.
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
              Next logical wave: automated connector runners, evidence-pack exports, and richer Analysis Studio run-to-dataset lineage.
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
