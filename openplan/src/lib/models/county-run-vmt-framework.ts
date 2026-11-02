/**
 * Which VMT significance framework governs a county run, from the run's own
 * geography.
 *
 * The county run page carries a CEQA §15064.3 screen. CEQA is California law,
 * so the screen belongs only on a run whose geography is in California. That fact
 * comes from the run's stored county FIPS code or place GEOID, not from the workspace's home
 * geography: a California consultant can run a county in Nevada, and that
 * run is not subject to CEQA.
 *
 * The answer comes from the VMT framework registry, so a framework registered
 * for another state later resolves here without editing the page.
 */

import { stateUspsFromFips } from "@/lib/geographies/state-fips";
import { US_CA_CEQA_15064_3_FRAMEWORK } from "@/lib/planner-pack/frameworks/us-ca-ceqa-15064-3";
import {
  vmtSignificanceFrameworkRegistry,
  type VmtSignificanceFrameworkDescriptor,
} from "@/lib/planner-pack/vmt-significance-frameworks";
import { parseCountyGeoid } from "@/lib/safety/county-code";

export type CountyRunGeography = {
  geography_type: string | null | undefined;
  geography_id: string | null | undefined;
};

/**
 * The state FIPS code a run's own geography names, or null when it names none.
 *
 * A "place" run stores the picked place's Census GEOID. An incorporated place
 * or CDP GEOID (7 digits) and a county subdivision GEOID (10 digits) both
 * begin with the state code. A metro or micro area's CBSA code and a tribal
 * area's code name no state, so they stay unknown.
 */
function runStateFips(run: CountyRunGeography): string | null {
  const id = run.geography_id?.trim();
  if (!id) return null;
  if (run.geography_type === "county_fips") return parseCountyGeoid(id)?.stateFips ?? null;
  if (run.geography_type === "place" && /^(\d{7}|\d{10})$/.test(id)) return id.slice(0, 2);
  return null;
}

/** The framework covering this run's geography, or null when none does or it is unknown. */
function countyRunVmtFramework(
  run: CountyRunGeography | null | undefined
): VmtSignificanceFrameworkDescriptor | null {
  if (!run) return null;
  const stateFips = runStateFips(run);
  const subdivision = stateFips ? stateUspsFromFips(stateFips) : null;
  if (!subdivision) return null;
  const resolution = vmtSignificanceFrameworkRegistry.resolve({ country: "US", subdivision });
  return resolution.kind === "covered" ? resolution.framework : null;
}

/** True only when the run's county or place is governed by CEQA §15064.3. */
export function countyRunShowsCeqaScreen(run: CountyRunGeography | null | undefined): boolean {
  return countyRunVmtFramework(run)?.frameworkId === US_CA_CEQA_15064_3_FRAMEWORK.frameworkId;
}
