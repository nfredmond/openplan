import type { GrantProgramCoverageEntry } from "./program-catalog";

/** Search the displayed catalog text without changing coverage or program records. */
export function filterGrantProgramCatalog(
  entries: readonly GrantProgramCoverageEntry[],
  query: string
): readonly GrantProgramCoverageEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return entries;

  return entries.filter(({ program, bundle }) => {
    const text = [
      program.name,
      program.administeringAgency,
      ...program.eligibleProjectTypes,
      program.summary,
      program.typicalApplicants,
      program.cycleNote,
      program.matchRequirement,
      program.bcaNote ?? "",
      program.level,
      bundle.scopeLabel,
    ].join(" ").toLowerCase();

    return terms.every((term) => text.includes(term));
  });
}
