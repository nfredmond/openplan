import type { ModelingWorkerDeclaration } from "@/lib/config/deployment-health";

export const WORKER_HEARTBEAT_STALE_AFTER_MS = 2 * 60 * 1000;

export type ModelingWorkerKind = "aequilibrae" | "activitysim";

export type ModelingWorkerHeartbeatRow = {
  worker_kind: string;
  instance_id: string;
  supported_stages: string[] | null;
  runtime_mode: string | null;
  worker_version: string | null;
  current_work: Record<string, unknown> | null;
  started_at: string | null;
  last_successful_heartbeat_at: string | null;
};

export type WorkerCapabilityState = {
  kind: ModelingWorkerKind;
  state: "fresh" | "stale" | "absent" | "conflicting" | "unknown";
  observationKey: string;
  observedAt: string | null;
  instanceCount: number;
  currentWork: Record<string, unknown>[];
  reason: string;
};

export type ModelingWorkerHealth = {
  observedAt: string;
  schemaAvailable: boolean;
  aequilibrae: WorkerCapabilityState;
  activitysim: WorkerCapabilityState;
};

const REQUIRED_STAGES: Record<ModelingWorkerKind, readonly string[]> = {
  aequilibrae: ["AequilibraE Setup", "Network Assignment", "Artifact Extraction"],
  activitysim: ["ActivitySim Bundle & Preflight"],
};

function keyFor(kind: ModelingWorkerKind, rows: readonly ModelingWorkerHeartbeatRow[]): string {
  return [
    kind,
    ...rows
      .map((row) => `${row.instance_id}:${row.last_successful_heartbeat_at ?? "missing"}:${(row.supported_stages ?? []).sort().join(",")}`)
      .sort(),
  ].join("|");
}

function unknown(kind: ModelingWorkerKind, reason: string, suffix: string): WorkerCapabilityState {
  return {
    kind,
    state: "unknown",
    observationKey: `${kind}|unknown|${suffix}`,
    observedAt: null,
    instanceCount: 0,
    currentWork: [],
    reason,
  };
}

function reduceKind(args: {
  kind: ModelingWorkerKind;
  rows: readonly ModelingWorkerHeartbeatRow[];
  now: number;
  declaration: ModelingWorkerDeclaration;
  schemaAvailable: boolean;
}): WorkerCapabilityState {
  const { kind, now, declaration, schemaAvailable } = args;
  if (!schemaAvailable) {
    return unknown(kind, "Worker heartbeat schema is unavailable; using deployment declaration and run history.", "schema");
  }
  if (kind === "aequilibrae" && declaration === "absent") {
    return {
      kind,
      state: "absent",
      observationKey: `${kind}|absent|declared`,
      observedAt: null,
      instanceCount: 0,
      currentWork: [],
      reason: "This deployment explicitly declares that no AequilibraE worker exists.",
    };
  }
  const rows = args.rows.filter((row) => row.worker_kind === kind);
  if (rows.length === 0) {
    return unknown(kind, "No compatible heartbeat was observed; this may be an older worker or no worker at all.", "none");
  }

  const freshRows = rows.filter((row) => {
    const heartbeatMs = row.last_successful_heartbeat_at
      ? new Date(row.last_successful_heartbeat_at).getTime()
      : Number.NaN;
    return Number.isFinite(heartbeatMs) && now - heartbeatMs <= WORKER_HEARTBEAT_STALE_AFTER_MS;
  });

  // Retired instance rows are durable observations, not active capability
  // conflicts. Once any current instance answers, reduce capabilities over the
  // current set only; otherwise preserve all rows to describe the stale state.
  const capabilityRows = freshRows.length > 0 ? freshRows : rows;

  if (capabilityRows.some((row) => !row.worker_version || row.worker_version === "unrecorded")) {
    return {
      ...unknown(kind, "A current heartbeat came from a worker whose version cannot be verified.", keyFor(kind, capabilityRows)),
      instanceCount: capabilityRows.length,
    };
  }

  const required = REQUIRED_STAGES[kind];
  const incompatible = capabilityRows.filter(
    (row) => !required.every((stage) => (row.supported_stages ?? []).includes(stage))
  );
  if (incompatible.length > 0) {
    return {
      kind,
      state: "conflicting",
      observationKey: keyFor(kind, capabilityRows),
      observedAt: capabilityRows.map((row) => row.last_successful_heartbeat_at).filter(Boolean).sort().at(-1) ?? null,
      instanceCount: capabilityRows.length,
      currentWork: capabilityRows.map((row) => row.current_work).filter((work): work is Record<string, unknown> => Boolean(work)),
      reason: "Observed workers disagree with the stages this OpenPlan version requires.",
    };
  }

  const latest = rows
    .map((row) => row.last_successful_heartbeat_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  const latestMs = latest ? new Date(latest).getTime() : Number.NaN;
  const fresh = Number.isFinite(latestMs) && now - latestMs <= WORKER_HEARTBEAT_STALE_AFTER_MS;
  return {
    kind,
    state: fresh ? "fresh" : "stale",
    observationKey: keyFor(kind, capabilityRows),
    observedAt: latest,
    instanceCount: capabilityRows.length,
    currentWork: capabilityRows.map((row) => row.current_work).filter((work): work is Record<string, unknown> => Boolean(work)),
    reason: fresh
      ? `${kind === "aequilibrae" ? "AequilibraE" : "ActivitySim"} reported within the last two minutes.`
      : `${kind === "aequilibrae" ? "AequilibraE" : "ActivitySim"} has not reported within the last two minutes. This does not prove active work stopped.`,
  };
}

export function reduceModelingWorkerHealth(args: {
  rows: readonly ModelingWorkerHeartbeatRow[];
  now: number;
  declaration: ModelingWorkerDeclaration;
  schemaAvailable?: boolean;
}): ModelingWorkerHealth {
  const schemaAvailable = args.schemaAvailable ?? true;
  return {
    observedAt: new Date(args.now).toISOString(),
    schemaAvailable,
    aequilibrae: reduceKind({ ...args, kind: "aequilibrae", schemaAvailable }),
    activitysim: reduceKind({ ...args, kind: "activitysim", schemaAvailable }),
  };
}

export type WorkerHealthLaunchGate = {
  blocked: boolean;
  acknowledgementKey: string | null;
  reason: string | null;
  states: WorkerCapabilityState[];
};

export function evaluateWorkerHealthLaunchGate(
  engineKey: string,
  health: ModelingWorkerHealth
): WorkerHealthLaunchGate {
  const states = engineKey === "behavioral_demand"
    ? [health.aequilibrae, health.activitysim]
    : engineKey === "aequilibrae"
      ? [health.aequilibrae]
      : [];
  if (states.length === 0) return { blocked: false, acknowledgementKey: null, reason: null, states };

  const hard = states.find((state) => state.state === "absent" || state.state === "conflicting");
  if (hard) return { blocked: true, acknowledgementKey: null, reason: hard.reason, states };

  const stale = states.filter((state) => state.state === "stale");
  if (stale.length > 0) {
    return {
      blocked: true,
      acknowledgementKey: stale.map((state) => state.observationKey).sort().join("||"),
      reason: stale.map((state) => state.reason).join(" "),
      states,
    };
  }
  return { blocked: false, acknowledgementKey: null, reason: null, states };
}
