/**
 * Whether serious-injury crashes can be counted, and the one sentence that says so.
 *
 * WHY ONE FUNCTION. Two facts decide it: what the source's crash file declares
 * (`CrashSeverityCompleteness` on the adapter), and whether the serious-injury
 * join ran for this particular set of crashes. CCRS shows why both are needed.
 * Its crash file carries only killed and injured counts, so the adapter declares
 * `fatal_injury_only`; its injured-person table does carry suspected serious
 * injury (KABCO A), and the join upgrades those crashes. Before 2026-11-02 the
 * Safety acquisition ran the join and the corridor scorecard did not, and each
 * surface worded its own caveat from the declared value alone. The same CCRS
 * crashes then read "12 serious-injury crashes" on the Safety page and "serious
 * injury is not separable" in the corridor analysis (KI-2026-11-02-046).
 *
 * Every surface that states serious-injury availability (the Safety banner, the
 * corridor scorecard and its safety line, report caveats, the SS4A appendices,
 * the high-injury network basis) now reads `seriousInjuryAvailability`, so the
 * same crashes cannot produce two statements.
 *
 * Pure and client-safe: it imports no adapter, so the Safety page can render a
 * statement the server computed without bundling crash-source fetch code.
 */

import { SAFETY_FATAL_ONLY_CAVEAT, SAFETY_SEVERITY_COMPLETENESS_CAVEAT } from "@/lib/safety/caveats";
import type { CrashSeverityCompleteness } from "@/lib/safety/sources/types";

const SEVERITY_COMPLETENESS_VALUES: readonly CrashSeverityCompleteness[] = [
  "kabco_full",
  "fatal_injury_only",
  "fatal_only",
];

/** Narrow an untyped stored value. Anything else is unknown, never a guess. */
export function isCrashSeverityCompleteness(value: unknown): value is CrashSeverityCompleteness {
  return typeof value === "string" && (SEVERITY_COMPLETENESS_VALUES as readonly string[]).includes(value);
}

/**
 * Whether the serious-injury join ran for these crashes.
 *
 * `applied`       the source has a serious-injury join and it ran.
 * `not_applied`   the source has one and it did not run (switched off or failed).
 * `not_supported` the source has no such join.
 * `unknown`       the source is not identified, so neither is its join.
 */
export type SeriousInjuryEnrichment = "applied" | "not_applied" | "not_supported" | "unknown";

const ENRICHMENT_VALUES: readonly SeriousInjuryEnrichment[] = ["applied", "not_applied", "not_supported", "unknown"];

/** The two inputs, as they travel between server and client. */
export type SeriousInjuryInputs = {
  /** What the source's crash file declares, or null when the source is unknown. */
  declared: CrashSeverityCompleteness | null;
  enrichment: SeriousInjuryEnrichment;
};

/**
 * Where a serious-injury count comes from, or why there is none.
 *
 * `source_severity`     the crash file's own severity field.
 * `recorded_separated`  the record says serious injuries are separated; its source is not identified.
 * `injured_person_join` the source's person-level injury records, joined to each crash.
 * `join_not_applied`    the source has those records and they were not joined.
 * `not_in_source`       the source records injury but not its severity.
 * `fatal_only`          the source records only fatal crashes.
 * `unknown`             severity coverage was not recorded.
 */
type SeriousInjuryBasis =
  | "source_severity"
  | "recorded_separated"
  | "injured_person_join"
  | "join_not_applied"
  | "not_in_source"
  | "fatal_only"
  | "unknown";

export type SeriousInjuryAvailability = SeriousInjuryInputs & {
  /** Severity completeness after the join: what the crashes in hand can express. */
  effective: CrashSeverityCompleteness | null;
  /** True only when serious-injury crashes are separately counted. */
  separable: boolean;
  basis: SeriousInjuryBasis;
  /** One planner-facing sentence. Every surface prints this, not its own wording. */
  statement: string;
  /** Short table-cell text for a missing serious-injury count. Null when separable. */
  absenceLabel: string | null;
};

const STATEMENTS: Record<SeriousInjuryBasis, { statement: string; absenceLabel: string | null }> = {
  source_severity: {
    statement: "Serious-injury crashes are counted from the source's own severity field.",
    absenceLabel: null,
  },
  recorded_separated: {
    statement:
      "Serious-injury crashes are counted separately in this record. The record does not name its source, so how they were separated is not stated.",
    absenceLabel: null,
  },
  injured_person_join: {
    statement:
      "Serious-injury crashes are counted from the source's injured-person records, joined to each crash. The crash file alone does not separate them.",
    absenceLabel: null,
  },
  join_not_applied: {
    statement:
      "Serious-injury crashes are not separated here. The crash file does not record them, and the source's injured-person records, which do, were not joined for these crashes. Missing serious-injury counts are not zero.",
    absenceLabel: "Not separated (injured-person records not joined)",
  },
  not_in_source: {
    statement:
      "The source does not separate serious injuries from other injuries, so a fatal-or-serious-injury crash count cannot be formed from it.",
    absenceLabel: "Not separated in source (injury crashes not split by severity)",
  },
  fatal_only: {
    statement: `${SAFETY_FATAL_ONLY_CAVEAT} Suspected serious injuries are not in it either, so a fatal-or-serious-injury crash count cannot be derived from it.`,
    absenceLabel: "Not in source (fatal crashes only)",
  },
  unknown: {
    statement: SAFETY_SEVERITY_COMPLETENESS_CAVEAT,
    absenceLabel: "Not available; severity coverage not recorded",
  },
};

function basisFor(inputs: SeriousInjuryInputs): SeriousInjuryBasis {
  switch (inputs.declared) {
    case "kabco_full":
      // Only an unidentified source arrives here with an unknown join: the
      // record says the crashes are separated, but not by which route.
      return inputs.enrichment === "unknown" ? "recorded_separated" : "source_severity";
    case "fatal_only":
      return "fatal_only";
    case "fatal_injury_only":
      if (inputs.enrichment === "applied") return "injured_person_join";
      if (inputs.enrichment === "not_applied") return "join_not_applied";
      if (inputs.enrichment === "not_supported") return "not_in_source";
      return "unknown";
    default:
      return "unknown";
  }
}

/**
 * THE function. Declared completeness plus whether the join ran gives what the
 * crashes can express and the sentence every surface prints.
 */
export function seriousInjuryAvailability(inputs: SeriousInjuryInputs): SeriousInjuryAvailability {
  const basis = basisFor(inputs);
  // The join is the only thing that changes what the crashes express; without
  // it they express exactly what the source declared.
  const effective: CrashSeverityCompleteness | null =
    basis === "injured_person_join" ? "kabco_full" : inputs.declared;
  return {
    declared: inputs.declared,
    enrichment: inputs.enrichment,
    effective,
    separable: effective === "kabco_full",
    basis,
    ...STATEMENTS[basis],
  };
}

/**
 * Whether crashes with this (post-join) severity completeness separate serious
 * injuries. For a surface that holds only the effective value, such as a filter
 * control; a surface that states availability uses `seriousInjuryAvailability`.
 */
export function separatesSeriousInjuries(effectiveCompleteness: string | null | undefined): boolean {
  return effectiveCompleteness === "kabco_full";
}

/**
 * Each registered crash source's declared severity completeness and whether it
 * has a serious-injury join, keyed by adapter id.
 *
 * A copy of what the adapters declare, kept here because this module must stay
 * client-safe and the registry imports every adapter's fetch code.
 * `src/test/serious-injury-statements-agree-across-surfaces.test.tsx` fails if
 * an entry differs from its adapter or an adapter has no entry, so a new source
 * cannot be described by a guess.
 */
export const CRASH_SOURCE_SERIOUS_INJURY: Readonly<
  Record<string, { declared: CrashSeverityCompleteness; seriousInjuryJoin: boolean }>
> = {
  "ccrs-ca": { declared: "fatal_injury_only", seriousInjuryJoin: true },
  "odot-or": { declared: "kabco_full", seriousInjuryJoin: false },
  "iowadot-ia": { declared: "kabco_full", seriousInjuryJoin: false },
  "odot-oh": { declared: "kabco_full", seriousInjuryJoin: false },
  "ddot-dc": { declared: "kabco_full", seriousInjuryJoin: false },
  "fars-national": { declared: "fatal_only", seriousInjuryJoin: false },
};

/**
 * The inputs for crashes already recorded: a stored acquisition
 * (`safety_crash_ingests.source_id`, `.severity_completeness`) or a corridor
 * run's crash snapshot (`source`, `severityCompleteness`,
 * `seriousInjuryEnrichment`).
 *
 * An acquisition records the completeness AFTER the join, not whether the join
 * ran, and no column says so. For a source whose crash file cannot separate
 * serious injury the join is the only way its record reaches `kabco_full`, so
 * the recorded value answers the question. An unregistered or missing source
 * id (or `none`, a coverage gap) keeps the recorded value as `declared` with an
 * unknown join, so nothing is claimed about a source nobody named.
 */
export function seriousInjuryInputsForRecord(record: {
  sourceId: unknown;
  severityCompleteness: unknown;
  enrichment?: unknown;
}): SeriousInjuryInputs {
  const recorded = isCrashSeverityCompleteness(record.severityCompleteness) ? record.severityCompleteness : null;
  const source =
    typeof record.sourceId === "string" && Object.hasOwn(CRASH_SOURCE_SERIOUS_INJURY, record.sourceId)
      ? CRASH_SOURCE_SERIOUS_INJURY[record.sourceId]
      : null;
  // "none" (a coverage gap) and anything unregistered: the record's own value
  // is all there is, and nothing is said about a join.
  if (!source) return { declared: recorded, enrichment: "unknown" };
  if (!source.seriousInjuryJoin) return { declared: source.declared, enrichment: "not_supported" };
  if ((ENRICHMENT_VALUES as readonly unknown[]).includes(record.enrichment)) {
    return { declared: source.declared, enrichment: record.enrichment as SeriousInjuryEnrichment };
  }
  if (recorded === null) return { declared: source.declared, enrichment: "unknown" };
  return { declared: source.declared, enrichment: recorded === "kabco_full" ? "applied" : "not_applied" };
}

/** The availability for a recorded acquisition or run snapshot. */
export function seriousInjuryAvailabilityForRecord(
  record: Parameters<typeof seriousInjuryInputsForRecord>[0]
): SeriousInjuryAvailability {
  return seriousInjuryAvailability(seriousInjuryInputsForRecord(record));
}
