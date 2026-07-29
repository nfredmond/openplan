/**
 * California — CEQA §15064.3 VMT significance framework.
 *
 * Everything jurisdiction-specific about California's VMT significance process —
 * the statute a determination cites, the percent-below-reference cut line OPR
 * recommends, the reference baseline to pre-fill, and the caveat California puts
 * on screening-level output — lives on this descriptor so the registry, the API
 * route, the persisted record, and the UI stay jurisdiction-neutral.
 *
 * Adding another jurisdiction's VMT significance process means adding a sibling
 * descriptor file and one registration entry in
 * `src/lib/planner-pack/vmt-significance-frameworks.ts` — never editing a call
 * site. That is the same shape `src/lib/invoicing/profiles/us-ca-lapm.ts` uses
 * for Caltrans LAPM reimbursement.
 *
 * The citation and caveat strings are the ones OpenPlan has always shown
 * (`src/lib/models/ceqa-vmt-screen.ts`), imported rather than retyped: they are
 * ported verbatim from the memo renderer, whose header states that "every caveat,
 * statutory citation, and disclaimer string is preserved verbatim … the wording
 * that says so must not drift". A determination stored years ago must still read
 * as the thing that was issued.
 */

import {
  CEQA_SCREENING_CAVEAT,
  CEQA_STATUTORY_CITATION,
} from "@/lib/models/ceqa-vmt-screen";
import {
  DEFAULT_REFERENCE_VMT_PER_CAPITA,
  OPR_DEFAULT_THRESHOLD_PCT,
} from "@/lib/planner-pack/ceqa";
import type { VmtSignificanceFrameworkDescriptor } from "@/lib/planner-pack/vmt-significance-frameworks";

export const US_CA_CEQA_15064_3_FRAMEWORK: VmtSignificanceFrameworkDescriptor = {
  frameworkId: "us_ca_ceqa_15064_3_v1",
  frameworkName: "CEQA §15064.3 VMT significance screening",
  version: "1.0.0",
  jurisdiction: { country: "US", subdivision: "CA", label: "California, United States" },
  scopeStatement:
    "CEQA §15064.3 applies to projects subject to review under the California Environmental Quality Act. " +
    "It is California state law and creates no transportation-impact significance standard outside California.",
  statutoryCitation: CEQA_STATUTORY_CITATION,
  screeningCaveat: CEQA_SCREENING_CAVEAT,
  // The Governor's Office of Planning and Research Technical Advisory (December
  // 2018) recommends 15 percent below the regional or citywide reference as the
  // default residential screening threshold. A lead agency may adopt another.
  defaultThresholdPct: OPR_DEFAULT_THRESHOLD_PCT,
  defaultThresholdRationale:
    "Governor's Office of Planning and Research, Technical Advisory on Evaluating Transportation Impacts in CEQA (December 2018): 15 percent below the regional or citywide VMT-per-capita baseline is the recommended default residential screening threshold. A lead agency may adopt a different threshold with substantial evidence.",
  // A California statewide average, which is precisely why it belongs on a
  // California descriptor rather than in shared code. The constant still lives in
  // `ceqa.ts` because the ported engine and the sketch-ABM benchmark both read it
  // there; importing it keeps one number rather than two that can drift.
  defaultReferenceVmtPerCapita: DEFAULT_REFERENCE_VMT_PER_CAPITA,
  defaultReferenceRationale:
    "California statewide average total VMT per capita (FHWA Highway Statistics 2022–2023, Table PS-1: 21.8–21.9 mi/day). This is total travel on public roads divided by resident population — a coarse screening reference, not the narrower resident-generated VMT the residential efficiency metric contemplates. Replace it with your region's adopted baseline where one exists.",
};
