import { describe, expect, it } from "vitest";
import { ACTION_METADATA } from "@/lib/runtime/action-metadata";

describe("the assistant cannot author a project cost estimate", () => {
  it("keeps every estimated-cost action out of the registry", () => {
    const offenders = Object.keys(ACTION_METADATA).filter(
      (kind) => kind.includes("project") && kind.includes("cost")
    );
    expect(
      offenders,
      "A plausible number on an approval sheet is indistinguishable from an engineer's estimate. The planner must enter the amount and link its source."
    ).toEqual([]);
  });

  it("guards the matcher against a vacuous spelling", () => {
    const pretend = ["set_project_estimated_cost", "update_project_cost_basis"];
    expect(pretend.filter((kind) => kind.includes("project") && kind.includes("cost"))).toEqual(pretend);
  });
});
