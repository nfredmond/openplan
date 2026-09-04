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
});
