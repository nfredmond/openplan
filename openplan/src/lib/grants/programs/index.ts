// Jurisdiction registry for the grant program catalog.
//
// Each bundle module carries one jurisdiction's curated programs. Adding
// another state or country means adding a bundle module (e.g. `us-tx.ts`,
// `ca-on.ts`) and registering it in GRANT_PROGRAM_BUNDLES below — call sites
// never change: they keep importing GRANT_PROGRAM_CATALOG and see every
// registered bundle flattened, in registration order.

import type { GrantProgramBundle, GrantProgramCatalogEntry } from "./types";
import { usCaPrograms } from "./us-ca";
import { usFederalPrograms } from "./us-federal";

export type {
  GrantApplicationAttachmentTemplate,
  GrantApplicationEvidenceKind,
  GrantApplicationSectionTemplate,
  GrantProgramBundle,
  GrantProgramCatalogEntry,
  GrantProgramLevel,
} from "./types";
export { GRANT_APPLICATION_EVIDENCE_KINDS } from "./types";
export { usCaPrograms } from "./us-ca";
export { usFederalPrograms } from "./us-federal";

/** Every registered jurisdiction bundle, in registration order. */
export const GRANT_PROGRAM_BUNDLES: readonly GrantProgramBundle[] = [
  usFederalPrograms,
  usCaPrograms,
];

/** The full catalog: every registered bundle's programs, flattened. */
export const GRANT_PROGRAM_CATALOG: readonly GrantProgramCatalogEntry[] =
  GRANT_PROGRAM_BUNDLES.flatMap((bundle) => bundle.programs);

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
