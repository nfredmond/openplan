/**
 * Binds a workspace or project to a stage-gate template.
 *
 * The templates themselves live in `template-registry.ts`; this module answers
 * one question — "which template does this caller get, and did it actually
 * choose it?" — and records the answer on the binding so the product can be
 * honest about the difference.
 *
 * There are three ways to get a template, in descending order of authority:
 *
 *   1. the caller named one (`explicitly_requested`);
 *   2. the workspace's own jurisdiction has a registered pack
 *      (`jurisdiction_matched`) — this is what a workspace's home geography
 *      buys, and it is why every surface should hand its geography in;
 *   3. neither, so an explicitly-labeled interim default applies
 *      (`interim_unconfigured_default`), carrying the REASON it applied.
 *
 * Case 3 is not a silent fallback and must never be rendered as one. See
 * `describeStageGateBinding`, which produces the sentence a planner has to be
 * shown before they act on gates nobody chose for them.
 */

import {
  INTERIM_DEFAULT_RATIONALE,
  stageGateTemplateRegistry,
  type StageGateJurisdictionQuery,
  type StageGateTemplateDescriptor,
  type StageGateTemplateRegistry,
} from "@/lib/stage-gates/template-registry";
import {
  parseWorkspaceHomeGeography,
  resolveJurisdiction,
} from "@/lib/workspaces/home-geography";

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
 * Whether the bound template was chosen, derived, or assumed.
 *
 * `interim_unconfigured_default` means nobody picked it — see
 * `INTERIM_DEFAULT_RATIONALE`. Any surface that shows gates bound this way must
 * disclose that the jurisdiction was assumed, and offer a way to change it.
 */
export type StageGateTemplateSelection =
  | "explicitly_requested"
  | "jurisdiction_matched"
  | "interim_unconfigured_default";

/**
 * Why an interim default applied. The three cases need different things from the
 * user, so collapsing them into one message would waste the disclosure:
 *
 *   - `no_workspace_jurisdiction`  → tell us where you work.
 *   - `no_template_for_jurisdiction` → we know where you work and have not
 *     authored your pack yet. Nothing the user can do; OpenPlan owes them one.
 *   - `ambiguous_jurisdiction_templates` → more than one pack covers you; pick.
 */
export type StageGateInterimDefaultReason =
  | "no_workspace_jurisdiction"
  | "no_template_for_jurisdiction"
  | "ambiguous_jurisdiction_templates";

export type StageGateTemplateBinding = {
  templateId: string;
  templateName: string;
  templateVersion: string;
  /** Flat code as persisted/returned today; `jurisdictionLabel` is the readable form. */
  jurisdiction: string;
  jurisdictionLabel: string;
  bindingMode: StageGateBindingMode;
  templateSelection: StageGateTemplateSelection;
  /** Null unless `templateSelection` is `interim_unconfigured_default`. */
  interimDefaultReason: StageGateInterimDefaultReason | null;
  /**
   * The workspace jurisdiction the resolver was given, or null when the caller
   * could not state one. Kept on the binding so a surface can say "we know you
   * are in US-OH and have no Ohio pack" rather than the vaguer "no jurisdiction".
   */
  workspaceJurisdiction: StageGateJurisdictionQuery | null;
  /**
   * Declared by the bound template, not by the binder: `null` for any template
   * whose jurisdiction has no Caltrans LAPM forms. It used to be a literal
   * stamped on every binding, which reported a California form-set status to
   * agencies nowhere near California.
   */
  lapmFormIdsStatus: string | null;
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
  /**
   * Where the workspace works, as `resolveJurisdiction()` reports it from the
   * workspace's home geography. `null`/omitted means the workspace has not said
   * — which is a fallback reason, never a licence to guess.
   */
  jurisdiction?: StageGateJurisdictionQuery | null;
};

/**
 * Resolve a template binding without throwing.
 *
 * An unknown id is a caller-handleable outcome, not an exception: the caller
 * decides whether to reject the request or offer the available templates. It is
 * never resolved to the default — silently substituting a jurisdiction the
 * caller did not ask for is the failure mode this module exists to prevent.
 *
 * With no requested id, the workspace's own jurisdiction decides; only when that
 * yields nothing does the labeled interim default apply.
 */
export function resolveStageGateTemplate(
  requestedTemplateId?: string,
  options?: StageGateTemplateResolveOptions
): StageGateTemplateResolution {
  const registry = options?.registry ?? stageGateTemplateRegistry;
  const bindingMode = options?.bindingMode ?? "workspace_bootstrap_interim";
  const jurisdiction = normalizeJurisdictionQuery(options?.jurisdiction);
  const normalizedRequestedTemplateId = requestedTemplateId?.trim();

  // An explicit id outranks geography: an agency that works in one place may
  // deliberately deliver under another jurisdiction's process (a consultant, a
  // federally-funded project, a tribe electing a state's checklist).
  if (normalizedRequestedTemplateId?.length) {
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
      binding: toBinding(entry.descriptor, {
        bindingMode,
        templateSelection: "explicitly_requested",
        interimDefaultReason: null,
        workspaceJurisdiction: jurisdiction,
      }),
    };
  }

  if (jurisdiction) {
    const match = registry.findByJurisdiction(jurisdiction);
    if (match.kind === "matched") {
      return {
        kind: "resolved",
        binding: toBinding(match.entry.descriptor, {
          bindingMode,
          templateSelection: "jurisdiction_matched",
          interimDefaultReason: null,
          workspaceJurisdiction: jurisdiction,
        }),
      };
    }

    return interimDefaultResolution(registry, bindingMode, jurisdiction, {
      ambiguous: match.kind === "ambiguous",
    });
  }

  return interimDefaultResolution(registry, bindingMode, null, { ambiguous: false });
}

/**
 * Resolve from a workspace row that carries the home-geography columns.
 *
 * This is the seam every workspace-aware caller should use: hand it the row and
 * the jurisdiction question is answered the same way everywhere. A row with no
 * geography resolves to the labeled interim default, exactly as a caller that
 * passes no jurisdiction at all does.
 */
export function resolveStageGateTemplateForWorkspace(
  workspaceRow: unknown,
  requestedTemplateId?: string,
  options?: Omit<StageGateTemplateResolveOptions, "jurisdiction">
): StageGateTemplateResolution {
  return resolveStageGateTemplate(requestedTemplateId, {
    ...options,
    jurisdiction: resolveJurisdiction(parseWorkspaceHomeGeography(workspaceRow)),
  });
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

/**
 * The sentence a planner must be shown alongside gates they did not choose.
 *
 * Returned for every binding, not only the assumed ones, so a surface renders
 * one thing unconditionally and cannot forget the disclosure by forgetting a
 * branch. `isJurisdictionAssumed` is the flag that decides how loudly.
 */
export type StageGateBindingDisclosure = {
  /** True only for `interim_unconfigured_default`. */
  isJurisdictionAssumed: boolean;
  headline: string;
  detail: string;
  /** What the reader can do about it, or null when there is nothing to do. */
  action: string | null;
};

export function describeStageGateBinding(
  binding: StageGateTemplateBinding
): StageGateBindingDisclosure {
  const known = formatJurisdictionQuery(binding.workspaceJurisdiction);

  if (binding.templateSelection === "explicitly_requested") {
    return {
      isJurisdictionAssumed: false,
      headline: `Stage gates: ${binding.jurisdictionLabel}`,
      detail: `This workspace was bound to the ${binding.templateName} template because it asked for it.`,
      action: null,
    };
  }

  if (binding.templateSelection === "jurisdiction_matched") {
    return {
      isJurisdictionAssumed: false,
      headline: `Stage gates: ${binding.jurisdictionLabel}`,
      detail: `These gates come from the template registered for this workspace's own jurisdiction (${known ?? binding.jurisdiction}).`,
      action: null,
    };
  }

  const headline = `Interim default gates — not ${known ? `${known}'s` : "your jurisdiction's"}`;

  if (binding.interimDefaultReason === "no_template_for_jurisdiction") {
    return {
      isJurisdictionAssumed: true,
      headline,
      detail: `OpenPlan has no stage-gate template for ${known} yet, so this workspace is showing the ${binding.jurisdictionLabel} template as an interim default. Its gates and evidence requirements are ${binding.jurisdictionLabel}'s, not this workspace's, and must not be treated as this jurisdiction's requirements.`,
      action: `Choose a registered template that matches how this agency delivers, or track it as a gap until a ${known} pack exists.`,
    };
  }

  if (binding.interimDefaultReason === "ambiguous_jurisdiction_templates") {
    return {
      isJurisdictionAssumed: true,
      headline,
      detail: `More than one registered stage-gate template covers ${known}, so none was chosen automatically and this workspace is showing the ${binding.jurisdictionLabel} template as an interim default.`,
      action: "Pick the template this agency actually delivers under.",
    };
  }

  return {
    isJurisdictionAssumed: true,
    headline,
    detail: `This workspace has not stated where it works, so it is showing the ${binding.jurisdictionLabel} template as an interim default. Its gates and evidence requirements are ${binding.jurisdictionLabel}'s and were not chosen for this workspace.`,
    action: "Set the workspace's home geography so its gates come from its own jurisdiction.",
  };
}

/** "US-OH" / "US" — the readable form of what the resolver was told. */
function formatJurisdictionQuery(query: StageGateJurisdictionQuery | null): string | null {
  if (!query) return null;
  return query.subdivision ? `${query.country}-${query.subdivision}` : query.country;
}

function normalizeJurisdictionQuery(
  query: StageGateJurisdictionQuery | null | undefined
): StageGateJurisdictionQuery | null {
  const country = query?.country?.trim().toUpperCase();
  if (!country) return null;
  const subdivision = query?.subdivision?.trim().toUpperCase();
  return { country, subdivision: subdivision || null };
}

function interimDefaultResolution(
  registry: StageGateTemplateRegistry,
  bindingMode: StageGateBindingMode,
  jurisdiction: StageGateJurisdictionQuery | null,
  context: { ambiguous: boolean }
): StageGateTemplateResolution {
  if (!registry.defaultTemplateId) {
    return { kind: "no_default_template", available: registry.list() };
  }

  const fallback = registry.get(registry.defaultTemplateId);
  if (!fallback) {
    return { kind: "no_default_template", available: registry.list() };
  }

  const interimDefaultReason: StageGateInterimDefaultReason = !jurisdiction
    ? "no_workspace_jurisdiction"
    : context.ambiguous
      ? "ambiguous_jurisdiction_templates"
      : "no_template_for_jurisdiction";

  return {
    kind: "resolved",
    binding: toBinding(fallback.descriptor, {
      bindingMode,
      templateSelection: "interim_unconfigured_default",
      interimDefaultReason,
      workspaceJurisdiction: jurisdiction,
    }),
  };
}

function toBinding(
  descriptor: StageGateTemplateDescriptor,
  provenance: {
    bindingMode: StageGateBindingMode;
    templateSelection: StageGateTemplateSelection;
    interimDefaultReason: StageGateInterimDefaultReason | null;
    workspaceJurisdiction: StageGateJurisdictionQuery | null;
  }
): StageGateTemplateBinding {
  return {
    templateId: descriptor.templateId,
    templateName: descriptor.templateName,
    templateVersion: descriptor.templateVersion,
    jurisdiction: descriptor.jurisdictionCode,
    jurisdictionLabel: descriptor.jurisdiction.label,
    bindingMode: provenance.bindingMode,
    templateSelection: provenance.templateSelection,
    interimDefaultReason: provenance.interimDefaultReason,
    workspaceJurisdiction: provenance.workspaceJurisdiction,
    lapmFormIdsStatus: descriptor.lapmFormIdsStatus ?? null,
  };
}
