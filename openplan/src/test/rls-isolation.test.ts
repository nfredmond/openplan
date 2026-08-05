import { randomUUID } from "node:crypto";
import { type SupabaseClient } from "@supabase/supabase-js";
import { LIVE_RLS, getLocalSupabaseEnv, liveClient, type LocalSupabaseEnv } from "./local-supabase-env";
import { resolveLocalDbContainer, queryCatalog } from "./helpers/live-catalog";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type ProbeRow = Record<string, unknown>;

type WorkspaceRlsProbe = {
  table: string;
  select: string;
  expectedMemberReadable: boolean;
  build: (context: SeedContext) => ProbeRow;
};

type SeedContext = {
  suffix: string;
  workspaceAId: string;
  workspaceBId: string;
  userAId: string;
  userBId: string;
  projectBId: string;
  rtpCycleBId: string;
  countyRunBId: string;
  aerialMissionBId: string;
  kbDocumentBId: string;
  safetyCrashIngestBId: string;
  dataConnectorBId: string;
  dataDatasetBId: string;
  modelBId: string;
  modelRunBId: string;
  sourceManifestBId: string;
  reportBId: string;
};

type ReadResult = {
  table: string;
  rows: unknown[];
  error: string | null;
};

const SERVICE_ONLY_TABLES = new Set(["billing_webhook_receipts"]);

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
    build: ({ workspaceBId, suffix }) => ({
      id: randomUUID(),
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
    build: ({ workspaceBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      agency_name: `RLS agency ${suffix}`,
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
    table: "safety_crashes",
    select: "id,workspace_id",
    expectedMemberReadable: true,
    build: ({ workspaceBId, safetyCrashIngestBId, suffix }) => ({
      id: randomUUID(),
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
    build: ({ workspaceBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
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
    build: ({ workspaceBId, projectBId, suffix }) => ({
      id: randomUUID(),
      workspace_id: workspaceBId,
      project_id: projectBId,
      title: `RLS scenario ${suffix}`,
    }),
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
      ].includes(table) && source.indexOf(table) === index
  ),
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
  workspaceId: string
): Promise<ReadResult> {
  const probe = probeByTable(table);
  const { data, error } = await supabase
    .from(table)
    .select(probe.select)
    .eq("workspace_id", workspaceId);

  return {
    table,
    rows: data ?? [],
    error: error?.message ?? null,
  };
}

describe("workspace RLS isolation inventory", () => {
  it("covers every direct workspace-scoped table in the paid-access audit set", () => {
    const tables = WORKSPACE_RLS_PROBES.map((probe) => probe.table).sort();

    expect(tables).toHaveLength(42);
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
      "funding_awards",
      "funding_opportunities",
      "gtfs_feeds",
      "kb_document_chunks",
      "kb_documents",
      "model_runs",
      "modeling_claim_decisions",
      "modeling_source_manifests",
      "modeling_validation_results",
      "models",
      "network_packages",
      "plans",
      "programs",
      "project_corridors",
      "project_funding_profiles",
      "project_rtp_cycle_links",
      "projects",
      "reports",
      "rtp_cycle_chapters",
      "rtp_cycles",
      "runs",
      "safety_crash_ingests",
      "safety_crashes",
      "scenario_sets",
      "stage_gate_decisions",
      "subscriptions",
      "usage_events",
      "workspace_invitations",
      "workspace_members",
    ]);
    expect([...SERVICE_ONLY_TABLES]).toEqual(["billing_webhook_receipts"]);
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
const PROBE_EXCUSED_TABLES: ReadonlyArray<string> = [
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
  "project_bca_screenings",
  "vmt_significance_screenings",
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

    const probed = new Set(WORKSPACE_RLS_PROBES.map((probe) => probe.table));
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
    const createdA = await service.auth.admin.createUser({ email: emailA, password, email_confirm: true });
    const createdB = await service.auth.admin.createUser({ email: emailB, password, email_confirm: true });

    if (createdA.error || !createdA.data.user) {
      throw new Error(`Failed to create RLS user A: ${createdA.error?.message ?? "missing user"}`);
    }
    if (createdB.error || !createdB.data.user) {
      throw new Error(`Failed to create RLS user B: ${createdB.error?.message ?? "missing user"}`);
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
      projectBId: randomUUID(),
      rtpCycleBId: randomUUID(),
      countyRunBId: randomUUID(),
      aerialMissionBId: randomUUID(),
      kbDocumentBId: randomUUID(),
      safetyCrashIngestBId: randomUUID(),
      dataConnectorBId: randomUUID(),
      dataDatasetBId: randomUUID(),
      modelBId: randomUUID(),
      modelRunBId: randomUUID(),
      sourceManifestBId: randomUUID(),
      reportBId: randomUUID(),
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

    for (const table of INSERT_ORDER) {
      await mustInsert(service, table, probeByTable(table).build(context));
    }
  }, 60_000);

  afterAll(async () => {
    if (!service || !context) return;

    await userA?.auth.signOut();
    await userB?.auth.signOut();

    await service.from("workspaces").delete().in("id", [context.workspaceAId, context.workspaceBId]);
    // Delete each user's trigger-provisioned personal workspaces by
    // MEMBERSHIP, then the user, CHECKED — a discarded deleteUser result
    // strands a live auth account carrying this suite's fixed password in
    // whatever database the suite pointed at, which is exactly how eleven
    // stranded users accumulated before 2026-08-03. This was the third
    // teardown site; the other two were hardened first and this one kept the
    // old shape (2026-08-03 review). The slug-LIKE cleanup it used matched
    // nothing at all: fixture slugs are `rls-a-<suffix>` with no trailing
    // segment, so `rls-%-<suffix>-%` was a dead pattern.
    for (const userId of [context.userAId, context.userBId]) {
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
      WORKSPACE_RLS_PROBES.map((probe) => readWorkspaceRows(service, probe.table, context.workspaceBId))
    );

    expect(results.filter((result) => result.error)).toEqual([]);
    for (const result of results) {
      expect(result.rows.length, `${result.table} service fixture count`).toBeGreaterThan(0);
    }
  });

  it("does not expose tenant B rows to anon clients", async () => {
    const results = await Promise.all(
      WORKSPACE_RLS_PROBES.map((probe) => readWorkspaceRows(anon, probe.table, context.workspaceBId))
    );

    for (const result of results) {
      expect(result.rows, `${result.table} anon rows`).toEqual([]);
    }
  });

  it("does not expose tenant B rows to an authenticated tenant A member", async () => {
    const results = await Promise.all(
      WORKSPACE_RLS_PROBES.map((probe) => readWorkspaceRows(userA, probe.table, context.workspaceBId))
    );

    for (const result of results) {
      expect(result.rows, `${result.table} tenant A rows`).toEqual([]);
    }
  });

  it("keeps tenant B rows readable to tenant B members except service-only ledgers", async () => {
    const results = await Promise.all(
      WORKSPACE_RLS_PROBES.map((probe) => readWorkspaceRows(userB, probe.table, context.workspaceBId))
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

    // Skipping silently would make this pass on an empty database, so require it.
    expect(real?.length ?? 0, "a real tract must exist for this probe to mean anything").toBeGreaterThan(0);

    const target = (real as { geoid: string; median_household_income: number }[])[0];
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
