/**
 * The United States nationwide floor for RTP priority citations.
 *
 * What this descriptor deliberately does NOT claim:
 *
 *   - It is not a state framework. It cites the federal metropolitan planning
 *     regulation, which binds every MPO in the country, and says nothing about
 *     any individual state's law. A workspace in a state with its own adopted
 *     framework should get that state's descriptor instead.
 *   - It does not assert that a project SATISFIES any of these provisions. The
 *     planning factors are what an MPO must CONSIDER (23 CFR 450.306(a)); a
 *     planner's 0–3 rating is an attestation about their own project, and the
 *     citation names the factor that rating speaks to.
 *   - It cites no executive order. The basis this framework replaced for the
 *     equity criterion was "Justice40", which EO 14148 revoked on 2025-01-20
 *     together with EO 14008 and the CEJST screening tool. Every citation
 *     below is statute or regulation, which changes through notice and
 *     comment rather than overnight.
 *
 * Every citation was read against the regulation's own text before being
 * written here.
 */
import type { RtpPriorityFrameworkDescriptor } from "../priority-frameworks";

export const US_FEDERAL_GENERIC_RTP_PRIORITY_FRAMEWORK: RtpPriorityFrameworkDescriptor = {
  frameworkId: "us-federal-generic",
  label: "United States — federal metropolitan planning factors",
  jurisdiction: { country: "US", subdivision: null },
  isInterimDefault: true,
  framingNote:
    "Cites the federal planning factors and participation requirements that apply to metropolitan transportation planning nationwide. It does not reflect any individual state's statutes; a state framework supersedes it where one is registered.",
  policyBasis: {
    // 23 CFR 450.306(b)(5): "Protect and enhance the environment, promote
    // energy conservation, improve the quality of life". VMT and GHG are the
    // two measures this factor is most often demonstrated through; there is
    // no federal VMT or GHG mandate to cite, and inventing one would be the
    // same defect this registry exists to fix.
    vmt_reduction: "23 CFR 450.306(b)(5)",
    ghg_reduction: "23 CFR 450.306(b)(5)",
    // "Increase the safety of the transportation system for motorized and
    // non-motorized users".
    safety: "23 CFR 450.306(b)(2)",
    // Title VI of the Civil Rights Act of 1964 (42 U.S.C. 2000d) plus the
    // planning regulation's own obligation at 23 CFR 450.316(a)(1)(vii):
    // "Seeking out and considering the needs of those traditionally
    // underserved by existing transportation systems, such as low-income and
    // minority households".
    equity: "Title VI · 23 CFR 450.316(a)(1)(vii)",
    // "Enhance the integration and connectivity of the transportation system,
    // across and between modes".
    multimodal: "23 CFR 450.306(b)(6)",
    // "Emphasize the preservation of the existing transportation system".
    state_of_good_repair: "23 CFR 450.306(b)(8)",
    // The participation plan the MPO must develop and follow.
    community_support: "23 CFR 450.316(a)",
    // The metropolitan transportation plan itself.
    regional_priority: "23 CFR 450.324",
  },
};
