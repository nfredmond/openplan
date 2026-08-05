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
// trigger-provisioned workspace in the country is born holding a default id
// nobody chose. Reading that stored id as a choice would present one
// jurisdiction's statutory checklist to an agency nowhere near it, and look
// entirely deliberate while doing so.
//
// AND THE DEFAULT HAS CHANGED ONCE ALREADY (2026-08-05: ca_stage_gates_v0_1 →
// us_federal_aid_stage_gates_v0_1), which is why the reconciliation compares
// the stored id against EVERY id the column default has ever been
// (KNOWN_DATABASE_DEFAULT_TEMPLATE_IDS), not against the registry's current
// default. Comparing against the current default alone would reclassify every
// workspace born under the old default as having EXPLICITLY REQUESTED
// California's gates — the assumed-presented-as-chosen substitution itself.

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

/**
 * A workspace row as the project page selects it. The default stored id is the
 * ORIGINAL migration's default (20260305000009): every workspace created before
 * 2026-08-05 carries it, so it is the historically dominant shape.
 */
function workspaceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "workspace-1",
    name: "Any Agency",
    slug: "any-agency",
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
function homeGeography(subdivision: string | null, country: string = "US") {
  return {
    home_geography_source: "tigerweb",
    home_geography_kind: "county",
    home_geography_ref: "00000",
    home_country_code: country,
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
  it("treats a superseded database default on a geography-less workspace as an assumption, not a choice", () => {
    // Battery (b): stored CA id + no geography. This is every pre-2026-08-05
    // workspace that never stated where it works, and its answer is UNCHANGED
    // by the default flip: the CA template is still the binding of record, and
    // it is still labeled assumed with the same reason. No churn.
    const binding = resolvedBinding(workspaceRow());

    expect(binding.templateId).toBe("ca_stage_gates_v0_1");
    expect(binding.templateSelection).toBe("interim_unconfigured_default");
    expect(binding.interimDefaultReason).toBe("no_workspace_jurisdiction");
    expect(binding.workspaceJurisdiction).toBeNull();
  });

  it("labels a stored old default assumed — never chosen — when the workspace's geography answers differently", () => {
    // Battery (a): stored CA id + Texas geography. The federal floor covers
    // US-TX, so a pack for this workspace's jurisdiction IS registered and the
    // row is just still holding the default it was born under. The CA template
    // remains the binding of record (its gates are what render), but calling it
    // "explicitly requested" would be false.
    const binding = resolvedBinding(workspaceRow(homeGeography("TX")));

    expect(binding.templateId).toBe("ca_stage_gates_v0_1");
    expect(binding.templateSelection).toBe("interim_unconfigured_default");
    expect(binding.interimDefaultReason).toBe("jurisdiction_template_not_bound");
    expect(binding.workspaceJurisdiction).toEqual({ country: "US", subdivision: "TX" });
  });

  it("does NOT call it an assumption when the bound template is the workspace's own jurisdiction's", () => {
    // Battery (c): stored CA id + California geography — stored and derived
    // agree, so the geography answer's provenance stands.
    const binding = resolvedBinding(workspaceRow(homeGeography("CA")));

    expect(binding.templateId).toBe("ca_stage_gates_v0_1");
    expect(binding.templateSelection).toBe("jurisdiction_matched");
    expect(binding.interimDefaultReason).toBeNull();
  });

  it("matches a new-default workspace to the federal floor when its geography agrees", () => {
    // Battery (d): stored US id + Texas geography. The floor is the pack the
    // registry matches for US-TX, so stored and derived agree — a real match.
    const binding = resolvedBinding(
      workspaceRow({ ...homeGeography("TX"), stage_gate_template_id: "us_federal_aid_stage_gates_v0_1" })
    );

    expect(binding.templateId).toBe("us_federal_aid_stage_gates_v0_1");
    expect(binding.templateSelection).toBe("jurisdiction_matched");
    expect(binding.interimDefaultReason).toBeNull();
  });

  it("tells a federal-floor workspace that later states California to rebind to the CA pack", () => {
    // Battery (e): stored US id + California geography. California has its own
    // registered pack, so the stored default diverges from the geography answer
    // and stays labeled assumed, with the rebind reason.
    const binding = resolvedBinding(
      workspaceRow({ ...homeGeography("CA"), stage_gate_template_id: "us_federal_aid_stage_gates_v0_1" })
    );

    expect(binding.templateId).toBe("us_federal_aid_stage_gates_v0_1");
    expect(binding.templateSelection).toBe("interim_unconfigured_default");
    expect(binding.interimDefaultReason).toBe("jurisdiction_template_not_bound");
  });

  it("reuses the geography's own reason when a stored default diverges and no pack covers the workspace", () => {
    // Stored CA id + a non-US geography: the registry has nothing for NZ, so
    // the honest reason is the geography's own — "no template for your
    // jurisdiction" — not the rebind instruction, because there is nothing to
    // rebind to.
    const binding = resolvedBinding(workspaceRow(homeGeography(null, "NZ")));

    expect(binding.templateId).toBe("ca_stage_gates_v0_1");
    expect(binding.templateSelection).toBe("interim_unconfigured_default");
    expect(binding.interimDefaultReason).toBe("no_template_for_jurisdiction");
    expect(binding.workspaceJurisdiction).toEqual({ country: "NZ", subdivision: null });
  });

  it("reports a workspace still holding a default while a subdivision pack for its jurisdiction exists", () => {
    // Stored CA id + Ohio geography, with an Ohio pack registered: same rebind
    // answer as battery (a), at the subdivision tier.
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

  it("treats a stored id that was never a database default as a deliberate binding", () => {
    // Battery (f): a California workspace delivering under Ohio's process.
    // "oh_stage_gates_test" is not in KNOWN_DATABASE_DEFAULT_TEMPLATE_IDS, so
    // nothing but an explicit write could have put it on the row.
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
    expect(resolution.available.map((descriptor) => descriptor.templateId)).toContain(
      "us_federal_aid_stage_gates_v0_1"
    );
  });

  it("falls back to the geography answer when the row carries no stored id", () => {
    // A narrower select, or a deployment predating the column. The federal
    // floor covers US-OH, so the geography alone yields a real match.
    const binding = resolvedBinding({ ...homeGeography("OH") });

    expect(binding.templateId).toBe("us_federal_aid_stage_gates_v0_1");
    expect(binding.templateSelection).toBe("jurisdiction_matched");
    expect(binding.interimDefaultReason).toBeNull();
  });
});

describe("describeStageGateBinding for a workspace row", () => {
  it("tells a workspace holding the old default to rebind, naming its own jurisdiction", () => {
    // Battery (a)'s disclosure: the sentence carries the rebind action and the
    // consequence — the CA gate names on screen are not this agency's.
    const disclosure = describeStageGateBinding(resolvedBinding(workspaceRow(homeGeography("TX"))));

    expect(disclosure.isJurisdictionAssumed).toBe(true);
    expect(disclosure.headline).toContain("US-TX");
    expect(disclosure.detail).toContain("IS registered for US-TX");
    expect(disclosure.detail).toContain("interim default");
    // The consequence, not just the variable: a planner must be told the gate
    // names and form ids in front of them are not the ones their funder expects.
    expect(disclosure.detail).toContain("exhibit/form ids");
    expect(disclosure.detail).toContain("not authoritative for this agency");
    expect(disclosure.action).toContain("Rebind");
  });

  it("says no pack exists for a jurisdiction OpenPlan has not authored", () => {
    const disclosure = describeStageGateBinding(
      resolvedBinding(workspaceRow(homeGeography(null, "NZ")))
    );

    expect(disclosure.isJurisdictionAssumed).toBe(true);
    expect(disclosure.detail).toContain("no stage-gate template registered for NZ");
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

  it("tells a workspace to rebind when a subdivision pack for its jurisdiction exists but is not bound", () => {
    const disclosure = describeStageGateBinding(
      resolvedBinding(workspaceRow(homeGeography("OH")), { registry: multiJurisdictionRegistry })
    );

    expect(disclosure.isJurisdictionAssumed).toBe(true);
    expect(disclosure.detail).toContain("IS registered for US-OH");
    expect(disclosure.detail).toContain("not authoritative for this agency");
    expect(disclosure.action).toContain("Rebind");
  });
});
