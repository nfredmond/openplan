import Link from "next/link";
import { redirect } from "next/navigation";
import { CartographicSurfaceWide } from "@/components/cartographic/cartographic-surface-wide";
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
import { GtfsIngestPanel } from "@/components/data-hub/gtfs-ingest-panel";
import { TitleViServiceEquityPanel } from "@/components/data-hub/title-vi-service-equity-panel";
import { WorkspaceCommandBoard } from "@/components/operations/workspace-command-board";
import { WorkspaceRuntimeCue } from "@/components/operations/workspace-runtime-cue";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  resolveDatasetDependentOutputContext,
  toneForDatasetDependentOutputLevel,
} from "@/lib/data-sources/dataset-dependent-output-context";
import {
  resolveDatasetLineageReadiness,
  toneForDatasetLineageReadiness,
} from "@/lib/data-sources/dataset-lineage-readiness";
import { resolveDatasetTrustLabel, toneForDatasetTrustLevel } from "@/lib/data-sources/dataset-provenance";
import { describeRefreshJobStatus } from "@/lib/data-sources/refresh-log";
import {
  loadWorkspaceOperationsSummaryForWorkspace,
  type WorkspaceOperationsSupabaseLike,
} from "@/lib/operations/workspace-summary";
import { createClient } from "@/lib/supabase/server";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { BODY_LIMITS } from "@/lib/http/body-limit";
import { filterToCurrentReadyVersion } from "@/lib/gtfs/persist";
import {
  describeTransitFeedRegistry,
  type TransitFeedRow,
  type TransitFeedVersionRow,
} from "@/lib/transit/feed-registry-card";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { moduleMetadata } from "@/lib/ui/page-title";

export const metadata = moduleMetadata("Data Hub");

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

/**
 * Just enough of a PostgREST builder for the current-version read to compile.
 *
 * See the comment at the call site: the full builder type sent `tsc` into
 * TS2589 when `filterToCurrentReadyVersion`'s generic was instantiated against
 * it inside a `Promise.all`. The Supabase clients in this repo are untyped by
 * convention anyway, so nothing is lost by naming the two methods used.
 */
type CurrentVersionQuery = {
  eq: (column: string, value: never) => CurrentVersionQuery;
  limit: (count: number) => Promise<{ data: unknown; error: { message: string } | null }>;
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

export default async function DataHubPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { membership, workspace } = await loadCurrentWorkspaceMembership(supabase, user.id);

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
              Sign in, or create a workspace first. Datasets belong to a workspace, so there is nothing to show until
              you are in one.
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

  /**
   * BUILT OUTSIDE THE `Promise.all`, AND CAST DOWN TO WHAT IT IS USED AS.
   *
   * `filterToCurrentReadyVersion` is generic over the PostgREST builder, and
   * instantiating that generic against a `Promise.all` tuple made `tsc` give up
   * with TS2589 ("type instantiation is excessively deep") — the recurring
   * Supabase-client-into-a-generic trigger this repo has hit before. The chain
   * is unchanged at runtime, and it is deliberately still routed through
   * `filterToCurrentReadyVersion` rather than hand-written `.eq()` calls,
   * because that function is the codebase's single expression of "the version
   * this workspace analyses with".
   */
  const transitFeedVersionsQuery = filterToCurrentReadyVersion(
    supabase
      .from("gtfs_feed_versions")
      .select(
        "feed_id, workspace_id, service_start_date, service_end_date, route_service_level_rows, stop_service_level_rows"
      )
      .eq("workspace_id", workspaceId) as unknown as CurrentVersionQuery
  ).limit(200);

  const [
    connectorsResult,
    datasetsResult,
    refreshJobsResult,
    projectsResult,
    transitFeedsResult,
    transitFeedVersionsResult,
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
    // `.eq("workspace_id", workspaceId)` is not optional here, and it is the
    // one filter on this page whose absence would not look like a bug.
    // `gtfs_feeds.workspace_id` is NULLABLE and a null means a PUBLIC preloaded
    // feed (see 20260219000001_gtfs_schema.sql), so an unscoped read would
    // hand this workspace a stranger's agency and present it as their own.
    // `describeTransitFeedRegistry` re-checks the id for the same reason.
    supabase
      .from("gtfs_feeds")
      .select("id, workspace_id, agency_name, status, loaded_at")
      .eq("workspace_id", workspaceId)
      .order("loaded_at", { ascending: false }),
    // THE SERVICE WINDOW, WHICH IS THE FACT THE FEED ROW CANNOT TELL YOU.
    //
    // `gtfs_feeds.status = 'loaded'` describes the INGEST. Whether the schedule
    // inside the feed is still running lives on the version row, and on real
    // catalog feeds it usually is NOT — three of four Sacramento-area feeds
    // measured on 2026-08-05 had ended, SacRT's sixteen months earlier. So the
    // card reads `service_end_date` and says so, and this projection is where
    // dropping that column would be caught (the clients are untyped; a missing
    // column renders `undefined` with every test green).
    //
    // `filterToCurrentReadyVersion` is the codebase's one expression of "the
    // version this workspace analyses with" — `is_current` AND `status =
    // 'ready'` together, because either alone is wrong in a different direction.
    transitFeedVersionsQuery,
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
    transitFeedsResult.error?.message,
    transitFeedVersionsResult.error?.message,
  ].filter((message): message is string => Boolean(message) && looksLikePendingSchema(message));

  const migrationPending = pendingSchemaMessages.length > 0;

  const connectorMap = new Map(connectors.map((connector) => [connector.id, connector]));
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const datasetLinksByDataset = new Map<string, Array<{ project: ProjectRow; relationshipType: string }>>();
  const latestRefreshJobByDataset = new Map<string, RefreshJobRow>();

  refreshJobs.forEach((job) => {
    if (!job.dataset_id || latestRefreshJobByDataset.has(job.dataset_id)) return;
    latestRefreshJobByDataset.set(job.dataset_id, job);
  });

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
  const lineageCompleteDatasets = datasets.filter(
    (dataset) =>
      resolveDatasetLineageReadiness({
        citationText: dataset.citation_text,
        sourceUrl: dataset.source_url,
        licenseLabel: dataset.license_label,
        vintageLabel: dataset.vintage_label,
        schemaVersion: dataset.schema_version,
        checksum: dataset.checksum,
        rowCount: dataset.row_count,
        lastRefreshedAt: dataset.last_refreshed_at,
        geographyScope: dataset.geography_scope,
        geometryAttachment: dataset.geometry_attachment,
      }).level === "complete"
  ).length;
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
  const outputReadyDatasets = datasets.filter((dataset) => {
    const links = datasetLinksByDataset.get(dataset.id) ?? [];
    const latestRefreshJob = latestRefreshJobByDataset.get(dataset.id);
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
    const lineageReadiness = resolveDatasetLineageReadiness({
      citationText: dataset.citation_text,
      sourceUrl: dataset.source_url,
      licenseLabel: dataset.license_label,
      vintageLabel: dataset.vintage_label,
      schemaVersion: dataset.schema_version,
      checksum: dataset.checksum,
      rowCount: dataset.row_count,
      lastRefreshedAt: dataset.last_refreshed_at,
      geographyScope: dataset.geography_scope,
      geometryAttachment: dataset.geometry_attachment,
    });

    return (
      resolveDatasetDependentOutputContext({
        status: dataset.status,
        linkedProjectCount: links.length,
        lineageLevel: lineageReadiness.level,
        overlayReady,
        thematicReady,
        latestRefreshStatus: latestRefreshJob?.status,
      }).level === "output_ready"
    );
  }).length;
  const runningJobs = refreshJobs.filter((job) => job.status === "running" || job.status === "queued").length;

  const operationsSummary = await loadWorkspaceOperationsSummaryForWorkspace(
    supabase as unknown as WorkspaceOperationsSupabaseLike,
    workspaceId
  );

  /**
   * The transit-feed card is READ, not written.
   *
   * It used to be a constant reading "Transit feed storage already exists in
   * the current architecture and can fold into this registry" — a description
   * of nine empty tables, presented beside real registries under the heading
   * "Visible system component". A planner who believed that card went looking
   * for a button that had never existed. It then said the opposite, that there
   * was no upload path at all — true when written, and false the moment the
   * `/api/gtfs/*` lane and the panel below shipped. It now states what a read of
   * `gtfs_feeds` and its current version rows actually supports, INCLUDING
   * whether the schedule in the adopted feed has expired.
   */
  const todayIso = new Date().toISOString().slice(0, 10);
  const transitFeedCard = describeTransitFeedRegistry({
    workspaceId,
    readFailed: Boolean(transitFeedsResult.error),
    feeds: (transitFeedsResult.data ?? []) as TransitFeedRow[],
    // BOTH READS REPORT THEIR OWN FAILURE, because they are two statements
    // against two tables and either can fail alone. This page passed only the
    // first, and collapsed the second with `data ?? []` — so a failed version
    // read printed "No ingest of this feed has been adopted yet" beside a green
    // "loaded" badge and silently dropped the expired-schedule warning. A
    // question the database did not answer is not an answer of none, and that
    // is as true of the version table as of the feed table.
    versionReadFailed: Boolean(transitFeedVersionsResult.error),
    currentVersions: (transitFeedVersionsResult.data ?? []) as TransitFeedVersionRow[],
    today: todayIso,
    formatTimestamp: fmtDateTime,
  });

  /**
   * `kicker` is explicit per card because the panel used to print "Visible
   * system component" over every one of them unconditionally — which is the
   * same overclaim as the transit copy itself, one layer up. A workspace with
   * no feed, or one whose registry read failed, is not looking at a visible
   * system component and must not be told it is.
   */
  const liveFoundations: Array<{
    label: string;
    detail: string;
    tone: "info" | "success" | "warning" | "neutral";
    kicker: string;
  }> = [
    {
      label: "Census / ACS",
      detail: "Corridor Analysis already captures corridor demographic retrieval metadata.",
      tone: "success",
      kicker: "Visible system component",
    },
    {
      label: "LODES employment",
      detail: "Source posture is surfaced today, even before bulk ingestion becomes fully automated.",
      tone: "info",
      kicker: "Visible system component",
    },
    {
      label: transitFeedCard.label,
      detail: transitFeedCard.detail,
      tone: transitFeedCard.tone,
      // "Schema only — no ingest path yet" was the honest kicker while nothing
      // could bring a feed in. The ingest lane exists now, so a workspace with
      // no feed is looking at an empty registry with a working front door, not
      // at absent software.
      kicker:
        transitFeedCard.state === "feed-present"
          ? "Visible system component"
          : transitFeedCard.state === "read-failed"
            ? "Registry could not be read"
            : "No feed ingested yet — add one below",
    },
    {
      label: "Crash / safety inputs",
      detail: "Data Hub now gives these sources a home instead of leaving them implicit in analysis flows.",
      tone: "neutral",
      kicker: "Visible system component",
    },
  ];

  return (
    <section className="module-page">
      <CartographicSurfaceWide />
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <Sparkles className="h-3.5 w-3.5" />
            Data Hub
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">Data Hub</h1>
            <p className="module-intro-description">
              The datasets your analysis draws on — where each one came from, when it was last refreshed, and which
              projects rely on it.
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
                {overlayReadyDatasets} overlay-ready · {thematicReadyDatasets} thematic-ready · {outputReadyDatasets} output-ready · {lineageCompleteDatasets} lineage-complete.
              </p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Refresh log</p>
              <p className="module-summary-value">{refreshJobs.length}</p>
              <p className="module-summary-detail">
                {runningJobs} recorded as queued or running — no runner executes these.
              </p>
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
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Data Hub</p>
              <h2 className="module-operator-title">One place to find the data {workspace?.name ?? "your team"} works from</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            When someone asks where a number came from, the answer is here — the dataset, its source, and the projects using it.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Datasets belong to this workspace only.</div>
            <div className="module-operator-item">A project can point straight at the data it relies on.</div>
          </div>
          <div className="mt-4">
            <WorkspaceRuntimeCue summary={operationsSummary} />
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
        <div id="register-data-source" className="space-y-6">
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
            label="Across your workspace"
            title="What needs attention next"
            description="The most pressing work anywhere in this workspace, kept in view so it does not get lost while you are in here."
          />
        </div>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="module-section-heading">
              <p className="module-section-label">Foundation sources</p>
              <h2 className="module-section-title">The sources everything else is built on</h2>
              <p className="module-section-description">
                What counts as a source you can cite, as opposed to something OpenPlan worked out from it.
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
                  <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{item.kicker}</p>
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

      {/*
        THE FEED CARD ABOVE NOW POINTS SOMEWHERE. It says a feed can be added
        "in the transit feed panel on this page" — this is that panel, and the
        two must move together: if it is ever removed from here, the card's
        sentence goes back to sending a planner looking for a control that is
        not there.

        `BODY_LIMITS.gtfsFeedRaw` is read on the SERVER and passed down.
        `@/lib/http/body-limit` pulls `next/server` into whatever imports it, so
        a client component may not read it directly.
      */}
      <GtfsIngestPanel
        workspaceId={workspaceId}
        maxUploadBytes={BODY_LIMITS.gtfsFeedRaw}
        today={todayIso}
        readOnly={isReadOnlyWorkspaceRole(membership.role)}
      />

      {/*
        Mounted directly beneath the feed it analyses. The tract-service join is
        computed at ingest by that panel's work, so a planner who has just added
        their operator's feed is one screen away from the equity comparison it
        makes possible — rather than the capability existing with no route to it,
        which is this repository's most-repeated defect class.
      */}
      <TitleViServiceEquityPanel
        workspaceId={workspaceId}
        today={todayIso}
        readOnly={isReadOnlyWorkspaceRole(membership.role)}
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
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
              Data Hub records where your data comes from. Each connector documents one live source, so
              everything built on it can say where its numbers originated. Register your first source to
              get started.
              <div className="mt-3">
                <a href="#register-data-source" className="inline-flex items-center rounded border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/40">
                  Register a data source
                </a>
              </div>
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
              <h2 className="module-section-title">Datasets, with where they came from</h2>
              <p className="module-section-description">
                The full list. Denser than the cards above because this is where the detail lives.
              </p>
            </div>
            <Link href="/projects" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-primary">
              Projects
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {datasets.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">
              Datasets registered here carry their vintage, license, and provenance, so every map and model
              that uses one can cite it. Register your first dataset, or ingest one from a source above.
              <div className="mt-3">
                <a href="#register-data-source" className="inline-flex items-center rounded border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/40">
                  Register a dataset
                </a>
              </div>
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {datasets.map((dataset) => {
                const connector = dataset.connector_id ? connectorMap.get(dataset.connector_id) : null;
                const links = datasetLinksByDataset.get(dataset.id) ?? [];
                const latestRefreshJob = latestRefreshJobByDataset.get(dataset.id);
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
                const trustLabel = resolveDatasetTrustLabel({
                  connectorId: dataset.connector_id,
                  citationText: dataset.citation_text,
                  sourceUrl: dataset.source_url,
                  licenseLabel: dataset.license_label,
                  schemaVersion: dataset.schema_version,
                  checksum: dataset.checksum,
                  vintageLabel: dataset.vintage_label,
                  lastRefreshedAt: dataset.last_refreshed_at,
                });
                const lineageReadiness = resolveDatasetLineageReadiness({
                  citationText: dataset.citation_text,
                  sourceUrl: dataset.source_url,
                  licenseLabel: dataset.license_label,
                  vintageLabel: dataset.vintage_label,
                  schemaVersion: dataset.schema_version,
                  checksum: dataset.checksum,
                  rowCount: dataset.row_count,
                  lastRefreshedAt: dataset.last_refreshed_at,
                  geographyScope: dataset.geography_scope,
                  geometryAttachment: dataset.geometry_attachment,
                });
                const dependentOutputContext = resolveDatasetDependentOutputContext({
                  status: dataset.status,
                  linkedProjectCount: links.length,
                  lineageLevel: lineageReadiness.level,
                  overlayReady,
                  thematicReady,
                  latestRefreshStatus: latestRefreshJob?.status,
                  latestRefreshAt: latestRefreshJob?.completed_at || latestRefreshJob?.started_at || latestRefreshJob?.created_at,
                });

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
                          <StatusBadge tone={toneForDatasetTrustLevel(trustLabel.level)}>{trustLabel.label}</StatusBadge>
                          <StatusBadge tone={toneForDatasetLineageReadiness(lineageReadiness.level)}>
                            {lineageReadiness.label}
                          </StatusBadge>
                          <StatusBadge tone={toneForDatasetDependentOutputLevel(dependentOutputContext.level)}>
                            {dependentOutputContext.label}
                          </StatusBadge>
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
                        <p className="font-medium text-foreground">Dependent output context</p>
                        <p className="mt-2">
                          {dependentOutputContext.detail}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {dependentOutputContext.dependentOutputCount}/4 output cues ready.
                          {dependentOutputContext.needs.length > 0 ? ` Needs ${dependentOutputContext.needs.slice(0, 2).join(" and ")}.` : " Ready for supervised handoff."}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Map posture: {thematicReady
                            ? dataset.geometry_attachment === "analysis_corridor"
                              ? `Thematic-ready via ${dataset.thematic_metric_label || titleize(dataset.thematic_metric_key)} on analysis corridor geometry.`
                              : dataset.geometry_attachment === "analysis_crash_points"
                                ? `Thematic-ready via ${dataset.thematic_metric_label || titleize(dataset.thematic_metric_key)} on analysis crash-point geometry.`
                                : `Thematic-ready via ${dataset.thematic_metric_label || titleize(dataset.thematic_metric_key)} on analysis tracts.`
                            : overlayReady
                              ? "Drawable in Corridor Analysis as a coverage footprint."
                              : "Registry only for now; not drawable in Corridor Analysis yet."}
                        </p>
                      </div>
                      <div className="module-note text-sm">
                        <p className="font-medium text-foreground">Provenance</p>
                        <p className="mt-2">{dataset.citation_text || dataset.source_url || "No provenance note captured yet."}</p>
                        <p className="mt-2 text-xs text-muted-foreground">{trustLabel.detail}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Lineage readiness: {lineageReadiness.readyCount}/{lineageReadiness.totalCount} fields captured.
                          {lineageReadiness.missing.length > 0 ? ` Missing ${lineageReadiness.missing.join(", ")}.` : ""}
                        </p>
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
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-sky-500/10 text-sky-700 dark:text-sky-300">
                <RefreshCw className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Refresh log</p>
                <h2 className="module-section-title">Refreshes you recorded</h2>
                <p className="module-section-description">
                  These are refreshes someone on your team did, or plans to do. OpenPlan does not run them for you —
                  nothing here is scheduled or automatic.
                </p>
              </div>
            </div>
          </div>

          {refreshJobs.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">
              No refreshes logged yet. Use the job lane to document ingestion, validation, and backfill
              work an operator performed or plans to perform.
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {refreshJobs.map((job) => {
                const connector = job.connector_id ? connectorMap.get(job.connector_id) : null;
                const dataset = job.dataset_id ? datasets.find((item) => item.id === job.dataset_id) : null;
                const statusDescriptor = describeRefreshJobStatus(job.status, job.refresh_mode);

                return (
                  <div key={job.id} className="module-record-row">
                    <div className="module-record-head">
                      <div className="module-record-main">
                        <div className="module-record-kicker">
                          <StatusBadge tone={statusDescriptor.tone}>{statusDescriptor.label}</StatusBadge>
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

                    <p className="text-xs text-muted-foreground">{statusDescriptor.caveat}</p>

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
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-violet-500/10 text-violet-700 dark:text-violet-300">
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
              Next logical wave: automated connector runners, evidence-pack exports, and richer Corridor Analysis
              run-to-dataset lineage.
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
