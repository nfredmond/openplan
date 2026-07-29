/**
 * VMT significance framework registry.
 *
 * A VMT significance framework is a *data artifact*: the statute or guideline
 * that makes vehicle-miles-travelled the transportation-impact metric in one
 * jurisdiction, the reference baseline and percent-below threshold that
 * jurisdiction's guidance recommends, the citation a determination under it must
 * carry, and the caveat it puts on screening-level output. California's CEQA
 * §15064.3 pack (under `frameworks/`) is the first one OpenPlan ships.
 *
 * IT IS NOT THE ONLY SHAPE A FRAMEWORK MAY TAKE, and nothing in this module may
 * assume it. CEQA is California law: a §15064.3 significance determination is
 * meaningless in Ohio, in Ontario, or on tribal land with its own environmental
 * review process. A framework for any of those must be addable as a descriptor
 * file plus one registration entry — never as an edit to a call site, a schema,
 * or a branch that asks "is this California?".
 *
 * The design deliberately mirrors `src/lib/invoicing/reimbursement-profiles.ts`
 * (which mirrors `src/lib/stage-gates/template-registry.ts`, which mirrors
 * `src/lib/safety/sources/registry.ts`):
 *
 *   - coverage grows by adding a registration entry, not by editing consumers;
 *   - the resolver returns an explicit "not covered" result rather than quietly
 *     substituting whatever framework happens to be loaded.
 *
 * ONE DELIBERATE DIVERGENCE FROM THE REIMBURSEMENT REGISTRY, and it is the whole
 * point of this file: THERE IS NO INTERIM DEFAULT. A reimbursement profile can
 * fall back to a labeled default because the worst case is an agency logging a
 * draw under an unfamiliar posture vocabulary — inconvenient, and disclosed. A
 * significance determination cannot. Issuing "less than significant under CEQA
 * §15064.3" to a planner in a state where CEQA does not exist is not an
 * inconvenience; it is a false statement about the law that looks entirely
 * plausible and would travel into a report, a stage gate, or a grant narrative.
 * So an uncovered jurisdiction gets a refusal that NAMES ITS REASON, and an
 * unstated jurisdiction gets a request to state one. Neither ever gets a
 * determination.
 *
 * `createVmtSignificanceFrameworkRegistry` is exported separately from the
 * built-in instance so a future workspace-authored or database-backed framework
 * set can be built into a registry without this file changing.
 */

import { US_CA_CEQA_15064_3_FRAMEWORK } from "@/lib/planner-pack/frameworks/us-ca-ceqa-15064-3";

/**
 * Where a framework's rules come from, expressed so the core stays
 * country-neutral: ISO 3166-1 alpha-2 for the country, ISO 3166-2 subdivision
 * code (without the country prefix) when the framework is subdivision-scoped.
 *
 * `label` is what a planner reads. It is carried here rather than derived,
 * because deriving "California" from "US-CA" would mean shipping a code-to-name
 * table for the world in order to render one string.
 */
export type VmtFrameworkJurisdiction = {
  country: string;
  /** Omitted for frameworks that apply nationwide. */
  subdivision?: string;
  label: string;
};

/**
 * What a caller knows about a workspace's own jurisdiction when asking which
 * framework covers it.
 *
 * Deliberately looser than `VmtFrameworkJurisdiction`: `subdivision` may be null,
 * which is a meaningful state — "this workspace is in this country, but which
 * subdivision is not established" — and `label` is whatever the workspace's home
 * geography is called, which may be absent. It is the shape `resolveJurisdiction()`
 * in `src/lib/workspaces/home-geography.ts` returns (plus the optional label), so
 * a workspace's home geography can be handed here without translation.
 */
export type VmtFrameworkJurisdictionQuery = {
  country: string;
  subdivision?: string | null;
  /** The workspace's own name for the place, used only to word a refusal. */
  label?: string | null;
};

export type VmtSignificanceFrameworkDescriptor = {
  frameworkId: string;
  /** Planner-facing name, e.g. the statute a determination cites. */
  frameworkName: string;
  version: string;
  jurisdiction: VmtFrameworkJurisdiction;
  /**
   * What this framework covers, in its own words — used to explain to a planner
   * OUTSIDE it why it does not reach them. It lives on the descriptor so the
   * registry never has to know what any particular framework is about.
   */
  scopeStatement: string;
  /** The statutory citation every determination under this framework carries. */
  statutoryCitation: string;
  /** What this framework says about screening-level output of its own kind. */
  screeningCaveat: string;
  /**
   * The default percent-below-reference cut line this jurisdiction's guidance
   * recommends, as a fraction, plus where that number comes from. Operators may
   * override it; the framework supplies the starting point rather than the app
   * assuming one jurisdiction's guidance is universal.
   */
  defaultThresholdPct: number;
  defaultThresholdRationale: string;
  /**
   * A reference VMT-per-capita baseline to pre-fill, and its provenance. This is
   * jurisdiction-specific data (a statewide or national average), which is
   * exactly why it belongs on a descriptor rather than as an app-wide constant.
   */
  defaultReferenceVmtPerCapita: number;
  defaultReferenceRationale: string;
};

/** How the jurisdiction behind a resolution was established. Persisted. */
export type VmtJurisdictionBasis = "workspace_home_geography";

/**
 * The jurisdiction a resolution was made for, normalized. Carried on the
 * resolution (rather than left with the caller) so the record written to the
 * database and the sentence shown to the planner cannot disagree.
 */
export type VmtResolvedJurisdiction = {
  country: string;
  subdivision: string | null;
  /** The workspace's own label for the place, when it has one. */
  label: string | null;
};

/**
 * Outcome of asking which framework governs a jurisdiction.
 *
 * Every non-covered arm carries `reason` — a complete sentence a surface can
 * render verbatim. That is deliberate: a caller that has to compose its own
 * explanation will eventually compose a vaguer one, and "no determination
 * available" without a reason is the silent degrade this codebase refuses.
 *
 * `ambiguous` exists so the registry never picks arbitrarily between two
 * frameworks that cover the same place equally well. Two California packs
 * authored by different agencies are a legitimate configuration; silently
 * binding whichever registered first would issue one agency's determination
 * under the other's name with nothing to indicate a choice was made.
 */
export type VmtFrameworkResolution =
  | {
      kind: "covered";
      framework: VmtSignificanceFrameworkDescriptor;
      jurisdiction: VmtResolvedJurisdiction;
      basis: VmtJurisdictionBasis;
    }
  | {
      kind: "not_covered";
      jurisdiction: VmtResolvedJurisdiction;
      registered: readonly VmtSignificanceFrameworkDescriptor[];
      reason: string;
    }
  | {
      kind: "jurisdiction_unknown";
      registered: readonly VmtSignificanceFrameworkDescriptor[];
      reason: string;
    }
  | {
      kind: "ambiguous";
      jurisdiction: VmtResolvedJurisdiction;
      frameworks: readonly VmtSignificanceFrameworkDescriptor[];
      reason: string;
    };

export type VmtSignificanceFrameworkRegistry = {
  /** Every registered framework, in registration order. */
  list: () => readonly VmtSignificanceFrameworkDescriptor[];
  get: (frameworkId: string) => VmtSignificanceFrameworkDescriptor | null;
  /**
   * Which registered framework governs a jurisdiction. `null` for the query
   * means the workspace has not said where it works, which is its own answer —
   * never a licence to guess.
   */
  resolve: (
    jurisdiction: VmtFrameworkJurisdictionQuery | null | undefined,
    basis?: VmtJurisdictionBasis
  ) => VmtFrameworkResolution;
};

/** Trim-and-upcase a jurisdiction code, treating blank as absent. */
function normalizeCode(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toUpperCase();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function normalizeLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

/**
 * How a place is named in a refusal. The workspace's own label first (it is what
 * the planner recognises), then the ISO codes, which are always present.
 */
export function describeJurisdiction(jurisdiction: VmtResolvedJurisdiction): string {
  const code = jurisdiction.subdivision
    ? `${jurisdiction.country}-${jurisdiction.subdivision}`
    : jurisdiction.country;
  return jurisdiction.label ? `${jurisdiction.label} (${code})` : code;
}

/** "CEQA §15064.3 (California, United States)" — for listing what IS covered. */
function describeFramework(framework: VmtSignificanceFrameworkDescriptor): string {
  return `${framework.frameworkName} (${framework.jurisdiction.label})`;
}

function validateDescriptor(descriptor: VmtSignificanceFrameworkDescriptor): void {
  if (!descriptor.frameworkId?.trim()) {
    throw new Error("VMT significance framework descriptor missing frameworkId");
  }
  if (!descriptor.frameworkName?.trim()) {
    throw new Error(`VMT significance framework ${descriptor.frameworkId} missing frameworkName`);
  }
  if (!normalizeCode(descriptor.jurisdiction?.country)) {
    throw new Error(`VMT significance framework ${descriptor.frameworkId} missing jurisdiction country`);
  }
  if (!normalizeLabel(descriptor.jurisdiction?.label)) {
    throw new Error(`VMT significance framework ${descriptor.frameworkId} missing jurisdiction label`);
  }
  if (!normalizeLabel(descriptor.statutoryCitation)) {
    throw new Error(
      `VMT significance framework ${descriptor.frameworkId} declares no statutory citation; a determination that cannot cite its own authority must not be issuable`
    );
  }
  if (!normalizeLabel(descriptor.scopeStatement)) {
    throw new Error(
      `VMT significance framework ${descriptor.frameworkId} declares no scope statement; the registry needs it to tell a planner outside this jurisdiction why it does not reach them`
    );
  }
  if (!(descriptor.defaultThresholdPct > 0 && descriptor.defaultThresholdPct < 1)) {
    throw new Error(
      `VMT significance framework ${descriptor.frameworkId} declares defaultThresholdPct ${descriptor.defaultThresholdPct}; it must be a fraction strictly between 0 and 1`
    );
  }
  if (!(descriptor.defaultReferenceVmtPerCapita > 0)) {
    throw new Error(
      `VMT significance framework ${descriptor.frameworkId} declares defaultReferenceVmtPerCapita ${descriptor.defaultReferenceVmtPerCapita}; it must be greater than 0`
    );
  }
}

/**
 * Build a registry from descriptor registrations.
 *
 * Every failure here is a registration bug rather than a runtime condition, so
 * they throw: a registry that silently dropped a malformed or duplicate
 * framework would leave a stored determination pointing at a framework id
 * nothing can resolve.
 */
export function createVmtSignificanceFrameworkRegistry(
  registrations: readonly VmtSignificanceFrameworkDescriptor[]
): VmtSignificanceFrameworkRegistry {
  const byId = new Map<string, VmtSignificanceFrameworkDescriptor>();
  const descriptors: VmtSignificanceFrameworkDescriptor[] = [];

  for (const descriptor of registrations) {
    validateDescriptor(descriptor);
    if (byId.has(descriptor.frameworkId)) {
      throw new Error(`Duplicate VMT significance framework registration: ${descriptor.frameworkId}`);
    }
    descriptors.push(descriptor);
    byId.set(descriptor.frameworkId, descriptor);
  }

  /**
   * Frameworks covering a jurisdiction, most specific tier only. Two rules, both
   * load-bearing and identical to the reimbursement and stage-gate registries':
   *
   *   1. A subdivision-scoped framework covers ONLY a workspace whose
   *      subdivision it names. A nationwide framework covers every workspace in
   *      its country — a real match, just a less specific one.
   *   2. When the caller cannot say which subdivision the workspace is in, only
   *      nationwide frameworks are candidates. Picking a subdivision pack for a
   *      workspace whose subdivision is unknown is the exact substitution this
   *      registry exists to prevent.
   */
  function covering(
    jurisdiction: VmtResolvedJurisdiction
  ): readonly VmtSignificanceFrameworkDescriptor[] {
    const inCountry = descriptors.filter(
      (descriptor) => normalizeCode(descriptor.jurisdiction.country) === jurisdiction.country
    );

    const subdivisionScoped = jurisdiction.subdivision
      ? inCountry.filter(
          (descriptor) =>
            normalizeCode(descriptor.jurisdiction.subdivision) === jurisdiction.subdivision
        )
      : [];

    return subdivisionScoped.length > 0
      ? subdivisionScoped
      : inCountry.filter((descriptor) => normalizeCode(descriptor.jurisdiction.subdivision) === null);
  }

  /**
   * Frameworks registered for a SUBDIVISION of this country — the ones a
   * workspace whose own subdivision is unknown cannot be matched against.
   */
  function subdivisionScopedIn(country: string): readonly VmtSignificanceFrameworkDescriptor[] {
    return descriptors.filter(
      (descriptor) =>
        normalizeCode(descriptor.jurisdiction.country) === country &&
        normalizeCode(descriptor.jurisdiction.subdivision) !== null
    );
  }

  function coverageSentence(): string {
    if (descriptors.length === 0) {
      return "This deployment registers no VMT significance framework at all.";
    }
    return `OpenPlan registers ${descriptors.length === 1 ? "one framework" : `${descriptors.length} frameworks`}: ${descriptors
      .map(describeFramework)
      .join("; ")}.`;
  }

  return {
    list: () => descriptors,
    get: (frameworkId) => byId.get(frameworkId) ?? null,
    resolve: (query, basis = "workspace_home_geography") => {
      const country = normalizeCode(query?.country);
      if (!country) {
        return {
          kind: "jurisdiction_unknown",
          registered: descriptors,
          reason:
            "This workspace has not stated where it works, so OpenPlan cannot tell which jurisdiction's " +
            "VMT significance rules apply to it. Set the workspace's home geography, and OpenPlan will " +
            "either issue the determination under that jurisdiction's framework or say plainly that none " +
            `is registered for it. ${coverageSentence()}`,
        };
      }

      const jurisdiction: VmtResolvedJurisdiction = {
        country,
        subdivision: normalizeCode(query?.subdivision),
        label: normalizeLabel(query?.label),
      };

      const matches = covering(jurisdiction);

      if (matches.length === 0) {
        // WHY THIS SPLIT. "No framework covers you" and "we cannot tell which
        // subdivision you are in" are different facts, and conflating them
        // states something false. A workspace whose home geography is a metro
        // or micro area has no subdivision code at all — a CBSA number is not
        // state-prefixed and a CBSA can straddle states, so
        // `subdivisionCodeFromTigerwebGeoid` correctly refuses to guess one.
        // Telling that workspace "no framework is registered for your area"
        // would be a flat untruth whenever a framework for its actual
        // subdivision is sitting in this registry, and it would send the planner
        // looking for a coverage gap instead of at the one thing they can fix.
        const blockedBySubdivision =
          jurisdiction.subdivision === null ? subdivisionScopedIn(jurisdiction.country) : [];

        if (blockedBySubdivision.length > 0) {
          return {
            kind: "not_covered",
            jurisdiction,
            registered: descriptors,
            reason:
              `OpenPlan cannot tell which subdivision of ${jurisdiction.country} ` +
              `${describeJurisdiction(jurisdiction)} is in, and every VMT significance framework ` +
              `registered for ${jurisdiction.country} applies to a named subdivision ` +
              `(${blockedBySubdivision.map(describeFramework).join("; ")}). Rather than assume one, ` +
              "OpenPlan issues no determination: a framework applied to the wrong subdivision would " +
              "state something about the law that is not true where you work. Set the workspace's home " +
              "geography to a place whose subdivision is unambiguous — a metro or micro area has none, " +
              "because it is not subdivision-scoped and may span several.",
          };
        }

        return {
          kind: "not_covered",
          jurisdiction,
          registered: descriptors,
          reason:
            `No VMT significance framework is registered for ${describeJurisdiction(jurisdiction)}, so ` +
            "OpenPlan will not issue a significance determination there. A determination made under a " +
            "framework authored for a different jurisdiction would state something about the law that " +
            `is not true of yours. ${coverageSentence()}`,
        };
      }

      if (matches.length > 1) {
        return {
          kind: "ambiguous",
          jurisdiction,
          frameworks: matches,
          reason:
            `More than one registered VMT significance framework covers ${describeJurisdiction(jurisdiction)} ` +
            `(${matches.map(describeFramework).join("; ")}), so OpenPlan will not choose between them on ` +
            "your behalf. Until one is selected explicitly, no determination is issued.",
        };
      }

      return { kind: "covered", framework: matches[0], jurisdiction, basis };
    },
  };
}

/**
 * Frameworks shipped with the app.
 *
 * Adding a jurisdiction means adding its descriptor under `frameworks/` and one
 * entry here. Nothing downstream changes: the screen, the API route, and the
 * persisted record all address frameworks by id.
 */
export const BUILT_IN_VMT_SIGNIFICANCE_FRAMEWORKS: readonly VmtSignificanceFrameworkDescriptor[] = [
  US_CA_CEQA_15064_3_FRAMEWORK,
];

export const vmtSignificanceFrameworkRegistry = createVmtSignificanceFrameworkRegistry(
  BUILT_IN_VMT_SIGNIFICANCE_FRAMEWORKS
);
