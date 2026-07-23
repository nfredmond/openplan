import { describe, expect, it } from "vitest";
import {
  DEFAULT_STAGE_GATE_TEMPLATE_ID,
  listStageGateTemplates,
  resolveStageGateTemplate,
  resolveStageGateTemplateBinding,
} from "@/lib/stage-gates/template-loader";
import {
  BUILT_IN_STAGE_GATE_TEMPLATE_REGISTRATIONS,
  createStageGateTemplateRegistry,
  type StageGateTemplateRegistration,
} from "@/lib/stage-gates/template-registry";

const ohioRegistration: StageGateTemplateRegistration = {
  artifact: {
    template_id: "oh_stage_gates_test",
    template_name: "Ohio Test Scaffold",
    version: "1.0.0",
    jurisdiction: "OH",
    gate_order: ["G01_TEST"],
    gates: [{ gate_id: "G01_TEST", sequence: 1, name: "Test gate" }],
  },
  jurisdiction: { country: "US", subdivision: "OH", label: "Ohio, United States" },
};

const multiJurisdictionRegistry = createStageGateTemplateRegistry([
  ...BUILT_IN_STAGE_GATE_TEMPLATE_REGISTRATIONS,
  ohioRegistration,
]);

describe("resolveStageGateTemplateBinding", () => {
  it("defaults to the california template when no template id is provided", () => {
    const result = resolveStageGateTemplateBinding();

    expect(result).toEqual({
      templateId: DEFAULT_STAGE_GATE_TEMPLATE_ID,
      templateName: "California Stage-Gate Scaffold",
      templateVersion: "0.1.0",
      jurisdiction: "CA",
      jurisdictionLabel: "California, United States",
      bindingMode: "workspace_bootstrap_interim",
      templateSelection: "interim_unconfigured_default",
      lapmFormIdsStatus: "deferred_to_v0_2",
    });
    expect(DEFAULT_STAGE_GATE_TEMPLATE_ID).toBe("ca_stage_gates_v0_1");
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

  it("binds a workspace to another jurisdiction's template when it asks for one", () => {
    const result = resolveStageGateTemplateBinding("oh_stage_gates_test", {
      registry: multiJurisdictionRegistry,
    });

    expect(result.templateId).toBe("oh_stage_gates_test");
    expect(result.jurisdiction).toBe("OH");
    expect(result.jurisdictionLabel).toBe("Ohio, United States");
    expect(result.templateVersion).toBe("1.0.0");
  });
});

describe("resolveStageGateTemplate", () => {
  it("distinguishes an assumed default from a template the caller chose", () => {
    const assumed = resolveStageGateTemplate();
    const chosen = resolveStageGateTemplate(DEFAULT_STAGE_GATE_TEMPLATE_ID);

    expect(assumed.kind).toBe("resolved");
    expect(chosen.kind).toBe("resolved");
    if (assumed.kind !== "resolved" || chosen.kind !== "resolved") return;

    // Same gates, different provenance: only the first was an assumption the UI
    // has to disclose.
    expect(assumed.binding.templateId).toBe(chosen.binding.templateId);
    expect(assumed.binding.templateSelection).toBe("interim_unconfigured_default");
    expect(chosen.binding.templateSelection).toBe("explicitly_requested");
  });

  it("reports an unknown template with the available options instead of throwing", () => {
    const result = resolveStageGateTemplate("wa_stage_gates_v9", {
      registry: multiJurisdictionRegistry,
    });

    expect(result.kind).toBe("unknown_template");
    if (result.kind !== "unknown_template") return;

    expect(result.requestedTemplateId).toBe("wa_stage_gates_v9");
    expect(result.available.map((descriptor) => descriptor.templateId)).toEqual([
      "ca_stage_gates_v0_1",
      "oh_stage_gates_test",
    ]);
  });

  it("never substitutes the default for an unknown id", () => {
    const result = resolveStageGateTemplate("oh_stage_gates_test");

    // The built-in registry does not carry the Ohio fixture, so this must fail
    // to resolve rather than quietly hand back California's gates.
    expect(result.kind).toBe("unknown_template");
  });

  it("reports a registry that declares no default rather than picking one", () => {
    const result = resolveStageGateTemplate(undefined, {
      registry: createStageGateTemplateRegistry([ohioRegistration]),
    });

    expect(result.kind).toBe("no_default_template");
    if (result.kind !== "no_default_template") return;
    expect(result.available.map((descriptor) => descriptor.templateId)).toEqual([
      "oh_stage_gates_test",
    ]);
  });
});

describe("listStageGateTemplates", () => {
  it("exposes every registered template for a jurisdiction picker", () => {
    expect(listStageGateTemplates(multiJurisdictionRegistry)).toEqual([
      expect.objectContaining({ templateId: "ca_stage_gates_v0_1", isInterimDefault: true }),
      expect.objectContaining({ templateId: "oh_stage_gates_test", isInterimDefault: false }),
    ]);
  });
});
