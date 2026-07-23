/**
 * Stage-gate template registry.
 *
 * A stage-gate template is a *data artifact*: an ordered set of delivery gates
 * and the evidence each gate requires under one jurisdiction's rules. The
 * California LAPM/CEQA pack is the first one OpenPlan ships. It is not the only
 * shape a template may take, and nothing in this module may assume it — a
 * template for Ohio, for Ontario, or for a tribe's own delivery process must be
 * addable as a descriptor, never as an edit to a call site.
 *
 * The design deliberately mirrors `src/lib/safety/sources/registry.ts`:
 *
 *   - coverage grows by adding a registration entry, not by editing consumers;
 *   - the resolver returns an explicit "not registered" result rather than
 *     quietly substituting whatever template happens to be loaded.
 *
 * That second rule is the load-bearing one. Binding a workspace to a
 * jurisdiction's gates it did not choose would put the wrong statutory
 * checklist in front of a planner and look entirely plausible while doing it —
 * exactly the silent-wrong-data failure this codebase refuses. An unresolved
 * template is an answer the caller must handle; it is never a default.
 *
 * `createStageGateTemplateRegistry` is exported separately from the built-in
 * instance so a future workspace-authored or database-backed template set can
 * be built into a registry without this file changing.
 */

import caStageGatesTemplate from "@/lib/stage-gates/templates/ca_stage_gates_v0.1.json";

/**
 * Where a template's rules come from, expressed so the core stays
 * country-neutral: ISO 3166-1 alpha-2 for the country, ISO 3166-2 subdivision
 * code (without the country prefix) when the template is subdivision-scoped.
 *
 * `label` is what a planner reads. It is carried here rather than derived,
 * because deriving "California" from "US-CA" would mean shipping a code-to-name
 * table for the world in order to render one string.
 */
export type StageGateJurisdiction = {
  country: string;
  /** Omitted for templates that apply nationwide. */
  subdivision?: string;
  label: string;
};

export type StageGateTemplateEvidence = {
  evidence_id: string;
  title: string;
  artifact_type: string;
  required: boolean;
  conditional_required_when?: string;
};

export type StageGateTemplateGate = {
  gate_id: string;
  sequence: number;
  name: string;
  lapm_mapping?: string[];
  stip_rtip_mapping?: string[];
  ceqa_vmt_mapping?: string[];
  outreach_mapping?: string[];
  required_evidence?: StageGateTemplateEvidence[];
};

/** The artifact itself, as authored in JSON. */
export type StageGateTemplateDocument = {
  template_id: string;
  template_name: string;
  version: string;
  jurisdiction: string;
  gate_order: string[];
  gates: StageGateTemplateGate[];
};

/** The validated header of an artifact plus the metadata supplied at registration. */
export type StageGateTemplateDescriptor = {
  templateId: string;
  templateName: string;
  templateVersion: string;
  /**
   * The flat jurisdiction code carried inside the artifact ("CA"). Retained
   * because it is already returned by the workspace/project APIs; new consumers
   * should prefer the structured `jurisdiction`, which disambiguates codes that
   * collide across countries (CA = California here, Canada in ISO 3166-1).
   */
  jurisdictionCode: string;
  jurisdiction: StageGateJurisdiction;
  /**
   * True for the one template applied when nothing has told us which
   * jurisdiction a workspace operates in. See `INTERIM_DEFAULT_RATIONALE`.
   */
  isInterimDefault: boolean;
};

export type StageGateTemplateEntry = {
  descriptor: StageGateTemplateDescriptor;
  document: StageGateTemplateDocument;
};

/** What a caller supplies to register a template. */
export type StageGateTemplateRegistration = {
  /** Raw artifact — validated here, so untrusted/DB-sourced JSON is acceptable. */
  artifact: unknown;
  jurisdiction: StageGateJurisdiction;
  isInterimDefault?: boolean;
};

export type StageGateTemplateRegistry = {
  /** Every registered template, in registration order. */
  list: () => readonly StageGateTemplateDescriptor[];
  get: (templateId: string) => StageGateTemplateEntry | null;
  /** The interim default's id, or null when the registry declares none. */
  defaultTemplateId: string | null;
};

/**
 * Why a default exists at all, in one place so the UI can quote it.
 *
 * There is currently no way to know a workspace's jurisdiction: workspaces have
 * no geography, and sign-up never asks. Until they do, a workspace that does not
 * name a template gets this one — and the binding says so, via
 * `templateSelection: "interim_unconfigured_default"`, so the product can
 * disclose the assumption instead of presenting California's gates as though the
 * workspace had chosen them.
 */
export const INTERIM_DEFAULT_RATIONALE =
  "No workspace jurisdiction is recorded yet, so an explicitly-labeled interim default template is applied and disclosed.";

function requireString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Stage-gate template artifact missing ${key}`);
  }
  return value;
}

function normalizeArtifact(artifact: unknown): StageGateTemplateDocument {
  if (typeof artifact !== "object" || artifact === null) {
    throw new Error("Stage-gate template artifact must be an object");
  }

  const raw = artifact as Record<string, unknown>;
  const templateId = requireString(raw, "template_id");
  const templateName = requireString(raw, "template_name");
  const version = requireString(raw, "version");
  const jurisdiction = requireString(raw, "jurisdiction");

  const gateOrder = raw.gate_order;
  if (!Array.isArray(gateOrder) || gateOrder.some((gateId) => typeof gateId !== "string")) {
    throw new Error(`Stage-gate template ${templateId} missing gate_order`);
  }

  const gates = raw.gates;
  if (!Array.isArray(gates) || gates.length === 0) {
    throw new Error(`Stage-gate template ${templateId} missing gates`);
  }

  return {
    template_id: templateId,
    template_name: templateName,
    version,
    jurisdiction,
    gate_order: gateOrder as string[],
    gates: gates as StageGateTemplateGate[],
  };
}

/**
 * Build a registry from registrations.
 *
 * Every failure here is a registration bug rather than a runtime condition, so
 * they throw: a registry that silently dropped a malformed or duplicate template
 * would leave a workspace bound to a template id nothing can resolve.
 */
export function createStageGateTemplateRegistry(
  registrations: readonly StageGateTemplateRegistration[]
): StageGateTemplateRegistry {
  const entries = new Map<string, StageGateTemplateEntry>();
  const descriptors: StageGateTemplateDescriptor[] = [];
  let defaultTemplateId: string | null = null;

  for (const registration of registrations) {
    const document = normalizeArtifact(registration.artifact);

    if (entries.has(document.template_id)) {
      throw new Error(`Duplicate stage-gate template registration: ${document.template_id}`);
    }

    // The artifact's own jurisdiction code and the structured registration must
    // agree, or a descriptor could advertise one jurisdiction while the gates
    // inside it encode another — the persisted code comes from the artifact.
    const expectedCode = registration.jurisdiction.subdivision ?? registration.jurisdiction.country;
    if (document.jurisdiction.toUpperCase() !== expectedCode.toUpperCase()) {
      throw new Error(
        `Stage-gate template ${document.template_id} declares jurisdiction "${document.jurisdiction}" but was registered as "${expectedCode}"`
      );
    }

    if (registration.isInterimDefault) {
      if (defaultTemplateId) {
        throw new Error(
          `Multiple stage-gate templates claim the interim default: ${defaultTemplateId}, ${document.template_id}`
        );
      }
      defaultTemplateId = document.template_id;
    }

    const descriptor: StageGateTemplateDescriptor = {
      templateId: document.template_id,
      templateName: document.template_name,
      templateVersion: document.version,
      jurisdictionCode: document.jurisdiction,
      jurisdiction: registration.jurisdiction,
      isInterimDefault: Boolean(registration.isInterimDefault),
    };

    descriptors.push(descriptor);
    entries.set(document.template_id, { descriptor, document });
  }

  return {
    list: () => descriptors,
    get: (templateId) => entries.get(templateId) ?? null,
    defaultTemplateId,
  };
}

/**
 * Templates shipped with the app.
 *
 * Adding a jurisdiction means adding its artifact under `templates/` and one
 * entry here. Nothing downstream changes: the loader, the summary builder, and
 * the APIs all address templates by id.
 */
export const BUILT_IN_STAGE_GATE_TEMPLATE_REGISTRATIONS: readonly StageGateTemplateRegistration[] = [
  {
    artifact: caStageGatesTemplate,
    jurisdiction: { country: "US", subdivision: "CA", label: "California, United States" },
    // First and (so far) only pack authored, so it carries the interim default
    // until workspaces can state their own jurisdiction. Not a statement that
    // California is OpenPlan's home jurisdiction.
    isInterimDefault: true,
  },
];

export const stageGateTemplateRegistry = createStageGateTemplateRegistry(
  BUILT_IN_STAGE_GATE_TEMPLATE_REGISTRATIONS
);
