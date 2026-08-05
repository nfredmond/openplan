// The registered jurisdiction bundles themselves.
//
// Separate from ./index.ts, which is the barrel every call site imports: the
// coverage resolver needs the registration list, and importing it back through
// the barrel that also exports the resolver would make the module graph
// circular. Registration lives here; ./index.ts re-exports it unchanged.
//
// Adding a state or a country means authoring a sibling bundle module (e.g.
// `us-oh.ts`, `ca-on.ts`) and adding it to GRANT_PROGRAM_BUNDLES below. Nothing
// downstream changes: consumers keep importing GRANT_PROGRAM_CATALOG and see
// every registered bundle flattened, in registration order, and coverage
// labeling follows from the jurisdiction the new bundle declares about itself.

import type { GrantProgramBundle, GrantProgramCatalogEntry } from "./types";
import { usCaPrograms } from "./us-ca";
import { usCoPrograms } from "./us-co";
import { usFederalPrograms } from "./us-federal";
import { usOrPrograms } from "./us-or";
import { usWaPrograms } from "./us-wa";

/** Every registered jurisdiction bundle, in registration order. */
export const GRANT_PROGRAM_BUNDLES: readonly GrantProgramBundle[] = [
  usFederalPrograms,
  usCaPrograms,
  usWaPrograms,
  usOrPrograms,
  usCoPrograms,
];

/** The full catalog: every registered bundle's programs, flattened. */
export const GRANT_PROGRAM_CATALOG: readonly GrantProgramCatalogEntry[] =
  GRANT_PROGRAM_BUNDLES.flatMap((bundle) => bundle.programs);
