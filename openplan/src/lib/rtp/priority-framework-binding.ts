/**
 * Binding a workspace to the RTP priority framework whose law it may cite.
 *
 * The authority order mirrors the reimbursement-profile and stage-gate
 * registries: an explicit request outranks geography, geography outranks
 * everything else, and everything else is NOT a guess.
 *
 * The one deliberate difference from those two: there is no interim default
 * here. A workspace that has not said where it works gets no citations at all,
 * rather than the United States federal framework. Falling back to a country
 * would assume the United States — the exact assumption the product
 * constraints forbid — and unlike a reimbursement profile, whose absence
 * blocks an invoice, an absent citation costs nothing. The plan still scores,
 * ranks, exports and publishes; it just does not tell residents which law
 * says so until someone tells it where the agency is.
 */
import { resolveJurisdiction, type WorkspaceHomeGeography } from "@/lib/workspaces/home-geography";
import {
  createRtpPriorityFrameworkRegistry,
  resolveRtpPriorityCriteria,
  type ResolvedRtpPriorityCriterion,
  type RtpPriorityFrameworkDescriptor,
  type RtpPriorityFrameworkRegistry,
  type RtpPriorityJurisdictionQuery,
} from "./priority-frameworks";
import { US_CA_RTP_PRIORITY_FRAMEWORK } from "./frameworks/us-ca";
import { US_FEDERAL_GENERIC_RTP_PRIORITY_FRAMEWORK } from "./frameworks/us-federal-generic";

export const rtpPriorityFrameworkRegistry: RtpPriorityFrameworkRegistry =
  createRtpPriorityFrameworkRegistry([
    US_FEDERAL_GENERIC_RTP_PRIORITY_FRAMEWORK,
    US_CA_RTP_PRIORITY_FRAMEWORK,
  ]);

export type RtpPriorityFrameworkSelection =
  | "explicitly_requested"
  | "jurisdiction_matched"
  | "uncited";

export type RtpPriorityUncitedReason =
  | "no_workspace_jurisdiction"
  | "no_framework_for_jurisdiction"
  | "ambiguous_frameworks";

export interface RtpPriorityFrameworkBinding {
  /** Null when nothing covers the workspace — criteria still resolve, with null bases. */
  framework: RtpPriorityFrameworkDescriptor | null;
  selection: RtpPriorityFrameworkSelection;
  /** Null unless `selection` is `uncited`. */
  uncitedReason: RtpPriorityUncitedReason | null;
  /** The taxonomy with this binding's policy bases attached. */
  criteria: readonly ResolvedRtpPriorityCriterion[];
}

export type ResolveRtpPriorityFrameworkOptions = {
  /** An explicit framework id outranks geography. */
  requestedFrameworkId?: string | null;
  /**
   * Where the workspace works, as `resolveJurisdiction()` reports it. `null`
   * means the workspace has not said — a reason to withhold citations, never
   * a licence to pick a country.
   */
  workspaceJurisdiction: RtpPriorityJurisdictionQuery | null;
  /** Defaults to the built-in registry; injectable for tests. */
  registry?: RtpPriorityFrameworkRegistry;
};

function bind(
  framework: RtpPriorityFrameworkDescriptor | null,
  selection: RtpPriorityFrameworkSelection,
  uncitedReason: RtpPriorityUncitedReason | null
): RtpPriorityFrameworkBinding {
  return { framework, selection, uncitedReason, criteria: resolveRtpPriorityCriteria(framework) };
}

export function resolveRtpPriorityFramework(
  options: ResolveRtpPriorityFrameworkOptions
): RtpPriorityFrameworkBinding {
  const registry = options.registry ?? rtpPriorityFrameworkRegistry;
  const requestedFrameworkId = options.requestedFrameworkId?.trim();

  if (requestedFrameworkId) {
    const framework = registry.byId(requestedFrameworkId);
    // An unknown id withholds citations rather than falling back to
    // geography: the caller asked for a specific body of law, and quietly
    // answering with a different one is the substitution this module prevents.
    if (!framework) return bind(null, "uncited", "no_framework_for_jurisdiction");
    return bind(framework, "explicitly_requested", null);
  }

  const jurisdiction = options.workspaceJurisdiction;
  if (!jurisdiction?.country?.trim()) {
    return bind(null, "uncited", "no_workspace_jurisdiction");
  }

  const matches = registry.findByJurisdiction(jurisdiction);
  if (matches.length === 1) return bind(matches[0], "jurisdiction_matched", null);
  if (matches.length > 1) return bind(null, "uncited", "ambiguous_frameworks");
  return bind(null, "uncited", "no_framework_for_jurisdiction");
}

/** Convenience for the common case: bind straight from a workspace's home geography row. */
export function resolveRtpPriorityFrameworkForWorkspace(
  geo: WorkspaceHomeGeography | null | undefined,
  options?: { requestedFrameworkId?: string | null; registry?: RtpPriorityFrameworkRegistry }
): RtpPriorityFrameworkBinding {
  return resolveRtpPriorityFramework({
    requestedFrameworkId: options?.requestedFrameworkId ?? null,
    workspaceJurisdiction: resolveJurisdiction(geo),
    registry: options?.registry,
  });
}

export interface RtpPriorityFrameworkDisclosure {
  /** True when the plan cites no law, so a surface can decide whether to explain itself. */
  isUncited: boolean;
  headline: string;
  detail: string;
  /** What a planner can do about it; null when nothing is required. */
  action: string | null;
}

const UNCITED_DETAIL: Record<RtpPriorityUncitedReason, string> = {
  no_workspace_jurisdiction:
    "This workspace has not recorded where it works, so OpenPlan cannot tell which body of law applies to it.",
  no_framework_for_jurisdiction:
    "No policy framework has been registered for this workspace's jurisdiction yet.",
  ambiguous_frameworks:
    "More than one policy framework claims this workspace's jurisdiction, so none was applied.",
};

export function describeRtpPriorityFrameworkBinding(
  binding: RtpPriorityFrameworkBinding
): RtpPriorityFrameworkDisclosure {
  if (!binding.framework) {
    const reason = binding.uncitedReason ?? "no_framework_for_jurisdiction";
    return {
      isUncited: true,
      headline: "Priority scores cite no policy basis",
      detail: `${UNCITED_DETAIL[reason]} Projects are still scored and ranked; the plan simply does not state which statute or regulation each priority answers to.`,
      action:
        reason === "no_workspace_jurisdiction"
          ? "Set this workspace's home geography to cite the law that applies to it."
          : null,
    };
  }

  return {
    isUncited: false,
    headline: `Priority basis: ${binding.framework.label}`,
    detail: binding.framework.framingNote,
    action: null,
  };
}
