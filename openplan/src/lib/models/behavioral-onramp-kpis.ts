import type { SupabaseClient } from "@supabase/supabase-js";
import type { CountyOnrampManifest } from "@/lib/models/county-onramp";
import {
  partitionScreeningGradeRows,
  type CaveatGateConsent,
  type CaveatGateReason,
} from "@/lib/models/caveat-gate";

export type BehavioralOnrampKpi = {
  kpi_name: string;
  kpi_label: string;
  kpi_category: "behavioral_onramp";
  value: number | null;
  unit: string;
  breakdown_json: Record<string, unknown>;
};

export type BehavioralOnrampKpiRow = BehavioralOnrampKpi & {
  county_run_id: string;
  run_id: null;
};

export type BehavioralOnrampKpiSnapshot = {
  kpi_name: string;
  kpi_label: string;
  kpi_category: "behavioral_onramp";
  value: number | null;
  unit: string;
  breakdown_json: Record<string, unknown>;
  county_run_id: string | null;
  run_id: string | null;
};

type CountyOnrampRunSnapshotWithVmt = CountyOnrampManifest["summary"]["run"] & {
  daily_vmt?: number | null;
  vmt_per_capita?: number | null;
  vmt_provenance?: string | null;
};

function runSnapshot(manifest: CountyOnrampManifest): CountyOnrampRunSnapshotWithVmt {
  return manifest.summary.run as CountyOnrampRunSnapshotWithVmt;
}

const BEHAVIORAL_KPI_DEFINITIONS: Array<{
  name: string;
  label: string;
  unit: string;
  pick: (manifest: CountyOnrampManifest) => number | null;
  breakdown?: (manifest: CountyOnrampManifest) => Record<string, unknown>;
}> = [
  {
    name: "total_trips",
    label: "Total trips (behavioral)",
    unit: "trips",
    pick: (m) => m.summary.run.total_trips,
  },
  {
    name: "loaded_links",
    label: "Loaded links",
    unit: "links",
    pick: (m) => m.summary.run.loaded_links,
  },
  {
    name: "final_gap",
    label: "Assignment final gap",
    unit: "ratio",
    pick: (m) => m.summary.run.final_gap,
  },
  {
    name: "zone_count",
    label: "Zones with activity",
    unit: "zones",
    pick: (m) => m.summary.run.zone_count,
  },
  {
    name: "population_total",
    label: "Population coverage",
    unit: "persons",
    pick: (m) => m.summary.run.population_total,
  },
  {
    name: "jobs_total",
    label: "Jobs coverage",
    unit: "jobs",
    pick: (m) => m.summary.run.jobs_total,
  },
  {
    // Total daily VMT (screening-grade). Feeds the CEQA §15064.3 screen when
    // paired with population_total. Null when the run producer did not derive it.
    name: "daily_vmt",
    label: "Daily VMT (screening)",
    unit: "vehicle-miles/day",
    pick: (m) => runSnapshot(m).daily_vmt ?? null,
    breakdown: (m) => ({ provenance: runSnapshot(m).vmt_provenance ?? null }),
  },
  {
    // Per-capita daily VMT (screening-grade). The CEQA §15064.3 screen reads
    // this preferentially. Never presented as measured VMT.
    name: "vmt_per_capita",
    label: "VMT per capita (screening)",
    unit: "vehicle-miles/person/day",
    pick: (m) => runSnapshot(m).vmt_per_capita ?? null,
    breakdown: (m) => ({ provenance: runSnapshot(m).vmt_provenance ?? null }),
  },
];

export function buildBehavioralOnrampKpis(manifest: CountyOnrampManifest): BehavioralOnrampKpi[] {
  return BEHAVIORAL_KPI_DEFINITIONS.map((definition) => ({
    kpi_name: definition.name,
    kpi_label: definition.label,
    kpi_category: "behavioral_onramp" as const,
    value: definition.pick(manifest),
    unit: definition.unit,
    breakdown_json: {
      source: "county_onramp",
      stage: manifest.stage,
      mode: manifest.mode,
      generated_at: manifest.generated_at,
      ...(definition.breakdown?.(manifest) ?? {}),
    },
  }));
}

export type BehavioralOnrampKpiSupabaseLike = Pick<SupabaseClient, "from">;

export type PersistBehavioralOnrampKpisInput = {
  supabase: BehavioralOnrampKpiSupabaseLike;
  countyRunId: string;
  manifest: CountyOnrampManifest;
};

export type PersistBehavioralOnrampKpisResult = {
  inserted: BehavioralOnrampKpiRow[];
  error: { message: string; code?: string | null } | null;
};

export async function persistBehavioralOnrampKpis({
  supabase,
  countyRunId,
  manifest,
}: PersistBehavioralOnrampKpisInput): Promise<PersistBehavioralOnrampKpisResult> {
  const kpis = buildBehavioralOnrampKpis(manifest);

  const deleteResult = await supabase
    .from("model_run_kpis")
    .delete()
    .eq("county_run_id", countyRunId)
    .eq("kpi_category", "behavioral_onramp");

  if (deleteResult.error) {
    return {
      inserted: [],
      error: {
        message: deleteResult.error.message,
        code: deleteResult.error.code ?? null,
      },
    };
  }

  const rows: BehavioralOnrampKpiRow[] = kpis.map((kpi) => ({
    ...kpi,
    county_run_id: countyRunId,
    run_id: null,
  }));

  const insertResult = await supabase.from("model_run_kpis").insert(rows);

  if (insertResult.error) {
    return {
      inserted: [],
      error: {
        message: insertResult.error.message,
        code: insertResult.error.code ?? null,
      },
    };
  }

  return { inserted: rows, error: null };
}

export type LoadBehavioralOnrampKpisInput = {
  supabase: Pick<SupabaseClient, "from" | "rpc">;
  workspaceId: string;
  consent?: CaveatGateConsent;
};

export type LoadBehavioralOnrampKpisResult = {
  kpis: BehavioralOnrampKpiSnapshot[];
  rejectedCountyRunIds: string[];
  caveatGateReason: CaveatGateReason | null;
  error: { message: string; code?: string | null } | null;
};

export async function loadBehavioralOnrampKpisForWorkspace({
  supabase,
  workspaceId,
  consent,
}: LoadBehavioralOnrampKpisInput): Promise<LoadBehavioralOnrampKpisResult> {
  const countyRunsResult = await supabase
    .from("county_runs")
    .select("id, stage")
    .eq("workspace_id", workspaceId);

  if (countyRunsResult.error) {
    return {
      kpis: [],
      rejectedCountyRunIds: [],
      caveatGateReason: null,
      error: {
        message: countyRunsResult.error.message,
        code: countyRunsResult.error.code ?? null,
      },
    };
  }

  const countyRunRows = (countyRunsResult.data ?? []) as Array<{ id: string; stage: string | null }>;

  if (countyRunRows.length === 0) {
    return { kpis: [], rejectedCountyRunIds: [], caveatGateReason: null, error: null };
  }

  const gate = partitionScreeningGradeRows({
    rows: countyRunRows,
    consent,
    resolveStage: (row) => row.stage,
  });

  const kpisResult = await supabase.rpc("load_behavioral_onramp_kpis_for_workspace", {
    p_workspace_id: workspaceId,
    p_accept_screening_grade: Boolean(consent?.acceptScreeningGrade),
  });

  if (kpisResult.error) {
    return {
      kpis: [],
      rejectedCountyRunIds: gate.rejected.map((row) => row.id),
      caveatGateReason: gate.reason,
      error: {
        message: kpisResult.error.message,
        code: kpisResult.error.code ?? null,
      },
    };
  }

  return {
    kpis: (kpisResult.data ?? []) as BehavioralOnrampKpiSnapshot[],
    rejectedCountyRunIds: gate.rejected.map((row) => row.id),
    caveatGateReason: gate.reason,
    error: null,
  };
}
