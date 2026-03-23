import { createHash } from "node:crypto";
import type { CorridorGeojson } from "@/lib/models/run-launch";

export type SupportedEngineKey = "deterministic_corridor_v1" | "aequilibrae" | "activitysim";
export type ManagedRunLaunchMode = "inline_analysis" | "queued_worker" | "queued_handoff";

export type ManagedRunStageTemplate = {
  stageName: string;
  sortOrder: number;
  executionRole: "inline" | "worker" | "adapter";
  notes?: string;
};

export type ManagedRunLaunchPlan = {
  engineKey: SupportedEngineKey;
  engineLabel: string;
  pipelineKey: string;
  orchestratorVersion: string;
  launchMode: ManagedRunLaunchMode;
  defaultRunStatus: "running" | "queued";
  stagePlan: ManagedRunStageTemplate[];
  expectedArtifacts: string[];
  honestCapability: string;
};

export type ManagedRunManifest = {
  schemaVersion: "openplan-managed-run-manifest.v1";
  pipelineKey: string;
  orchestratorVersion: string;
  engineKey: SupportedEngineKey;
  engineLabel: string;
  launchMode: ManagedRunLaunchMode;
  honestCapability: string;
  launchedAt: string;
  model: {
    id: string;
    title: string | null;
    family: string | null;
    configVersion: string | null;
  };
  scenario: {
    id: string | null;
    label: string | null;
    status: string | null;
  };
  inputs: {
    queryText: string;
    corridorGeojson: CorridorGeojson;
    corridorGeojsonHash: string;
    assumptionSnapshot: Record<string, unknown>;
  };
  stagePlan: Array<ManagedRunStageTemplate & { initialStatus: "queued" }>;
  expectedArtifacts: string[];
};

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJsonStringify(nested)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function hashCorridorGeojson(corridorGeojson: CorridorGeojson): string {
  return createHash("sha256").update(stableJsonStringify(corridorGeojson)).digest("hex").slice(0, 16);
}

export function buildManagedRunLaunchPlan(engineKey: SupportedEngineKey): ManagedRunLaunchPlan {
  if (engineKey === "deterministic_corridor_v1") {
    return {
      engineKey,
      engineLabel: "Deterministic Corridor",
      pipelineKey: "deterministic_corridor_v1",
      orchestratorVersion: "openplan-orchestrator-v1",
      launchMode: "inline_analysis",
      defaultRunStatus: "running",
      stagePlan: [],
      expectedArtifacts: ["analysis_run_link"],
      honestCapability: "Runs the existing synchronous corridor analysis path only.",
    };
  }

  if (engineKey === "aequilibrae") {
    return {
      engineKey,
      engineLabel: "AequilibraE",
      pipelineKey: "aequilibrae_screening_v1",
      orchestratorVersion: "openplan-orchestrator-v1",
      launchMode: "queued_worker",
      defaultRunStatus: "queued",
      stagePlan: [
        {
          stageName: "AequilibraE Setup",
          sortOrder: 1,
          executionRole: "worker",
          notes: "Build dynamic study package, download OSM network, add centroids/connectors.",
        },
        {
          stageName: "Network Assignment",
          sortOrder: 2,
          executionRole: "worker",
          notes: "Run skims, build OD demand, and execute traffic assignment.",
        },
        {
          stageName: "Artifact Extraction",
          sortOrder: 3,
          executionRole: "worker",
          notes: "Extract evidence, KPIs, skims, and map artifacts.",
        },
      ],
      expectedArtifacts: ["link_volumes", "demand_matrix", "skim_matrix", "evidence_packet", "volumes_geojson"],
      honestCapability: "Executes the current AequilibraE worker prototype end-to-end.",
    };
  }

  return {
    engineKey,
    engineLabel: "ActivitySim",
    pipelineKey: "aequilibrae_activitysim_handoff_v1",
    orchestratorVersion: "openplan-orchestrator-v1",
    launchMode: "queued_handoff",
    defaultRunStatus: "queued",
    stagePlan: [
      {
        stageName: "AequilibraE Setup",
        sortOrder: 1,
        executionRole: "worker",
        notes: "Prepare the network and zone package used to seed ActivitySim-facing artifacts.",
      },
      {
        stageName: "Network Assignment",
        sortOrder: 2,
        executionRole: "worker",
        notes: "Generate skims and screening demand artifacts from the AequilibraE lane.",
      },
      {
        stageName: "Artifact Extraction",
        sortOrder: 3,
        executionRole: "worker",
        notes: "Persist evidence, KPIs, and the AequilibraE artifact set.",
      },
      {
        stageName: "ActivitySim Handoff Package",
        sortOrder: 4,
        executionRole: "adapter",
        notes: "Build an honest ActivitySim handoff manifest from the AequilibraE outputs. ActivitySim runtime execution is not included yet.",
      },
    ],
    expectedArtifacts: [
      "link_volumes",
      "demand_matrix",
      "skim_matrix",
      "evidence_packet",
      "volumes_geojson",
      "activitysim_handoff_manifest",
    ],
    honestCapability:
      "Builds a staged AequilibraE → ActivitySim handoff package. It does not execute the ActivitySim engine yet.",
  };
}

export function buildManagedRunManifest({
  plan,
  launchedAt,
  model,
  scenario,
  queryText,
  corridorGeojson,
  assumptionSnapshot,
}: {
  plan: ManagedRunLaunchPlan;
  launchedAt: string;
  model: {
    id: string;
    title: string | null;
    family: string | null;
    configVersion: string | null;
  };
  scenario?: {
    id: string | null;
    label: string | null;
    status: string | null;
  } | null;
  queryText: string;
  corridorGeojson: CorridorGeojson;
  assumptionSnapshot: Record<string, unknown>;
}): ManagedRunManifest {
  return {
    schemaVersion: "openplan-managed-run-manifest.v1",
    pipelineKey: plan.pipelineKey,
    orchestratorVersion: plan.orchestratorVersion,
    engineKey: plan.engineKey,
    engineLabel: plan.engineLabel,
    launchMode: plan.launchMode,
    honestCapability: plan.honestCapability,
    launchedAt,
    model,
    scenario: {
      id: scenario?.id ?? null,
      label: scenario?.label ?? null,
      status: scenario?.status ?? null,
    },
    inputs: {
      queryText,
      corridorGeojson,
      corridorGeojsonHash: hashCorridorGeojson(corridorGeojson),
      assumptionSnapshot,
    },
    stagePlan: plan.stagePlan.map((stage) => ({ ...stage, initialStatus: "queued" })),
    expectedArtifacts: plan.expectedArtifacts,
  };
}
