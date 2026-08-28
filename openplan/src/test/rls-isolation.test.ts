import { randomUUID } from "node:crypto";
import { type SupabaseClient } from "@supabase/supabase-js";
import { LIVE_RLS, getLocalSupabaseEnv, liveClient, type LocalSupabaseEnv } from "./local-supabase-env";
import { resolveLocalDbContainer, queryCatalog, executeSql } from "./helpers/live-catalog";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type ProbeRow = Record<string, unknown>;

type WorkspaceRlsProbe = {
  table: string;
  select: string;
  expectedMemberReadable: boolean;
  build: (context: SeedContext) => ProbeRow;
  /**
   * HOW THIS TABLE IS SCOPED TO A WORKSPACE, when it is not by a `workspace_id`
   * column of its own.
   *
   * MOST OF THE SCHEMA IS SCOPED BY A JOIN, and that was this harness's blind
   * spot until 2026-08-07. `readWorkspaceRows` filtered on `workspace_id`
   * unconditionally, so a table without that column could not be probed at all
   * — and the census below, built on the same assumption, could not even SEE
   * such a table to report it missing. 44 tables sat in that gap, including
   * `engagement_items`: the resident comments, with the names, emails,
   * coordinates and demographics members of the public typed in.
   *
   * A policy that reaches through a join is the shape most likely to be written
   * wrongly and least likely to be noticed, because the wrongness is one table
   * away from the row it exposes.
   */
  scope?: {
    /** The column on THIS table that carries the parent id. */
    column: string;
    /** The tenant-B parent id the fixture row hangs off. */
    value: (context: SeedContext) => string;
  };
  /**
   * SEED THIS ROW WITH SQL INSTEAD OF THE CLIENT, for the one table the client
   * physically cannot write.
   *
   * `workspace_gis_features` holds a PostGIS `geometry` column, and PostgREST
   * has no way to write one from a JSON insert — the migration says so and
   * routes both directions through SQL functions for exactly that reason. The
   * table is still workspace-scoped and still READABLE through PostgREST as
   * long as the projection leaves `geom` out, so its isolation is testable even
   * though its seeding is not.
   *
   * The alternative was to excuse it, and an excuse here would have been wrong:
   * this table is the one that holds the actual shapes an agency uploaded, and
   * "we could not conveniently insert a fixture" is not a reason to leave the
   * biggest table in the lane unproven. `build()` is still required, so the
   * generic read path knows what to look for.
   */
  seedSql?: (context: SeedContext) => string;
};

type SeedContext = {
  suffix: string;
  workspaceAId: string;
  workspaceBId: string;
  userAId: string;
  userBId: string;
  userCId: string;
  projectBId: string;
  projectBRevision: string;
  planBId: string;
  reportArtifactBId: string;
  evidenceBundleBId: string;
  decisionSubmissionBId: string;
  decisionDecisionBId: string;
  scenarioSetBId: string;
  rtpCycleBId: string;
  rtpHorizonBandBId: string;
  countyRunBId: string;
  aerialMissionBId: string;
  gtfsFeedBId: string;
  gtfsFeedVersionBId: string;
  kbDocumentBId: string;
  portfolioImportBatchBId: string;
  safetyCrashIngestBId: string;
  safetyCrashBId: string;
  gisLayerBId: string;
  gisLayerVersionBId: string;
  dataConnectorBId: string;
  dataDatasetBId: string;
  modelBId: string;
  modelRunBId: string;
  sourceManifestBId: string;
  reportBId: string;
  engagementCampaignBId: string;
  engagementQuestionBId: string;
  landUsePlanBId: string;
  landUsePlanVersionBId: string;
  landUsePlanNodeBId: string;
  landUsePlanDesignationBId: string;
  landUsePlanReleaseBId: string;
};

const RLS_BUNDLE_CHECKSUM = "c".repeat(64);
const RLS_ENTRY_REVISION = "d".repeat(64);

function rlsEvidenceDescriptor(options: {
  idSeed: string;
  label: string;
  checksum: string;
  retrievedAt: string;
}) {
  return {
    schemaVersion: "openplan.evidence_descriptor.v1",
    stableEvidenceId: options.idSeed.repeat(64).slice(0, 64),
    source: { kind: "rls_fixture", label: options.label, citation: null },
    asOfDate: options.retrievedAt,
    retrievedAt: options.retrievedAt,
    evidenceStatus: "administrative",
    claimTier: null,
    uncertainty: [],
    limits: [],
    revisionToken: RLS_ENTRY_REVISION,
    checksumSha256: options.checksum,
    support: { status: "not_a_numeric_claim", reason: null },
  };
}

function rlsDecisionManifest(context: SeedContext) {
  const retrievedAt = "2026-08-27T00:00:00.000Z";
  const planChecksum = "e".repeat(64);
  const pdfChecksum = "f".repeat(64);
  const includedEntry = (options: {
    path: string;
    sourceId: string;
    recordId: string;
    contentType: string;
    checksum: string;
    label: string;
    idSeed: string;
  }) => ({
    path: options.path,
    originalRecord: { sourceId: options.sourceId, recordId: options.recordId, parentRecordId: null },
    contentType: options.contentType,
    inclusion: { status: "included", reason: null },
    retrieval: { state: "available", retrievedAt },
    revisionToken: RLS_ENTRY_REVISION,
    checksumSha256: options.checksum,
    byteSize: 1,
    evidence: rlsEvidenceDescriptor({
      idSeed: options.idSeed,
      label: options.label,
      checksum: options.checksum,
      retrievedAt,
    }),
  });
  return {
    schemaVersion: "project_evidence_manifest.v2",
    bundleId: context.evidenceBundleBId,
    workspaceId: context.workspaceBId,
    projectId: context.projectBId,
    projectRevision: context.projectBRevision,
    generatedAt: retrievedAt,
    purpose: "retained_evidence_snapshot",
    approvalOrPublication: false,
    layerStatusTable: "openplan_layer_status",
    inventory: { inventoryTruncated: false },
    selectedLinkedPlan: { id: context.planBId, revisionToken: RLS_ENTRY_REVISION },
    currentBoardOrReportPdf: { recordId: context.reportArtifactBId, checksumSha256: pdfChecksum },
    entries: [
      includedEntry({
        path: "project/linked-plan.json",
        sourceId: "linked_data",
        recordId: context.planBId,
        contentType: "application/json",
        checksum: planChecksum,
        label: "RLS linked plan",
        idSeed: "1",
      }),
      includedEntry({
        path: `files/report_artifacts/${context.reportArtifactBId}-rls.pdf`,
        sourceId: "report_artifacts",
        recordId: context.reportArtifactBId,
        contentType: "application/pdf",
        checksum: pdfChecksum,
        label: "RLS report PDF",
        idSeed: "2",
      }),
    ],
  };
}

type ReadResult = {
  table: string;
  rows: unknown[];
  error: string | null;
};

const SERVICE_ONLY_TABLES = new Set(["billing_webhook_receipts"]);

// These append-only ledgers cannot join this harness's create/delete fixture
// cycle. Their named live suites are part of `npm run test:rls-live` and prove
// the same member-visible / outsider-hidden boundary plus their stricter write
// rules. Keep this list exact so a filename alone cannot silently count.
const DEDICATED_LIVE_RLS_PROBES = new Set([
  "modeling_validation_assessments",
  "modeling_validation_structural_diagnoses",
]);

const WORKSPACE_RLS_PROBES: WorkspaceRlsProbe[] = [
  {
    table: "aerial_missions",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ aerialMissionBId, workspaceBId, suffix }) => ({
      id: aerialMissionBId,
      workspace_id: workspaceBId,
      title: `RLS aerial mission ${suffix}`,
    }),
  },
  {
    table: "aerial_evidence_packages",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, aerialMissionBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      mission_id: aerialMissionBId,
      title: `RLS evidence package ${suffix}`,
    }),
  },
  {
    table: "analyses",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      title: `RLS analysis ${suffix}`,
      query_text: "RLS isolation probe",
      is_public: false,
    }),
  },
  {
    table: "assistant_action_executions",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, userBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      user_id: userBId,
      action_kind: "rls_probe",
      audit_event: `rls_probe_${suffix}`,
      approval: "safe",
      regrounding: "none",
      outcome: "succeeded",
    }),
  },
  {
    table: "billing_events",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      event_type: `rls_probe_${suffix}`,
    }),
  },
  {
    table: "billing_invoice_records",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      invoice_number: `RLS-${suffix}`,
    }),
  },
  {
    table: "billing_webhook_receipts",
    select: "id,workspace_id",
    expectedMemberReadable: false,
    build: ({ workspaceBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      provider: "stripe",
      event_id: `evt_rls_${suffix}`,
      event_type: "rls.probe",
    }),
  },
  {
    table: "county_runs",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, countyRunBId, suffix }) => ({
      id: countyRunBId,
      workspace_id: workspaceBId,
      geography_id: "06057",
      geography_label: "Nevada County, CA",
      run_name: `RLS county run ${suffix}`,
    }),
  },
  {
    table: "county_run_artifacts",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, countyRunBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      county_run_id: countyRunBId,
      artifact_type: "manifest",
      path: `/tmp/openplan/rls/${suffix}.json`,
    }),
  },
  {
    table: "data_connectors",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, dataConnectorBId, suffix }) => ({
      id: dataConnectorBId,
      workspace_id: workspaceBId,
      key: `rls_connector_${suffix}`,
      display_name: `RLS connector ${suffix}`,
    }),
  },
  {
    table: "data_datasets",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, dataDatasetBId, dataConnectorBId, suffix }) => ({
      id: dataDatasetBId,
      workspace_id: workspaceBId,
      connector_id: dataConnectorBId,
      name: `RLS dataset ${suffix}`,
    }),
  },
  {
    table: "data_refresh_jobs",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, dataDatasetBId, dataConnectorBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      connector_id: dataConnectorBId,
      dataset_id: dataDatasetBId,
      job_name: `RLS refresh ${suffix}`,
    }),
  },
  {
    table: "engagement_campaigns",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, engagementCampaignBId, suffix }) => ({
      id: engagementCampaignBId,
      workspace_id: workspaceBId,
      title: `RLS campaign ${suffix}`,
      status: "draft",
      share_token: null,
    }),
  },
  {
    table: "funding_opportunities",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      title: `RLS opportunity ${suffix}`,
    }),
  },
  {
    table: "funding_awards",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, projectBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      project_id: projectBId,
      title: `RLS award ${suffix}`,
    }),
  },
  {
    table: "gtfs_feeds",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    // Seeded with a FIXED id (not randomUUID) because the three GTFS tables
    // below are its descendants and their composite (child, workspace) foreign
    // keys need this exact row.
    build: ({ workspaceBId, gtfsFeedBId, suffix }) => ({
      id: gtfsFeedBId,
      workspace_id: workspaceBId,
      agency_name: `RLS agency ${suffix}`,
    }),
  },
  {
    // The GTFS service-level spine (20260805000006). These three carry
    // `workspace_id` DIRECTLY rather than reaching a workspace through
    // `feed_id`, and this block is why: the probe-coverage guard below
    // enumerates tables by the presence of that column, so a transitively
    // scoped table is neither probed nor excused — it is invisible. The eight
    // older GTFS children that leaked for four months (20260730000010) are
    // exactly the tables shaped that way.
    table: "gtfs_feed_versions",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    // `status: 'ready'` with all four counts at 1 is not decoration: the
    // `gtfs_feed_versions_ready_is_not_empty` CHECK refuses a ready version
    // with no derived rows, so a fixture claiming ready must be internally
    // consistent with the two service-level rows seeded after it. It is left
    // NOT current (`is_current` defaults false) so it cannot collide with the
    // fixtures in gtfs-feed-status-mirrors-its-current-version.test.ts, which
    // runs against the same database.
    build: ({ workspaceBId, gtfsFeedBId, gtfsFeedVersionBId }) => ({
      id: gtfsFeedVersionBId,
      workspace_id: workspaceBId,
      feed_id: gtfsFeedBId,
      source_kind: "url",
      status: "ready",
      route_count: 1,
      stop_count: 1,
      route_service_level_rows: 1,
      stop_service_level_rows: 1,
    }),
  },
  {
    table: "gtfs_route_service_levels",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, gtfsFeedVersionBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      feed_version_id: gtfsFeedVersionBId,
      route_id: `rls-route-${suffix}`,
      direction_id: 0,
      route_short_name: "RLS",
      route_type: 3,
      service_day: "friday",
      trips_per_day: 24,
      first_departure_seconds: 21600,
      last_departure_seconds: 79200,
      peak_headway_seconds: 900,
      peak_window_start_seconds: 61200,
      median_headway_seconds: 1800,
      stops_served: 12,
      derivation_method: "scheduled",
      scheduled_trips: 24,
    }),
  },
  {
    table: "gtfs_stop_service_levels",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, gtfsFeedVersionBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      feed_version_id: gtfsFeedVersionBId,
      stop_id: `rls-stop-${suffix}`,
      stop_name: `RLS stop ${suffix}`,
      latitude: 39.2,
      longitude: -121.0,
      service_day: "friday",
      trips_per_day: 24,
      first_departure_seconds: 21600,
      last_departure_seconds: 79200,
      peak_headway_seconds: 900,
      peak_window_start_seconds: 61200,
      median_headway_seconds: 1800,
      routes_serving: 1,
      route_ids: [`rls-route-${suffix}`],
      derivation_method: "scheduled",
      scheduled_trips: 24,
    }),
  },
  {
    table: "gtfs_tract_service",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    // Derived by a spatial join at ingest, so it is service-role-authored and
    // has a SELECT policy only — the same posture as the two tables above. It
    // is probed all the same because it carries a workspace_id, and because the
    // rows describe which census tracts one agency serves.
    build: ({ workspaceBId, gtfsFeedVersionBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      feed_version_id: gtfsFeedVersionBId,
      tract_geoid: `060570000${suffix.slice(0, 2)}`,
      service_day: "friday",
      stops_in_tract: 3,
      stop_events_per_day: 72,
      best_peak_headway_seconds: 900,
      best_span_seconds: 57600,
      routes_serving: 2,
    }),
  },
  {
    table: "title_vi_policies",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    // An agency's adopted civil-rights thresholds and the board action that
    // adopted them. Every value here is workspace-specific policy, so a
    // cross-tenant read would expose one agency's adopted program to another.
    build: ({ workspaceBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      adopted_on: "2026-01-15",
      adopted_by: `RLS board ${suffix}`,
      minority_definition_method: "service_area_average",
      low_income_definition_method: "service_area_average",
      disparate_impact_threshold_pct: 10,
      disproportionate_burden_threshold_pct: 10,
    }),
  },
  {
    table: "models",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, modelBId, suffix }) => ({
      id: modelBId,
      workspace_id: workspaceBId,
      title: `RLS model ${suffix}`,
      model_family: "travel_demand",
    }),
  },
  {
    table: "model_runs",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, modelBId, modelRunBId, suffix }) => ({
      id: modelRunBId,
      workspace_id: workspaceBId,
      model_id: modelBId,
      run_title: `RLS model run ${suffix}`,
    }),
  },
  {
    // Knowledge Base document — must be inserted before kb_document_chunks (FK).
    table: "kb_documents",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, kbDocumentBId, suffix }) => ({
      id: kbDocumentBId,
      workspace_id: workspaceBId,
      title: `RLS document ${suffix}`,
      source_kind: "pasted_text",
      status: "ready",
    }),
  },
  {
    table: "kb_document_chunks",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, kbDocumentBId, suffix }) => ({
      id: randomUUID(),
      document_id: kbDocumentBId,
      workspace_id: workspaceBId,
      chunk_index: 0,
      content: `RLS knowledge base chunk ${suffix}`,
    }),
  },
  {
    table: "project_portfolio_import_batches",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, kbDocumentBId, portfolioImportBatchBId, userBId }) => ({
      id: portfolioImportBatchBId,
      workspace_id: workspaceBId,
      source_document_id: kbDocumentBId,
      source_sha256: "a".repeat(64),
      preview_sha256: "b".repeat(64),
      mapping_json: { name: 0 },
      defaults_json: { planType: "rls_probe", status: "draft", deliveryPhase: "scoping" },
      row_count: 1,
      created_count: 0,
      skipped_count: 1,
      conflicted_count: 0,
      invalid_count: 0,
      previously_created_count: 0,
      imported_by: userBId,
    }),
  },
  {
    table: "project_portfolio_import_rows",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, kbDocumentBId, portfolioImportBatchBId, userBId }) => ({
      id: randomUUID(),
      batch_id: portfolioImportBatchBId,
      workspace_id: workspaceBId,
      source_document_id: kbDocumentBId,
      source_sha256: "a".repeat(64),
      source_row_number: 2,
      row_fingerprint: "c".repeat(64),
      decision: "skip",
      outcome: "skipped",
      errors_json: [],
      warnings_json: [],
      resolved_plan_type: "rls_probe",
      resolved_status: "draft",
      resolved_delivery_phase: "scoping",
      actor_id: userBId,
    }),
  },
  {
    table: "project_evidence_bundles",
    select: "id,workspace_id,project_id,status",
    expectedMemberReadable: true,
    build: (context) => ({
      id: context.evidenceBundleBId,
      workspace_id: context.workspaceBId,
      project_id: context.projectBId,
      project_revision: context.projectBRevision,
      selection_json: [],
      selected_count: 0,
      generated_by: context.userBId,
      status: "ready",
      manifest_json: rlsDecisionManifest(context),
      manifest_sha256: "a".repeat(64),
      checksums_sha256: "b".repeat(64),
      bundle_sha256: RLS_BUNDLE_CHECKSUM,
      storage_bucket: "project-evidence-bundles",
      storage_path: `${context.workspaceBId}/${context.projectBId}/${context.evidenceBundleBId}.zip`,
      byte_count: 1,
      completed_at: new Date().toISOString(),
    }),
  },
  {
    table: "project_decision_package_submissions",
    select: "id,workspace_id,project_id,bundle_sha256",
    expectedMemberReadable: true,
    build: ({ workspaceBId, projectBId, evidenceBundleBId, decisionSubmissionBId, userBId, userCId }) => ({
      id: decisionSubmissionBId,
      workspace_id: workspaceBId,
      project_id: projectBId,
      bundle_id: evidenceBundleBId,
      bundle_sha256: RLS_BUNDLE_CHECKSUM,
      submitted_by: userBId,
      assigned_approver_id: userCId,
    }),
  },
  {
    table: "project_decision_package_decisions",
    select: "id,workspace_id,project_id,bundle_sha256",
    expectedMemberReadable: true,
    build: ({ workspaceBId, projectBId, evidenceBundleBId, decisionSubmissionBId, decisionDecisionBId, userCId }) => ({
      id: decisionDecisionBId,
      workspace_id: workspaceBId,
      project_id: projectBId,
      submission_id: decisionSubmissionBId,
      bundle_id: evidenceBundleBId,
      bundle_sha256: RLS_BUNDLE_CHECKSUM,
      decision: "approved",
      decided_by: userCId,
    }),
  },
  {
    // Safety crash ingest — must be inserted before safety_crashes (FK).
    table: "safety_crash_ingests",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, safetyCrashIngestBId }) => ({
      id: safetyCrashIngestBId,
      workspace_id: workspaceBId,
      min_lon: -121.3,
      min_lat: 39.1,
      max_lon: -120.0,
      max_lat: 39.6,
      source_id: "ccrs-ca",
      source_label: "California Crash Reporting System (CCRS)",
      attribution: "California Highway Patrol, CCRS (public domain).",
      coverage_state: "ccrs_ca_statewide",
      status: "ready",
    }),
  },
  {
    table: "workspace_reminder_preferences",
    select: "workspace_id,advance_days,email_digest_enabled",
    expectedMemberReadable: true,
    build: ({ workspaceBId }) => ({
      workspace_id: workspaceBId,
      advance_days: 14,
      email_digest_enabled: false,
    }),
  },
  {
    table: "safety_crashes",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, safetyCrashIngestBId, safetyCrashBId, suffix }) => ({
      id: safetyCrashBId,
      workspace_id: workspaceBId,
      ingest_id: safetyCrashIngestBId,
      source_id: "ccrs-ca",
      external_id: `rls-crash-${suffix}`,
      severity: "injury",
      latitude: 39.2,
      longitude: -121.0,
    }),
  },
  {
    // Service-authored road evidence still carries agency and project scope.
    // The database trigger guards the pairing; this fixture proves the SELECT
    // policy also refuses the frozen road line to every other tenant.
    table: "safety_road_context_features",
    select: "id,workspace_id,project_id,road_name",
    expectedMemberReadable: true,
    build: ({ workspaceBId, projectBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      project_id: projectBId,
      country_code: "US",
      source_id: "us-census-tiger-line-cache",
      source_label: "U.S. Census TIGER/Line roads",
      source_vintage: "2025",
      source_feature_id: `rls-road-${suffix}`,
      road_name: `RLS road ${suffix}`,
      geometry_geojson: {
        type: "LineString",
        coordinates: [[-121.1, 39.2], [-121.0, 39.3]],
      },
    }),
  },
  {
    /*
      THE PEOPLE IN THE CRASHES — the most person-level rows in the schema, and
      unprobed from the day they shipped (2026-08-12) until this was written.

      A row here is one human being involved in one collision: their role, their
      age band, and what happened to them. It is not identified by name, but a
      tenant who could read another agency's parties would learn the age and
      outcome of every person hurt on that agency's roads. `safety_crashes` has
      been probed since it existed; its child table was added three days later
      and nothing followed it here.

      Must be inserted after safety_crashes (FK on crash_id), which is why it
      sits directly below it — INSERT_ORDER follows this array's order.
    */
    table: "safety_crash_parties",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, safetyCrashIngestBId, safetyCrashBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      crash_id: safetyCrashBId,
      ingest_id: safetyCrashIngestBId,
      source_id: "ccrs-ca",
      external_party_id: `rls-party-${suffix}`,
      party_role: "pedestrian",
      age_band: "65_plus",
      person_injury: "suspected_serious",
    }),
  },
  {
    table: "modeling_source_manifests",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, countyRunBId, sourceManifestBId, suffix }) => ({
      id: sourceManifestBId,
      workspace_id: workspaceBId,
      county_run_id: countyRunBId,
      source_key: `rls_source_${suffix}`,
      source_kind: "census_tiger",
      source_label: "RLS source",
      citation_text: "RLS isolation fixture",
    }),
  },
  {
    table: "modeling_validation_results",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, countyRunBId, sourceManifestBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      county_run_id: countyRunBId,
      source_manifest_id: sourceManifestBId,
      track: "assignment",
      metric_key: `rls_metric_${suffix}`,
      metric_label: "RLS metric",
      threshold_comparator: "manual",
      status: "pass",
      detail: "RLS isolation fixture",
    }),
  },
  {
    table: "modeling_claim_decisions",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, countyRunBId }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      county_run_id: countyRunBId,
      track: "assignment",
      claim_status: "screening_grade",
      status_reason: "RLS isolation fixture",
    }),
  },
  {
    table: "network_packages",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      name: `RLS network package ${suffix}`,
    }),
  },
  {
    table: "plans",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, projectBId, planBId, suffix }) => ({
      id: planBId,
      workspace_id: workspaceBId,
      project_id: projectBId,
      title: `RLS plan ${suffix}`,
      plan_type: "corridor",
    }),
  },
  {
    table: "programs",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      title: `RLS program ${suffix}`,
      program_type: "rtip",
      cycle_name: `RLS cycle ${suffix}`,
    }),
  },
  {
    table: "project_corridors",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, projectBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      project_id: projectBId,
      name: `RLS corridor ${suffix}`,
      geometry_geojson: {
        type: "LineString",
        coordinates: [
          [-121.05, 39.22],
          [-121.03, 39.24],
        ],
      },
    }),
  },
  {
    table: "projects",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, projectBId, suffix }) => ({
      id: projectBId,
      workspace_id: workspaceBId,
      name: `RLS project ${suffix}`,
    }),
  },
  {
    table: "project_funding_profiles",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, projectBId }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      project_id: projectBId,
    }),
  },
  {
    table: "project_rtp_cycle_links",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, projectBId, rtpCycleBId }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      project_id: projectBId,
      rtp_cycle_id: rtpCycleBId,
    }),
  },
  {
    table: "reports",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, projectBId, reportBId, suffix }) => ({
      id: reportBId,
      workspace_id: workspaceBId,
      project_id: projectBId,
      title: `RLS report ${suffix}`,
      report_type: "project_status",
    }),
  },
  {
    // The financial element. These three carry what a plan says it can afford,
    // so they are PROBED rather than excused: a cross-workspace read here would
    // leak one agency's unadopted revenue assumptions to another.
    table: "rtp_horizon_bands",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, rtpCycleBId, rtpHorizonBandBId, suffix }) => ({
      id: rtpHorizonBandBId,
      workspace_id: workspaceBId,
      rtp_cycle_id: rtpCycleBId,
      label: `RLS band ${suffix}`,
      start_year: 2026,
      end_year: 2035,
    }),
  },
  {
    table: "rtp_financial_assumptions",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    // Seeded after rtp_horizon_bands — INSERT_ORDER follows this array, and the
    // band is a NOT NULL ON DELETE RESTRICT parent.
    build: ({ workspaceBId, rtpCycleBId, rtpHorizonBandBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      rtp_cycle_id: rtpCycleBId,
      horizon_band_id: rtpHorizonBandBId,
      entry_kind: "revenue",
      source_name: `RLS revenue ${suffix}`,
      amount: 1000000,
    }),
  },
  {
    table: "rtp_performance_measures",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, rtpCycleBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      rtp_cycle_id: rtpCycleBId,
      measure_key: `rls_measure_${suffix}`,
      label: `RLS measure ${suffix}`,
    }),
  },
  {
    table: "rtp_cycles",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, rtpCycleBId, suffix }) => ({
      id: rtpCycleBId,
      workspace_id: workspaceBId,
      title: `RLS RTP cycle ${suffix}`,
    }),
  },
  {
    table: "rtp_cycle_chapters",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, rtpCycleBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      rtp_cycle_id: rtpCycleBId,
      chapter_key: `rls_chapter_${suffix}`,
      title: `RLS chapter ${suffix}`,
    }),
  },
  {
    table: "runs",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      title: `RLS run ${suffix}`,
      query_text: "RLS isolation probe",
    }),
  },
  {
    table: "scenario_sets",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, projectBId, scenarioSetBId, suffix }) => ({
      id: scenarioSetBId,
      workspace_id: workspaceBId,
      project_id: projectBId,
      title: `RLS scenario ${suffix}`,
    }),
  },
  {
    table: "scenario_comparison_model_run_links",
    select: "id,workspace_id,model_run_id,artifact_sha256",
    expectedMemberReadable: true,
    build: ({ workspaceBId, modelRunBId, userBId }) => ({
      id: randomUUID(), workspace_id: workspaceBId, model_run_id: modelRunBId,
      artifact_sha256: "d".repeat(64), created_by: userBId,
    }),
    seedSql: ({ workspaceBId, scenarioSetBId, modelRunBId, userBId, suffix }) => `
      SET session_replication_role = replica;
      WITH baseline AS (
        INSERT INTO public.scenario_entries (id, scenario_set_id, slug, label, entry_type, sort_order)
        VALUES (gen_random_uuid(), '${scenarioSetBId}', 'rls-baseline-${suffix}', 'RLS baseline', 'baseline', 0)
        RETURNING id
      ), candidate AS (
        INSERT INTO public.scenario_entries (id, scenario_set_id, slug, label, entry_type, sort_order)
        VALUES (gen_random_uuid(), '${scenarioSetBId}', 'rls-build-${suffix}', 'RLS build', 'alternative', 1)
        RETURNING id
      ), snapshot AS (
        INSERT INTO public.scenario_comparison_snapshots
          (id, scenario_set_id, baseline_entry_id, candidate_entry_id, label, status, created_by)
        SELECT gen_random_uuid(), '${scenarioSetBId}', baseline.id, candidate.id, 'RLS comparison', 'ready', '${userBId}'
        FROM baseline, candidate
        RETURNING id
      )
      INSERT INTO public.scenario_comparison_model_run_links
        (workspace_id, comparison_snapshot_id, model_run_id, method, scenario_role,
         artifact_type, artifact_sha256, created_by)
      SELECT '${workspaceBId}', snapshot.id, '${modelRunBId}', 'aequilibrae', 'baseline',
             'link_volumes', repeat('d', 64), '${userBId}'
      FROM snapshot;
      SET session_replication_role = origin;
    `,
  },
  {
    table: "stage_gate_decisions",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, userBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      gate_id: `rls_gate_${suffix}`,
      decision: "PASS",
      rationale: "RLS isolation fixture",
      decided_by: userBId,
    }),
  },
  {
    table: "subscriptions",
    select: "workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId }) => ({
      workspace_id: workspaceBId,
      plan: "pilot",
      status: "pilot",
    }),
  },
  {
    table: "usage_events",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      event_key: `rls_usage_${suffix}`,
      weight: 1,
    }),
  },
  {
    table: "workspace_invitations",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      email: `rls-invite-${suffix}@example.test`,
      email_normalized: `rls-invite-${suffix}@example.test`,
      role: "member",
      status: "pending",
      token_hash: `rls-token-hash-${suffix}`,
      token_prefix: `rls-${suffix}`.slice(0, 12),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    }),
  },
  {
    table: "workspace_members",
    select: "workspace_id,user_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, userBId }) => ({
      workspace_id: workspaceBId,
      user_id: userBId,
      role: "member",
    }),
  },
  /* ---------------------------------------------------------------------- */
  /* JOIN-SCOPED TABLES — added 2026-08-07, the harness's former blind spot.  */
  /* ---------------------------------------------------------------------- */
  /**
   * THE RESIDENT COMMENT. If one row in this schema must never cross a tenant
   * boundary, it is this one: what a member of the public wrote, and depending
   * on the campaign their name, email, coordinates and demographic answers.
   *
   * It has no `workspace_id`. Its policy reaches through `campaign_id` into
   * `engagement_campaigns`, which is exactly the shape this suite could not
   * probe and its census could not see — so the most sensitive table in the
   * product was, until today, the one with the least evidence behind it.
   */
  {
    table: "engagement_items",
    select: "id,campaign_id",
    expectedMemberReadable: true,
    scope: { column: "campaign_id", value: (context) => context.engagementCampaignBId },
    build: ({ engagementCampaignBId, suffix }) => ({
      id: randomUUID(),
      campaign_id: engagementCampaignBId,
      body: `RLS resident comment ${suffix}`,
    }),
  },
  {
    table: "engagement_survey_questions",
    select: "id,campaign_id",
    expectedMemberReadable: true,
    scope: { column: "campaign_id", value: (context) => context.engagementCampaignBId },
    build: ({ engagementCampaignBId, engagementQuestionBId, suffix }) => ({
      id: engagementQuestionBId,
      campaign_id: engagementCampaignBId,
      question_type: "free_text",
      prompt: `RLS survey question ${suffix}`,
    }),
  },
  {
    table: "engagement_survey_question_options",
    select: "id,campaign_id",
    expectedMemberReadable: true,
    scope: { column: "campaign_id", value: (context) => context.engagementCampaignBId },
    build: ({ engagementCampaignBId, engagementQuestionBId, suffix }) => ({
      id: randomUUID(),
      campaign_id: engagementCampaignBId,
      question_id: engagementQuestionBId,
      label: `RLS option ${suffix}`,
    }),
  },
  /** The KPI rows a CEQA §15064.3 determination is derived from. */
  {
    table: "model_run_kpis",
    select: "id,run_id",
    expectedMemberReadable: true,
    scope: { column: "run_id", value: (context) => context.modelRunBId },
    build: ({ modelRunBId, suffix }) => ({
      id: randomUUID(),
      run_id: modelRunBId,
      kpi_name: "resident_vmt_per_capita",
      kpi_label: `RLS KPI ${suffix}`,
      value: 21.4,
    }),
  },
  {
    table: "report_sections",
    select: "id,report_id",
    expectedMemberReadable: true,
    scope: { column: "report_id", value: (context) => context.reportBId },
    build: ({ reportBId, suffix }) => ({
      id: randomUUID(),
      report_id: reportBId,
      section_key: `rls_section_${suffix}`,
      title: `RLS section ${suffix}`,
    }),
  },
  {
    table: "report_artifacts",
    select: "id,report_id",
    expectedMemberReadable: true,
    scope: { column: "report_id", value: (context) => context.reportBId },
    build: ({ workspaceBId, reportBId, reportArtifactBId }) => ({
      id: reportArtifactBId,
      report_id: reportBId,
      artifact_kind: "pdf",
      storage_path: `${workspaceBId}/${reportBId}/${reportArtifactBId}.pdf`,
      metadata_json: { checksumSha256: "f".repeat(64) },
    }),
  },
  {
    table: "project_milestones",
    select: "id,project_id",
    expectedMemberReadable: true,
    scope: { column: "project_id", value: (context) => context.projectBId },
    build: ({ projectBId, suffix }) => ({
      id: randomUUID(),
      project_id: projectBId,
      title: `RLS milestone ${suffix}`,
    }),
  },
  {
    table: "project_decisions",
    select: "id,project_id",
    expectedMemberReadable: true,
    scope: { column: "project_id", value: (context) => context.projectBId },
    build: ({ projectBId, suffix }) => ({
      id: randomUUID(),
      project_id: projectBId,
      title: `RLS decision ${suffix}`,
      rationale: `RLS rationale ${suffix}`,
    }),
  },
  {
    /**
     * The one table here whose read policy is about a PERSON and not only about
     * a workspace: `recipient_user_id = auth.uid() AND <member>`
     * (20260811000007). The fixture is addressed to tenant B's user, so the
     * standard four probes ask exactly the right questions — anon and tenant A
     * see nothing, and the recipient sees their own reminder.
     *
     * What this probe canNOT see, stated so nobody assumes otherwise: it does
     * not prove that a tenant-B member who is NOT the recipient is refused,
     * because the harness only has one member per tenant. That half is asserted
     * against the policy text; a second member per tenant is the change that
     * would prove it live.
     */
    table: "work_notifications",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, userBId, projectBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      recipient_user_id: userBId,
      kind: "deliverable_due",
      subject_table: "project_deliverables",
      subject_id: randomUUID(),
      project_id: projectBId,
      due_on: "2099-12-31",
      title: `RLS reminder ${suffix}`,
      body: `RLS reminder body ${suffix}`,
    }),
  },
  /*
    ─────────────────────────────────────────────────────────────────────────
    THE AGENCY'S OWN MAP LAYERS (20260812000015–18), four tables that shipped
    on 2026-08-12 and went unprobed until this was written.

    These hold whatever a planning department uploaded: parcel fabrics, right
    of way, sewer mains, draft alignments nobody outside the agency should see
    yet. The layer row names it, the version row records where the bytes are
    and what coordinate system was claimed, the features are the shapes, and a
    reference records what adopted the layer.

    They are LAST in this array on purpose. INSERT_ORDER follows array order,
    and the chain is layer → version → features/references. The layer's
    `current_version_id` is nullable, which is what breaks the circular
    reference between the first two.
    ─────────────────────────────────────────────────────────────────────────
  */
  {
    table: "workspace_gis_layers",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, gisLayerBId, userBId, suffix }) => ({
      id: gisLayerBId,
      workspace_id: workspaceBId,
      name: `RLS layer ${suffix}`,
      created_by: userBId,
    }),
  },
  {
    table: "workspace_gis_layer_versions",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, gisLayerBId, gisLayerVersionBId, userBId, suffix }) => ({
      id: gisLayerVersionBId,
      workspace_id: workspaceBId,
      layer_id: gisLayerBId,
      version_number: 1,
      source_format: "geojson",
      source_filename: `rls-${suffix}.geojson`,
      source_byte_size: 128,
      // RFC 7946 says a GeoJSON with no CRS member IS WGS84 — evidence from the
      // file, not an assertion, so this fixture must NOT carry an author. The
      // table's claim-tier CHECK enforces that pairing in both directions.
      srs_name: "WGS 84",
      srs_basis: "geojson_rfc7946_default",
      declared_feature_count: 1,
      feature_count: 0,
      source_feature_count: 1,
      ingest_status: "receiving",
      created_by: userBId,
    }),
  },
  {
    table: "workspace_gis_features",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    // Seeded with SQL because PostgREST cannot write a PostGIS geometry — see
    // `seedSql` on the probe type. `build` still describes the row so the read
    // side of the harness is unchanged.
    build: ({ workspaceBId, gisLayerBId, gisLayerVersionBId }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      layer_id: gisLayerBId,
      version_id: gisLayerVersionBId,
      feature_index: 0,
      properties: {},
    }),
    seedSql: ({ workspaceBId, gisLayerBId, gisLayerVersionBId }) =>
      `INSERT INTO public.workspace_gis_features
         (version_id, layer_id, workspace_id, feature_index, geom, properties)
       VALUES ('${gisLayerVersionBId}', '${gisLayerBId}', '${workspaceBId}', 0,
               ST_SetSRID(ST_MakePoint(-121.0, 39.2), 4326), '{}'::jsonb)`,
  },
  {
    table: "workspace_gis_layer_references",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, gisLayerBId, projectBId, userBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      layer_id: gisLayerBId,
      reference_kind: "project",
      reference_id: projectBId,
      reference_label: `RLS project ${suffix}`,
      created_by: userBId,
    }),
  },
  {
    table: "land_use_plans",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, landUsePlanBId, userBId, suffix }) => ({
      id: landUsePlanBId,
      workspace_id: workspaceBId,
      title: `RLS land use plan ${suffix}`,
      descriptor_id: "us-ca-general-plan",
      plan_kind_key: "comprehensive",
      authority_label: `RLS authority ${suffix}`,
      geography_label: `RLS geography ${suffix}`,
      created_by: userBId,
    }),
  },
  {
    table: "land_use_plan_versions",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, landUsePlanBId, landUsePlanVersionBId, userBId }) => ({
      id: landUsePlanVersionBId,
      workspace_id: workspaceBId,
      plan_id: landUsePlanBId,
      version_number: 1,
      version_kind: "original",
      state: "working",
      applicable_requirement_keys: ["land_use"],
      created_by: userBId,
    }),
  },
  {
    table: "land_use_plan_content_nodes",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, landUsePlanVersionBId, landUsePlanNodeBId, userBId }) => ({
      id: landUsePlanNodeBId,
      workspace_id: workspaceBId,
      version_id: landUsePlanVersionBId,
      node_kind: "policy",
      title: "RLS policy",
      body: "RLS policy body",
      created_by: userBId,
    }),
  },
  {
    table: "land_use_plan_relationships",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, landUsePlanBId, landUsePlanVersionBId, userBId }) => ({
      id: randomUUID(), workspace_id: workspaceBId, plan_id: landUsePlanBId,
      version_id: landUsePlanVersionBId, related_plan_label: "RLS related plan",
      relationship_kind: "overlapping", created_by: userBId,
    }),
  },
  {
    table: "land_use_plan_review_events",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, landUsePlanVersionBId, userBId }) => ({
      id: randomUUID(), workspace_id: workspaceBId, version_id: landUsePlanVersionBId,
      event_kind: "hearing", occurred_on: "2099-12-31", created_by: userBId,
    }),
  },
  {
    table: "land_use_plan_designations",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, landUsePlanVersionBId, landUsePlanDesignationBId, gisLayerBId, gisLayerVersionBId, userBId }) => ({
      id: landUsePlanDesignationBId, workspace_id: workspaceBId, version_id: landUsePlanVersionBId,
      layer_id: gisLayerBId, layer_version_id: gisLayerVersionBId,
      designation_set_label: "RLS designations", created_by: userBId,
    }),
    seedSql: ({ workspaceBId, landUsePlanVersionBId, landUsePlanDesignationBId, gisLayerBId, gisLayerVersionBId, userBId }) =>
      `UPDATE public.workspace_gis_layer_versions
         SET feature_count = 1, ingest_status = 'ready', finalized_at = '2099-12-31T00:00:00Z'
       WHERE id = '${gisLayerVersionBId}';
       INSERT INTO public.land_use_plan_designations
         (id, workspace_id, version_id, layer_id, layer_version_id, designation_set_label, created_by)
       VALUES ('${landUsePlanDesignationBId}', '${workspaceBId}', '${landUsePlanVersionBId}',
         '${gisLayerBId}', '${gisLayerVersionBId}', 'RLS designations', '${userBId}')`,
  },
  {
    table: "land_use_plan_designation_policy_links",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, landUsePlanVersionBId, landUsePlanDesignationBId, landUsePlanNodeBId, userBId }) => ({
      id: randomUUID(), workspace_id: workspaceBId, version_id: landUsePlanVersionBId,
      designation_id: landUsePlanDesignationBId, policy_node_id: landUsePlanNodeBId, created_by: userBId,
    }),
  },
  {
    table: "land_use_plan_implementation_actions",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, landUsePlanVersionBId, landUsePlanNodeBId, userBId }) => ({
      id: randomUUID(), workspace_id: workspaceBId, version_id: landUsePlanVersionBId,
      content_node_id: landUsePlanNodeBId, title: "RLS implementation action",
      status: "not_started", created_by: userBId,
    }),
  },
  {
    table: "land_use_plan_process_records",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, landUsePlanBId, landUsePlanVersionBId, userBId }) => ({
      id: randomUUID(), workspace_id: workspaceBId, plan_id: landUsePlanBId,
      version_id: landUsePlanVersionBId, descriptor_id: "us-ca-general-plan",
      process_key: "hearing", status: "in_progress", due_on: "2099-12-30",
      created_by: userBId,
    }),
  },
  {
    table: "land_use_plan_review_releases",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, landUsePlanBId, landUsePlanVersionBId, landUsePlanReleaseBId, userBId }) => ({
      id: landUsePlanReleaseBId, workspace_id: workspaceBId, plan_id: landUsePlanBId,
      version_id: landUsePlanVersionBId, version_content_hash: "a".repeat(64), round_number: 1,
      review_method: "external_process", review_open_on: "2099-01-01", review_close_on: "2099-12-01",
      status: "open", created_by: userBId,
    }),
    seedSql: ({ workspaceBId, landUsePlanBId, landUsePlanVersionBId, landUsePlanReleaseBId, kbDocumentBId, userBId }) =>
      `UPDATE public.land_use_plan_versions
         SET state = 'public_review', content_hash = '${"a".repeat(64)}', frozen_snapshot = '{}'::jsonb,
             frozen_at = '2099-12-31T00:00:00Z', frozen_by = '${userBId}'
       WHERE id = '${landUsePlanVersionBId}';
       INSERT INTO public.land_use_plan_review_releases
         (id, workspace_id, plan_id, version_id, version_content_hash, round_number,
          review_method, review_open_on, review_close_on, external_review_document_id, status, created_by)
       VALUES ('${landUsePlanReleaseBId}', '${workspaceBId}', '${landUsePlanBId}', '${landUsePlanVersionBId}',
          '${"a".repeat(64)}', 1, 'external_process', '2099-01-01', '2099-12-01',
          '${kbDocumentBId}', 'open', '${userBId}')`,
  },
  {
    table: "land_use_plan_decisions",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, landUsePlanBId, landUsePlanVersionBId, kbDocumentBId, userBId }) => ({
      id: randomUUID(), workspace_id: workspaceBId, plan_id: landUsePlanBId,
      version_id: landUsePlanVersionBId, version_content_hash: "a".repeat(64),
      decision_kind: "adoption", decision_body: "RLS body", instrument_type: "RLS instrument",
      instrument_identifier: "RLS-1", decided_on: "2099-12-31",
      supporting_document_id: kbDocumentBId, created_by: userBId,
    }),
    seedSql: ({ workspaceBId, landUsePlanBId, landUsePlanVersionBId, landUsePlanReleaseBId, kbDocumentBId, userBId }) =>
      `UPDATE public.land_use_plan_review_releases
         SET status = 'closed', outcome_snapshot = '{"method":"external_process","dispositionSummary":"RLS complete"}'::jsonb,
             closed_at = '2099-12-31T00:00:00Z', closed_by = '${userBId}'
       WHERE id = '${landUsePlanReleaseBId}';
       INSERT INTO public.land_use_plan_decisions
         (id, workspace_id, plan_id, version_id, version_content_hash, review_release_id, adoption_manifest, decision_kind,
          decision_body, instrument_type, instrument_identifier, decided_on,
          supporting_document_id, created_by)
       VALUES (gen_random_uuid(), '${workspaceBId}', '${landUsePlanBId}', '${landUsePlanVersionBId}',
          '${"a".repeat(64)}', '${landUsePlanReleaseBId}',
          jsonb_build_object('planId','${landUsePlanBId}','versionId','${landUsePlanVersionBId}',
            'versionContentHash','${"a".repeat(64)}','reviewReleaseId','${landUsePlanReleaseBId}',
            'reviewOutcomeHash',(SELECT outcome_hash FROM public.land_use_plan_review_releases WHERE id='${landUsePlanReleaseBId}')),
          'adoption', 'RLS body', 'RLS instrument', 'RLS-1',
          '2099-12-31', '${kbDocumentBId}', '${userBId}')`,
  },
  {
    table: "land_use_plan_implementation_reports",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, landUsePlanBId, landUsePlanVersionBId, reportBId, userBId }) => ({
      id: randomUUID(), workspace_id: workspaceBId, plan_id: landUsePlanBId,
      adopted_version_id: landUsePlanVersionBId, reporting_period_start: "2099-01-01",
      reporting_period_end: "2099-12-31", action_status_snapshot: [],
      content_hash: "b".repeat(64), report_id: reportBId, generated_by: userBId,
    }),
  },
  {
    table: "land_use_plan_consultation_records",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, landUsePlanBId, landUsePlanVersionBId, userBId }) => ({
      id: randomUUID(), workspace_id: workspaceBId, plan_id: landUsePlanBId,
      version_id: landUsePlanVersionBId, status: "in_progress",
      confidential_notes: "RLS private consultation note", contains_sensitive_locations: true,
      created_by: userBId,
    }),
  },
];

const INSERT_ORDER = [
  "projects",
  "rtp_cycles",
  "county_runs",
  "aerial_missions",
  "models",
  "model_runs",
  "modeling_source_manifests",
  ...WORKSPACE_RLS_PROBES.map((probe) => probe.table).filter(
    (table, index, source) =>
      ![
        "projects",
        "rtp_cycles",
        "county_runs",
        "aerial_missions",
        "models",
        "model_runs",
        "modeling_source_manifests",
        "workspace_members",
        "project_evidence_bundles",
        "project_decision_package_submissions",
        "project_decision_package_decisions",
      ].includes(table) && source.indexOf(table) === index
  ),
  "project_evidence_bundles",
  "project_decision_package_submissions",
  "project_decision_package_decisions",
] as const;

const liveDescribe = LIVE_RLS ? describe : describe.skip;

const client = (url: string, key: string) => liveClient(url, key, "openplan-rls");

function probeByTable(table: string): WorkspaceRlsProbe {
  const probe = WORKSPACE_RLS_PROBES.find((item) => item.table === table);
  if (!probe) throw new Error(`Missing RLS probe for ${table}`);
  return probe;
}

async function mustInsert(service: SupabaseClient, table: string, row: ProbeRow) {
  const { error } = await service.from(table).insert(row);
  if (error) {
    throw new Error(`Failed to insert ${table} RLS fixture: ${error.message}`);
  }
}

async function readWorkspaceRows(
  supabase: SupabaseClient,
  table: string,
  workspaceId: string,
  context?: SeedContext
): Promise<ReadResult> {
  const probe = probeByTable(table);
  // A join-scoped table is read through the column that carries its parent.
  // Filtering on `workspace_id` here would error rather than return nothing,
  // and an errored read is not a denial — it would make every such probe
  // "pass" for the wrong reason.
  const scoped =
    probe.scope && context
      ? supabase.from(table).select(probe.select).eq(probe.scope.column, probe.scope.value(context))
      : supabase.from(table).select(probe.select).eq("workspace_id", workspaceId);
  const { data, error } = await scoped;

  return {
    table,
    rows: data ?? [],
    error: error?.message ?? null,
  };
}

describe("workspace RLS isolation inventory", () => {
  it("covers every direct workspace-scoped table in the paid-access audit set", () => {
    const tables = WORKSPACE_RLS_PROBES.map((probe) => probe.table).sort();

    expect(tables).toHaveLength(85);
    expect(new Set(tables).size).toBe(tables.length);
    expect(tables).toEqual([
      "aerial_evidence_packages",
      "aerial_missions",
      "analyses",
      "assistant_action_executions",
      "billing_events",
      "billing_invoice_records",
      "billing_webhook_receipts",
      "county_run_artifacts",
      "county_runs",
      "data_connectors",
      "data_datasets",
      "data_refresh_jobs",
      "engagement_campaigns",
      "engagement_items",
      "engagement_survey_question_options",
      "engagement_survey_questions",
      "funding_awards",
      "funding_opportunities",
      "gtfs_feed_versions",
      "gtfs_feeds",
      "gtfs_route_service_levels",
      "gtfs_stop_service_levels",
      "gtfs_tract_service",
      "kb_document_chunks",
      "kb_documents",
      "land_use_plan_consultation_records",
      "land_use_plan_content_nodes",
      "land_use_plan_decisions",
      "land_use_plan_designation_policy_links",
      "land_use_plan_designations",
      "land_use_plan_implementation_actions",
      "land_use_plan_implementation_reports",
      "land_use_plan_process_records",
      "land_use_plan_relationships",
      "land_use_plan_review_events",
      "land_use_plan_review_releases",
      "land_use_plan_versions",
      "land_use_plans",
      "model_run_kpis",
      "model_runs",
      "modeling_claim_decisions",
      "modeling_source_manifests",
      "modeling_validation_results",
      "models",
      "network_packages",
      "plans",
      "programs",
      "project_corridors",
      "project_decision_package_decisions",
      "project_decision_package_submissions",
      "project_decisions",
      "project_evidence_bundles",
      "project_funding_profiles",
      "project_milestones",
      "project_portfolio_import_batches",
      "project_portfolio_import_rows",
      "project_rtp_cycle_links",
      "projects",
      "report_artifacts",
      "report_sections",
      "reports",
      "rtp_cycle_chapters",
      "rtp_cycles",
      "rtp_financial_assumptions",
      "rtp_horizon_bands",
      "rtp_performance_measures",
      "runs",
      "safety_crash_ingests",
      "safety_crash_parties",
      "safety_crashes",
      "safety_road_context_features",
      "scenario_comparison_model_run_links",
      "scenario_sets",
      "stage_gate_decisions",
      "subscriptions",
      "title_vi_policies",
      "usage_events",
      "work_notifications",
      "workspace_gis_features",
      "workspace_gis_layer_references",
      "workspace_gis_layer_versions",
      "workspace_gis_layers",
      "workspace_invitations",
      "workspace_members",
      "workspace_reminder_preferences",
    ]);
    expect([...SERVICE_ONLY_TABLES]).toEqual(["billing_webhook_receipts"]);
    expect([...DEDICATED_LIVE_RLS_PROBES]).toEqual([
      "modeling_validation_assessments",
      "modeling_validation_structural_diagnoses",
    ]);
  });
});

/**
 * THE PROBE LIST MUST COVER THE SCHEMA — added 2026-08-04 (Fable review).
 *
 * The inventory test above asserts the 42-name list agrees with ITSELF, which
 * is how a new workspace-scoped table ships un-probed: nothing connected the
 * list to the schema. Measured the day this was written, the live schema
 * carried 65 tables with a `workspace_id` column and the probe list 42.
 *
 * The rule, checked against the LIVE catalog: every table carrying
 * `workspace_id` must be one of —
 *
 *   1. PROBED — on `WORKSPACE_RLS_PROBES`, so the cross-tenant read tests
 *      exercise it;
 *   2. PROVABLY DENY-ALL — row security enabled with ZERO policies, which no
 *      client role can read through regardless of grants (the
 *      `workspace_integration_keys` posture, and the strongest of the three);
 *   3. EXCUSED BY NAME below, with the reason it is not yet probed.
 *
 * The excused list is a RATCHET: it may only shrink, and an entry that stops
 * being true (table dropped, or added to the probes) must be removed. Every
 * table on it has RLS enabled and tenant-scoped policies written by the same
 * migrations that scoped the probed tables — what is missing is the live
 * cross-tenant PROOF, not the boundary. Moving one off this list means writing
 * its fixture `build()` in WORKSPACE_RLS_PROBES.
 */

/**
 * Tables scoped to a workspace THROUGH A JOIN that have no live cross-tenant
 * probe yet.
 *
 * MEASURED 2026-08-07: 44 tables are scoped this way and none had a probe,
 * because the harness could not read them (it filtered on `workspace_id`
 * unconditionally) and this census could not see them. Eight were probed the
 * same day, chosen by what a leak would cost: the resident comments and the
 * survey definition they hang off, the KPI rows a CEQA determination is derived
 * from, the report sections and artifacts an agency publishes, and two project
 * spine tables.
 *
 * The rest are listed here so the number is visible and can only shrink. Every
 * one of them HAS a policy and HAS row security — what is missing is the live
 * proof that the policy refuses somebody, which is the only thing that catches a
 * join written against the wrong parent. Moving one off this list means adding a
 * probe with a `scope`.
 */
const JOIN_SCOPED_EXCUSED: ReadonlyArray<string> = [
  "agencies",
  "calendar",
  "calendar_dates",
  "client_invoice_line_items",
  "data_dataset_project_links",
  "engagement_categories",
  "engagement_closeloop_entries",
  "invoicing_rate_entries",
  "model_links",
  "model_run_artifacts",
  "model_run_stages",
  "network_connectors",
  "network_corridors",
  "network_package_versions",
  "network_zones",
  "plan_links",
  "program_links",
  "project_deliverables",
  "project_issues",
  "project_meetings",
  "project_risks",
  "project_spend_entries",
  "project_submittals",
  "report_runs",
  "routes",
  "scenario_assumption_sets",
  "scenario_comparison_indicator_deltas",
  "scenario_comparison_snapshots",
  "scenario_data_packages",
  "scenario_entries",
  "scenario_indicator_snapshots",
  "shapes",
  "stop_times",
  "stops",
  "trips",
  // The workspace row itself: every other probe's setup depends on its
  // isolation, so a probe here would be testing the harness.
  "workspaces",
];

/**
 * How many tables may stand on an excuse instead of a live probe.
 *
 * Shrink-only. 37 on 2026-08-22, when the growth half of the ratchet was added
 * — until then an excuse entry with any text made the census green, so the
 * list could grow forever and the census would keep reporting that everything
 * was accounted for.
 */
const EXCUSED_TABLE_CEILING = 37;

const PROBE_EXCUSED_TABLES: ReadonlyArray<string> = [
  /*
    FOUND 2026-08-11, AND REPORTED RATHER THAN QUIETLY PATCHED. The first run of
    this census since 0.11.0 and 0.12.0 shipped listed three tables nobody had
    accounted for: the drone lane's flight plans and imagery, and the engagement
    lane's campaign-to-project links. All three have row security ON with
    workspace-scoped policies (checked in the catalog the same day) — what is
    missing is the live cross-tenant PROOF, which is what this list is for. They
    are excused here so the census runs green and can catch the NEXT one; each
    still wants a probe.
  */
  "aerial_flight_plans",
  "aerial_imagery",
  "engagement_campaign_projects",
  "aerial_artifact_custody",
  "aerial_processing_jobs",
  "aerial_project_posture",
  "client_invoices",
  "document_narrative_drafts",
  "engagement_content_translations",
  "engagement_context_layers",
  "engagement_notifications",
  "funding_opportunity_application_exports",
  "funding_opportunity_application_sections",
  "funding_opportunity_attachments",
  "funding_opportunity_narrative_drafts",
  "funding_opportunity_section_drafts",
  "invoicing_clients",
  "invoicing_engagements",
  "invoicing_rate_tables",
  "invoicing_staff",
  "invoicing_time_entries",
  // (2026-08-11) The OCR job ledger for scanned documents. Member SELECT only,
  // no client write policy anywhere, and its callback sibling
  // `kb_ocr_job_callbacks` needs no entry at all — row security on with zero
  // policies is rule 2 above, the strongest posture available. The job row
  // carries no document text (the migration says why: the text lands in
  // `kb_document_chunks`, and a second copy of every scanned plan is a
  // duplicate, not a record), so what a cross-tenant leak would expose here is
  // the fact that another agency OCR'd something. Excused rather than probed
  // because a fixture would have to stand up a document and a worker job for
  // that; the posture itself is asserted from the catalog by
  // `kb-ocr-migration.test.ts`.
  "kb_ocr_jobs",
  "project_bca_screenings",
  // (2026-08-11) THE TRANSCRIPTION STAGING TABLES, and the excuse is a pointer
  // rather than a gap: `rtp-extraction-rls.test.ts` probes both of them live,
  // against a real database, for the cross-tenant read this census asks about
  // ("shows a member nothing of another agency's extraction") AND for the
  // question this harness has no shape for — whether the workspace OWNER, the
  // highest role there is, can INSERT, UPDATE or DELETE a row in a table only
  // the service role may write. That second question is the load-bearing one
  // for these two tables: a client-inserted candidate is a quote nothing
  // verified, sitting in the review queue one click from an RTP write route and
  // from a citation on a public plan page. Adding a probe here would mean
  // widening this harness for a case a sibling file already proves; deleting
  // these lines without deleting that file is what would be wrong.
  "rtp_extraction_candidates",
  "rtp_extraction_runs",
  "vmt_significance_screenings",
  /*
    (2026-08-12) THE SELF-HELP LOCAL MEASURE FUND — six tables, excused with the
    honest reason: the boundary is written and the live cross-tenant PROOF is
    still owed. (PARTLY PAID 2026-08-22 — `measure-fund-rls.test.ts` proves the
    composite-key half for `measure_fund_periods`; the read half for the rest is
    still owed.) Every one has row security on, a workspace-membership SELECT
    policy, and role-aware write policies through `workspace_member_can_write`
    (asserted statically from the migration corpus by
    `local-measure-fund-migration.test.ts`).

    What raises the stake above the usual excuse, recorded so whoever writes
    these probes knows what to aim at: these rows denormalize `workspace_id` and
    reach their parent through a COMPOSITE foreign key into
    `(id, workspace_id)`. That constraint is what stops a child from being
    parented across tenants, and a static guard can only prove the constraint
    was written — not that Postgres refuses the insert. A probe here should try
    the cross-tenant parenting directly, not merely the cross-tenant read.
  */
  "measure_funds",
  "measure_fund_periods",
  "measure_allocation_rules",
  "measure_recipients",
  "measure_recipient_basis_values",
  "measure_allocations",
  /*
    (2026-08-12) CLAIMS AGAINST THE MEASURE FUND — three more, excused with the
    same honest reason and one addition worth aiming a probe at.

    `measure_claims` carries a row-level rule the others do not: its DELETE
    policy is `workspace_member_can_write(workspace_id) AND status = 'draft'`,
    so a submitted or paid claim must be undeletable BY ANYONE, including a
    workspace owner. A static guard can prove that predicate was written; only
    a live probe can prove Postgres enforces it.

    WRITTEN 2026-08-22: `measure-fund-rls.test.ts` deletes a submitted claim as
    the workspace OWNER and requires zero rows affected, with a draft claim
    beside it as the control — without that control the suite would pass just as
    happily against a database where deleting a claim is broken for everyone.
    Mutation-proven by relaxing the policy to drop its `status = 'draft'` half
    against the live database.
  */
  "measure_claims",
  "measure_claim_documents",
  "measure_moe_records",
  /*
    (2026-08-12) WHAT THE FUND TOOK OFF THE TOP — excused with the same honest
    reason, and with the sharpest probe target in the group.

    These rows are the ONLY record of money an agency removed from a
    voter-approved fund before the ordinance's own purposes were cut, and the
    fiscal-year cap in `buildMeasureCapWindow` is evaluated by summing them. A
    tenant that could read another's rows would learn what a neighbouring
    agency takes for administration; a tenant that could WRITE them could
    inflate another fund's year-to-date total and stop that agency taking money
    it is entitled to, or delete rows and let it take the cap twice.

    WRITTEN 2026-08-22: `measure-fund-rls.test.ts` now attempts exactly that,
    live — an off-the-top row parented into another workspace's period while
    carrying the caller's own workspace_id past the INSERT policy, and the plain
    cross-tenant write beside it. Mutation-proven by dropping
    `measure_period_off_the_top_period_fk` against the live database. This entry
    stays because the census's `probed` set is `WORKSPACE_RLS_PROBES` and the
    proof lives in a sibling file, the same arrangement as the extraction
    staging tables above — a pointer now, not an IOU.
  */
  "measure_period_off_the_top",
  /*
    (2026-08-12) WHAT THE FUND KEPT BACK IN RESERVE — excused with the same
    honest reason, and with a probe target of its own.

    These rows are the only record of money a voter-approved fund kept rather
    than dividing, and both public surfaces SUBTRACT them from what came in. A
    tenant that could write another fund's reserve rows could therefore change
    what a neighbouring agency's oversight page says its own purposes were
    given, without touching a single allocation — and the page would close its
    arithmetic on the forged figure, because closing it is exactly what the
    reserve line is for.

    A probe here should attempt the cross-tenant INSERT specifically. The
    composite `(period_id, workspace_id)` foreign key is what stops a row being
    parented across tenants, and nothing but a live attempt shows Postgres
    enforcing it.
  */
  "measure_period_reserve",
];

liveDescribe("the probe list covers the schema", () => {
  it("every workspace_id table is probed, provably deny-all, or excused by name", () => {
    const container = resolveLocalDbContainer();
    const rows = queryCatalog(
      container,
      "SELECT c.relname || '|' || c.relrowsecurity || '|' || count(p.polname) " +
        "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' " +
        "LEFT JOIN pg_policy p ON p.polrelid = c.oid " +
        "WHERE c.relkind = 'r' AND EXISTS (" +
        "  SELECT 1 FROM information_schema.columns col " +
        "  WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'workspace_id') " +
        "GROUP BY c.relname, c.relrowsecurity ORDER BY 1"
    ).map((line) => {
      const [table, rls, policies] = line.split("|");
      // `boolean || text` casts through text, so relrowsecurity arrives as
      // "true"/"false" here — not the "t"/"f" psql shows for a bare column.
      return { table, rlsEnabled: rls === "true", policyCount: Number(policies) };
    });

    expect(rows.length, "the catalog query found no workspace-scoped tables at all").toBeGreaterThan(40);

    const probed = new Set([
      ...WORKSPACE_RLS_PROBES.map((probe) => probe.table),
      ...DEDICATED_LIVE_RLS_PROBES,
    ]);
    const excused = new Set(PROBE_EXCUSED_TABLES);

    const uncovered = rows.filter(
      ({ table, rlsEnabled, policyCount }) =>
        !probed.has(table) && !excused.has(table) && !(rlsEnabled && policyCount === 0)
    );
    expect(
      uncovered.map(({ table }) => table),
      "these workspace-scoped tables are neither probed by this suite, nor provably deny-all, nor excused — add a fixture to WORKSPACE_RLS_PROBES, or excuse them by name with the reason"
    ).toEqual([]);

    // The ratchet's staleness half: an excuse that is no longer needed is a
    // number that has quietly stopped being true.
    const byName = new Map(rows.map((row) => [row.table, row]));
    const stale = PROBE_EXCUSED_TABLES.filter((table) => {
      const row = byName.get(table);
      if (!row) return true; // table no longer exists
      if (probed.has(table)) return true; // now probed — excuse is dead weight
      return row.rlsEnabled && row.policyCount === 0; // now deny-all — covered by rule 2
    });
    expect(stale, "these excused tables no longer need an excuse — remove them from PROBE_EXCUSED_TABLES").toEqual([]);

    // ------------------------------------------------------------------
    // THE RATCHET'S OTHER HALF: the list may not GROW.
    // ------------------------------------------------------------------
    //
    // Staleness above catches an excuse that stopped being needed. Nothing
    // caught an excuse being ADDED — and an entry with any text at all made the
    // census green, so "add a fixture, or excuse it by name" was in practice a
    // choice between work and a sentence. That is the compliant twin of the
    // pattern this census exists to end: prose promising a probe somebody has
    // yet to write, standing where the proof should be.
    //
    // The stake is not uniform. `measure_period_off_the_top` and
    // `measure_period_reserve` are excused here, and a composite-FK typo or a
    // policy joined to the wrong parent would let one tenant write another
    // fund's rows — forging the year-to-date total that a fiscal-year cap and a
    // public oversight page are computed from.
    //
    // A CEILING, NOT AN EQUALITY, so removing an excuse never requires editing
    // this number; and it may be LOWERED freely. Raising it means a new
    // capability shipped without its cross-tenant proof, which is a decision
    // that should cost a commit message.
    expect(new Set(PROBE_EXCUSED_TABLES).size, "PROBE_EXCUSED_TABLES has a duplicate").toBe(
      PROBE_EXCUSED_TABLES.length
    );
    expect(
      PROBE_EXCUSED_TABLES.length,
      `${PROBE_EXCUSED_TABLES.length} tables are excused from the live cross-tenant proof, above the ` +
        `ceiling of ${EXCUSED_TABLE_CEILING}. Write the probe rather than raising this — and if the ` +
        "excuse is genuinely right, lower the ceiling in the same commit that raises it."
    ).toBeLessThanOrEqual(EXCUSED_TABLE_CEILING);

    // ------------------------------------------------------------------
    // THE SECOND CATEGORY, and the reason this census used to miss it.
    // ------------------------------------------------------------------
    //
    // Everything above enumerates tables with a `workspace_id` COLUMN. Most of
    // this schema is not scoped that way — a report section belongs to a report,
    // a resident comment belongs to a campaign — so their policies reach through
    // a join and they have no such column. The query above cannot see them AT
    // ALL: not as probed, not as unprobed, not as excused. 44 tables sat in that
    // silence on 2026-08-07, `engagement_items` among them, which holds the
    // names, emails, coordinates and demographics members of the public typed in.
    //
    // A policy that reaches through a join is the shape most likely to be
    // written wrongly and least likely to be noticed, because the wrongness is
    // one table away from the row it exposes. This half makes them countable.
    const joinScoped = queryCatalog(
      container,
      "SELECT DISTINCT p.tablename FROM pg_policies p WHERE p.schemaname = 'public' " +
        "AND (p.qual LIKE '%workspace%' OR p.with_check LIKE '%workspace%') " +
        "AND NOT EXISTS (SELECT 1 FROM information_schema.columns col " +
        "  WHERE col.table_schema = 'public' AND col.table_name = p.tablename " +
        "  AND col.column_name = 'workspace_id') ORDER BY 1"
    );

    expect(joinScoped.length, "the join-scope query found nothing — it broke").toBeGreaterThan(30);

    const unprobedJoinScoped = joinScoped.filter(
      (table) => !probed.has(table) && !JOIN_SCOPED_EXCUSED.includes(table)
    );
    expect(
      unprobedJoinScoped,
      "these tables are scoped to a workspace THROUGH A JOIN and nothing has ever asked their policy " +
        "to refuse another tenant. Add a probe with a `scope` to WORKSPACE_RLS_PROBES, or excuse it by name."
    ).toEqual([]);

    // Staleness, same rule as above: an excuse for a table that is now probed,
    // or that no longer carries a join-scoped policy, is a number that has
    // quietly stopped being true.
    const joinScopedSet = new Set(joinScoped);
    const staleJoinExcuses = JOIN_SCOPED_EXCUSED.filter(
      (table) => !joinScopedSet.has(table) || probed.has(table)
    );
    expect(
      staleJoinExcuses,
      "these join-scoped excuses are no longer needed — remove them from JOIN_SCOPED_EXCUSED"
    ).toEqual([]);

    // And no excused table may lose row security while sitting on the list.
    const excusedWithoutRls = PROBE_EXCUSED_TABLES.filter((table) => byName.get(table) && !byName.get(table)?.rlsEnabled);
    expect(excusedWithoutRls, "an excused table has RLS DISABLED — that is the unarmed-policy defect, fix it now").toEqual([]);
  });
});

liveDescribe("workspace RLS live isolation", () => {
  let env: LocalSupabaseEnv;
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let userA: SupabaseClient;
  let userB: SupabaseClient;
  let context: SeedContext;
  let safetyEquityTractGeoid = "";
  let bundleObjectCreated = false;

  const password = "OpenPlanRls!2026";

  beforeAll(async () => {
    env = getLocalSupabaseEnv();
    service = client(env.API_URL, env.SERVICE_ROLE_KEY);
    anon = client(env.API_URL, env.ANON_KEY);
    userA = client(env.API_URL, env.ANON_KEY);
    userB = client(env.API_URL, env.ANON_KEY);

    const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    const emailA = `rls-a-${suffix}@example.test`;
    const emailB = `rls-b-${suffix}@example.test`;
    const emailC = `rls-c-${suffix}@example.test`;
    const createdA = await service.auth.admin.createUser({ email: emailA, password, email_confirm: true });
    const createdB = await service.auth.admin.createUser({ email: emailB, password, email_confirm: true });
    const createdC = await service.auth.admin.createUser({ email: emailC, password, email_confirm: true });

    if (createdA.error || !createdA.data.user) {
      throw new Error(`Failed to create RLS user A: ${createdA.error?.message ?? "missing user"}`);
    }
    if (createdB.error || !createdB.data.user) {
      throw new Error(`Failed to create RLS user B: ${createdB.error?.message ?? "missing user"}`);
    }
    if (createdC.error || !createdC.data.user) {
      throw new Error(`Failed to create RLS user C: ${createdC.error?.message ?? "missing user"}`);
    }

    const signInA = await userA.auth.signInWithPassword({ email: emailA, password });
    const signInB = await userB.auth.signInWithPassword({ email: emailB, password });

    if (signInA.error) throw new Error(`Failed to sign in RLS user A: ${signInA.error.message}`);
    if (signInB.error) throw new Error(`Failed to sign in RLS user B: ${signInB.error.message}`);

    context = {
      suffix,
      workspaceAId: randomUUID(),
      workspaceBId: randomUUID(),
      userAId: createdA.data.user.id,
      userBId: createdB.data.user.id,
      userCId: createdC.data.user.id,
      projectBId: randomUUID(),
      projectBRevision: "",
      planBId: randomUUID(),
      reportArtifactBId: randomUUID(),
      evidenceBundleBId: randomUUID(),
      decisionSubmissionBId: randomUUID(),
      decisionDecisionBId: randomUUID(),
      scenarioSetBId: randomUUID(),
      rtpCycleBId: randomUUID(),
      rtpHorizonBandBId: randomUUID(),
      countyRunBId: randomUUID(),
      aerialMissionBId: randomUUID(),
      gtfsFeedBId: randomUUID(),
      gtfsFeedVersionBId: randomUUID(),
      kbDocumentBId: randomUUID(),
      portfolioImportBatchBId: randomUUID(),
      safetyCrashIngestBId: randomUUID(),
      safetyCrashBId: randomUUID(),
      gisLayerBId: randomUUID(),
      gisLayerVersionBId: randomUUID(),
      dataConnectorBId: randomUUID(),
      dataDatasetBId: randomUUID(),
      modelBId: randomUUID(),
      modelRunBId: randomUUID(),
      sourceManifestBId: randomUUID(),
      reportBId: randomUUID(),
      engagementCampaignBId: randomUUID(),
      engagementQuestionBId: randomUUID(),
      landUsePlanBId: randomUUID(),
      landUsePlanVersionBId: randomUUID(),
      landUsePlanNodeBId: randomUUID(),
      landUsePlanDesignationBId: randomUUID(),
      landUsePlanReleaseBId: randomUUID(),
    };

    await mustInsert(service, "workspaces", {
      id: context.workspaceAId,
      name: `RLS tenant A ${suffix}`,
      slug: `rls-a-${suffix}`,
      plan: "pilot",
    });
    await mustInsert(service, "workspaces", {
      id: context.workspaceBId,
      name: `RLS tenant B ${suffix}`,
      slug: `rls-b-${suffix}`,
      plan: "pilot",
    });
    await mustInsert(service, "workspace_members", {
      workspace_id: context.workspaceAId,
      user_id: context.userAId,
      role: "owner",
    });
    await mustInsert(service, "workspace_members", probeByTable("workspace_members").build(context));
    await mustInsert(service, "workspace_members", {
      workspace_id: context.workspaceBId,
      user_id: context.userCId,
      role: "admin",
    });

    for (const table of INSERT_ORDER) {
      if (table === "project_evidence_bundles") {
        const revisionRead = await service
          .from("projects")
          .select("updated_at")
          .eq("id", context.projectBId)
          .single();
        if (revisionRead.error || !revisionRead.data?.updated_at) {
          throw new Error(`Failed to read the RLS project revision: ${revisionRead.error?.message ?? "missing revision"}`);
        }
        context.projectBRevision = revisionRead.data.updated_at as string;
        const objectPath = `${context.workspaceBId}/${context.projectBId}/${context.evidenceBundleBId}.zip`;
        const objectUpload = await service.storage
          .from("project-evidence-bundles")
          .upload(objectPath, Buffer.from("x"), { contentType: "application/zip", upsert: false });
        if (objectUpload.error) throw new Error(`Failed to upload the RLS bundle fixture: ${objectUpload.error.message}`);
        bundleObjectCreated = true;
      }
      const probe = probeByTable(table);
      if (probe.seedSql) {
        executeSql(resolveLocalDbContainer(), probe.seedSql(context));
        continue;
      }
      await mustInsert(service, table, probe.build(context));
    }
  }, 60_000);

  afterAll(async () => {
    if (!service || !context) return;

    await userA?.auth.signOut();
    await userB?.auth.signOut();

    if (bundleObjectCreated) {
      const objectPath = `${context.workspaceBId}/${context.projectBId}/${context.evidenceBundleBId}.zip`;
      const removedObject = await service.storage.from("project-evidence-bundles").remove([objectPath]);
      if (removedObject.error) throw new Error(`Failed to remove the RLS bundle fixture: ${removedObject.error.message}`);
    }

    await service.from("workspaces").delete().in("id", [context.workspaceAId, context.workspaceBId]);
    if (safetyEquityTractGeoid) {
      await service.from("census_tracts").delete().eq("geoid", safetyEquityTractGeoid);
    }
    // Delete each user's trigger-provisioned personal workspaces by
    // MEMBERSHIP, then the user, CHECKED — a discarded deleteUser result
    // strands a live auth account carrying this suite's fixed password in
    // whatever database the suite pointed at, which is exactly how eleven
    // stranded users accumulated before 2026-08-03. This was the third
    // teardown site; the other two were hardened first and this one kept the
    // old shape (2026-08-03 review). The slug-LIKE cleanup it used matched
    // nothing at all: fixture slugs are `rls-a-<suffix>` with no trailing
    // segment, so `rls-%-<suffix>-%` was a dead pattern.
    for (const userId of [context.userAId, context.userBId, context.userCId]) {
      const { data: memberships } = await service
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", userId);
      for (const row of (memberships ?? []) as { workspace_id: string }[]) {
        await service.from("workspaces").delete().eq("id", row.workspace_id);
      }
      const removed = await service.auth.admin.deleteUser(userId);
      if (removed.error) {
        throw new Error(`RLS isolation teardown left user ${userId} behind: ${removed.error.message}`);
      }
    }
    // The 60s timeout matches beforeAll: this hook makes 10+ live round
    // trips, and vitest's 10s default kills it BEFORE deleteUser on a slow
    // stack — noisy in the run, invisible in the database.
  }, 60_000);

  it("seeds one fixture row per audited workspace table for tenant B", async () => {
    const results = await Promise.all(
      WORKSPACE_RLS_PROBES.map((probe) => readWorkspaceRows(service, probe.table, context.workspaceBId, context))
    );

    expect(results.filter((result) => result.error)).toEqual([]);
    for (const result of results) {
      expect(result.rows.length, `${result.table} service fixture count`).toBeGreaterThan(0);
    }
  });

  it("does not expose tenant B rows to anon clients", async () => {
    const results = await Promise.all(
      WORKSPACE_RLS_PROBES.map((probe) => readWorkspaceRows(anon, probe.table, context.workspaceBId, context))
    );

    for (const result of results) {
      expect(result.rows, `${result.table} anon rows`).toEqual([]);
    }
  });

  it("does not expose tenant B rows to an authenticated tenant A member", async () => {
    const results = await Promise.all(
      WORKSPACE_RLS_PROBES.map((probe) => readWorkspaceRows(userA, probe.table, context.workspaceBId, context))
    );

    for (const result of results) {
      expect(result.rows, `${result.table} tenant A rows`).toEqual([]);
    }
  });

  it("keeps tenant B rows readable to tenant B members except service-only ledgers", async () => {
    const results = await Promise.all(
      WORKSPACE_RLS_PROBES.map((probe) => readWorkspaceRows(userB, probe.table, context.workspaceBId, context))
    );

    for (const result of results) {
      const probe = probeByTable(result.table);
      if (probe.expectedMemberReadable) {
        expect(result.error, `${result.table} member read error`).toBeNull();
        expect(result.rows.length, `${result.table} tenant B rows`).toBeGreaterThan(0);
      } else {
        expect(result.rows, `${result.table} tenant B service-only rows`).toEqual([]);
      }
    }
  });

  it("keeps deployment-global modeling worker heartbeats service-role-only", async () => {
    const instanceId = `rls-${context.suffix}`;
    const seeded = await service.from("modeling_worker_heartbeats").insert({
      worker_kind: "aequilibrae",
      instance_id: instanceId,
      supported_stages: ["AequilibraE Setup", "Network Assignment", "Artifact Extraction"],
      runtime_mode: "poll",
      worker_version: "rls-probe",
      started_at: new Date().toISOString(),
      last_successful_heartbeat_at: new Date().toISOString(),
    });
    expect(seeded.error).toBeNull();

    for (const candidate of [anon, userA, userB]) {
      const { data } = await candidate
        .from("modeling_worker_heartbeats")
        .select("instance_id")
        .eq("instance_id", instanceId);
      expect(data ?? []).toEqual([]);
    }
    const { data: serviceRows } = await service
      .from("modeling_worker_heartbeats")
      .select("instance_id")
      .eq("instance_id", instanceId);
    expect(serviceRows?.map((row) => row.instance_id)).toEqual([instanceId]);
    await service.from("modeling_worker_heartbeats").delete().eq("instance_id", instanceId);
  });

  it("keeps severe-crash concentration rankings inside the caller's workspace", async () => {
    await mustInsert(service, "safety_crashes", {
      id: randomUUID(),
      workspace_id: context.workspaceBId,
      ingest_id: context.safetyCrashIngestBId,
      source_id: "ccrs-ca",
      external_id: `rls-ksi-${context.suffix}`,
      severity: "fatal",
      latitude: 39.2004,
      longitude: -121.0004,
    });
    await service
      .from("safety_crashes")
      .update({ severity: "severe_injury" })
      .eq("id", context.safetyCrashBId);

    const args = {
      p_workspace_id: context.workspaceBId,
      p_min_lon: -121.3,
      p_min_lat: 39.1,
      p_max_lon: -120.0,
      p_max_lat: 39.6,
      p_project_id: null,
      p_severities: ["fatal", "severe_injury"],
      p_radius_meters: 150,
      p_min_points: 2,
      p_result_limit: 10,
    };

    const foreign = await userA.rpc("safety_ksi_concentrations", args);
    expect(foreign.error, "tenant A concentration RPC error").toBeNull();
    expect(foreign.data, "tenant A concentration rows").toEqual([]);

    const own = await userB.rpc("safety_ksi_concentrations", args);
    expect(own.error, "tenant B concentration RPC error").toBeNull();
    expect(own.data).toEqual([
      expect.objectContaining({ rank: 1, crash_count: 2, fatal_crash_count: 1, serious_injury_crash_count: 1 }),
    ]);

    const anonymous = await anon.rpc("safety_ksi_concentrations", args);
    expect(anonymous.error?.message ?? "").toMatch(/permission denied|function/i);
    expect(anonymous.data).toBeNull();

    safetyEquityTractGeoid = `99${context.suffix}`;
    executeSql(
      resolveLocalDbContainer(),
      `INSERT INTO public.census_tracts (` +
        `geoid, state_fips, county_fips, name, geometry, pop_total, pop_white, households, ` +
        `households_zero_vehicle, pop_below_poverty` +
      `) VALUES (` +
        `'${safetyEquityTractGeoid}', '99', '999', 'RLS safety equity tract', ` +
        `ST_Multi(ST_GeomFromText('POLYGON((-121.01 39.19,-120.99 39.19,-120.99 39.21,-121.01 39.21,-121.01 39.19))', 4326)), ` +
        `1000, 600, 400, 40, 200` +
      `);`
    );
    const equityArgs = {
      p_workspace_id: context.workspaceBId,
      p_min_lon: -121.3,
      p_min_lat: 39.1,
      p_max_lon: -120.0,
      p_max_lat: 39.6,
      p_project_id: null,
      p_severities: ["fatal", "severe_injury"],
      p_result_limit: 10,
    };
    const foreignEquity = await userA.rpc("safety_ksi_tract_burden", equityArgs);
    expect(foreignEquity.error, "tenant A equity RPC error").toBeNull();
    expect(foreignEquity.data, "tenant A equity rows").toEqual([]);

    const ownEquity = await userB.rpc("safety_ksi_tract_burden", equityArgs);
    expect(ownEquity.error, "tenant B equity RPC error").toBeNull();
    expect(ownEquity.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ geoid: safetyEquityTractGeoid, ksi_crash_count: 2 }),
    ]));

    const anonymousEquity = await anon.rpc("safety_ksi_tract_burden", equityArgs);
    expect(anonymousEquity.error?.message ?? "").toMatch(/permission denied|function/i);
    expect(anonymousEquity.data).toBeNull();
  });

  it("rejects cross-workspace project inserts even when created_by is the caller", async () => {
    const { error } = await userA.from("projects").insert({
      id: randomUUID(),
      workspace_id: context.workspaceBId,
      name: `RLS cross-tenant probe ${context.suffix}`,
      created_by: context.userAId,
    });

    expect(error?.message ?? "", "cross-workspace project insert error").toMatch(
      /row-level security|permission denied|violates/i
    );
  });

  it("isolates planning-level project cost writes", async () => {
    const recordedAt = new Date().toISOString();
    const foreign = await userA
      .from("projects")
      .update({
        estimated_cost_amount: 123456,
        estimated_cost_currency: "USD",
        estimated_cost_recorded_by: context.userAId,
        estimated_cost_recorded_at: recordedAt,
      })
      .eq("id", context.projectBId)
      .select("id");
    expect(foreign.error, "tenant A cost update error").toBeNull();
    expect(foreign.data, "tenant A cost update rows").toEqual([]);

    const own = await userB
      .from("projects")
      .update({
        estimated_cost_amount: 123456,
        estimated_cost_currency: "USD",
        estimated_cost_recorded_by: context.userBId,
        estimated_cost_recorded_at: recordedAt,
      })
      .eq("id", context.projectBId)
      .select("id,estimated_cost_amount,estimated_cost_currency")
      .single();
    expect(own.error, "tenant B cost update error").toBeNull();
    expect(Number(own.data?.estimated_cost_amount)).toBe(123456);
    expect(own.data?.estimated_cost_currency).toBe("USD");
  });

  /**
   * A CROSS-TENANT DENIAL OF SERVICE, removed in 20260805000006.
   *
   * `gtfs_feeds` carried `UNIQUE (city, agency_name)` from 20260219000001 with
   * no `workspace_id` in it, so it was GLOBAL across every tenant sharing a
   * database. The first workspace to register ('Sacramento', 'SacRT') would
   * have permanently prevented every other workspace from registering the same
   * agency — which is the NORMAL case for an MPO and its member cities reading
   * one regional feed. It never fired because nothing in `src/` writes the
   * table yet; it fires on the first day ingest ships.
   *
   * This belongs with the tenant-isolation probes rather than with the GTFS
   * schema tests because it is the same question asked from the other side:
   * not "can tenant A READ tenant B's row" but "can tenant A STOP tenant B
   * from having one". Driven through the two signed-in clients, not the
   * service role, because the service role bypasses RLS and would not have
   * exercised the write path a planner uses.
   */
  it("lets two workspaces register the same city and agency name (no cross-tenant lockout)", async () => {
    const city = `RlsSharedCity${context.suffix}`;
    const agencyName = `RLS shared agency ${context.suffix}`;
    const feedAId = randomUUID();
    const feedBId = randomUUID();

    const firstToRegister = await userA.from("gtfs_feeds").insert({
      id: feedAId,
      workspace_id: context.workspaceAId,
      city,
      state: "ZZ",
      agency_name: agencyName,
    });
    const secondToRegister = await userB.from("gtfs_feeds").insert({
      id: feedBId,
      workspace_id: context.workspaceBId,
      city,
      state: "ZZ",
      agency_name: agencyName,
    });

    // Read back through the service role BEFORE asserting, then clean up
    // unconditionally — the run where this guard correctly FAILS is the run
    // that has just left rows behind under a name a later run will reuse.
    const { data: landed } = await service
      .from("gtfs_feeds")
      .select("id, workspace_id")
      .eq("agency_name", agencyName);
    const workspaces = ((landed ?? []) as { workspace_id: string }[])
      .map((row) => row.workspace_id)
      .sort();

    await service.from("gtfs_feeds").delete().in("id", [feedAId, feedBId]);

    expect(firstToRegister.error, "first workspace registering the agency").toBeNull();
    expect(
      secondToRegister.error?.message ?? null,
      "a second workspace registering the SAME agency — a unique constraint here is a cross-tenant lockout"
    ).toBeNull();
    expect(workspaces, "both workspaces must own a feed for the same agency").toEqual(
      [context.workspaceAId, context.workspaceBId].sort()
    );
  });

  it("does not let anon clients enumerate shared engagement campaigns", async () => {
    const sharedCampaignId = randomUUID();
    const seeded = await service.from("engagement_campaigns").insert({
      id: sharedCampaignId,
      workspace_id: context.workspaceBId,
      title: `RLS shared campaign ${context.suffix}`,
      status: "active",
      engagement_type: "comment_collection",
      share_token: `rls_probe_${context.suffix}_token`,
      allow_public_submissions: true,
      created_by: context.userBId,
    });
    expect(seeded.error, "shared campaign seed error").toBeNull();

    const { data: enumerated } = await anon
      .from("engagement_campaigns")
      .select("id, share_token")
      .not("share_token", "is", null);

    expect(enumerated ?? [], "anon-enumerable shared campaigns").toEqual([]);

    await service.from("engagement_campaigns").delete().eq("id", sharedCampaignId);
  });

  it("keeps assistant action executions readable but service-authored only", async () => {
    const readable = await readWorkspaceRows(userB, "assistant_action_executions", context.workspaceBId);
    expect(readable.error, "assistant_action_executions member read error").toBeNull();
    expect(readable.rows.length, "assistant_action_executions tenant B rows").toBeGreaterThan(0);

    const attemptedClientInsert = probeByTable("assistant_action_executions").build({
      ...context,
      suffix: `${context.suffix}_client_insert`,
    });
    attemptedClientInsert.id = randomUUID();

    const { error } = await userB.from("assistant_action_executions").insert(attemptedClientInsert);

    expect(error?.message ?? "", "assistant_action_executions client insert error").toMatch(
      /row-level security|permission denied|violates/i
    );
  });
});

/**
 * LIVE — the hardening of 2026-08-03, asserted where it can regress.
 *
 * The block above enumerates workspace-scoped tables BY NAME, which is exactly
 * why the defects below survived: reference tables and service-role ledgers were
 * never on the list, so nothing here ever looked at them. These probes are the
 * three verdicts that live curl proved once and that must keep holding.
 *
 * Each asserts a DENIAL that is distinguishable from an accident. "Zero rows" is
 * not evidence — a broken query, an empty table and a working boundary all
 * return zero rows. So the reads assert `permission denied` where the grant was
 * revoked, and every write probe READS THE ROW BACK to confirm the write did not
 * land, because PostgREST answers 204 for a zero-row DELETE exactly as it does
 * for a successful one.
 */
liveDescribe("hardening of 2026-08-03 stays in force", () => {
  let env: LocalSupabaseEnv;
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let member: SupabaseClient;
  let suffix: string;
  let userId: string;
  let workspaceId: string;
  let feedId: string;

  const password = "OpenPlanHardening!2026";

  /**
   * Tables written only by the service role, whose `anon` and `authenticated`
   * grants 20260730000008 removed. They have RLS on and ZERO policies, so both
   * roles were already denied every row — the revoke removes the grant that was
   * the only thing left between a future permissive policy and full exposure.
   */
  const GRANT_REVOKED_TABLES = [
    "assistant_action_approvals",
    "engagement_item_votes",
    "aerial_processing_callbacks",
    "billing_webhook_receipts",
  ];

  /** Public reference data: reads stay open, writes were revoked (20260730000009). */
  const REFERENCE_TABLES = ["census_tracts", "lodes_od"];

  const GTFS_CHILD_TABLES = [
    "agencies",
    "routes",
    "stops",
    "trips",
    "stop_times",
    "shapes",
    "calendar",
    "calendar_dates",
  ];

  beforeAll(async () => {
    env = getLocalSupabaseEnv();
    service = client(env.API_URL, env.SERVICE_ROLE_KEY);
    anon = client(env.API_URL, env.ANON_KEY);
    member = client(env.API_URL, env.ANON_KEY);

    suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    const email = `rls-harden-${suffix}@example.test`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) {
      throw new Error(`Failed to create hardening probe user: ${created.error?.message ?? "missing user"}`);
    }
    userId = created.data.user.id;

    const signIn = await member.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`Failed to sign in hardening probe user: ${signIn.error.message}`);

    workspaceId = randomUUID();
    await mustInsert(service, "workspaces", {
      id: workspaceId,
      name: `RLS hardening ${suffix}`,
      slug: `rls-harden-${suffix}`,
      plan: "pilot",
    });
    await mustInsert(service, "workspace_members", {
      workspace_id: workspaceId,
      user_id: userId,
      role: "owner",
    });

    // A transit feed owned by this workspace, with one row in each child table.
    // The child rows are what an anonymous caller must not be able to reach.
    feedId = randomUUID();
    await mustInsert(service, "gtfs_feeds", {
      id: feedId,
      workspace_id: workspaceId,
      agency_name: `RLS hardening agency ${suffix}`,
      city: `RlsHardenCity${suffix}`,
      state: "ZZ",
      status: "loaded",
    });

    const childRows: Record<string, ProbeRow> = {
      agencies: { feed_id: feedId, agency_id: `${suffix}-ag`, name: `RLS hardening agency ${suffix}` },
      routes: { feed_id: feedId, route_id: `${suffix}-rt`, short_name: `${suffix}-RT`, type: 3 },
      stops: {
        feed_id: feedId,
        stop_id: `${suffix}-st`,
        name: `RLS hardening stop ${suffix}`,
        geometry: "SRID=4326;POINT(-121.1 39.1)",
      },
      trips: { feed_id: feedId, trip_id: `${suffix}-tp`, route_id: `${suffix}-rt`, service_id: `${suffix}-sv` },
      stop_times: { feed_id: feedId, trip_id: `${suffix}-tp`, stop_id: `${suffix}-st`, stop_sequence: 1 },
      shapes: {
        feed_id: feedId,
        shape_id: `${suffix}-sh`,
        geometry: "SRID=4326;LINESTRING(-121.1 39.1,-121 39.2)",
      },
      calendar: {
        feed_id: feedId,
        service_id: `${suffix}-sv`,
        monday: true,
        tuesday: true,
        wednesday: true,
        thursday: true,
        friday: true,
        saturday: false,
        sunday: false,
        start_date: "2026-01-01",
        end_date: "2026-12-31",
      },
      calendar_dates: { feed_id: feedId, service_id: `${suffix}-sv`, date: "2026-07-04", exception_type: 2 },
    };

    for (const table of GTFS_CHILD_TABLES) {
      await mustInsert(service, table, childRows[table]);
    }
  }, 60_000);

  afterAll(async () => {
    if (!service) return;
    await member?.auth.signOut();
    if (feedId) await service.from("gtfs_feeds").delete().eq("id", feedId);
    if (workspaceId) await service.from("workspaces").delete().eq("id", workspaceId);
    if (userId) {
      // Delete the trigger-provisioned personal workspace by MEMBERSHIP. Matching
      // on a slug pattern happens to work for the `rls-` prefix above and would
      // silently strand rows for any other prefix.
      const { data: memberships } = await service
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", userId);
      for (const row of (memberships ?? []) as { workspace_id: string }[]) {
        await service.from("workspaces").delete().eq("id", row.workspace_id);
      }
      const removed = await service.auth.admin.deleteUser(userId);
      if (removed.error) {
        throw new Error(`Hardening probe left user ${userId} behind: ${removed.error.message}`);
      }
    }
  }, 60_000);

  it("seeds a tenant-owned transit feed, so the denials below are not vacuous", async () => {
    for (const table of GTFS_CHILD_TABLES) {
      const { data } = await service.from(table).select("feed_id").eq("feed_id", feedId);
      expect(data?.length ?? 0, `${table} service fixture count`).toBeGreaterThan(0);
    }
  });

  it("refuses anon and authenticated callers on the service-role-only tables (20260730000008)", async () => {
    for (const table of GRANT_REVOKED_TABLES) {
      const asAnon = await anon.from(table).select("*").limit(1);
      const asMember = await member.from(table).select("*").limit(1);

      // The GRANT is what this asserts, not the policy. Before the revoke both
      // roles got `200 []` — RLS held, but the privilege was still there. The
      // change from empty-success to permission-denied is the whole proof.
      expect(asAnon.error?.message ?? "", `${table} anon read`).toMatch(/permission denied/i);
      expect(asMember.error?.message ?? "", `${table} authenticated read`).toMatch(/permission denied/i);
    }
  });

  it("keeps public reference data readable while refusing anonymous writes (20260730000009)", async () => {
    for (const table of REFERENCE_TABLES) {
      const read = await anon.from(table).select("*").limit(1);
      // Over-restriction is its own defect: the equity choropleth reads
      // `census_tracts` through a security_invoker view as the calling role.
      expect(read.error, `${table} anon read must keep working`).toBeNull();
    }

    const forgedGeoid = `99${suffix}`.slice(0, 11);
    const insert = await anon.from("census_tracts").insert({
      geoid: forgedGeoid,
      state_fips: "99",
      county_fips: "999",
      name: `RLS hardening forged tract ${suffix}`,
      pop_total: 999999,
      geometry: "SRID=4326;MULTIPOLYGON(((-121 39,-121 39.1,-120.9 39.1,-120.9 39,-121 39)))",
    });

    // Read back as the service role BEFORE asserting anything. An error alone is
    // not proof the row is absent, and a fabricated tract silently added to
    // shared equity data is the failure this guards.
    const { data: landed } = await service.from("census_tracts").select("geoid").eq("geoid", forgedGeoid);

    // Then remove it UNCONDITIONALLY, before the expectations below can throw.
    // Learned the hard way on 2026-08-03: an earlier version cleaned up after
    // the assertion, so the one run where the guard correctly FAILED — during
    // the mutation check that proved it non-vacuous — stranded a forged tract in
    // `census_tracts` and left the shared table at 530 rows. A probe whose
    // cleanup is skipped precisely when it detects the defect is a probe that
    // corrupts the database it is protecting.
    await service.from("census_tracts").delete().eq("geoid", forgedGeoid);

    expect(insert.error?.message ?? "", "anon census_tracts insert").toMatch(/permission denied/i);
    expect(landed ?? [], "forged tract must not exist").toEqual([]);
  });

  it("refuses anonymous updates to real shared reference rows (20260730000009)", async () => {
    const { data: real } = await service
      .from("census_tracts")
      .select("geoid, median_household_income")
      .not("median_household_income", "is", null)
      .limit(1);

    // A fresh database (CI runs `db reset`; there is no seed file) holds no
    // tracts at all, and this probe used to REQUIRE one — so it had never
    // passed in CI: its first nightly, 2026-08-04, failed exactly here while
    // every local run leaned on the dev database's 530 real rows. Seed the
    // subject through the service role instead of skipping: the probe stays
    // meaningful (the anon update below must still bounce off a real, present
    // row) and stays self-contained. The seeded row is removed at the end,
    // and only when it was ours.
    let seededGeoid: string | null = null;
    let target: { geoid: string; median_household_income: number };
    if ((real?.length ?? 0) > 0) {
      target = (real as { geoid: string; median_household_income: number }[])[0];
    } else {
      seededGeoid = `98${suffix}`.slice(0, 11);
      const seeded = await service.from("census_tracts").insert({
        geoid: seededGeoid,
        state_fips: "98",
        county_fips: "998",
        name: `RLS hardening probe tract ${suffix}`,
        pop_total: 1000,
        median_household_income: 54321,
        geometry: "SRID=4326;MULTIPOLYGON(((-120 38,-120 38.1,-119.9 38.1,-119.9 38,-120 38)))",
      });
      expect(seeded.error, "service must be able to seed the probe tract on an empty database").toBeNull();
      target = { geoid: seededGeoid, median_household_income: 54321 };
    }
    await anon.from("census_tracts").update({ median_household_income: 1 }).eq("geoid", target.geoid);

    const { data: after } = await service
      .from("census_tracts")
      .select("median_household_income")
      .eq("geoid", target.geoid)
      .single();

    // Restore from the captured original BEFORE asserting, and unconditionally.
    // This probe attacks a REAL row of shared reference data, so the run where
    // it correctly fails is exactly the run that has just corrupted the equity
    // inputs for every workspace. Repairing only on success would mean the guard
    // does damage in proportion to how well it works.
    await service
      .from("census_tracts")
      .update({ median_household_income: target.median_household_income })
      .eq("geoid", target.geoid);
    // Remove the seeded subject unconditionally and BEFORE asserting, for the
    // same reason the restore above runs before the assertion: cleanup that
    // only happens on success strands rows precisely when the guard works.
    if (seededGeoid) {
      await service.from("census_tracts").delete().eq("geoid", seededGeoid);
    }

    expect(
      (after as { median_household_income: number } | null)?.median_household_income,
      `tract ${target.geoid} median income must be unchanged by an anonymous caller`
    ).toBe(target.median_household_income);
  });

  it("hides a workspace's GTFS child rows from anonymous callers (20260730000010)", async () => {
    for (const table of GTFS_CHILD_TABLES) {
      const { data } = await anon.from(table).select("*").eq("feed_id", feedId);
      expect(data ?? [], `${table} anon rows`).toEqual([]);
    }

    // The control that makes the result meaningful: the PARENT already denied
    // before the fix. Parent denying while children published is what proved the
    // boundary was designed and never switched on.
    const { data: parent } = await anon.from("gtfs_feeds").select("id").eq("id", feedId);
    expect(parent ?? [], "gtfs_feeds parent control").toEqual([]);
  });

  it("still shows a workspace its own GTFS child rows (20260730000010 did not over-restrict)", async () => {
    for (const table of GTFS_CHILD_TABLES) {
      const { data, error } = await member.from(table).select("*").eq("feed_id", feedId);
      expect(error, `${table} owning-member read error`).toBeNull();
      expect(data?.length ?? 0, `${table} owning-member rows`).toBeGreaterThan(0);
    }
  });

  it("refuses anonymous writes to a workspace's GTFS child rows (20260730000010)", async () => {
    const injected = await anon
      .from("agencies")
      .insert({ feed_id: feedId, agency_id: `${suffix}-injected`, name: "anon injected" });
    expect(injected.error?.message ?? "", "anon agencies insert").toMatch(
      /permission denied|row-level security/i
    );

    await anon.from("routes").update({ short_name: "defaced" }).eq("feed_id", feedId);
    await anon.from("stops").delete().eq("feed_id", feedId);

    // Every write probe reads back through the service role. PostgREST returns
    // 204 for a zero-row DELETE and for a successful one alike, so the response
    // status cannot distinguish a denial from a deletion.
    const { data: injectedRows } = await service
      .from("agencies")
      .select("agency_id")
      .eq("agency_id", `${suffix}-injected`);
    expect(injectedRows ?? [], "anon-injected agency must not exist").toEqual([]);

    const { data: routeRows } = await service.from("routes").select("short_name").eq("feed_id", feedId);
    expect(
      (routeRows as { short_name: string }[] | null)?.[0]?.short_name,
      "route short_name must be unchanged"
    ).toBe(`${suffix}-RT`);

    const { data: stopRows } = await service.from("stops").select("stop_id").eq("feed_id", feedId);
    expect(stopRows?.length ?? 0, "stop must survive an anonymous delete").toBeGreaterThan(0);
  });
});
