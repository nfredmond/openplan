import { describe, expect, it } from "vitest";
import {
  resolveDatasetDependentOutputContext,
  toneForDatasetDependentOutputLevel,
} from "@/lib/data-sources/dataset-dependent-output-context";

const baseline = {
  status: "ready",
  linkedProjectCount: 1,
  lineageLevel: "complete" as const,
  overlayReady: true,
  thematicReady: true,
  latestRefreshStatus: "succeeded",
};

describe("dataset dependent output context", () => {
  it("marks linked, lineage-backed map datasets as output-ready", () => {
    const context = resolveDatasetDependentOutputContext(baseline);

    expect(context).toMatchObject({
      level: "output_ready",
      label: "Output-ready",
      dependentOutputCount: 4,
      needs: [],
    });
    expect(context.hints.map((hint) => [hint.key, hint.ready])).toEqual([
      ["project_link", true],
      ["analysis_overlay", true],
      ["thematic_map", true],
      ["report_appendix", true],
    ]);
    expect(toneForDatasetDependentOutputLevel(context.level)).toBe("success");
  });

  it("keeps unlinked datasets in registry-only posture even with complete lineage", () => {
    const context = resolveDatasetDependentOutputContext({
      ...baseline,
      linkedProjectCount: 0,
    });

    expect(context.level).toBe("registry_only");
    expect(context.label).toBe("Registry only");
    expect(context.needs).toContain("Project linkage");
    expect(context.needs).toContain("Report appendix");
    expect(toneForDatasetDependentOutputLevel(context.level)).toBe("neutral");
  });

  it("requires usable lineage and ready status before report appendix handoff", () => {
    const context = resolveDatasetDependentOutputContext({
      ...baseline,
      status: "draft",
      lineageLevel: "partial",
      overlayReady: true,
      thematicReady: false,
    });

    expect(context.level).toBe("review_ready");
    expect(context.label).toBe("Handoff review");
    expect(context.hints.find((hint) => hint.key === "report_appendix")?.ready).toBe(false);
    expect(context.needs).toEqual(expect.arrayContaining(["Thematic map", "Report appendix"]));
    expect(toneForDatasetDependentOutputLevel(context.level)).toBe("warning");
  });

  it("blocks dependent outputs when latest refresh failed", () => {
    const context = resolveDatasetDependentOutputContext({
      ...baseline,
      latestRefreshStatus: "failed",
    });

    expect(context.level).toBe("blocked");
    expect(context.label).toBe("Output blocked");
    expect(context.detail).toContain("Latest refresh");
    expect(toneForDatasetDependentOutputLevel(context.level)).toBe("danger");
  });

  it("surfaces refresh review for stale or running datasets with dependent projects", () => {
    const staleContext = resolveDatasetDependentOutputContext({
      ...baseline,
      status: "stale",
      latestRefreshStatus: "succeeded",
    });
    const runningContext = resolveDatasetDependentOutputContext({
      ...baseline,
      status: "ready",
      latestRefreshStatus: "running",
    });

    expect(staleContext.level).toBe("review_ready");
    expect(staleContext.label).toBe("Refresh review");
    expect(runningContext.level).toBe("review_ready");
    expect(runningContext.label).toBe("Refresh review");
  });
});
