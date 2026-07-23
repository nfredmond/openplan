/**
 * Binds a workspace or project to a stage-gate template.
 *
 * The templates themselves live in `template-registry.ts`; this module answers
 * one question — "which template does this caller get, and did it actually
 * choose it?" — and records the answer on the binding so the product can be
 * honest about the difference.
 */

import {
  INTERIM_DEFAULT_RATIONALE,
  stageGateTemplateRegistry,
  type StageGateTemplateDescriptor,
  type StageGateTemplateRegistry,
} from "@/lib/stage-gates/template-registry";

/**
 * The template applied when a caller names none.
 *
 * Derived from the registry rather than written down, so registering a
 * different interim default is a data change. Callers that persist a template id
 * should persist the resolved binding's `templateId`, not this constant.
 */
export const DEFAULT_STAGE_GATE_TEMPLATE_ID: string =
  stageGateTemplateRegistry.defaultTemplateId ?? "";

export type StageGateBindingMode = "workspace_bootstrap_interim" | "project_create_v0_2";

/**
 * Whether the bound template was chosen or assumed.
 *
 * `interim_unconfigured_default` means nobody picked it — see
 * `INTERIM_DEFAULT_RATIONALE`. Any surface that shows gates bound this way must
 * disclose that the jurisdiction was assumed, and offer a way to change it.
 */
export type StageGateTemplateSelection = "explicitly_requested" | "interim_unconfigured_default";

export type StageGateTemplateBinding = {
  templateId: string;
  templateName: string;
  templateVersion: string;
  /** Flat code as persisted/returned today; `jurisdictionLabel` is the readable form. */
  jurisdiction: string;
  jurisdictionLabel: string;
  bindingMode: StageGateBindingMode;
  templateSelection: StageGateTemplateSelection;
  /**
   * California-specific holdover: LAPM form ids were deferred past v0.2. It is
   * on every binding regardless of jurisdiction because the workspace and
   * project APIs already return it. It belongs on the template descriptor, not
   * on the binding — do not read new meaning into it for other jurisdictions.
   */
  lapmFormIdsStatus: "deferred_to_v0_2";
};

/**
 * Resolution outcome. The two unresolved cases carry what was available so the
 * caller can say which templates *do* exist instead of a bare failure.
 */
export type StageGateTemplateResolution =
  | { kind: "resolved"; binding: StageGateTemplateBinding }
  | {
      kind: "unknown_template";
      requestedTemplateId: string;
      available: readonly StageGateTemplateDescriptor[];
    }
  | { kind: "no_default_template"; available: readonly StageGateTemplateDescriptor[] };

export type StageGateTemplateResolveOptions = {
  bindingMode?: StageGateBindingMode;
  /** Defaults to the built-in registry; injectable for tests and future template sources. */
  registry?: StageGateTemplateRegistry;
};

/**
 * Resolve a template binding without throwing.
 *
 * An unknown id is a caller-handleable outcome, not an exception: the caller
 * decides whether to reject the request or offer the available templates. It is
 * never resolved to the default — silently substituting a jurisdiction the
 * caller did not ask for is the failure mode this module exists to prevent.
 */
export function resolveStageGateTemplate(
  requestedTemplateId?: string,
  options?: StageGateTemplateResolveOptions
): StageGateTemplateResolution {
  const registry = options?.registry ?? stageGateTemplateRegistry;
  const bindingMode = options?.bindingMode ?? "workspace_bootstrap_interim";
  const normalizedRequestedTemplateId = requestedTemplateId?.trim();

  if (!normalizedRequestedTemplateId?.length) {
    if (!registry.defaultTemplateId) {
      return { kind: "no_default_template", available: registry.list() };
    }

    const fallback = registry.get(registry.defaultTemplateId);
    if (!fallback) {
      return { kind: "no_default_template", available: registry.list() };
    }

    return {
      kind: "resolved",
      binding: toBinding(fallback.descriptor, bindingMode, "interim_unconfigured_default"),
    };
  }

  const entry = registry.get(normalizedRequestedTemplateId);
  if (!entry) {
    return {
      kind: "unknown_template",
      requestedTemplateId: normalizedRequestedTemplateId,
      available: registry.list(),
    };
  }

  return {
    kind: "resolved",
    binding: toBinding(entry.descriptor, bindingMode, "explicitly_requested"),
  };
}

/**
 * Throwing wrapper kept for the workspace-bootstrap, admin-provisioning, and
 * project-create routes, which already catch it and return 400. New callers
 * should use `resolveStageGateTemplate` and handle the unresolved cases
 * explicitly — they can then tell the operator which templates exist.
 */
export function resolveStageGateTemplateBinding(
  requestedTemplateId?: string,
  options?: StageGateTemplateResolveOptions
): StageGateTemplateBinding {
  const resolution = resolveStageGateTemplate(requestedTemplateId, options);

  if (resolution.kind === "unknown_template") {
    throw new Error(`Unsupported stage-gate template: ${resolution.requestedTemplateId}`);
  }

  if (resolution.kind === "no_default_template") {
    throw new Error("No stage-gate template is registered");
  }

  return resolution.binding;
}

/** Every registered template — the source for a jurisdiction picker. */
export function listStageGateTemplates(
  registry: StageGateTemplateRegistry = stageGateTemplateRegistry
): readonly StageGateTemplateDescriptor[] {
  return registry.list();
}

export { INTERIM_DEFAULT_RATIONALE };

function toBinding(
  descriptor: StageGateTemplateDescriptor,
  bindingMode: StageGateBindingMode,
  templateSelection: StageGateTemplateSelection
): StageGateTemplateBinding {
  return {
    templateId: descriptor.templateId,
    templateName: descriptor.templateName,
    templateVersion: descriptor.templateVersion,
    jurisdiction: descriptor.jurisdictionCode,
    jurisdictionLabel: descriptor.jurisdiction.label,
    bindingMode,
    templateSelection,
    lapmFormIdsStatus: "deferred_to_v0_2",
  };
}
