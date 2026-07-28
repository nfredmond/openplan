// Jurisdiction registry for the grant program catalog — the barrel every call
// site imports.
//
// Each bundle module carries one jurisdiction's curated programs and declares
// where those programs apply. Registration lives in `./registry.ts` (adding a
// state or country means adding a bundle module and one entry there); coverage
// — which of the registered programs a given workspace can actually apply to,
// and how the rest must be labeled — lives in `./coverage.ts`. Call sites never
// change: they keep importing GRANT_PROGRAM_CATALOG and see every registered
// bundle flattened, in registration order.

import type { GrantProgramCatalogEntry } from "./types";

export type {
  GrantApplicationAttachmentTemplate,
  GrantApplicationEvidenceKind,
  GrantApplicationSectionTemplate,
  GrantProgramBundle,
  GrantProgramCatalogEntry,
  GrantProgramJurisdiction,
  GrantProgramLevel,
} from "./types";
export { GRANT_APPLICATION_EVIDENCE_KINDS } from "./types";
export { usCaPrograms } from "./us-ca";
export { usFederalPrograms } from "./us-federal";
export { GRANT_PROGRAM_BUNDLES, GRANT_PROGRAM_CATALOG } from "./registry";
export {
  describeGrantProgramCoverage,
  listGrantProgramsWithBundle,
  type GrantProgramBundleCoverage,
  type GrantProgramBundleScope,
  type GrantProgramCoverage,
  type GrantProgramCoverageDisclosure,
  type GrantProgramCoverageEntry,
  type GrantProgramCoverageGapReason,
  type GrantProgramJurisdictionQuery,
} from "./coverage";

export function isGrantProgramTracked(
  program: Pick<GrantProgramCatalogEntry, "name">,
  trackedTitles: Iterable<string>
): boolean {
  const normalized = program.name.trim().toLowerCase();
  for (const title of trackedTitles) {
    if (title.trim().toLowerCase() === normalized) {
      return true;
    }
  }
  return false;
}
