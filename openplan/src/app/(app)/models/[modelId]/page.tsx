import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CartographicSurfaceWide } from "@/components/cartographic/cartographic-surface-wide";
import { ArrowLeft, Database, FileStack, ShieldCheck } from "lucide-react";
import { ModelDetailControls } from "@/components/models/model-detail-controls";
import { ModelLinkedRecordsBoard } from "@/components/models/model-linked-records";
import {
  ModelRunManager,
  type ModelRunStage,
  type ModelRunArtifact,
  type TransitFeedOption,
} from "@/components/models/model-run-manager";
import { MetaItem, MetaList } from "@/components/ui/meta-item";
import { StateBlock } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { resolveModelingWorkerDeclaration } from "@/lib/config/deployment-health-facts";
import { isPassingCountyRunGateStatus } from "@/lib/models/county-onramp";
import { corridorGeojsonSchema, extractModelLaunchTemplate, looksLikePendingSchema } from "@/lib/models/run-launch";
import { resolveStudyArea } from "@/lib/models/study-area";
import { placeOfRecordFromProject } from "@/lib/projects/project-place";
import {
  HOME_GEOGRAPHY_COLUMNS,
  parseWorkspaceHomeGeography,
  placeOfRecordFromHomeGeography,
} from "@/lib/workspaces/home-geography";
import { reconcileStaleModelRuns } from "@/lib/models/run-reconcile";
import type { ReaperRun } from "@/lib/models/run-reaper";
import {
  loadModelRunClaimStatuses,
  type ModelRunClaimDecision,
} from "@/lib/models/evidence-backbone";
import { filterToCurrentReadyVersion } from "@/lib/gtfs/persist";
import { createClient } from "@/lib/supabase/server";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import { looksLikePendingScenarioSpineSchema } from "@/lib/scenarios/api";
import {
  buildModelWorkspaceSummary,
  formatModelDateTime,
  formatModelFamilyLabel,
  formatModelStatusLabel,
  modelStatusTone,
} from "@/lib/models/catalog";

type RouteParams = Promise<{ modelId: string }>;

/**
 * Just enough of a PostgREST builder for the current-version read to compile.
 *
 * Same reason `data-hub/page.tsx` names one: `filterToCurrentReadyVersion` is
 * generic over the builder, and instantiating that generic against the full
 * Supabase client type is the recurring TS2589 ("type instantiation is
 * excessively deep") trigger this repo has hit before. The clients here are
 * untyped by convention anyway, so naming the two methods used loses nothing —
 * and the read is deliberately still routed through the shared predicate rather
 * than hand-written `.eq()` calls.
 */
type CurrentTransitVersionQuery = {
  eq: (column: string, value: never) => CurrentTransitVersionQuery;
  limit: (count: number) => Promise<{ data: unknown; error: { message: string } | null }>;
};

type ModelLinkRow = {
  id: string;
  model_id: string;
  link_type: string;
  linked_id: string;
  label: string | null;
};

type LinkedRecordCard = {
  id: string;
  title: string;
  href: string | null;
  statusLabel: string;
  timestampLabel: string;
  meta: string[];
};

type ScenarioSpineRow = {
  updated_at?: string | null;
  snapshot_at?: string | null;
};

function latestTimestamp(values: Array<string | null | undefined>) {
  const timestamps = values
    .map((value) => (typeof value === "string" ? new Date(value).getTime() : Number.NaN))
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

function titleForRecord(record: { title?: string | null; name?: string | null }) {
  return record.title ?? record.name ?? "Untitled";
}

// Column-level variant of looksLikePendingSchema: the models table exists, but
// network_package_version_id may predate migration 20260727000001 on this
// deployment, and its absence must not take down the whole detail page.
function looksLikePendingNetworkLinkColumn(message: string | null | undefined) {
  return /column .* does not exist|schema cache/i.test(message ?? "");
}

type NetworkBasisVersionRow = {
  id: string;
  version_name: string;
  status: string;
  updated_at: string | null;
  package: { id: string; name: string } | Array<{ id: string; name: string }> | null;
};

export default async function ModelDetailPage({ params }: { params: RouteParams }) {
  const { modelId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  // Every read below is registered here, and anything that failed is disclosed
  // by name at the top of the page. Before this, a failed read and an empty
  // table were the same `null`, and the empty-state copy — written for the
  // empty table — stated the failure as a fact about the planner's workspace.
  const reads = new ReadFailureLog();

  const modelResult = await supabase
    .from("models")
    .select(
      "id, workspace_id, project_id, scenario_set_id, title, model_family, status, config_version, owner_label, horizon_label, assumptions_summary, input_summary, output_summary, summary, config_json, last_validated_at, last_run_recorded_at, created_at, updated_at"
    )
    .eq("id", modelId)
    .maybeSingle();

  // The one read on this page that IS load-bearing, and the one place where
  // "could not read it" and "it is not there" must not be merged: `notFound()`
  // tells the planner their model does not exist, and a 400 or a policy failure
  // is not evidence of that. It raises instead, so the route's error boundary
  // says something a retry can act on.
  if (modelResult.error) {
    throw new Error(`Could not read this model: ${modelResult.error.message}`);
  }

  const model = modelResult.data;

  if (!model) {
    notFound();
  }

  const [projectsResult, scenarioOptionsResult, primaryProjectResult, primaryScenarioResult, plansResult, reportsResult, datasetsResult, runsResult, linksResult, scenarioEntriesResult, modelRunsResult, scenarioAssumptionSetsResult, scenarioDataPackagesResult, scenarioIndicatorSnapshotsResult, workspaceResult] =
    await Promise.all([
      supabase.from("projects").select("id, name").eq("workspace_id", model.workspace_id).order("updated_at", { ascending: false }),
      supabase.from("scenario_sets").select("id, title").eq("workspace_id", model.workspace_id).order("updated_at", { ascending: false }),
      model.project_id
        ? supabase
            .from("projects")
            // Spelled out rather than interpolating PROJECT_PLACE_COLUMNS: a
            // template literal breaks supabase-js inference, and a projection
            // this guard cannot read as a literal is one
            // reference-count-projection-guard.test.ts silently stops checking.
            // The full place row INCLUDING geometry — the scope variant omits
            // it deliberately, and geometry is what makes an area seedable.
            .select(
              "id, name, status, delivery_phase, summary, updated_at, place_source, place_kind, place_ref, place_label, place_country_code, place_subdivision_code, place_min_lon, place_min_lat, place_max_lon, place_max_lat, place_geometry_geojson, place_set_at"
            )
            .eq("id", model.project_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      model.scenario_set_id
        ? supabase
            .from("scenario_sets")
            .select("id, title, status, summary, planning_question, updated_at")
            .eq("id", model.scenario_set_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.from("plans").select("id, title").eq("workspace_id", model.workspace_id).order("updated_at", { ascending: false }),
      supabase.from("reports").select("id, title").eq("workspace_id", model.workspace_id).order("updated_at", { ascending: false }),
      supabase
        .from("data_datasets")
        .select("id, name, status, vintage_label, geography_scope, updated_at")
        .eq("workspace_id", model.workspace_id)
        .order("updated_at", { ascending: false }),
      supabase.from("runs").select("id, title, created_at").eq("workspace_id", model.workspace_id).order("created_at", { ascending: false }).limit(60),
      supabase.from("model_links").select("id, model_id, link_type, linked_id, label").eq("model_id", model.id),
      model.scenario_set_id
        ? supabase
            .from("scenario_entries")
            .select("id, label, entry_type, status, assumptions_json, sort_order, created_at")
            .eq("scenario_set_id", model.scenario_set_id)
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("model_runs")
        .select(
          "id, model_id, scenario_entry_id, source_analysis_run_id, engine_key, status, run_title, result_summary_json, error_message, corridor_geojson, started_at, completed_at, created_at, updated_at, stages:model_run_stages(id, stage_name, status, started_at, completed_at, updated_at, error_message, log_tail), artifacts:model_run_artifacts(id, artifact_type, file_url, file_size_bytes)"
        )
        .eq("model_id", model.id)
        .order("created_at", { ascending: false })
        .limit(12),
      model.scenario_set_id
        ? supabase
            .from("scenario_assumption_sets")
            .select("updated_at")
            .eq("scenario_set_id", model.scenario_set_id)
        : Promise.resolve({ data: [], error: null }),
      model.scenario_set_id
        ? supabase
            .from("scenario_data_packages")
            .select("updated_at")
            .eq("scenario_set_id", model.scenario_set_id)
        : Promise.resolve({ data: [], error: null }),
      model.scenario_set_id
        ? supabase
            .from("scenario_indicator_snapshots")
            .select("snapshot_at")
            .eq("scenario_set_id", model.scenario_set_id)
        : Promise.resolve({ data: [], error: null }),
      // The workspace's own place of record — the last fallback a model run
      // inherits when neither the model nor its project carries an area. Same
      // read as county-runs/page.tsx and safety/page.tsx.
      supabase.from("workspaces").select(HOME_GEOGRAPHY_COLUMNS).eq("id", model.workspace_id).maybeSingle(),
    ]);

  /**
   * THE WORKSPACE'S TRANSIT FEEDS THAT A MODEL RUN COULD ACTUALLY USE.
   *
   * Two filters, both load-bearing. `workspace_id` is named explicitly because
   * `gtfs_feeds.workspace_id IS NULL` is a PUBLIC preloaded feed readable by
   * every tenant — and the model handoff resolves the version under this
   * workspace's id, so a public feed offered here would refuse on the far side
   * for a reason pointing at the wrong thing. And the version read goes through
   * `filterToCurrentReadyVersion`, the codebase's one expression of "the ingest
   * this workspace analyses with": a feed whose only ingest failed has nothing
   * to hand the worker, and listing it would produce a refusal the planner
   * could have been shown before they clicked.
   *
   * A failed read yields an EMPTY list — the picker is optional, and a launch
   * control that broke because a transit read failed would be worse than one
   * offering no feeds. But an empty list is ALSO what a workspace with no feeds
   * looks like, and those two must not render identically: "you have not
   * ingested a feed yet" is a fact, and "we could not ask" is not. Both reads
   * therefore go through `reads.check`, which discloses the failure through
   * `ReadFailureLog` at the top of the page.
   */
  const transitFeedsResult = await supabase
    .from("gtfs_feeds")
    .select("id, agency_name")
    .eq("workspace_id", model.workspace_id)
    .order("agency_name", { ascending: true })
    .limit(100);

  const transitFeedVersionsResult = await filterToCurrentReadyVersion(
    supabase
      .from("gtfs_feed_versions")
      .select("feed_id, service_end_date, frequency_trip_count, scheduled_trip_count")
      .eq("workspace_id", model.workspace_id) as unknown as CurrentTransitVersionQuery
  ).limit(100);

  reads.check("this workspace's transit feeds", transitFeedsResult);
  reads.check("the transit feed ingests in use", transitFeedVersionsResult);

  const transitVersionsByFeedId = new Map(
    (((transitFeedVersionsResult.data ?? []) as unknown) as Array<{
      feed_id: string;
      service_end_date: string | null;
      frequency_trip_count: number | null;
      scheduled_trip_count: number | null;
    }>).map((version) => [version.feed_id, version])
  );

  const transitFeedOptions: TransitFeedOption[] = (
    ((transitFeedsResult.data ?? []) as unknown) as Array<{ id: string; agency_name: string | null }>
  )
    .map((feed) => {
      const version = transitVersionsByFeedId.get(feed.id);
      if (!version) return null;
      return {
        id: feed.id,
        agencyName: feed.agency_name ?? "Unnamed transit feed",
        serviceEndDate: version.service_end_date ? version.service_end_date.slice(0, 10) : null,
        // Counts, not a boolean. A boolean could only ever be phrased as a
        // refusal ("this feed uses frequencies"); the numbers let the launch
        // control say what will actually be excluded and what will be modeled.
        frequencyTripCount: version.frequency_trip_count ?? null,
        scheduledTripCount: version.scheduled_trip_count ?? null,
      };
    })
    .filter((option): option is TransitFeedOption => option !== null);

  const countyRunsResult = await supabase
    .from("county_runs")
    .select("stage, status_label")
    .eq("workspace_id", model.workspace_id);

  const countyRunsUnreadable = reads.check("county screening runs", countyRunsResult);
  const workspaceCountyRuns = countyRunsResult.data;

  const networkBasisResult = await supabase
    .from("models")
    .select("network_package_version_id")
    .eq("id", model.id)
    .maybeSingle();

  const networkBasisSchemaPending = Boolean(
    networkBasisResult.error && looksLikePendingNetworkLinkColumn(networkBasisResult.error.message)
  );
  const networkPackageVersionId =
    ((networkBasisResult.data ?? null) as { network_package_version_id?: string | null } | null)
      ?.network_package_version_id ?? null;

  const networkBasisVersionResult = networkPackageVersionId
    ? await supabase
        .from("network_package_versions")
        .select("id, version_name, status, updated_at, package:network_packages(id, name)")
        .eq("id", networkPackageVersionId)
        .maybeSingle()
    : { data: null, error: null };

  const networkBasisVersion = (networkBasisVersionResult.data ?? null) as NetworkBasisVersionRow | null;
  const networkBasisPackage = networkBasisVersion
    ? Array.isArray(networkBasisVersion.package)
      ? networkBasisVersion.package[0] ?? null
      : networkBasisVersion.package
    : null;

  const countyRunRows = (workspaceCountyRuns ?? []) as Array<{
    stage: string | null;
    status_label: string | null;
  }>;
  const hasWorkspacePassingCountyRun = countyRunRows.some(
    (row) => row.stage === "validated-screening" && isPassingCountyRunGateStatus(row.status_label)
  );

  // The option lists behind the Links tab. A failed read here offers the
  // planner nothing to attach, which looks identical to a workspace that has
  // nothing to attach.
  reads.check("selectable projects", projectsResult);
  reads.check("selectable scenario sets", scenarioOptionsResult);
  reads.check("selectable plans", plansResult);
  reads.check("selectable reports", reportsResult);
  reads.check("selectable datasets", datasetsResult);
  reads.check("selectable runs", runsResult);
  reads.check("the primary project", primaryProjectResult);
  reads.check("the primary scenario set", primaryScenarioResult);
  reads.check("scenario entries", scenarioEntriesResult);
  reads.check("this workspace's home geography", workspaceResult);

  // The link set itself. Everything downstream of it — the six linked-record
  // sections, the four linkage counts in the header, and the link-derived
  // readiness checks — is computed from this one array, so its failure is the
  // single read on this page that can turn the most of it into a false claim.
  const linkSetUnreadable = reads.check("this model's link set", linksResult);

  const links = (linksResult.data ?? []) as ModelLinkRow[];
  const scenarioLinkIds = links.filter((link) => link.link_type === "scenario_set").map((link) => link.linked_id);
  const planLinkIds = links.filter((link) => link.link_type === "plan").map((link) => link.linked_id);
  const reportLinkIds = links.filter((link) => link.link_type === "report").map((link) => link.linked_id);
  const datasetLinkIds = links.filter((link) => link.link_type === "data_dataset").map((link) => link.linked_id);
  const runLinkIds = links.filter((link) => link.link_type === "run").map((link) => link.linked_id);
  const projectLinkIds = links.filter((link) => link.link_type === "project_record").map((link) => link.linked_id);

  const [linkedScenariosResult, linkedPlansResult, linkedReportsResult, linkedDatasetsResult, linkedRunsResult, linkedProjectsResult] =
    await Promise.all([
      scenarioLinkIds.length
        ? supabase
            .from("scenario_sets")
            .select("id, title, status, summary, planning_question, updated_at")
            .in("id", scenarioLinkIds)
        : Promise.resolve({ data: [], error: null }),
      planLinkIds.length
        ? supabase.from("plans").select("id, title, plan_type, status, updated_at").in("id", planLinkIds)
        : Promise.resolve({ data: [], error: null }),
      reportLinkIds.length
        ? supabase.from("reports").select("id, title, report_type, status, generated_at, updated_at").in("id", reportLinkIds)
        : Promise.resolve({ data: [], error: null }),
      datasetLinkIds.length
        ? supabase
            .from("data_datasets")
            .select("id, name, status, vintage_label, geography_scope, updated_at")
            .in("id", datasetLinkIds)
        : Promise.resolve({ data: [], error: null }),
      runLinkIds.length ? supabase.from("runs").select("id, title, created_at").in("id", runLinkIds) : Promise.resolve({ data: [], error: null }),
      projectLinkIds.length
        ? supabase.from("projects").select("id, name, status, delivery_phase, updated_at").in("id", projectLinkIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  const { readiness, workflow, linkageCounts } = buildModelWorkspaceSummary({
    modelStatus: model.status,
    projectId: model.project_id,
    scenarioSetId: model.scenario_set_id,
    configVersion: model.config_version,
    ownerLabel: model.owner_label,
    assumptionsSummary: model.assumptions_summary,
    inputSummary: model.input_summary,
    outputSummary: model.output_summary,
    lastValidatedAt: model.last_validated_at,
    lastRunRecordedAt: model.last_run_recorded_at,
    links,
  });

  // Each of the six resolves the records behind one KIND of link. The link ids
  // came from `model_links` and are already in hand, so a failure here has a
  // more precise thing to say than "none": the links exist, and their records
  // could not be loaded. The count therefore falls back to the number of LINKS
  // — which is known — rather than to zero, which would be a claim.
  const linkedScenariosUnreadable = reads.check("linked scenario sets", linkedScenariosResult);
  const linkedPlansUnreadable = reads.check("linked plans", linkedPlansResult);
  const linkedReportsUnreadable = reads.check("linked reports", linkedReportsResult);
  const linkedDatasetsUnreadable = reads.check("linked datasets", linkedDatasetsResult);
  const linkedRunsUnreadable = reads.check("linked runs", linkedRunsResult);
  const linkedProjectsUnreadable = reads.check("linked projects", linkedProjectsResult);

  function unreadableCopy(linkCount: number, noun: string) {
    return (
      `${linkCount} ${linkCount === 1 ? noun : `${noun}s`} ${linkCount === 1 ? "is" : "are"} linked to this ` +
      "model, and the records could not be read. This list is empty because the query failed, not because " +
      "nothing is attached."
    );
  }

  const linkedRecordSections: Array<{
    title: string;
    count: number;
    records: LinkedRecordCard[];
    emptyCopy: string;
    unavailable: string | null;
  }> = [
    {
      title: "Scenario links",
      unavailable: linkedScenariosUnreadable ? unreadableCopy(scenarioLinkIds.length, "scenario set") : null,
      count: linkedScenariosUnreadable ? scenarioLinkIds.length : linkedScenariosResult.data?.length ?? 0,
      emptyCopy: "Use the Links tab to attach additional scenario variants or parallel scenario sets.",
      records: ((linkedScenariosResult.data ?? []) as Array<{
        id: string;
        title: string | null;
        status: string | null;
        planning_question: string | null;
        updated_at: string | null;
      }>).map((record) => ({
        id: record.id,
        title: titleForRecord(record),
        href: `/scenarios/${record.id}`,
        statusLabel: record.status || "Scenario record",
        timestampLabel: formatModelDateTime(record.updated_at),
        meta: record.planning_question ? [record.planning_question] : [],
      })),
    },
    {
      title: "Plan links",
      unavailable: linkedPlansUnreadable ? unreadableCopy(planLinkIds.length, "plan") : null,
      count: linkedPlansUnreadable ? planLinkIds.length : linkedPlansResult.data?.length ?? 0,
      emptyCopy: "Attach plans when the model supports a specific planning package or corridor strategy.",
      records: ((linkedPlansResult.data ?? []) as Array<{
        id: string;
        title: string | null;
        status: string | null;
        plan_type: string | null;
        updated_at: string | null;
      }>).map((record) => ({
        id: record.id,
        title: titleForRecord(record),
        href: `/plans/${record.id}`,
        statusLabel: record.status || "Plan record",
        timestampLabel: formatModelDateTime(record.updated_at),
        meta: record.plan_type ? [record.plan_type] : [],
      })),
    },
    {
      title: "Report links",
      unavailable: linkedReportsUnreadable ? unreadableCopy(reportLinkIds.length, "report") : null,
      count: linkedReportsUnreadable ? reportLinkIds.length : linkedReportsResult.data?.length ?? 0,
      emptyCopy: "Attach reports when outputs have been cited or published downstream.",
      records: ((linkedReportsResult.data ?? []) as Array<{
        id: string;
        title: string | null;
        status: string | null;
        report_type: string | null;
        generated_at: string | null;
        updated_at: string | null;
      }>).map((record) => ({
        id: record.id,
        title: titleForRecord(record),
        href: `/reports/${record.id}`,
        statusLabel: record.status || "Report record",
        timestampLabel: formatModelDateTime(record.generated_at ?? record.updated_at),
        meta: record.report_type ? [record.report_type] : [],
      })),
    },
    {
      title: "Dataset links",
      unavailable: linkedDatasetsUnreadable ? unreadableCopy(datasetLinkIds.length, "dataset") : null,
      count: linkedDatasetsUnreadable ? datasetLinkIds.length : linkedDatasetsResult.data?.length ?? 0,
      emptyCopy: "Attach datasets to make the model input basis traceable from Data Hub forward.",
      records: ((linkedDatasetsResult.data ?? []) as Array<{
        id: string;
        name: string | null;
        status: string | null;
        vintage_label: string | null;
        geography_scope: string | null;
        updated_at: string | null;
      }>).map((record) => ({
        id: record.id,
        title: titleForRecord(record),
        href: "/data-hub",
        statusLabel: record.status || "Dataset record",
        timestampLabel: formatModelDateTime(record.updated_at),
        meta: [record.vintage_label, record.geography_scope].filter((value): value is string => Boolean(value)),
      })),
    },
    {
      title: "Recorded runs",
      unavailable: linkedRunsUnreadable ? unreadableCopy(runLinkIds.length, "recorded run") : null,
      count: linkedRunsUnreadable ? runLinkIds.length : linkedRunsResult.data?.length ?? 0,
      emptyCopy: "Attach run records when execution evidence exists and should remain auditable.",
      records: ((linkedRunsResult.data ?? []) as Array<{
        id: string;
        title: string | null;
        created_at: string | null;
      }>).map((record) => ({
        id: record.id,
        title: titleForRecord(record),
        href: null,
        statusLabel: "Recorded run",
        timestampLabel: formatModelDateTime(record.created_at),
        meta: [],
      })),
    },
    {
      title: "Related projects",
      unavailable: linkedProjectsUnreadable ? unreadableCopy(projectLinkIds.length, "project") : null,
      count: linkedProjectsUnreadable ? projectLinkIds.length : linkedProjectsResult.data?.length ?? 0,
      emptyCopy: "Attach adjacent projects when the model informs work outside the primary anchor.",
      records: ((linkedProjectsResult.data ?? []) as Array<{
        id: string;
        name: string | null;
        status: string | null;
        delivery_phase: string | null;
        updated_at: string | null;
      }>).map((record) => ({
        id: record.id,
        title: titleForRecord(record),
        href: `/projects/${record.id}`,
        statusLabel: record.status || "Project record",
        timestampLabel: formatModelDateTime(record.updated_at),
        meta: record.delivery_phase ? [record.delivery_phase] : [],
      })),
    },
  ];

  const scenarioSpineSchemaPending = [
    scenarioAssumptionSetsResult.error,
    scenarioDataPackagesResult.error,
    scenarioIndicatorSnapshotsResult.error,
  ].some((error) => looksLikePendingScenarioSpineSchema(error?.message));

  // Classified first, collected second. A spine table this deployment has not
  // migrated yet already has a truer thing to say than "could not be read", and
  // it says it below; only the failures that are NOT that are disclosed.
  if (!scenarioSpineSchemaPending) {
    reads.check("scenario assumption sets", scenarioAssumptionSetsResult);
    reads.check("scenario data packages", scenarioDataPackagesResult);
    reads.check("scenario indicator snapshots", scenarioIndicatorSnapshotsResult);
  }

  if (!networkBasisSchemaPending) {
    reads.check("this model's network basis", networkBasisResult);
    reads.check("the linked network package version", networkBasisVersionResult);
  }

  const primaryScenarioSpine = model.scenario_set_id
    ? {
        schemaPending: scenarioSpineSchemaPending,
        assumptionSetCount: scenarioSpineSchemaPending
          ? 0
          : ((scenarioAssumptionSetsResult.data ?? []) as ScenarioSpineRow[]).length,
        dataPackageCount: scenarioSpineSchemaPending
          ? 0
          : ((scenarioDataPackagesResult.data ?? []) as ScenarioSpineRow[]).length,
        indicatorSnapshotCount: scenarioSpineSchemaPending
          ? 0
          : ((scenarioIndicatorSnapshotsResult.data ?? []) as ScenarioSpineRow[]).length,
        latestIndicatorSnapshotAt: scenarioSpineSchemaPending
          ? null
          : latestTimestamp(
              ((scenarioIndicatorSnapshotsResult.data ?? []) as ScenarioSpineRow[]).map(
                (row) => row.snapshot_at ?? null
              )
            ),
      }
    : null;

  const launchTemplate = extractModelLaunchTemplate(model.config_json ?? {});
  const modelRunsSchemaPending = Boolean(modelRunsResult.error && looksLikePendingSchema(modelRunsResult.error.message));

  if (!modelRunsSchemaPending) {
    reads.check("this model's runs", modelRunsResult);
  }

  // Reconcile-on-read: reap runs whose worker crashed or never picked them up
  // so the UI never shows a run stuck "running"/"queued" forever. The client
  // re-triggers this loader every 5s (router.refresh) while a run is active,
  // so a dead run flips to a truthful `failed` state within a poll cycle.
  // Best-effort + status-guarded; the cron sweep (/api/cron/reap-model-runs)
  // is the no-viewer backstop.
  const reapedRunMessages = modelRunsSchemaPending
    ? new Map<string, string>()
    : await reconcileStaleModelRuns((modelRunsResult.data ?? []) as unknown as ReaperRun[]);

  // Real claim tier per run (from modeling_claim_decisions), so the evidence
  // panel surfaces a genuinely calibrated_to_counts run as such instead of the
  // engine-availability default. Best-effort: an empty map falls back cleanly.
  const modelRunClaimStatuses = modelRunsSchemaPending
    ? new Map<string, ModelRunClaimDecision>()
    : await loadModelRunClaimStatuses({
        supabase,
        modelRunIds: ((modelRunsResult.data ?? []) as Array<{ id: string }>).map((r) => r.id),
      });

  const modelRuns = modelRunsSchemaPending ? [] : ((modelRunsResult.data ?? []) as unknown as Array<{
    id: string;
    status: string;
    run_title: string;
    engine_key?: string;
    scenario_entry_id: string | null;
    source_analysis_run_id: string | null;
    result_summary_json: Record<string, unknown> | null;
    error_message: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string | null;
    stages: ModelRunStage[];
    artifacts: ModelRunArtifact[];
  }>).map((r) => {
    const engine_key = r.engine_key ?? "deterministic_corridor_v1";
    const claimDecision = modelRunClaimStatuses.get(r.id) ?? null;
    const reapMessage = reapedRunMessages.get(r.id);
    if (!reapMessage) return { ...r, engine_key, claimDecision };
    // Reflect the reap in the rendered payload without a re-query. completed_at
    // is set by the DB write and picked up on the next poll — omitting it here
    // keeps the loader pure.
    return {
      ...r,
      engine_key,
      claimDecision,
      status: "failed",
      error_message: reapMessage,
      stages: (r.stages ?? []).map((s) =>
        s.status === "queued" || s.status === "running"
          ? { ...s, status: "failed", error_message: reapMessage }
          : s
      ),
    };
  });
  const scenarioEntryOptions = ((scenarioEntriesResult.data ?? []) as Array<{
    id: string;
    label: string;
    entry_type: string;
    status: string;
    assumptions_json: Record<string, unknown> | null;
  }>).map((entry) => ({
    id: entry.id,
    label: entry.label,
    entryType: entry.entry_type,
    status: entry.status,
    assumptionCount: Object.keys(entry.assumptions_json ?? {}).length,
  }));
  /**
   * Which study area this model's run form opens with.
   *
   * Before this, the picker here opened EMPTY while Explore, Safety and county
   * runs all opened on something the workspace had already told the app — so a
   * planner who had set their county, and then set a study area on the project,
   * still had to find and re-pick the same boundary to launch a model run.
   *
   * Precedence is `resolveStudyArea`'s, and the first candidate is the model's
   * OWN launch template, which outranks the rest: an area deliberately
   * configured for this model must not be replaced by a project-wide one just
   * because a project-wide one exists. So this cannot change what any existing
   * model opens with; it only fills a blank.
   *
   * Seeded into initial state rather than applied by an effect — this page is
   * server-rendered, so `useState(initial)` already satisfies "applied once,
   * into an empty field, never over a user's edit". The `prefillAppliedRef`
   * pattern in `use-explore-home-geography.ts` exists because Explore fetches
   * its geography client-side, after the field is already on screen.
   */
  const previousRun = ((modelRunsResult.data ?? []) as Array<{ corridor_geojson?: unknown }>)[0];
  const studyArea = resolveStudyArea({
    existing: launchTemplate.corridorGeojson,
    project: placeOfRecordFromProject(primaryProjectResult.data as Parameters<typeof placeOfRecordFromProject>[0]),
    workspaceHome: placeOfRecordFromHomeGeography(parseWorkspaceHomeGeography(workspaceResult.data)),
    previousRun: corridorGeojsonSchema.safeParse(previousRun?.corridor_geojson).data ?? null,
  });

  const defaultCorridorText = studyArea.geometry
    ? JSON.stringify(studyArea.geometry, null, 2)
    : "";

  /**
   * What this deployment DECLARES about the AequilibraE worker.
   *
   * Read here rather than inside the run manager because the manager is a client
   * component and this variable is deliberately unprefixed: it is not in the
   * browser bundle at all, and the `NEXT_PUBLIC_` alternative would be inlined
   * at build time, so an operator who started a worker and corrected the
   * declaration would keep being refused until they rebuilt. Read per request on
   * the server, a corrected answer takes effect on the next process restart.
   *
   * The same reader the dashboard's configuration panel uses, so the panel and
   * the launch button can never describe this deployment differently.
   *
   * Unset stays `undeclared`, and the manager then behaves exactly as it did
   * before any declaration existed — inferring from this model's own run history
   * and claiming nothing more. A deployment that runs a worker and has never set
   * the variable is untouched by this, which is the whole reason silence is not
   * read as absence.
   */
  const modelingWorkerDeclaration = resolveModelingWorkerDeclaration();

  return (
    <section className="module-page relative">
      <CartographicSurfaceWide />
      <div className="module-page-backdrop" />

      <div className="space-y-6">
        <Link href="/models" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to Models
        </Link>

        {reads.any ? (
          <StateBlock
            tone="danger"
            title="Part of this page could not be read"
            description={`${reads.describe()} ${reads.messages().join(" · ")}`}
          />
        ) : null}

        {/* The screening gate, and the difference between not having one and not
            being able to tell. Both hold modeling output to prototype-only —
            withholding the claim is the safe direction either way — but only one
            of them is a statement about this workspace, and the planner acts
            differently on each: go and run a county screening, or come back when
            the read works. */}
        {countyRunsUnreadable ? (
          <StateBlock
            tone="warning"
            title="Screening status could not be verified"
            description="The county screening runs for this workspace could not be read, so this page cannot say whether a validated screening run exists. Treat modeling output here as prototype-only until it can."
            action={
              <Link
                href="/county-runs"
                className="inline-flex items-center rounded border border-border/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-primary/35 hover:text-primary"
              >
                Review county runs
              </Link>
            }
          />
        ) : !hasWorkspacePassingCountyRun ? (
          <StateBlock
            tone="warning"
            title="No validated screening run on file"
            description="Modeling outputs in this workspace are prototype-only until a county-run clears the screening gate. Any numbers produced here should not be used for outward modeling claims."
            action={
              <Link
                href="/county-runs"
                className="inline-flex items-center rounded border border-border/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-primary/35 hover:text-primary"
              >
                Review county runs
              </Link>
            }
          />
        ) : null}

        <header className="module-header-grid">
          <article className="module-intro-card">
            <div className="module-intro-kicker">
              <Database className="h-3.5 w-3.5" />
              Model detail
            </div>
            <div className="module-intro-body">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={modelStatusTone(model.status)}>{formatModelStatusLabel(model.status)}</StatusBadge>
                <StatusBadge tone="info">{formatModelFamilyLabel(model.model_family)}</StatusBadge>
                <StatusBadge tone={readiness.ready ? "success" : "warning"}>{readiness.label}</StatusBadge>
              </div>
              <h1 className="module-intro-title">{model.title}</h1>
              <p className="module-intro-description">
                {model.summary ||
                  "No summary yet. Use this record to document the model setup, linked inputs, and downstream outputs."}
              </p>
            </div>

            <div className="module-summary-grid cols-5">
              {/* All four linkage counts and several readiness checks are
                  computed from the one `model_links` read. When it fails the
                  numbers are not zero, they are unknown — and an unknown
                  rendered as 0 is the exact shape of the defect this page had:
                  a query failure presented as a finished count. */}
              <div className="module-summary-card">
                <p className="module-summary-label">Checks passed</p>
                <p className="module-summary-value">
                  {linkSetUnreadable ? "—" : `${readiness.readyCheckCount}/${readiness.totalCheckCount}`}
                </p>
                <p className="module-summary-detail">
                  {linkSetUnreadable
                    ? "Several checks read this model's links, which could not be loaded."
                    : readiness.reason}
                </p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Linked plans</p>
                <p className="module-summary-value">{linkSetUnreadable ? "—" : linkageCounts.plans}</p>
                <p className="module-summary-detail">
                  {linkSetUnreadable ? "Link set unreadable." : "Plans that already reference this model."}
                </p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Datasets</p>
                <p className="module-summary-value">{linkSetUnreadable ? "—" : linkageCounts.datasets}</p>
                <p className="module-summary-detail">
                  {linkSetUnreadable ? "Link set unreadable." : "Linked Data Hub records."}
                </p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Runs</p>
                <p className="module-summary-value">{linkSetUnreadable ? "—" : linkageCounts.runs}</p>
                <p className="module-summary-detail">
                  {linkSetUnreadable ? "Link set unreadable." : "Recorded run references tied to this model."}
                </p>
              </div>
              <div className="module-summary-card">
                <p className="module-summary-label">Reports</p>
                <p className="module-summary-value">{linkSetUnreadable ? "—" : linkageCounts.reports}</p>
                <p className="module-summary-detail">
                  {linkSetUnreadable ? "Link set unreadable." : "Reports that reference this model."}
                </p>
              </div>
            </div>
          </article>

          <article className="module-operator-card">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] border border-white/10 bg-white/[0.05]">
                <ShieldCheck className="h-5 w-5 text-emerald-200" />
              </span>
              <div>
                <p className="module-operator-eyebrow">Model summary</p>
                <h2 className="module-operator-title">{workflow.label}</h2>
              </div>
            </div>
            <p className="module-operator-copy">{workflow.reason}</p>
            <div className="module-operator-list">
              <div className="module-operator-item">
                {workflow.packageLabel}: {workflow.packageDetail}
              </div>
              {workflow.actionItems.length > 0 ? <div className="module-operator-item">{workflow.actionItems[0]}</div> : null}
              {workflow.reviewNotes[0] ? <div className="module-operator-item">{workflow.reviewNotes[0]}</div> : null}
            </div>
          </article>
        </header>

        <div className="grid gap-6 xl:grid-cols-[0.96fr_1.04fr]">
          <ModelDetailControls
            model={model}
            projects={(projectsResult.data ?? []) as Array<{ id: string; name: string }>}
            scenarioSets={(scenarioOptionsResult.data ?? []) as Array<{ id: string; title: string }>}
            plans={((plansResult.data ?? []) as Array<{ id: string; title: string | null }>).map((plan) => ({
              id: plan.id,
              title: plan.title ?? "Untitled plan",
            }))}
            reports={((reportsResult.data ?? []) as Array<{ id: string; title: string | null }>).map((report) => ({
              id: report.id,
              title: report.title ?? "Untitled report",
            }))}
            datasets={((datasetsResult.data ?? []) as Array<{ id: string; name: string | null }>).map((dataset) => ({
              id: dataset.id,
              title: dataset.name ?? "Untitled dataset",
            }))}
            runs={((runsResult.data ?? []) as Array<{ id: string; title: string | null }>).map((run) => ({
              id: run.id,
              title: run.title ?? "Untitled run",
            }))}
            selectedLinks={{
              scenarios: scenarioLinkIds,
              plans: planLinkIds,
              reports: reportLinkIds,
              datasets: datasetLinkIds,
              runs: runLinkIds,
              relatedProjects: projectLinkIds,
            }}
          />

          <div className="space-y-6">
            <ModelRunManager
              modelId={model.id}
              modelTitle={model.title}
              defaultQueryText={launchTemplate.queryText ?? ""}
              defaultCorridorText={defaultCorridorText}
              studyAreaOriginLabel={studyArea.originLabel}
              scenarioEntries={scenarioEntryOptions}
              modelRuns={modelRuns}
              schemaPending={modelRunsSchemaPending}
              modelingWorkerDeclaration={modelingWorkerDeclaration}
              workspaceId={model.workspace_id}
              transitFeeds={transitFeedOptions}
            />

            <article className="module-section-surface">
              <div className="module-section-header">
                <div className="module-section-heading">
                  <p className="module-section-label">Anchors</p>
                  <h2 className="module-section-title">Primary planning context</h2>
                  <p className="module-section-description">
                    These anchors define what decision frame the model record belongs to before any explicit cross-links are added.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <div className="module-record-row">
                  <div className="module-record-head">
                    <div className="module-record-main">
                      <p className="module-section-label">Primary project</p>
                      {primaryProjectResult.data ? (
                        <>
                          <Link href={`/projects/${primaryProjectResult.data.id}`} className="module-record-title hover:text-primary">
                            {primaryProjectResult.data.name}
                          </Link>
                          <p className="module-record-summary">
                            {primaryProjectResult.data.summary || "Project anchor is present for this model record."}
                          </p>
                        </>
                      ) : (
                        <p className="module-record-summary">No primary project attached yet.</p>
                      )}
                    </div>
                  </div>
                  {primaryProjectResult.data ? (
                    <MetaList>
                      <MetaItem>{primaryProjectResult.data.status || "Status pending"}</MetaItem>
                      {primaryProjectResult.data.delivery_phase ? <MetaItem>{primaryProjectResult.data.delivery_phase}</MetaItem> : null}
                      <MetaItem>Updated {formatModelDateTime(primaryProjectResult.data.updated_at)}</MetaItem>
                    </MetaList>
                  ) : null}
                </div>

                <div className="module-record-row">
                  <div className="module-record-head">
                    <div className="module-record-main">
                      <p className="module-section-label">Primary scenario set</p>
                      {primaryScenarioResult.data ? (
                        <>
                          <Link href={`/scenarios/${primaryScenarioResult.data.id}`} className="module-record-title hover:text-primary">
                            {primaryScenarioResult.data.title}
                          </Link>
                          <p className="module-record-summary">
                            {primaryScenarioResult.data.planning_question || primaryScenarioResult.data.summary || "No planning question captured yet."}
                          </p>
                        </>
                      ) : (
                        <p className="module-record-summary">No primary scenario set attached yet.</p>
                      )}
                    </div>
                  </div>
                  {primaryScenarioResult.data ? (
                    <MetaList>
                      <MetaItem>{primaryScenarioResult.data.status || "Scenario record"}</MetaItem>
                      <MetaItem>Updated {formatModelDateTime(primaryScenarioResult.data.updated_at)}</MetaItem>
                      {primaryScenarioSpine ? (
                        primaryScenarioSpine.schemaPending ? (
                          <MetaItem>Scenario spine schema pending</MetaItem>
                        ) : (
                          <>
                            <MetaItem>{primaryScenarioSpine.assumptionSetCount} assumption sets</MetaItem>
                            <MetaItem>{primaryScenarioSpine.dataPackageCount} data packages</MetaItem>
                            <MetaItem>{primaryScenarioSpine.indicatorSnapshotCount} indicator snapshots</MetaItem>
                            {primaryScenarioSpine.latestIndicatorSnapshotAt ? (
                              <MetaItem>
                                Latest indicator {formatModelDateTime(primaryScenarioSpine.latestIndicatorSnapshotAt)}
                              </MetaItem>
                            ) : null}
                          </>
                        )
                      ) : null}
                    </MetaList>
                  ) : null}
                </div>

                <div className="module-record-row md:col-span-2">
                  <div className="module-record-head">
                    <div className="module-record-main">
                      <p className="module-section-label">Network basis</p>
                      {networkBasisSchemaPending ? (
                        <p className="module-record-summary">
                          Network link schema pending — apply the latest migrations to record which network package
                          version this model runs against.
                        </p>
                      ) : networkBasisVersion ? (
                        <>
                          <Link href="/models#network-packages" className="module-record-title hover:text-primary">
                            {networkBasisPackage?.name ?? "Untitled package"} · {networkBasisVersion.version_name}
                          </Link>
                          <p className="module-record-summary">
                            Ingested network bundle this model&apos;s runs are read against.
                          </p>
                        </>
                      ) : networkPackageVersionId ? (
                        <p className="module-record-summary">
                          A network package version is linked but could not be loaded. It may have been deleted or
                          belong to a package this account cannot read.
                        </p>
                      ) : (
                        <p className="module-record-summary">No network package version linked.</p>
                      )}
                    </div>
                  </div>
                  {networkBasisVersion ? (
                    <MetaList>
                      <MetaItem>{networkBasisVersion.status}</MetaItem>
                      <MetaItem>Updated {formatModelDateTime(networkBasisVersion.updated_at)}</MetaItem>
                    </MetaList>
                  ) : null}
                </div>
              </div>
            </article>

            <article className="module-section-surface">
              <div className="module-section-header">
                <div className="module-section-heading">
                  <p className="module-section-label">Readiness</p>
                  <h2 className="module-section-title">Configuration and traceability checks</h2>
                </div>
                <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  <FileStack className="h-3.5 w-3.5" />
                  {readiness.missingCheckCount} gaps
                </span>
              </div>

              <div className="mt-5 grid gap-3">
                {readiness.checks.map((check) => (
                  <div key={check.key} className="rounded-[0.5rem] border border-border/70 bg-background/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-foreground">{check.label}</p>
                      <StatusBadge tone={check.ready ? "success" : "warning"}>{check.ready ? "Ready" : "Missing"}</StatusBadge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{check.detail}</p>
                  </div>
                ))}
              </div>
            </article>

            <ModelLinkedRecordsBoard
              sections={linkedRecordSections}
              totalLinkCount={links.length}
              linkSetUnavailable={linkSetUnreadable}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
