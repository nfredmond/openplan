/**
 * Which VMT significance framework governs a county run, from the run's own
 * geography.
 *
 * The county run page carries a CEQA §15064.3 screen. CEQA is California law,
 * so the screen belongs only on a run whose county is in California. That fact
 * comes from the run's stored county FIPS code, not from the workspace's home
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

/** The framework covering this run's county, or null when none does or it is unknown. */
function countyRunVmtFramework(
  run: CountyRunGeography | null | undefined
): VmtSignificanceFrameworkDescriptor | null {
  if (!run || run.geography_type !== "county_fips" || !run.geography_id) return null;
  const parts = parseCountyGeoid(run.geography_id);
  const subdivision = parts ? stateUspsFromFips(parts.stateFips) : null;
  if (!subdivision) return null;
  const resolution = vmtSignificanceFrameworkRegistry.resolve({ country: "US", subdivision });
  return resolution.kind === "covered" ? resolution.framework : null;
}

/** True only when the run's county is governed by CEQA §15064.3. */
export function countyRunShowsCeqaScreen(run: CountyRunGeography | null | undefined): boolean {
  return countyRunVmtFramework(run)?.frameworkId === US_CA_CEQA_15064_3_FRAMEWORK.frameworkId;
}
