type ManagedRunStatusInput = {
  status: string;
  engine_key: string;
  artifacts: Array<{ artifact_type: string }>;
};

export type ManagedRunStatusPresentation = {
  label: string;
  tone: "info" | "success" | "warning" | "danger" | "neutral";
};

/**
 * Report what a managed run produced, not only whether its declared stages ended.
 * A behavioral preflight is terminal in storage, but it is not an ActivitySim
 * execution and must never appear to a planner as a successful model run.
 */
export function managedRunStatusPresentation(run: ManagedRunStatusInput): ManagedRunStatusPresentation {
  if (run.status === "succeeded" && run.engine_key === "behavioral_demand") {
    const executed = run.artifacts.some(
      (artifact) => artifact.artifact_type === "activitysim_demand_package_manifest"
    );
    if (!executed) return { label: "Preflight only", tone: "warning" };
  }

  if (run.status === "succeeded") return { label: "Succeeded", tone: "success" };
  if (run.status === "running") return { label: "Running", tone: "info" };
  if (run.status === "queued") return { label: "Queued", tone: "info" };
  if (run.status === "failed") return { label: "Failed", tone: "warning" };
  if (run.status === "cancelled") return { label: "Cancelled", tone: "warning" };
  return { label: run.status || "Unknown", tone: "neutral" };
}
