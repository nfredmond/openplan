/**
 * California's RTP priority citations.
 *
 * These are the statutes OpenPlan used to apply to every agency in the country.
 * They are correct here and only here.
 *
 * What this descriptor deliberately does NOT claim: that California law
 * displaces the federal planning regulation. A California MPO is bound by both,
 * so where California adds no distinct authority — safety, asset preservation,
 * participation — this framework keeps the federal citation rather than
 * inventing a state one to fill the column.
 */
import type { RtpPriorityFrameworkDescriptor } from "../priority-frameworks";

export const US_CA_RTP_PRIORITY_FRAMEWORK: RtpPriorityFrameworkDescriptor = {
  frameworkId: "us-ca",
  label: "California — SB 743 / SB 375 planning framework",
  jurisdiction: { country: "US", subdivision: "CA" },
  framingNote:
    "Cites California statutes alongside the federal planning factors that also bind California MPOs. Where California adds no distinct authority, the federal citation is kept rather than substituted.",
  policyBasis: {
    // CEQA's transportation metric, adopted via SB 743.
    vmt_reduction: "CEQA §15064.3 · SB 743",
    // Sustainable Communities and Climate Protection Act and the state's
    // Scoping Plan.
    ghg_reduction: "SB 375 · CARB Scoping Plan",
    safety: "23 CFR 450.306(b)(2)",
    // SB 535 directs benefits to disadvantaged communities identified under
    // Health & Safety Code §39711 — a California designation that remains in
    // force, unlike the federal CEJST tool it used to be paired with here.
    equity: "Title VI · SB 535",
    // The California Complete Streets Act of 2008.
    multimodal: "Complete Streets Act (AB 1358) · 23 CFR 450.306(b)(6)",
    state_of_good_repair: "23 CFR 450.306(b)(8)",
    community_support: "23 CFR 450.316(a)",
    regional_priority: "23 CFR 450.324 · CTC RTP Guidelines",
  },
};
