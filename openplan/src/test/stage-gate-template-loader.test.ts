import { describe, expect, it } from "vitest";
import {
  DEFAULT_STAGE_GATE_TEMPLATE_ID,
  resolveStageGateTemplateBinding,
} from "@/lib/stage-gates/template-loader";

describe("resolveStageGateTemplateBinding", () => {
  it("defaults to the california template when no template id is provided", () => {
    const result = resolveStageGateTemplateBinding();

    expect(result).toEqual({
      templateId: DEFAULT_STAGE_GATE_TEMPLATE_ID,
      templateVersion: "0.1.0",
      jurisdiction: "CA",
      bindingMode: "workspace_bootstrap_interim",
      lapmFormIdsStatus: "deferred_to_v0_2",
    });
  });

  it("supports canonical project-create binding mode", () => {
    const result = resolveStageGateTemplateBinding(undefined, {
      bindingMode: "project_create_v0_2",
    });

    expect(result.bindingMode).toBe("project_create_v0_2");
    expect(result.templateId).toBe(DEFAULT_STAGE_GATE_TEMPLATE_ID);
  });

  it("throws for unsupported template ids", () => {
    expect(() => resolveStageGateTemplateBinding("unknown-template")).toThrow(
      "Unsupported stage-gate template: unknown-template"
    );
  });
});
