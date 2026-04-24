import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
  dataConnectorBId: string;
  dataDatasetBId: string;
  modelBId: string;
  modelRunBId: string;
  sourceManifestBId: string;
  reportBId: string;
};

type LocalSupabaseEnv = {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
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

const LIVE_RLS = process.env.OPENPLAN_RLS_LIVE_TEST === "1";
const liveDescribe = LIVE_RLS ? describe : describe.skip;

function parseLocalSupabaseEnv(output: string): LocalSupabaseEnv {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
    if (match) {
      values.set(match[1], match[2]);
    }
  }

  const env = {
    API_URL: values.get("API_URL"),
    ANON_KEY: values.get("ANON_KEY"),
    SERVICE_ROLE_KEY: values.get("SERVICE_ROLE_KEY"),
  };

  if (!env.API_URL || !env.ANON_KEY || !env.SERVICE_ROLE_KEY) {
    throw new Error("Unable to resolve local Supabase env. Run `pnpm supabase start` first.");
  }

  return env as LocalSupabaseEnv;
}

function getLocalSupabaseEnv(): LocalSupabaseEnv {
  const output = execFileSync("pnpm", ["supabase", "status", "-o", "env"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return parseLocalSupabaseEnv(output);
}

function client(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      storageKey: `openplan-rls-${randomUUID()}`,
    },
  });
}

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

    expect(tables).toHaveLength(38);
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
    await service.from("workspaces").delete().like("slug", `rls-%-${context.suffix}-%`);
    await service.auth.admin.deleteUser(context.userAId);
    await service.auth.admin.deleteUser(context.userBId);
  });

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
});
