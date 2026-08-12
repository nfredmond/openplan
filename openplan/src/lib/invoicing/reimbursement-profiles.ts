/**
 * Reimbursement-profile registry.
 *
 * A reimbursement profile is a *data artifact*: the posture vocabulary an
 * agency logs a grant-reimbursement draw under, plus where such a packet is
 * typically submitted, under one jurisdiction's rules. The California pack
 * (under `profiles/`) is the first one OpenPlan ships. It is not the only
 * shape a profile may take, and nothing in this module may assume it — a
 * profile for Ohio, for Ontario, or for a tribe's own reimbursement process
 * must be addable as a descriptor, never as an edit to a call site.
 *
 * The design deliberately mirrors `src/lib/stage-gates/template-registry.ts`
 * (which in turn mirrors `src/lib/safety/sources/registry.ts`):
 *
 *   - coverage grows by adding a registration entry, not by editing consumers;
 *   - the resolver returns an explicit "no profile" result rather than quietly
 *     substituting whatever profile happens to be loaded.
 *
 * That second rule is the load-bearing one. Binding a workspace to another
 * jurisdiction's reimbursement vocabulary it did not choose would put the
 * wrong funder's posture list in front of a planner and look entirely
 * plausible while doing it. An unresolved profile is an answer the caller must
 * handle; it is never a default.
 *
 * `createReimbursementProfileRegistry` is exported separately from the
 * built-in instance so a future workspace-authored or database-backed profile
 * set can be built into a registry without this file changing.
 */

import { US_CA_LAPM_REIMBURSEMENT_PROFILE } from "@/lib/invoicing/profiles/us-ca-lapm";
import { US_FEDERAL_GENERIC_REIMBURSEMENT_PROFILE } from "@/lib/invoicing/profiles/us-federal-generic";

/**
 * Where a profile's rules come from, expressed so the core stays
 * country-neutral: ISO 3166-1 alpha-2 for the country, ISO 3166-2 subdivision
 * code (without the country prefix) when the profile is subdivision-scoped.
 *
 * `label` is what a planner reads. It is carried here rather than derived,
 * because deriving "California" from "US-CA" would mean shipping a
 * code-to-name table for the world in order to render one string.
 */
export type InvoicingJurisdiction = {
  country: string;
  /** Omitted for profiles that apply nationwide. */
  subdivision?: string;
  label: string;
};

/**
 * What a caller knows about a workspace's own jurisdiction when asking which
 * profile covers it.
 *
 * Deliberately looser than `InvoicingJurisdiction`: it carries no label, and
 * `subdivision` may be null, which is a meaningful state — "this workspace is
 * in this country, but which subdivision is not established". It is the shape
 * `resolveJurisdiction()` in src/lib/workspaces/home-geography.ts returns, so
 * a workspace's home geography can be handed here without translation.
 */
export type InvoicingJurisdictionQuery = {
  country: string;
  subdivision?: string | null;
};

/** One way a reimbursement draw can be postured under a profile's process. */
export type ReimbursementPostureOption = {
  postureId: string;
  label: string;
  description?: string;
};

/**
 * One item a profile asks an agency to have in hand before submitting a
 * reimbursement packet. Guidance, never applied data: OpenPlan does not check
 * these off, it shows them where a draw is being logged.
 */
export type ReimbursementDocumentationChecklistItem = {
  key: string;
  label: string;
  guidance: string;
};

export type ReimbursementProfileDescriptor = {
  profileId: string;
  profileName: string;
  version: string;
  jurisdiction: InvoicingJurisdiction;
  postureOptions: readonly ReimbursementPostureOption[];
  defaultPostureId: string;
  /** Where a packet under this process is typically submitted — a hint, never applied data. */
  submittedToHint?: string;
  /**
   * The profile's own statement about its exact form pack (e.g. that exact
   * form ids are deferred). Declared here, on the profile, precisely so that a
   * jurisdiction with no such form pack does not declare one.
   */
  formPackStatus?: string;
  /**
   * A profile's own honesty disclosure, rendered wherever the profile's
   * postures are offered — e.g. that generic practice never outranks the
   * executed funding agreement. Optional so profiles that need no framing
   * (a specific funder's own process) declare none.
   */
  framingNote?: string;
  /**
   * What an agency should have in hand before submitting a packet under this
   * process. Guidance shown at the point of entry, never validated or applied
   * data. Optional for the same reason as `framingNote`.
   */
  documentationChecklist?: readonly ReimbursementDocumentationChecklistItem[];
  /**
   * ISO-4217 code for the money a packet under this process is claimed in.
   *
   * Declared on the PROFILE because the currency is a property of the funding
   * process, not of OpenPlan: a draw is denominated in whatever the funder
   * pays. Every money figure on a reimbursement worksheet used to be formatted
   * `currency: "USD"` with nothing on the document naming a currency at all, so
   * a packet for a funder outside the United States printed plausible-looking
   * amounts under the wrong unit and said nothing about it.
   *
   * Optional, and its absence is DISCLOSED rather than silently defaulted: a
   * packet whose profile declares no currency says that it is showing US
   * dollars and that the process did not state one. "Defaulting to USD" is only
   * honest if the reader is told it happened.
   */
  currencyCode?: string;
  /**
   * True for the one profile applied when nothing has told us which
   * jurisdiction a workspace operates in. See `INTERIM_DEFAULT_RATIONALE`.
   */
  isInterimDefault: boolean;
};

/**
 * Outcome of asking which profile covers a jurisdiction.
 *
 * `ambiguous` exists so the registry never picks arbitrarily between two
 * profiles that cover the same place equally well. Silently binding whichever
 * was registered first would log one funder's postures against another
 * funder's draws with nothing to indicate a choice was made.
 */
export type ReimbursementJurisdictionMatch =
  | { kind: "matched"; profile: ReimbursementProfileDescriptor }
  | { kind: "ambiguous"; profiles: readonly ReimbursementProfileDescriptor[] }
  | { kind: "no_profile" };

export type ReimbursementProfileRegistry = {
  /** Every registered profile, in registration order. */
  list: () => readonly ReimbursementProfileDescriptor[];
  get: (profileId: string) => ReimbursementProfileDescriptor | null;
  /**
   * Which registered profile covers a jurisdiction — the lookup that lets a
   * workspace's own geography choose its reimbursement vocabulary instead of
   * inheriting whichever pack shipped first. Never returns the interim default
   * as a consolation prize; "no profile" is an answer the caller must handle.
   */
  findByJurisdiction: (jurisdiction: InvoicingJurisdictionQuery) => ReimbursementJurisdictionMatch;
  /** The interim default's id, or null when the registry declares none. */
  defaultProfileId: string | null;
};

/**
 * Why a default exists at all, in one place so the UI can quote it.
 *
 * A workspace can state where it works (its home geography), and
 * `findByJurisdiction` binds it to a profile authored for that jurisdiction
 * when one is registered. The default covers what is left: a workspace that
 * has not stated a geography, and a workspace whose jurisdiction OpenPlan has
 * not authored a profile for yet. Neither is a reason to present another
 * jurisdiction's reimbursement process as chosen — every binding that lands
 * here is marked `selection: "interim_unconfigured_default"` and carries the
 * reason.
 */
export const INTERIM_DEFAULT_RATIONALE =
  "No reimbursement profile is registered for this workspace's jurisdiction, so an explicitly-labeled interim default profile is applied and disclosed.";

/** Trim-and-upcase a jurisdiction code, treating blank as absent. */
function normalizeJurisdictionPart(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toUpperCase();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function validateDescriptor(descriptor: ReimbursementProfileDescriptor): void {
  if (!descriptor.profileId?.trim()) {
    throw new Error("Reimbursement profile descriptor missing profileId");
  }
  if (!descriptor.profileName?.trim()) {
    throw new Error(`Reimbursement profile ${descriptor.profileId} missing profileName`);
  }
  if (!descriptor.postureOptions?.length) {
    throw new Error(`Reimbursement profile ${descriptor.profileId} declares no posture options`);
  }

  const seenPostureIds = new Set<string>();
  for (const option of descriptor.postureOptions) {
    if (!option.postureId?.trim() || !option.label?.trim()) {
      throw new Error(`Reimbursement profile ${descriptor.profileId} has a posture option missing id or label`);
    }
    if (seenPostureIds.has(option.postureId)) {
      throw new Error(`Reimbursement profile ${descriptor.profileId} declares duplicate posture ${option.postureId}`);
    }
    seenPostureIds.add(option.postureId);
  }

  if (!seenPostureIds.has(descriptor.defaultPostureId)) {
    throw new Error(
      `Reimbursement profile ${descriptor.profileId} declares default posture "${descriptor.defaultPostureId}" but no such posture option`
    );
  }

  if (!normalizeJurisdictionPart(descriptor.jurisdiction?.country)) {
    throw new Error(`Reimbursement profile ${descriptor.profileId} missing jurisdiction country`);
  }

  const seenChecklistKeys = new Set<string>();
  for (const item of descriptor.documentationChecklist ?? []) {
    if (!item.key?.trim() || !item.label?.trim() || !item.guidance?.trim()) {
      throw new Error(
        `Reimbursement profile ${descriptor.profileId} has a documentation checklist item missing key, label, or guidance`
      );
    }
    if (seenChecklistKeys.has(item.key)) {
      throw new Error(
        `Reimbursement profile ${descriptor.profileId} declares duplicate checklist item ${item.key}`
      );
    }
    seenChecklistKeys.add(item.key);
  }
}

/**
 * Build a registry from descriptor registrations.
 *
 * Every failure here is a registration bug rather than a runtime condition, so
 * they throw: a registry that silently dropped a malformed or duplicate
 * profile would leave an invoice row bound to a profile id nothing can
 * resolve.
 */
export function createReimbursementProfileRegistry(
  registrations: readonly ReimbursementProfileDescriptor[]
): ReimbursementProfileRegistry {
  const byId = new Map<string, ReimbursementProfileDescriptor>();
  const descriptors: ReimbursementProfileDescriptor[] = [];
  let defaultProfileId: string | null = null;

  for (const descriptor of registrations) {
    validateDescriptor(descriptor);

    if (byId.has(descriptor.profileId)) {
      throw new Error(`Duplicate reimbursement profile registration: ${descriptor.profileId}`);
    }

    if (descriptor.isInterimDefault) {
      if (defaultProfileId) {
        throw new Error(
          `Multiple reimbursement profiles claim the interim default: ${defaultProfileId}, ${descriptor.profileId}`
        );
      }
      defaultProfileId = descriptor.profileId;
    }

    descriptors.push(descriptor);
    byId.set(descriptor.profileId, descriptor);
  }

  /**
   * Profiles that cover a jurisdiction, most specific tier only. Two rules,
   * both load-bearing and identical to the stage-gate registry's:
   *
   *   1. A subdivision-scoped profile covers ONLY a workspace whose
   *      subdivision it names. A nationwide profile covers every workspace in
   *      its country — a real match, just a less specific one, used when no
   *      subdivision pack exists.
   *   2. When the caller cannot say which subdivision the workspace is in,
   *      only nationwide profiles are candidates. Picking a subdivision pack
   *      for a workspace whose subdivision is unknown is the exact
   *      substitution this registry exists to prevent.
   */
  function coveringProfiles(query: InvoicingJurisdictionQuery): readonly ReimbursementProfileDescriptor[] {
    const country = normalizeJurisdictionPart(query?.country);
    if (!country) return [];
    const subdivision = normalizeJurisdictionPart(query?.subdivision);

    const inCountry = descriptors.filter(
      (descriptor) => normalizeJurisdictionPart(descriptor.jurisdiction.country) === country
    );

    const subdivisionScoped = subdivision
      ? inCountry.filter(
          (descriptor) => normalizeJurisdictionPart(descriptor.jurisdiction.subdivision) === subdivision
        )
      : [];

    return subdivisionScoped.length > 0
      ? subdivisionScoped
      : inCountry.filter(
          (descriptor) => normalizeJurisdictionPart(descriptor.jurisdiction.subdivision) === null
        );
  }

  return {
    list: () => descriptors,
    get: (profileId) => byId.get(profileId) ?? null,
    findByJurisdiction: (jurisdiction) => {
      const covering = coveringProfiles(jurisdiction);
      if (covering.length === 0) return { kind: "no_profile" };
      if (covering.length === 1) return { kind: "matched", profile: covering[0] };
      return { kind: "ambiguous", profiles: covering };
    },
    defaultProfileId,
  };
}

/**
 * Profiles shipped with the app.
 *
 * Adding a jurisdiction means adding its descriptor under `profiles/` and one
 * entry here. Nothing downstream changes: the binding resolver, the API, and
 * the composer all address profiles by id.
 */
export const BUILT_IN_REIMBURSEMENT_PROFILE_REGISTRATIONS: readonly ReimbursementProfileDescriptor[] = [
  US_CA_LAPM_REIMBURSEMENT_PROFILE,
  US_FEDERAL_GENERIC_REIMBURSEMENT_PROFILE,
];

export const reimbursementProfileRegistry = createReimbursementProfileRegistry(
  BUILT_IN_REIMBURSEMENT_PROFILE_REGISTRATIONS
);
