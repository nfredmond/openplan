/**
 * Where an RTP priority criterion's POLICY BASIS comes from.
 *
 * The criteria in `priority-criteria.ts` are jurisdiction-neutral: any agency
 * anywhere can decide a project reduces VMT or preserves existing assets. The
 * law it cites for caring is not neutral, and OpenPlan used to pretend it was.
 * Every criterion carried a hardcoded California basis — "CEQA §15064.3 · SB
 * 743", "SB 375 · CARB Scoping Plan", "ATP · Complete Streets (AB 1358)" — and
 * `buildNarrative` spliced those strings into prose that renders on the PUBLIC
 * share page. An MPO in Ohio published, under its own name and to its own
 * residents, that its projects advance California statutes. That is a false
 * statement of law, and this registry exists to end it.
 *
 * Two rules govern what may be registered here, both learned the hard way:
 *
 *   1. **Cite durable law.** The federal framework cites the Code of Federal
 *      Regulations, not executive orders. The previous federal basis for the
 *      equity criterion was "Justice40", which Executive Order 14148 revoked
 *      on 2025-01-20 along with EO 14008 and the CEJST tool it created — so
 *      OpenPlan was publishing a rescinded initiative as a live policy basis.
 *      A regulation can change too, but it changes with notice and comment
 *      rather than overnight.
 *
 *   2. **An entry that cannot be verified is dropped, not guessed.** Every
 *      citation in `frameworks/` was read against the regulation's own text
 *      before it was written down.
 *
 * A workspace whose jurisdiction matches no registered framework gets NO
 * citations — `policyBasis` is null and the narrative simply omits the basis
 * clause. Scoring still works everywhere; only the legal claim is withheld.
 * Silence is the honest answer to "which law says so?" when we do not know.
 */
import type { RtpPriorityCriterion } from "./priority-criteria";
import { RTP_PRIORITY_CRITERIA } from "./priority-criteria";

/** The jurisdiction shape `resolveJurisdiction` returns, matched structurally. */
export interface RtpPriorityJurisdictionQuery {
  country: string;
  subdivision: string | null;
}

export interface RtpPriorityFrameworkDescriptor {
  frameworkId: string;
  /** How the framework names itself to a planner, e.g. "United States (federal)". */
  label: string;
  jurisdiction: RtpPriorityJurisdictionQuery;
  /**
   * The nationwide floor for its country. Exactly one framework per country
   * may claim it, and only a country-wide (subdivision: null) one may.
   */
  isInterimDefault?: boolean;
  /** What this framework deliberately does NOT claim. Rendered verbatim. */
  framingNote: string;
  /**
   * Policy basis per criterion key. Every key in RTP_PRIORITY_CRITERIA must
   * appear — a framework that covers a jurisdiction partially would leave some
   * criteria silently uncited while others carry law, which reads as "this one
   * has no legal basis" rather than "we did not write one down".
   */
  policyBasis: Readonly<Record<string, string>>;
}

/** A criterion with the basis its resolved framework supplies. */
export type ResolvedRtpPriorityCriterion = RtpPriorityCriterion & {
  /** Null when no framework covers the workspace's jurisdiction. */
  policyBasis: string | null;
};

export interface RtpPriorityFrameworkRegistry {
  descriptors: readonly RtpPriorityFrameworkDescriptor[];
  byId(frameworkId: string): RtpPriorityFrameworkDescriptor | null;
  /**
   * Frameworks covering a jurisdiction, most specific tier only. A
   * subdivision-scoped framework covers only a workspace whose subdivision it
   * names; a nationwide one covers every workspace in its country. When the
   * caller cannot say which subdivision the workspace is in, only nationwide
   * frameworks are candidates — picking a subdivision pack for an unknown
   * subdivision is the exact substitution this registry prevents.
   */
  findByJurisdiction(
    jurisdiction: RtpPriorityJurisdictionQuery | null | undefined
  ): readonly RtpPriorityFrameworkDescriptor[];
  interimDefaultFor(country: string | null | undefined): RtpPriorityFrameworkDescriptor | null;
}

function normalizePart(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toUpperCase();
  return trimmed ? trimmed : null;
}

function validateDescriptor(descriptor: RtpPriorityFrameworkDescriptor): void {
  if (!descriptor.frameworkId?.trim()) {
    throw new Error("RTP priority framework is missing a frameworkId");
  }
  if (!descriptor.label?.trim()) {
    throw new Error(`RTP priority framework ${descriptor.frameworkId} is missing a label`);
  }
  if (!descriptor.framingNote?.trim()) {
    throw new Error(`RTP priority framework ${descriptor.frameworkId} is missing a framingNote`);
  }
  if (!normalizePart(descriptor.jurisdiction?.country)) {
    throw new Error(`RTP priority framework ${descriptor.frameworkId} is missing a jurisdiction country`);
  }
  if (descriptor.isInterimDefault && normalizePart(descriptor.jurisdiction?.subdivision)) {
    throw new Error(
      `RTP priority framework ${descriptor.frameworkId} claims the interim default but is scoped to a subdivision`
    );
  }

  // Completeness is enforced against the taxonomy rather than against a
  // hand-written key list, so adding a criterion fails every framework that
  // has not decided what law it cites — at registry construction, not on a
  // public page.
  for (const criterion of RTP_PRIORITY_CRITERIA) {
    const basis = descriptor.policyBasis[criterion.key];
    if (!basis?.trim()) {
      throw new Error(
        `RTP priority framework ${descriptor.frameworkId} declares no policy basis for criterion ${criterion.key}`
      );
    }
  }
  for (const key of Object.keys(descriptor.policyBasis)) {
    if (!RTP_PRIORITY_CRITERIA.some((criterion) => criterion.key === key)) {
      throw new Error(
        `RTP priority framework ${descriptor.frameworkId} declares a policy basis for unknown criterion ${key}`
      );
    }
  }
}

/**
 * Build a registry from descriptor registrations.
 *
 * Every failure here is a registration bug rather than a runtime condition, so
 * they throw: a registry that silently dropped a malformed framework would
 * leave a workspace citing nothing while a framework for its state sat
 * unregistered.
 */
export function createRtpPriorityFrameworkRegistry(
  registrations: readonly RtpPriorityFrameworkDescriptor[]
): RtpPriorityFrameworkRegistry {
  const byId = new Map<string, RtpPriorityFrameworkDescriptor>();
  const defaultByCountry = new Map<string, string>();
  const descriptors: RtpPriorityFrameworkDescriptor[] = [];

  for (const descriptor of registrations) {
    validateDescriptor(descriptor);

    if (byId.has(descriptor.frameworkId)) {
      throw new Error(`Duplicate RTP priority framework registration: ${descriptor.frameworkId}`);
    }

    if (descriptor.isInterimDefault) {
      const country = normalizePart(descriptor.jurisdiction.country)!;
      const claimed = defaultByCountry.get(country);
      if (claimed) {
        throw new Error(
          `Multiple RTP priority frameworks claim the ${country} interim default: ${claimed}, ${descriptor.frameworkId}`
        );
      }
      defaultByCountry.set(country, descriptor.frameworkId);
    }

    descriptors.push(descriptor);
    byId.set(descriptor.frameworkId, descriptor);
  }

  return {
    descriptors,
    byId(frameworkId) {
      return byId.get(frameworkId) ?? null;
    },
    findByJurisdiction(jurisdiction) {
      const country = normalizePart(jurisdiction?.country);
      if (!country) return [];
      const subdivision = normalizePart(jurisdiction?.subdivision);

      const inCountry = descriptors.filter(
        (descriptor) => normalizePart(descriptor.jurisdiction.country) === country
      );

      if (subdivision) {
        const scoped = inCountry.filter(
          (descriptor) => normalizePart(descriptor.jurisdiction.subdivision) === subdivision
        );
        if (scoped.length > 0) return scoped;
      }

      return inCountry.filter((descriptor) => !normalizePart(descriptor.jurisdiction.subdivision));
    },
    interimDefaultFor(country) {
      const normalized = normalizePart(country);
      if (!normalized) return null;
      const frameworkId = defaultByCountry.get(normalized);
      return frameworkId ? (byId.get(frameworkId) ?? null) : null;
    },
  };
}

/**
 * Attach each criterion's basis under a framework. A null framework yields
 * null bases — the taxonomy still scores, it just cites nothing.
 */
export function resolveRtpPriorityCriteria(
  framework: RtpPriorityFrameworkDescriptor | null
): readonly ResolvedRtpPriorityCriterion[] {
  return RTP_PRIORITY_CRITERIA.map((criterion) => ({
    ...criterion,
    policyBasis: framework ? (framework.policyBasis[criterion.key] ?? null) : null,
  }));
}
