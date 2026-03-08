import caStageGatesTemplate from "@/lib/stage-gates/templates/ca_stage_gates_v0.1.json";

export const DEFAULT_STAGE_GATE_TEMPLATE_ID = "ca_stage_gates_v0_1" as const;

export type StageGateBindingMode = "workspace_bootstrap_interim" | "project_create_v0_2";

export type StageGateTemplateBinding = {
  templateId: string;
  templateVersion: string;
  jurisdiction: string;
  bindingMode: StageGateBindingMode;
  lapmFormIdsStatus: "deferred_to_v0_2";
};

type StageGateTemplateArtifact = {
  template_id?: unknown;
  version?: unknown;
  jurisdiction?: unknown;
};

function normalizeTemplateArtifact(raw: StageGateTemplateArtifact): {
  templateId: string;
  templateVersion: string;
  jurisdiction: string;
} {
  if (typeof raw.template_id !== "string" || raw.template_id.trim().length === 0) {
    throw new Error("Stage-gate template artifact missing template_id");
  }

  if (typeof raw.version !== "string" || raw.version.trim().length === 0) {
    throw new Error("Stage-gate template artifact missing version");
  }

  if (typeof raw.jurisdiction !== "string" || raw.jurisdiction.trim().length === 0) {
    throw new Error("Stage-gate template artifact missing jurisdiction");
  }

  return {
    templateId: raw.template_id,
    templateVersion: raw.version,
    jurisdiction: raw.jurisdiction,
  };
}

const caTemplate = normalizeTemplateArtifact(caStageGatesTemplate as StageGateTemplateArtifact);

const templateRegistry = new Map<string, typeof caTemplate>([[caTemplate.templateId, caTemplate]]);

export function resolveStageGateTemplateBinding(
  requestedTemplateId?: string,
  options?: { bindingMode?: StageGateBindingMode }
): StageGateTemplateBinding {
  const normalizedRequestedTemplateId = requestedTemplateId?.trim();
  const templateId = normalizedRequestedTemplateId?.length
    ? normalizedRequestedTemplateId
    : DEFAULT_STAGE_GATE_TEMPLATE_ID;

  const template = templateRegistry.get(templateId);
  if (!template) {
    throw new Error(`Unsupported stage-gate template: ${templateId}`);
  }

  const bindingMode = options?.bindingMode ?? "workspace_bootstrap_interim";

  return {
    templateId: template.templateId,
    templateVersion: template.templateVersion,
    jurisdiction: template.jurisdiction,
    bindingMode,
    lapmFormIdsStatus: "deferred_to_v0_2",
  };
}
