import { describe, expect, it } from "vitest";
import {
  describeStageGateBinding,
  resolveWorkspaceStageGateBinding,
} from "@/lib/stage-gates/template-loader";
import {
  BUILT_IN_STAGE_GATE_TEMPLATE_REGISTRATIONS,
  createStageGateTemplateRegistry,
  type StageGateTemplateRegistration,
} from "@/lib/stage-gates/template-registry";

// The defect this suite guards: `workspaces.stage_gate_template_id` carries a
// database default and the sign-up trigger inserts only (name, slug), so every
// trigger-provisioned workspace in the country is born holding the interim
// default's id. Reading that stored id as a choice would present one
// jurisdiction's statutory checklist to an agency nowhere near it, and look
// entirely deliberate while doing so.

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

/** A workspace row as the project page selects it. */
function workspaceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "workspace-1",
    name: "Any Agency",
    slug: "any-agency",
    // What the migration's DEFAULT puts on every trigger-provisioned workspace.
    stage_gate_template_id: "ca_stage_gates_v0_1",
    stage_gate_template_version: "0.1.0",
    home_geography_source: null,
    home_geography_kind: null,
    home_geography_ref: null,
    home_country_code: null,
    home_subdivision_code: null,
    ...overrides,
  };
}

/** The home-geography shape a TIGERweb county resolves to. */
function homeGeography(subdivision: string | null) {
  return {
    home_geography_source: "tigerweb",
    home_geography_kind: "county",
    home_geography_ref: "00000",
    home_country_code: "US",
    home_subdivision_code: subdivision,
  };
}

function resolvedBinding(
  row: unknown,
  options?: Parameters<typeof resolveWorkspaceStageGateBinding>[1]
) {
  const resolution = resolveWorkspaceStageGateBinding(row, options);
  if (resolution.kind !== "resolved") {
    throw new Error(`expected a resolved binding, got ${resolution.kind}`);
  }
  return resolution.binding;
}

describe("resolveWorkspaceStageGateBinding", () => {
  it("treats the database default on a geography-less workspace as an assumption, not a choice", () => {
    const binding = resolvedBinding(workspaceRow());

    expect(binding.templateId).toBe("ca_stage_gates_v0_1");
    expect(binding.templateSelection).toBe("interim_unconfigured_default");
    expect(binding.interimDefaultReason).toBe("no_workspace_jurisdiction");
    expect(binding.workspaceJurisdiction).toBeNull();
  });

  it("names the workspace's own jurisdiction when no pack is registered for it", () => {
    const binding = resolvedBinding(workspaceRow(homeGeography("OH")));

    expect(binding.templateSelection).toBe("interim_unconfigured_default");
    expect(binding.interimDefaultReason).toBe("no_template_for_jurisdiction");
    expect(binding.workspaceJurisdiction).toEqual({ country: "US", subdivision: "OH" });
  });

  it("does NOT call it an assumption when the bound template is the workspace's own jurisdiction's", () => {
    const binding = resolvedBinding(workspaceRow(homeGeography("CA")));

    expect(binding.templateId).toBe("ca_stage_gates_v0_1");
    expect(binding.templateSelection).toBe("jurisdiction_matched");
    expect(binding.interimDefaultReason).toBeNull();
  });

  it("reports a workspace still holding the interim default while a pack for its jurisdiction exists", () => {
    // Reachable only once a second subdivision pack is registered: the row's
    // stored id is the default, but Ohio now has a pack of its own. Saying "no
    // template for OH" here would be false, and saying "matched" would be worse.
    const binding = resolvedBinding(workspaceRow(homeGeography("OH")), {
      registry: multiJurisdictionRegistry,
    });

    expect(binding.templateId).toBe("ca_stage_gates_v0_1");
    expect(binding.templateSelection).toBe("interim_unconfigured_default");
    expect(binding.interimDefaultReason).toBe("jurisdiction_template_not_bound");
  });

  it("binds a workspace to the pack registered for its jurisdiction once it holds that id", () => {
    const binding = resolvedBinding(
      workspaceRow({ ...homeGeography("OH"), stage_gate_template_id: "oh_stage_gates_test" }),
      { registry: multiJurisdictionRegistry }
    );

    expect(binding.templateId).toBe("oh_stage_gates_test");
    expect(binding.templateSelection).toBe("jurisdiction_matched");
    expect(binding.interimDefaultReason).toBeNull();
  });

  it("treats a stored non-default template as a deliberate binding", () => {
    // A California workspace delivering under Ohio's process: nothing but an
    // explicit write puts a non-default id on the row.
    const binding = resolvedBinding(
      workspaceRow({ ...homeGeography("CA"), stage_gate_template_id: "oh_stage_gates_test" }),
      { registry: multiJurisdictionRegistry }
    );

    expect(binding.templateId).toBe("oh_stage_gates_test");
    expect(binding.templateSelection).toBe("explicitly_requested");
  });

  it("refuses to substitute a template for a stored id this deployment does not register", () => {
    const resolution = resolveWorkspaceStageGateBinding(
      workspaceRow({ stage_gate_template_id: "wa_stage_gates_v9" })
    );

    expect(resolution.kind).toBe("unknown_template");
    if (resolution.kind !== "unknown_template") return;
    expect(resolution.requestedTemplateId).toBe("wa_stage_gates_v9");
    expect(resolution.available.map((descriptor) => descriptor.templateId)).toContain(
      "ca_stage_gates_v0_1"
    );
  });

  it("falls back to the geography answer when the row carries no stored id", () => {
    // A narrower select, or a deployment predating the column. Still disclosed.
    const binding = resolvedBinding({ ...homeGeography("OH") });

    expect(binding.templateSelection).toBe("interim_unconfigured_default");
    expect(binding.interimDefaultReason).toBe("no_template_for_jurisdiction");
  });
});

describe("describeStageGateBinding for a workspace row", () => {
  it("says the jurisdiction was assumed, and that the gate names are not the agency's", () => {
    const disclosure = describeStageGateBinding(resolvedBinding(workspaceRow(homeGeography("OH"))));

    expect(disclosure.isJurisdictionAssumed).toBe(true);
    expect(disclosure.headline).toContain("US-OH");
    expect(disclosure.detail).toContain("no stage-gate template registered for US-OH");
    expect(disclosure.detail).toContain("interim default");
    // The consequence, not just the variable: a planner must be told the gate
    // names and form ids in front of them are not the ones their funder expects.
    expect(disclosure.detail).toContain("exhibit/form ids");
    expect(disclosure.detail).toContain("not authoritative for this agency");
    expect(disclosure.action).toBeTruthy();
  });

  it("says the geography is unset when that is why the default applied", () => {
    const disclosure = describeStageGateBinding(resolvedBinding(workspaceRow()));

    expect(disclosure.isJurisdictionAssumed).toBe(true);
    expect(disclosure.detail).toContain("has not stated where it works");
    expect(disclosure.detail).toContain("not authoritative for this agency");
    expect(disclosure.action).toContain("home geography");
  });

  it("does not misfire when the workspace's own jurisdiction chose the template", () => {
    const disclosure = describeStageGateBinding(resolvedBinding(workspaceRow(homeGeography("CA"))));

    expect(disclosure.isJurisdictionAssumed).toBe(false);
    expect(disclosure.detail).toContain("this workspace's own jurisdiction");
    expect(disclosure.detail).not.toContain("interim default");
    expect(disclosure.detail).not.toContain("not authoritative");
    expect(disclosure.action).toBeNull();
  });

  it("tells a workspace to rebind when a pack for its jurisdiction exists but is not bound", () => {
    const disclosure = describeStageGateBinding(
      resolvedBinding(workspaceRow(homeGeography("OH")), { registry: multiJurisdictionRegistry })
    );

    expect(disclosure.isJurisdictionAssumed).toBe(true);
    expect(disclosure.detail).toContain("IS registered for US-OH");
    expect(disclosure.detail).toContain("not authoritative for this agency");
    expect(disclosure.action).toContain("Rebind");
  });
});
