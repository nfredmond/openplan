/**
 * Binds an invoice write (or an invoicing surface) to a reimbursement profile.
 *
 * The profiles themselves live in `reimbursement-profiles.ts`; this module
 * answers one question — "which profile does this caller get, and did it
 * actually choose it?" — and records the answer on the binding so the product
 * can be honest about the difference. It ports the selection semantics of
 * `src/lib/stage-gates/template-loader.ts`.
 *
 * There are three ways to get a profile, in descending order of authority:
 *
 *   1. the caller named one (`explicitly_requested`);
 *   2. the workspace's own jurisdiction has a registered profile
 *      (`jurisdiction_matched`) — this is what a workspace's home geography
 *      buys, and it is why every surface should hand its geography in;
 *   3. neither, so an explicitly-labeled interim default applies
 *      (`interim_unconfigured_default`), carrying the REASON it applied.
 *
 * Case 3 is not a silent fallback and must never be rendered as one: any
 * surface showing postures bound this way discloses
 * `INTERIM_DEFAULT_RATIONALE`, and the selection is persisted on the invoice
 * row so the register can keep saying it later.
 */

import {
  INTERIM_DEFAULT_RATIONALE,
  reimbursementProfileRegistry,
  type InvoicingJurisdictionQuery,
  type ReimbursementPostureOption,
  type ReimbursementProfileDescriptor,
  type ReimbursementProfileRegistry,
} from "@/lib/invoicing/reimbursement-profiles";

/**
 * Whether the bound profile was chosen, derived, or assumed.
 *
 * `interim_unconfigured_default` means nobody picked it — see
 * `INTERIM_DEFAULT_RATIONALE`. Any surface that shows postures bound this way
 * must disclose that the jurisdiction was assumed. The three values are also
 * the CHECK vocabulary of `billing_invoice_records.reimbursement_profile_selection`.
 */
export type ReimbursementProfileSelection =
  | "explicitly_requested"
  | "jurisdiction_matched"
  | "interim_unconfigured_default";

/**
 * Why an interim default applied. The three cases need different things from
 * the user, so collapsing them into one message would waste the disclosure:
 *
 *   - `no_workspace_jurisdiction`     → tell us where you work.
 *   - `no_profile_for_jurisdiction`   → we know where you work and have not
 *     authored your profile yet. Nothing the user can do; OpenPlan owes one.
 *   - `ambiguous_jurisdiction_profiles` → more than one profile covers you.
 */
export type ReimbursementInterimDefaultReason =
  | "no_workspace_jurisdiction"
  | "no_profile_for_jurisdiction"
  | "ambiguous_jurisdiction_profiles";

export type ReimbursementProfileBinding = {
  profileId: string;
  profileName: string;
  postureOptions: readonly ReimbursementPostureOption[];
  defaultPostureId: string;
  selection: ReimbursementProfileSelection;
  /** Null unless `selection` is `interim_unconfigured_default`. */
  interimDefaultReason: ReimbursementInterimDefaultReason | null;
  submittedToHint: string | null;
  formPackStatus: string | null;
};

/**
 * Resolution outcome. `unknown_profile` carries what was available so the
 * caller can say which profiles DO exist instead of a bare failure. An
 * unknown id is never resolved to the default — silently substituting a
 * jurisdiction the caller did not ask for is the failure mode this module
 * exists to prevent.
 */
export type ReimbursementProfileResolution =
  | { kind: "resolved"; binding: ReimbursementProfileBinding }
  | {
      kind: "unknown_profile";
      requestedProfileId: string;
      available: readonly ReimbursementProfileDescriptor[];
    };

export type ResolveReimbursementProfileOptions = {
  /** An explicit profile id outranks geography — a consultant may deliberately bill under another jurisdiction's process. */
  requestedProfileId?: string | null;
  /**
   * Where the workspace works, as `resolveJurisdiction()` reports it from the
   * workspace's home geography. `null` means the workspace has not said —
   * which is a fallback reason, never a licence to guess.
   */
  workspaceJurisdiction: InvoicingJurisdictionQuery | null;
  /** Defaults to the built-in registry; injectable for tests and future profile sources. */
  registry?: ReimbursementProfileRegistry;
};

export function resolveReimbursementProfile(
  options: ResolveReimbursementProfileOptions
): ReimbursementProfileResolution {
  const registry = options.registry ?? reimbursementProfileRegistry;
  const jurisdiction = normalizeJurisdictionQuery(options.workspaceJurisdiction);
  const requestedProfileId = options.requestedProfileId?.trim();

  if (requestedProfileId?.length) {
    const profile = registry.get(requestedProfileId);
    if (!profile) {
      return { kind: "unknown_profile", requestedProfileId, available: registry.list() };
    }
    return {
      kind: "resolved",
      binding: toBinding(profile, "explicitly_requested", null),
    };
  }

  if (jurisdiction) {
    const match = registry.findByJurisdiction(jurisdiction);
    if (match.kind === "matched") {
      return {
        kind: "resolved",
        binding: toBinding(match.profile, "jurisdiction_matched", null),
      };
    }

    return interimDefaultResolution(
      registry,
      match.kind === "ambiguous" ? "ambiguous_jurisdiction_profiles" : "no_profile_for_jurisdiction"
    );
  }

  return interimDefaultResolution(registry, "no_workspace_jurisdiction");
}

/** True when the posture id is one the profile actually declares. */
export function isValidPosture(
  postureOptions: readonly ReimbursementPostureOption[] | null | undefined,
  postureId: string | null | undefined
): boolean {
  if (!postureId?.trim()) return false;
  return (postureOptions ?? []).some((option) => option.postureId === postureId);
}

/**
 * The readable label for a posture id — the profile's own label when it
 * declares one, a humanized form of the raw id otherwise.
 *
 * The humanized fallback exists for rows written before the profile columns
 * existed (or under a profile this deployment no longer registers): the
 * register must still render the value the agency stored, never blank it.
 */
export function postureLabel(
  postureOptions: readonly ReimbursementPostureOption[] | null | undefined,
  postureId: string | null | undefined
): string {
  const trimmed = postureId?.trim();
  if (!trimmed) return "Not recorded";

  const declared = (postureOptions ?? []).find((option) => option.postureId === trimmed);
  if (declared) return declared.label;

  const words = trimmed.toLowerCase().split(/[_\s-]+/).filter(Boolean);
  if (words.length === 0) return "Not recorded";
  return [words[0].charAt(0).toUpperCase() + words[0].slice(1), ...words.slice(1)].join(" ");
}

export { INTERIM_DEFAULT_RATIONALE };

function normalizeJurisdictionQuery(
  query: InvoicingJurisdictionQuery | null | undefined
): InvoicingJurisdictionQuery | null {
  const country = query?.country?.trim().toUpperCase();
  if (!country) return null;
  const subdivision = query?.subdivision?.trim().toUpperCase();
  return { country, subdivision: subdivision || null };
}

function interimDefaultResolution(
  registry: ReimbursementProfileRegistry,
  interimDefaultReason: ReimbursementInterimDefaultReason
): ReimbursementProfileResolution {
  const fallback = registry.defaultProfileId ? registry.get(registry.defaultProfileId) : null;

  // A registry with no interim default cannot answer an unconfigured caller at
  // all. That is a registration bug (the built-in registry always declares
  // one), not a runtime condition a caller should branch on, so it throws.
  if (!fallback) {
    throw new Error("No reimbursement profile is registered as the interim default");
  }

  return {
    kind: "resolved",
    binding: toBinding(fallback, "interim_unconfigured_default", interimDefaultReason),
  };
}

function toBinding(
  descriptor: ReimbursementProfileDescriptor,
  selection: ReimbursementProfileSelection,
  interimDefaultReason: ReimbursementInterimDefaultReason | null
): ReimbursementProfileBinding {
  return {
    profileId: descriptor.profileId,
    profileName: descriptor.profileName,
    postureOptions: descriptor.postureOptions,
    defaultPostureId: descriptor.defaultPostureId,
    selection,
    interimDefaultReason,
    submittedToHint: descriptor.submittedToHint ?? null,
    formPackStatus: descriptor.formPackStatus ?? null,
  };
}
