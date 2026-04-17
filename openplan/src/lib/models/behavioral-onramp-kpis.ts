import type { SupabaseClient } from "@supabase/supabase-js";
import type { CountyOnrampManifest, CountyRunStage } from "@/lib/models/county-onramp";
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
  value: number | null;
  unit: string;
  breakdown_json: Record<string, unknown>;
  county_run_id: string | null;
  run_id: string | null;
};

const BEHAVIORAL_KPI_DEFINITIONS: Array<{
  name: string;
  label: string;
  unit: string;
  pick: (manifest: CountyOnrampManifest) => number | null;
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
  supabase: BehavioralOnrampKpiSupabaseLike;
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

  const countyRunRows = (countyRunsResult.data ?? []) as Array<{ id: string; stage: CountyRunStage }>;

  if (countyRunRows.length === 0) {
    return { kpis: [], rejectedCountyRunIds: [], caveatGateReason: null, error: null };
  }

  const gate = partitionScreeningGradeRows({
    rows: countyRunRows,
    consent,
    resolveStage: (row) => row.stage,
  });

  if (gate.accepted.length === 0) {
    return {
      kpis: [],
      rejectedCountyRunIds: gate.rejected.map((row) => row.id),
      caveatGateReason: gate.reason,
      error: null,
    };
  }

  const kpisResult = await supabase
    .from("model_run_kpis")
    .select("kpi_name, kpi_label, value, unit, breakdown_json, county_run_id, run_id")
    .eq("kpi_category", "behavioral_onramp")
    .in(
      "county_run_id",
      gate.accepted.map((row) => row.id)
    );

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
