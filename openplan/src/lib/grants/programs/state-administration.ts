/**
 * Lay a state's administration of a federal program over the federal entry.
 *
 * Several federal programs reach local agencies through a state pass-through:
 * the state DOT runs the call, sets the cycle, and sometimes names its own
 * benefit/cost tool. Those facts differ by state, so they live in the state's
 * bundle (`federalProgramAdministration`) and the federal entry stays true in
 * every state. A planner in Ohio reads the federal text; a planner in
 * California reads California's.
 *
 * Matching is exact on country and subdivision, the same rule
 * `describeGrantProgramCoverage` uses for a jurisdiction-scoped bundle. A
 * workspace with no stated subdivision gets the federal text, which is correct
 * everywhere, never a guessed state's.
 */

import { GRANT_PROGRAM_BUNDLES } from "./registry";
import type {
  GrantProgramBundle,
  GrantProgramCatalogEntry,
  GrantProgramJurisdiction,
  GrantProgramStateAdministration,
} from "./types";

/** Where the workspace works; the shape `resolveJurisdiction()` returns. */
export type GrantProgramAdministrationQuery = {
  country: string;
  subdivision?: string | null;
};

/** One state's administration of a federal program, with the state it belongs to. */
export type GrantProgramStateAdministrationEntry = {
  jurisdiction: GrantProgramJurisdiction;
  administration: GrantProgramStateAdministration;
};

function normalized(code: string | null | undefined): string | null {
  const trimmed = code?.trim().toUpperCase();
  return trimmed ? trimmed : null;
}

/** Every registered state's administration of one federal program, in registration order. */
export function listStateAdministrationFor(
  programKey: string,
  bundles: readonly GrantProgramBundle[] = GRANT_PROGRAM_BUNDLES
): GrantProgramStateAdministrationEntry[] {
  return bundles.flatMap((bundle) =>
    bundle.jurisdiction.subdivision === undefined
      ? []
      : (bundle.federalProgramAdministration ?? [])
          .filter((administration) => administration.programKey === programKey)
          .map((administration) => ({ jurisdiction: bundle.jurisdiction, administration }))
  );
}

/** The administration a workspace in `query` gets for `programKey`, or null. */
export function findStateAdministration(
  programKey: string,
  query: GrantProgramAdministrationQuery | null | undefined,
  bundles: readonly GrantProgramBundle[] = GRANT_PROGRAM_BUNDLES
): GrantProgramStateAdministration | null {
  const country = normalized(query?.country);
  const subdivision = normalized(query?.subdivision);
  if (!country || !subdivision) return null;

  const match = listStateAdministrationFor(programKey, bundles).find(
    ({ jurisdiction }) =>
      normalized(jurisdiction.country) === country && normalized(jurisdiction.subdivision) === subdivision
  );
  return match?.administration ?? null;
}

/**
 * The program as a workspace in `query` should read it: the federal entry with
 * its state's administration laid over it, or the entry unchanged when no
 * registered state administers it there. Section and attachment keys, order,
 * evidence and drafting permissions always come from the federal entry; a state
 * changes only the words.
 */
export function resolveGrantProgramForJurisdiction(
  program: GrantProgramCatalogEntry,
  query: GrantProgramAdministrationQuery | null | undefined,
  bundles: readonly GrantProgramBundle[] = GRANT_PROGRAM_BUNDLES
): GrantProgramCatalogEntry {
  if (program.level !== "federal") return program;
  const administration = findStateAdministration(program.key, query, bundles);
  if (!administration) return program;

  return {
    ...program,
    administeringAgency: administration.administeringAgency ?? program.administeringAgency,
    typicalApplicants: administration.typicalApplicants ?? program.typicalApplicants,
    cycleNote: administration.cycleNote ?? program.cycleNote,
    matchRequirement: administration.matchRequirement ?? program.matchRequirement,
    url: administration.url ?? program.url,
    summary: administration.summary ?? program.summary,
    bcaNote: administration.bcaNote ?? program.bcaNote,
    applicationSections: program.applicationSections?.map((section) => {
      const text = administration.sections?.[section.key];
      return text ? { ...section, title: text.title ?? section.title, guidance: text.guidance } : section;
    }),
    requiredAttachments: program.requiredAttachments?.map((attachment) => {
      const text = administration.attachments?.[attachment.key];
      return text ? { ...attachment, title: text.title ?? attachment.title, guidance: text.guidance } : attachment;
    }),
  };
}
