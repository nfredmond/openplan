import { describe, expect, it } from "vitest";
import { managedRunStatusPresentation } from "@/lib/models/run-status";

describe("managed run status presentation", () => {
  it("does not call a behavioral preflight a successful model run", () => {
    expect(
      managedRunStatusPresentation({
        status: "succeeded",
        engine_key: "behavioral_demand",
        artifacts: [{ artifact_type: "behavioral_demand_preflight_evidence" }],
      })
    ).toEqual({ label: "Preflight only", tone: "warning" });
  });

  it("keeps an executed ActivitySim run distinct from preflight", () => {
    expect(
      managedRunStatusPresentation({
        status: "succeeded",
        engine_key: "behavioral_demand",
        artifacts: [{ artifact_type: "activitysim_demand_package_manifest" }],
      })
    ).toEqual({ label: "Succeeded", tone: "success" });
  });

  it("calls a running run with an interrupted stage interrupted, not running", () => {
    const run = {
      status: "running",
      engine_key: "aequilibrae",
      artifacts: [],
      stages: [
        { status: "succeeded", error_message: null },
        { status: "running", error_message: "Interrupted: the model worker shut down." },
      ],
    };
    expect(managedRunStatusPresentation(run)).toEqual({ label: "Interrupted", tone: "warning" });
    expect(
      managedRunStatusPresentation({ ...run, stages: [{ status: "running", error_message: null }] })
    ).toEqual({ label: "Running", tone: "info" });
    expect(
      managedRunStatusPresentation({ ...run, stages: [{ status: "failed", error_message: "x" }, { status: "running" }] })
    ).toEqual({ label: "Running", tone: "info" });
  });
});
