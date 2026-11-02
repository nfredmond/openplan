// United States, Colorado — state grant programs.
//
// Curated catalog entries for Colorado state transportation funding programs
// relevant to small and rural agencies. This is static reference data, not a
// live opportunity feed. Cycle timing is phrased as guidance text on purpose —
// funding cycles shift, so every entry tells the operator where to verify the
// current call instead of asserting a deadline. URLs point at the official
// program pages, each fetched and verified when these entries were authored.
//
// Deliberately absent, decided at authoring time from the live pages:
//   - Revitalizing Main Streets — CDOT's page states the program "no longer
//     has funding allocations to award future grants"; a defunded program is
//     not a funding menu entry.
//   - "CDOT planning grant cycles" — no standing CDOT planning-grant program
//     for local agencies exists; planning-study work routes through MMOF,
//     whose entry below says so.

import type { GrantProgramBundle, GrantProgramCatalogEntry } from "./types";

const programs: readonly GrantProgramCatalogEntry[] = [
  {
    key: "co-mmof",
    name: "Multimodal Transportation and Mitigation Options Fund (MMOF)",
    administeringAgency:
      "Colorado Department of Transportation (CDOT), with the local share awarded through Transportation Planning Regions (TPRs) and MPOs",
    level: "state",
    typicalApplicants:
      "State and local governments, special-purpose and transit agencies, school districts, and nonprofits with authority to lead eligible projects; small cities and counties apply through their TPR or MPO",
    eligibleProjectTypes: [
      "Fixed-route and on-demand transit (capital or operating)",
      "Transportation demand management programs",
      "Multimodal mobility projects enabled by emerging technology",
      "Multimodal transportation studies and planning",
      "Bicycle and pedestrian projects",
      "Modeling tools",
      "Greenhouse gas mitigation projects that reduce VMT or increase multimodal travel",
    ],
    cycleNote:
      "Currently between funding cycles; each TPR or MPO runs its own selection timeline — verify with the CDOT MMOF page and your regional planning agency.",
    matchRequirement:
      "The program page states a 50% match (federal, state, or local sources), automatically reduced or eliminated for some local governments under a Transportation Commission matrix — verify your community's rate with your TPR.",
    url: "https://www.codot.gov/programs/planning/grants/mmof-local",
    summary:
      "MMOF is Colorado's flagship state-funded multimodal grant, created by SB18-001 and expanded — and renamed to add \"Mitigation\" — by SB21-260, with the local share distributed through the Transportation Planning Regions and MPOs as locally selected competitive awards. Its scope is unusually broad, from transit operations and bike/ped infrastructure to planning studies, modeling tools, and greenhouse-gas mitigation; CDOT has no separate standing planning-grant program for local agencies, so planning-study work routes through MMOF. CDOT indicates the program is between funding cycles, with no new calls generally expected in the near term.",
    applicationSections: [
      {
        key: "project-narrative",
        title: "Project description and scope",
        guidance:
          "Describe the multimodal project or planning study and what it delivers. Applications run through your TPR or MPO's own call — verify its application outline and the statewide Program Guide on the CDOT MMOF page.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "multimodal-and-ghg-benefit",
        title: "Multimodal and greenhouse-gas benefit",
        guidance:
          "Explain how the project increases multimodal travel or reduces vehicle miles traveled. Verify how your TPR or MPO's current selection criteria score these benefits before drafting.",
        suggestedEvidence: ["project", "modeling", "kb"],
      },
      {
        key: "regional-selection-alignment",
        title: "Regional selection alignment",
        guidance:
          "Show how the project fits your TPR or MPO's regional priorities and selection criteria — each region runs its own process. Verify the current criteria with your regional planning agency.",
        suggestedEvidence: ["project", "engagement", "kb"],
      },
      {
        key: "budget-and-match",
        title: "Budget and match computation",
        guidance:
          "The budget and the match computation — including any Transportation Commission matrix reduction — are finance work products, never AI-drafted. Verify your community's match rate in the current Program Guide and with your TPR.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "cost-estimate",
        title: "Cost estimate",
        guidance: "Itemized estimate for the project or study. Verify your TPR or MPO's estimate expectations in its current call materials.",
        required: true,
      },
      {
        key: "match-documentation",
        title: "Match documentation",
        guidance: "Documentation of the match sources and any matrix-based reduction claimed. Verify accepted forms with your TPR and the current Program Guide.",
        required: true,
      },
      {
        key: "regional-call-materials",
        title: "Regional call-specific materials",
        guidance: "Each TPR or MPO's call carries its own forms and exhibits. Verify the full materials list with your regional planning agency.",
        required: false,
      },
    ],
  },
  {
    key: "co-srts",
    name: "Colorado Safe Routes to School (SRTS)",
    administeringAgency: "Colorado Department of Transportation (CDOT), Bicycle and Pedestrian Section",
    level: "state",
    typicalApplicants:
      "Political subdivisions of the state — school districts, schools, cities, counties, state and tribal entities; nonprofits only in partnership with a political subdivision",
    eligibleProjectTypes: [
      "Infrastructure projects: sidewalks, signalized crosswalks, bike lanes, lighting and other improvements around schools",
      "Non-infrastructure projects: education, encouragement, engagement, and planning initiatives (e.g., walking school bus programs)",
    ],
    cycleNote:
      "Active recurring program, currently between cycles — verify anticipated open dates on the CDOT Safe Routes to School grant application page.",
    matchRequirement:
      "Qualifying communities receive 100% funding based on the MMOF match matrix; other applicants provide a local match that varies by project type — verify your standing in the current application guidelines.",
    url: "https://www.codot.gov/programs/bikeped/saferoutes",
    summary:
      "Colorado SRTS is an active, recurring CDOT-administered grant program — the first state SRTS program in the country — funding both infrastructure and education/encouragement projects that make walking and biking to school safe, with eligibility extending through high schools. Its cycles publish application guidelines, top-scoring sample applications for both project types, a community engagement toolkit, and post-award templates, and awards are announced in the spring following a fall deadline.",
    applicationSections: [
      {
        key: "project-narrative",
        title: "Project description and scope",
        guidance:
          "Describe the infrastructure or non-infrastructure project and the school community it serves. Verify the current cycle's application guidelines and the published sample applications on the CDOT SRTS page.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "school-travel-safety-need",
        title: "School travel safety need",
        guidance:
          "Document the safety problem for children walking and biking to school: crash history, speeds, crossings, and gaps. Verify the current cycle's required data sources with CDOT before drafting.",
        suggestedEvidence: ["project", "modeling", "kb"],
      },
      {
        key: "education-and-encouragement-plan",
        title: "Education, encouragement, and engagement plan",
        guidance:
          "For non-infrastructure work, describe the education, encouragement, and engagement activities and the partners delivering them. Verify eligible activities and the community engagement toolkit on the CDOT SRTS page.",
        suggestedEvidence: ["engagement", "kb"],
      },
      {
        key: "budget-and-cost-estimate",
        title: "Budget and cost estimate",
        guidance:
          "Budget figures come from the engineer's estimate and finance staff, never from AI drafting. Verify the current cycle's budget-tracking templates and your match standing in the application guidelines.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "engineers-cost-estimate",
        title: "Engineer's cost estimate",
        guidance: "Itemized estimate for infrastructure projects. Verify the current cycle's estimate expectations in the application guidelines.",
        required: true,
      },
      {
        key: "school-partnership-documentation",
        title: "School partnership documentation",
        guidance: "Documentation of the school or district partnership behind the project. Verify what the current guidelines accept as partnership evidence.",
        required: true,
      },
      {
        key: "existing-conditions-photos",
        title: "Existing conditions photos",
        guidance: "Photos documenting current conditions on the school route. Verify quantity and labeling expectations in the current application guidelines.",
        required: false,
      },
    ],
  },
];

export const usCoPrograms: GrantProgramBundle = {
  key: "us-co",
  label: "Colorado state programs",
  // Subdivision-scoped: an agency outside Colorado cannot apply to these, so
  // the catalog must say so rather than list them as if it could.
  jurisdiction: { country: "US", subdivision: "CO", label: "Colorado" },
  programs,
};
