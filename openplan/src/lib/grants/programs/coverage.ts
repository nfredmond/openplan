/**
 * Which of the registered grant programs are actually open to a workspace.
 *
 * The catalog flattens every registered bundle into one list, and that list is
 * what a planner sees. Read plainly, it makes a claim it cannot support: an
 * agency in one state looking at another state's programs has no way to tell
 * that half the menu is not theirs. Federal coverage is genuinely national;
 * a state bundle is not, and the difference has to be on the surface.
 *
 * This module answers, per bundle, "does this cover the workspace, and if not,
 * why not" — and it answers it by ASKING THE BUNDLE where it applies. Nothing
 * here knows the name of a state or a country. Registering `us-oh.ts` with its
 * own jurisdiction makes every label and every disclosure below correct for an
 * Ohio workspace, with no edit to this file or to any call site.
 *
 * The posture matches `resolveReimbursementProfile` and the stage-gate
 * template registry: an unset workspace geography resolves as
 * jurisdiction-unknown, a DISCLOSED fallback, never a guess, and never a reason
 * to hide a program. A consultant may legitimately pursue work in another state;
 * the catalog's job is to label, not to filter.
 */

import { GRANT_PROGRAM_BUNDLES } from "./registry";
import type {
  GrantProgramBundle,
  GrantProgramCatalogEntry,
  GrantProgramJurisdiction,
} from "./types";

/**
 * What a caller knows about a workspace's own jurisdiction. Deliberately looser
 * than `GrantProgramJurisdiction`: no label, and `subdivision` may be null,
 * which is a meaningful state — "in this country, but which subdivision is not
 * established" (a multi-state metro, or a source that cannot say). It is the
 * shape `resolveJurisdiction()` returns in src/lib/workspaces/home-geography.ts.
 */
export type GrantProgramJurisdictionQuery = {
  country: string;
  subdivision?: string | null;
};

/**
 * How a bundle stands relative to the workspace asking.
 *
 *   - `nationwide_match`   — open country-wide, and the workspace is in that country.
 *   - `jurisdiction_match` — scoped to exactly the workspace's subdivision.
 *   - `other_jurisdiction` — registered for somewhere the workspace is not.
 *   - `unknown_jurisdiction` — the workspace has not established enough of its
 *     own geography for the question to be answerable. NOT a synonym for "no":
 *     it means OpenPlan does not know, and says so.
 */
export type GrantProgramBundleScope =
  | "nationwide_match"
  | "jurisdiction_match"
  | "other_jurisdiction"
  | "unknown_jurisdiction";

export type GrantProgramBundleCoverage = {
  key: string;
  label: string;
  jurisdiction: GrantProgramJurisdiction;
  scope: GrantProgramBundleScope;
  /** Short badge text: the jurisdiction, and the caveat when there is one. */
  scopeLabel: string;
  /** True for `nationwide_match` and `jurisdiction_match` only. */
  coversWorkspace: boolean;
};

/** One catalog entry alongside the bundle that registered it. */
export type GrantProgramCoverageEntry = {
  program: GrantProgramCatalogEntry;
  bundle: GrantProgramBundleCoverage;
};

/**
 * Why the catalog cannot present itself as this workspace's funding menu.
 * Each case needs a different thing from the reader, so they stay distinct —
 * the same reasoning as `StageGateInterimDefaultReason`.
 *
 *   - `no_workspace_jurisdiction` → tell us where you work.
 *   - `no_workspace_subdivision`  → we know the country but not the subdivision,
 *     so jurisdiction-scoped bundles cannot be judged either way.
 *   - `no_bundle_for_jurisdiction` → we know where you work and have not curated
 *     your programs yet. Nothing the user can do; OpenPlan owes them one.
 */
export type GrantProgramCoverageGapReason =
  | "no_workspace_jurisdiction"
  | "no_workspace_subdivision"
  | "no_bundle_for_jurisdiction";

/** The sentence a planner must be shown above a catalog that is not all theirs. */
export type GrantProgramCoverageDisclosure = {
  reason: GrantProgramCoverageGapReason;
  headline: string;
  detail: string;
  /** What the reader can do about it, or null when there is nothing to do. */
  action: string | null;
};

export type GrantProgramCoverage = {
  /** "US-OH" / "US", or null when the workspace has stated no geography. */
  workspaceJurisdictionLabel: string | null;
  bundles: readonly GrantProgramBundleCoverage[];
  /** Every program, in registration order, carrying its bundle's coverage. */
  programs: readonly GrantProgramCoverageEntry[];
  /** How many of them are open to this workspace; null when unknowable. */
  coveredProgramCount: number | null;
  /** Null when every registered bundle covers this workspace. */
  disclosure: GrantProgramCoverageDisclosure | null;
};

export function describeGrantProgramCoverage(
  workspaceJurisdiction: GrantProgramJurisdictionQuery | null | undefined,
  bundles: readonly GrantProgramBundle[] = GRANT_PROGRAM_BUNDLES
): GrantProgramCoverage {
  const query = normalizeQuery(workspaceJurisdiction);
  const workspaceJurisdictionLabel = formatJurisdictionQuery(query);

  const bundleCoverage = bundles.map((bundle) => {
    const scope = classifyBundle(bundle.jurisdiction, query);
    return {
      key: bundle.key,
      label: bundle.label,
      jurisdiction: bundle.jurisdiction,
      scope,
      scopeLabel: scopeLabelFor(bundle.jurisdiction, scope),
      coversWorkspace: scope === "nationwide_match" || scope === "jurisdiction_match",
    } satisfies GrantProgramBundleCoverage;
  });

  const programs = bundles.flatMap((bundle, index) =>
    bundle.programs.map((program) => ({ program, bundle: bundleCoverage[index] }))
  );

  const anyUnknown = bundleCoverage.some((bundle) => bundle.scope === "unknown_jurisdiction");
  const coveredProgramCount = anyUnknown
    ? null
    : programs.filter((entry) => entry.bundle.coversWorkspace).length;

  return {
    workspaceJurisdictionLabel,
    bundles: bundleCoverage,
    programs,
    coveredProgramCount,
    disclosure: buildDisclosure(query, workspaceJurisdictionLabel, bundleCoverage),
  };
}

/**
 * Every registered program with the bundle that carries it, for callers that
 * need provenance without a workspace to compare against — the assistant's
 * catalog tool, for one, which must name each program's jurisdiction because it
 * has no geography of its own to reason from.
 */
export function listGrantProgramsWithBundle(
  bundles: readonly GrantProgramBundle[] = GRANT_PROGRAM_BUNDLES
): readonly { program: GrantProgramCatalogEntry; bundle: GrantProgramBundle }[] {
  return bundles.flatMap((bundle) => bundle.programs.map((program) => ({ program, bundle })));
}

/**
 * Coverage of one bundle against one workspace.
 *
 * Two rules carry the honesty, and they mirror the stage-gate registry's:
 *
 *   1. A subdivision-scoped bundle covers ONLY a workspace whose subdivision it
 *      names. A nationwide bundle covers every workspace in its country.
 *   2. When the workspace's subdivision is not established, a subdivision-scoped
 *      bundle is UNKNOWN rather than excluded — declaring it "not yours" would be
 *      as invented as declaring it yours.
 */
function classifyBundle(
  bundle: GrantProgramJurisdiction,
  query: GrantProgramJurisdictionQuery | null
): GrantProgramBundleScope {
  if (!query) return "unknown_jurisdiction";
  if (normalize(bundle.country) !== normalize(query.country)) return "other_jurisdiction";
  if (!normalize(bundle.subdivision)) return "nationwide_match";
  if (!normalize(query.subdivision)) return "unknown_jurisdiction";
  return normalize(bundle.subdivision) === normalize(query.subdivision)
    ? "jurisdiction_match"
    : "other_jurisdiction";
}

function scopeLabelFor(
  jurisdiction: GrantProgramJurisdiction,
  scope: GrantProgramBundleScope
): string {
  if (scope === "other_jurisdiction") {
    return `${jurisdiction.label} — not this workspace's jurisdiction`;
  }
  if (scope === "unknown_jurisdiction") {
    return `${jurisdiction.label} — coverage unconfirmed`;
  }
  return jurisdiction.label;
}

function buildDisclosure(
  query: GrantProgramJurisdictionQuery | null,
  workspaceJurisdictionLabel: string | null,
  bundles: readonly GrantProgramBundleCoverage[]
): GrantProgramCoverageDisclosure | null {
  const scopedElsewhere = bundles.filter((bundle) => bundle.scope === "other_jurisdiction");
  const unconfirmed = bundles.filter((bundle) => bundle.scope === "unknown_jurisdiction");
  const nationwide = bundles.filter((bundle) => bundle.scope === "nationwide_match");
  const hasOwnBundle = bundles.some((bundle) => bundle.scope === "jurisdiction_match");

  if (!query) {
    return {
      reason: "no_workspace_jurisdiction",
      headline: "Program coverage: this workspace has not said where it works",
      detail:
        "Some of these programs are open only inside one jurisdiction, and OpenPlan cannot tell which of them apply here until this workspace states its home geography. Every program below is labeled with the jurisdiction its bundle is registered for; read those labels rather than the list length.",
      action:
        "Set the workspace's home geography so this catalog can say which of these programs are open to it.",
    };
  }

  if (unconfirmed.length > 0) {
    return {
      reason: "no_workspace_subdivision",
      headline: `Program coverage: only ${workspaceJurisdictionLabel} is established for this workspace`,
      detail: `This workspace's home geography does not establish which subdivision of ${workspaceJurisdictionLabel} it works in — it spans more than one, or its source cannot say — so ${describeBundleList(unconfirmed)} can be neither confirmed nor ruled out for it. Each is labeled with the jurisdiction it is registered for.${nationwide.length > 0 ? ` ${describeBundleList(nationwide)} apply throughout ${workspaceJurisdictionLabel}.` : ""}`,
      action:
        "Set a home geography that names one subdivision to have this catalog answer for it directly.",
    };
  }

  // Only a workspace with NO bundle of its own is owed this. Once its own
  // jurisdiction is registered, other jurisdictions' bundles are an ordinary
  // part of the catalog — a consultant works across states — and the per-program
  // labels carry that on their own.
  if (!hasOwnBundle && scopedElsewhere.length > 0) {
    return {
      reason: "no_bundle_for_jurisdiction",
      headline: `No grant program bundle is registered for ${workspaceJurisdictionLabel}`,
      detail: `OpenPlan has not curated ${workspaceJurisdictionLabel}'s own funding programs yet, so ${describeBundleList(scopedElsewhere)} below belong to another jurisdiction — they are listed with that jurisdiction on them, and are not this workspace's funding menu.${nationwide.length > 0 ? ` ${describeBundleList(nationwide)} do apply here.` : ""}`,
      action: `Track ${workspaceJurisdictionLabel}'s own programs as opportunities directly — the catalog does not carry them yet.`,
    };
  }

  return null;
}

/** "US federal programs and California state programs" — never a bare count. */
function describeBundleList(bundles: readonly GrantProgramBundleCoverage[]): string {
  const labels = bundles.map((bundle) => bundle.label);
  if (labels.length === 0) return "no bundles";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** "US-OH" / "US" — the readable form of what the caller was told. */
function formatJurisdictionQuery(query: GrantProgramJurisdictionQuery | null): string | null {
  if (!query) return null;
  return query.subdivision ? `${query.country}-${query.subdivision}` : query.country;
}

function normalizeQuery(
  query: GrantProgramJurisdictionQuery | null | undefined
): GrantProgramJurisdictionQuery | null {
  const country = normalize(query?.country);
  if (!country) return null;
  return { country, subdivision: normalize(query?.subdivision) };
}

/** Trim-and-upcase a jurisdiction code, treating blank as absent. */
function normalize(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toUpperCase();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}
