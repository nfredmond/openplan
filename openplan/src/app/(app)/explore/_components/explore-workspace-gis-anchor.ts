import type { WorkspaceGisMapTarget } from "@/lib/cartographic/workspace-gis-map-layers";

/**
 * Corridor Analysis's own subject layers, TOP TO BOTTOM as
 * `explore-analysis-layer-install.ts` adds them.
 *
 * The list is here rather than exported from the installer because it is a
 * statement about MEANING, not about installation: these are the layers that
 * carry the finding on this page. A layer added to the installer for some other
 * purpose — a scratch overlay, a highlight — should not silently become the
 * thing the agency's reference layers hide behind.
 */
const EXPLORE_SUBJECT_LAYER_IDS = [
  "analysis-fill",
  "analysis-outline",
  "analysis-points",
  "crash-points-glow",
  "crash-points-core",
] as const;

/**
 * The layer a workspace's uploaded layers sit immediately BELOW on this page.
 *
 * ── WHY BENEATH EVERYTHING, ALWAYS ──
 *
 * Same doctrine as the shell backdrop's anchor, and for the same hard reason.
 * An agency's uploaded layers are REFERENCE — parcels, city limits, a bike
 * network — and what Corridor Analysis draws is the SUBJECT: the corridor the
 * planner asked about, the tracts it runs through, the crashes on it. A parcel
 * fabric drawn over the corridor would bury the finding the page exists to
 * show, and — worse, because it is silent — a viewport-filling polygon on top
 * eats every click and hover on this map. The planner would point at a crash and
 * get a parcel.
 *
 * The tract choropleth comes first when it is present because it is the widest
 * area layer and everything else is drawn over it; below the tracts is the only
 * position from which a reference layer is under the whole finding rather than
 * under part of it.
 *
 * Returns `undefined` when nothing is installed yet, which Mapbox reads as "on
 * top" — correct, because with no subject layers present there is nothing to be
 * buried under, and the binding re-stacks on every paint once they arrive.
 */
export function exploreWorkspaceGisAnchorLayerId(
  map: WorkspaceGisMapTarget,
): string | undefined {
  if (map.getLayer("tract-fill")) return "tract-fill";
  return EXPLORE_SUBJECT_LAYER_IDS.find((id) => map.getLayer(id));
}
