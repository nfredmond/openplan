/**
 * The one place the CRS registry is bound to the workspace-GIS lane.
 *
 * ═══ WHY THIS FILE EXISTS, AND WHAT SHIPPED WITHOUT IT ═══
 *
 * `crs-resolution.ts` is deliberately written against a REGISTRY INTERFACE
 * rather than against the generated table: the table is ~1.4 MB of server-side
 * data, and binding to it directly would make "what does OpenPlan do when the
 * registry is absent?" impossible to test. That design is right and it stays.
 *
 * What it originally lacked was a caller. The registry was expected to register
 * ITSELF at import time, and nothing ever did — so on a running deployment the
 * resolver held no registry, `resolveWorkspaceGisCrs` answered
 * `crs_registry_unavailable`, and the ingest route refused every projected
 * shapefile with a 422. The refusal was honest, which is why nothing looked
 * broken; but a State Plane shapefile in survey feet is the common legacy case
 * and the entire reason this lane was built, so the capability was unreachable
 * in production while every test passed. An ambient registration that one
 * module is trusted to perform is invisible when it does not happen.
 *
 * The fix is to make the dependency IMPOSSIBLE TO OMIT rather than merely
 * documented: `resolveWorkspaceGisCrs` now takes the registry as a required
 * argument, so a call site that has not decided which registry it is resolving
 * against does not compile. This module is what a server route passes. Tests
 * pass a fake — or `null`, which is how the honest-refusal branch stays
 * reachable and proved.
 *
 * SERVER-SIDE ONLY. Importing this reaches `@/lib/geo/crs/registry` and through
 * it the generated table; it must never appear in a client component. The
 * browser receives the ONE entry the server resolved, via `/api/geo/crs`.
 */

import { findCrsByCode, identifyCrsFromPrj } from "@/lib/geo/crs/registry";
import type { CrsRegistryEntry } from "@/lib/geo/crs/types";
import type {
  WorkspaceGisCrsEntry,
  WorkspaceGisCrsRegistry,
} from "./crs-resolution";

/**
 * A registry entry narrowed to what this lane is allowed to know.
 *
 * The projection parameters are deliberately dropped. Nothing in the
 * workspace-GIS store reprojects anything — the browser does that with the
 * entry `/api/geo/crs` handed it — and an entry carrying the arithmetic into
 * the store would invite a second, divergent reprojection path. What survives
 * is the identity a planner recognises, the unit (because feet-read-as-metres
 * is the commonest legacy mistake and the version record has to be able to say
 * which it was), and the datum caveat that must ride with the layer forever.
 */
function toWorkspaceGisEntry(entry: CrsRegistryEntry): WorkspaceGisCrsEntry {
  return {
    authority: entry.authority,
    code: entry.code,
    name: entry.name,
    unit: entry.unit,
    kind: entry.kind,
    datum: entry.datum,
    requiresDatumAcknowledgement: entry.requiresDatumAcknowledgement,
    datumShiftNote: entry.datumShiftNote,
  };
}

/**
 * The real registry, as this lane consumes it.
 *
 * Both lookups refuse rather than approximate, which is the registry's own
 * contract: a `.prj` naming a system OpenPlan does not carry resolves to null
 * and becomes a refusal that names the system, never the nearest zone that
 * happens to be implemented.
 */
export const WORKSPACE_GIS_CRS_REGISTRY: WorkspaceGisCrsRegistry = {
  fromPrj(prjText: string): WorkspaceGisCrsEntry | null {
    const identification = identifyCrsFromPrj(prjText);
    return identification.ok ? toWorkspaceGisEntry(identification.entry) : null;
  },
  byCode(authorityCode: string): WorkspaceGisCrsEntry | null {
    const entry = findCrsByCode(authorityCode);
    return entry ? toWorkspaceGisEntry(entry) : null;
  },
};
