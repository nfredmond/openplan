// United States, Washington — state grant programs.
//
// Curated catalog entries for Washington state transportation funding programs
// relevant to small and rural agencies. This is static reference data, not a
// live opportunity feed. Cycle timing is phrased as guidance text on purpose —
// funding cycles shift, so every entry tells the operator where to verify the
// current call instead of asserting a deadline. URLs point at the official
// program pages, each fetched and verified when these entries were authored.

import type { GrantProgramBundle, GrantProgramCatalogEntry } from "./types";

const programs: readonly GrantProgramCatalogEntry[] = [
  {
    key: "wa-tib-uap",
    name: "TIB Urban Arterial Program (UAP)",
    administeringAgency: "Washington State Transportation Improvement Board (TIB)",
    level: "state",
    typicalApplicants: "Cities with population 5,000 or greater, and counties with urban unincorporated areas",
    eligibleProjectTypes: [
      "Arterial street improvements addressing safety",
      "Commercial growth and development access",
      "Mobility improvements",
      "Roadway physical condition and reconstruction",
    ],
    cycleNote:
      "Annual call for projects — opens late spring, applications due in summer, awards at TIB's November board meeting; verify current dates on tib.wa.gov.",
    matchRequirement:
      "Local match of 10 to 20 percent scaled to the agency's assessed valuation — verify your band in the current TIB guidelines.",
    url: "https://www.tib.wa.gov/grants/grants.cfm",
    summary:
      "TIB's flagship urban program funds arterial street projects in larger cities and urban county areas, scored against safety, commercial growth and development, mobility, and physical-condition criteria. TIB is an independent state agency funded by a share of the statewide gas tax, and it runs an annual call for projects with applications submitted through its online funding portal and awards made at the November board meeting.",
    applicationSections: [
      {
        key: "project-narrative",
        title: "Project description and scope",
        guidance:
          "Describe the arterial improvement: limits, elements, and how they address the program's criteria. Verify the current call's application questions in TIB's online funding portal — TIB also runs pre-application funding workshops each spring.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "safety-and-condition-need",
        title: "Safety and roadway condition need",
        guidance:
          "Document the safety history and pavement or geometric deficiencies the project corrects. Verify the current cycle's scoring criteria and required data with TIB before drafting.",
        suggestedEvidence: ["project", "modeling", "kb"],
      },
      {
        key: "mobility-and-growth",
        title: "Mobility and commercial growth benefits",
        guidance:
          "Explain how the project improves mobility and supports commercial growth and development, the program's other scored criteria. Verify how the current cycle weights each band with TIB.",
        suggestedEvidence: ["project", "modeling", "kb"],
      },
      {
        key: "budget-and-cost-estimate",
        title: "Budget and cost estimate",
        guidance:
          "Budget figures come from the engineer's estimate and finance staff, never from AI drafting. Verify the current cycle's estimate format and match computation with TIB.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "engineers-cost-estimate",
        title: "Engineer's cost estimate",
        guidance: "Itemized estimate supporting the funding request. Verify the current cycle's estimate expectations with TIB.",
        required: true,
      },
      {
        key: "location-vicinity-map",
        title: "Project location and vicinity map",
        guidance: "Map showing project limits and arterial context. Verify format expectations in the current application instructions.",
        required: true,
      },
      {
        key: "existing-conditions-photos",
        title: "Existing conditions photos",
        guidance: "Photos documenting current conditions on the corridor. Verify quantity and labeling expectations with TIB.",
        required: false,
      },
    ],
  },
  {
    key: "wa-tib-scap",
    name: "TIB Small City Arterial Program (SCAP)",
    administeringAgency: "Washington State Transportation Improvement Board (TIB)",
    level: "state",
    typicalApplicants: "Incorporated cities and towns with population under 5,000",
    eligibleProjectTypes: [
      "Preservation of TIB-classified arterial streets",
      "Rehabilitation of arterial streets",
      "Reconstruction of arterial streets consistent with local needs",
    ],
    cycleNote:
      "Shares TIB's annual call — late-spring opening, summer deadline, awards at the November board meeting; verify current dates on tib.wa.gov.",
    matchRequirement:
      "Valuation-scaled small-city match, from no match for the lowest-valuation towns up to 10% — verify your band in the current TIB guidelines.",
    url: "https://www.tib.wa.gov/grants/grants.cfm",
    summary:
      "SCAP funds preservation, rehabilitation, and reconstruction of TIB-classified arterial streets in Washington's incorporated cities and towns under 5,000 population. It shares TIB's annual call-for-projects cycle, and its match requirement scales with assessed valuation down to zero for the smallest communities — the core TIB street-construction program for small cities.",
    applicationSections: [
      {
        key: "project-scope",
        title: "Project description and scope",
        guidance:
          "Describe the arterial work: preservation, rehabilitation, or reconstruction, and the limits. Verify the current call's application questions in TIB's online funding portal.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "arterial-condition-need",
        title: "Arterial condition and safety need",
        guidance:
          "Document the street's condition and the safety or serviceability problem the project corrects. Verify the current cycle's condition-data expectations with TIB.",
        suggestedEvidence: ["project", "modeling", "kb"],
      },
      {
        key: "local-needs-consistency",
        title: "Consistency with local needs",
        guidance:
          "Explain how the project reflects local needs and any adopted local plans. Verify what the current cycle asks for as local-consistency documentation with TIB.",
        suggestedEvidence: ["project", "engagement", "kb"],
      },
      {
        key: "budget-and-cost-estimate",
        title: "Budget and cost estimate",
        guidance:
          "Budget figures come from the engineer's estimate and finance staff, never from AI drafting. Verify the current cycle's estimate format and your match band with TIB.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "engineers-cost-estimate",
        title: "Engineer's cost estimate",
        guidance: "Itemized estimate supporting the funding request. Verify the current cycle's estimate expectations with TIB.",
        required: true,
      },
      {
        key: "location-map",
        title: "Project location map",
        guidance: "Map locating the arterial segment within the city. Verify format expectations in the current application instructions.",
        required: true,
      },
      {
        key: "condition-photos",
        title: "Street condition photos",
        guidance: "Photos documenting the existing condition of the street. Verify quantity and labeling expectations with TIB.",
        required: false,
      },
    ],
  },
  {
    key: "wa-tib-small-city-atp",
    name: "TIB Small City Active Transportation Program (ATP)",
    administeringAgency: "Washington State Transportation Improvement Board (TIB)",
    level: "state",
    typicalApplicants:
      "Incorporated cities and towns with population under 5,000 (TIB runs a separate urban active transportation variant for larger cities and urban counties)",
    eligibleProjectTypes: [
      "Pedestrian and cyclist safety improvements",
      "Pedestrian and cyclist mobility and connectivity (sidewalks, crossings, bike facilities)",
      "Condition improvements to existing active-transportation facilities",
    ],
    cycleNote:
      "Part of TIB's annual call — late-spring opening, summer deadline, November awards; verify current dates on tib.wa.gov.",
    matchRequirement:
      "Follows the SCAP valuation-scaled schedule: no match for the lowest-valuation towns, rising to 10% — verify your band in the current TIB guidelines.",
    url: "https://www.tib.wa.gov/grants/grants.cfm",
    summary:
      "The program small cities knew as TIB's Small City Sidewalk Program now runs as the Small City Active Transportation Program, broadened beyond sidewalks to pedestrian and cyclist safety, mobility, connectivity, and facility-condition projects. It keeps the small-city eligibility (under 5,000 population) and the valuation-scaled match, within TIB's annual call-for-projects cycle.",
    applicationSections: [
      {
        key: "project-narrative",
        title: "Project description and scope",
        guidance:
          "Describe the active-transportation improvement and the gap it closes for people walking and biking. Verify the current call's application questions in TIB's online funding portal.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "safety-and-connectivity-need",
        title: "Safety and connectivity need",
        guidance:
          "Document the pedestrian and cyclist safety problem and the network gap the project addresses. Verify the current cycle's scoring criteria with TIB before drafting.",
        suggestedEvidence: ["project", "modeling", "engagement", "kb"],
      },
      {
        key: "facility-condition",
        title: "Existing facility condition",
        guidance:
          "For condition projects, document the state of the existing facility and the improvement proposed. Verify what condition evidence the current cycle expects with TIB.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "budget-and-cost-estimate",
        title: "Budget and cost estimate",
        guidance:
          "Budget figures come from the engineer's estimate and finance staff, never from AI drafting. Verify the current cycle's estimate format and your match band with TIB.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "engineers-cost-estimate",
        title: "Engineer's cost estimate",
        guidance: "Itemized estimate supporting the funding request. Verify the current cycle's estimate expectations with TIB.",
        required: true,
      },
      {
        key: "location-vicinity-map",
        title: "Project location and vicinity map",
        guidance: "Map showing the facility and the destinations it connects. Verify format expectations in the current application instructions.",
        required: true,
      },
      {
        key: "site-photos",
        title: "Site photos",
        guidance: "Photos of existing conditions along the route. Verify quantity and labeling expectations with TIB.",
        required: false,
      },
    ],
  },
  {
    key: "wa-tib-complete-streets",
    name: "TIB Complete Streets Award (CS)",
    administeringAgency: "Washington State Transportation Improvement Board (TIB)",
    level: "state",
    typicalApplicants:
      "Cities and counties with an adopted complete streets ordinance, put forward by board-approved nominators rather than by standard application",
    eligibleProjectTypes: [
      "Flexible award funding for streets serving all users — pedestrians, transit access, cyclists, and motorists of all ages and abilities",
    ],
    cycleNote:
      "Intermittent nomination rounds at the board's discretion rather than a fixed annual cycle — verify the current round's status on tib.wa.gov.",
    matchRequirement:
      "No local match is stated on the TIB grants page for this award — verify the posture with TIB before budgeting around it.",
    url: "https://www.tib.wa.gov/grants/grants.cfm",
    summary:
      "TIB's Complete Streets Award recognizes and funds local governments that have adopted a complete streets ordinance and demonstrate the practice of planning and building streets for all users. Unlike TIB's project grants it is nomination-based: board-approved nominators put agencies forward rather than agencies submitting a standard project application, so the preparation work is documenting the ordinance and the practice.",
    applicationSections: [
      {
        key: "ordinance-and-practice",
        title: "Complete streets ordinance and demonstrated practice",
        guidance:
          "Document the adopted complete streets ordinance and the projects that show the practice in the ground. Verify what evidence of practice the current round's nominators look for with TIB.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "nominator-coordination",
        title: "Nominator coordination",
        guidance:
          "The award is nomination-based — identify the board-approved nominators who know your agency's work and brief them. Verify the current nominator list and round timing with TIB.",
        suggestedEvidence: ["project", "engagement", "kb"],
      },
      {
        key: "planned-use-of-award",
        title: "Planned use of award funds",
        guidance:
          "Describe how the flexible award would be put to work on streets serving all users. Verify eligible uses for the current round with TIB.",
        suggestedEvidence: ["project", "funding", "kb"],
      },
      {
        key: "budget-for-award-use",
        title: "Budget for award use",
        guidance:
          "Cost figures for the planned use come from your estimates and finance staff, never from AI drafting. Verify any reporting expectations for award spending with TIB.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "adopted-complete-streets-ordinance",
        title: "Adopted complete streets ordinance",
        guidance: "The ordinance is the eligibility condition. Verify whether the current round asks for the adopting resolution as well with TIB.",
        required: true,
      },
      {
        key: "demonstrated-practice-documentation",
        title: "Demonstrated practice documentation",
        guidance: "Plans, photos, or project records showing complete-streets practice. Verify what the current round's nominators expect with TIB.",
        required: false,
      },
    ],
  },
  {
    key: "wa-wsdot-ped-bike",
    name: "WSDOT Pedestrian / Bicyclist Program (PBP)",
    administeringAgency: "Washington State Department of Transportation (WSDOT), Local Programs — Active Transportation",
    level: "state",
    typicalApplicants:
      "Cities, counties, and tribal governments; a joint application with WSDOT is required when state right-of-way is involved",
    eligibleProjectTypes: [
      "Pedestrian and bicyclist safety and mobility infrastructure",
      "Development and design-only projects",
      "Projects that increase active transportation trips",
    ],
    cycleNote:
      "Biennial call aligned to the state budget biennium, with a spring application deadline — verify the next call on WSDOT's active transportation pages.",
    matchRequirement:
      "No match requirement is stated on the program page; the biennium's applicant guidance governs — verify there before assuming zero match.",
    url: "https://wsdot.wa.gov/business-wsdot/support-local-programs/funding-programs/active-transportation-funding-programs/pedestrian-bicycle-program",
    summary:
      "WSDOT's Pedestrian / Bicyclist Program funds infrastructure and design-only projects that improve pedestrian and bicyclist safety and mobility and increase active-transportation trips, funded largely through Washington's Climate Commitment Act. It runs a biennial call administered by WSDOT Local Programs, with applications submitted through an online portal against a biennium-specific guidance document, documented tribal consultation required, and a joint application with WSDOT when state right-of-way is involved.",
    applicationSections: [
      {
        key: "project-description",
        title: "Project description and scope",
        guidance:
          "Describe the improvement and how its elements serve people walking and biking. Verify the current biennium's application questions in WSDOT's applicant guidance before drafting.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "need-and-safety",
        title: "Statement of need: safety and mobility",
        guidance:
          "Document the safety and mobility need with crash history, demand, and network gaps. Verify the current guidance's required data sources and scoring rubric with WSDOT Local Programs.",
        suggestedEvidence: ["project", "modeling", "bca", "kb"],
      },
      {
        key: "active-transportation-demand",
        title: "Increase in active transportation trips",
        guidance:
          "Explain how the project increases walking and biking trips and who it serves. Verify how the current cycle scores demand and equity considerations in the applicant guidance.",
        suggestedEvidence: ["modeling", "engagement", "kb"],
      },
      {
        key: "budget-and-cost-estimate",
        title: "Budget and cost estimate",
        guidance:
          "Budget figures come from the engineer's estimate and finance staff, never from AI drafting. Verify the current biennium's estimate format in the applicant guidance.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "tribal-consultation-documentation",
        title: "Tribal consultation documentation",
        guidance:
          "Complete applications require documented tribal consultation initiated well before submission. Verify the current biennium's consultation timeline in the applicant guidance.",
        required: true,
      },
      {
        key: "engineers-cost-estimate",
        title: "Engineer's cost estimate",
        guidance: "Itemized estimate supporting the funding request. Verify the current biennium's estimate expectations with WSDOT Local Programs.",
        required: true,
      },
      {
        key: "state-right-of-way-joint-application",
        title: "Joint application materials for state right-of-way",
        guidance:
          "Projects touching state right-of-way need a joint application with WSDOT. Verify whether your project triggers this with WSDOT's active transportation grants staff.",
        required: false,
      },
    ],
  },
  {
    key: "wa-wsdot-srts",
    name: "WSDOT Safe Routes to Schools Program (SRTS)",
    administeringAgency: "Washington State Department of Transportation (WSDOT), Local Programs — Active Transportation",
    level: "state",
    typicalApplicants:
      "Cities, counties, tribal governments, and organizations serving school communities; projects on tribal lands need tribal government support documentation",
    eligibleProjectTypes: [
      "Infrastructure projects within two miles of K-12 schools",
      "Development and design-only projects",
      "Education and encouragement projects",
    ],
    cycleNote:
      "Biennial call aligned to the state budget biennium, alongside the Pedestrian / Bicyclist Program — verify the next call on WSDOT's active transportation pages.",
    matchRequirement:
      "No match requirement is stated on the program page; the biennium's applicant guidance governs — verify there before assuming zero match.",
    url: "https://wsdot.wa.gov/business-wsdot/support-local-programs/funding-programs/active-transportation-funding-programs/safe-routes-school-program",
    summary:
      "WSDOT's Safe Routes to Schools Program funds projects that improve safety and mobility for children walking and bicycling to school, restricted to within two miles of K-12 schools, covering infrastructure, design-only, and education/encouragement work. It is supported by the Climate Commitment Act plus state multimodal and federal funds, and shares WSDOT's biennial active-transportation call and online application portal.",
    applicationSections: [
      {
        key: "school-route-context",
        title: "School route context and eligibility",
        guidance:
          "Describe the school or schools served and show the project sits within the program's two-mile eligibility area. Verify how the current biennium's guidance defines and documents the school connection.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "safety-need",
        title: "Student travel safety need",
        guidance:
          "Document the safety problem on the school route: crash history, speeds, crossings, and gaps. Verify the current guidance's required data and scoring rubric with WSDOT Local Programs.",
        suggestedEvidence: ["project", "modeling", "kb"],
      },
      {
        key: "education-and-encouragement",
        title: "Education and encouragement plan",
        guidance:
          "For non-infrastructure work, describe the education and encouragement activities and the partners delivering them. Verify eligible activity types in the current applicant guidance.",
        suggestedEvidence: ["engagement", "kb"],
      },
      {
        key: "budget-and-cost-estimate",
        title: "Budget and cost estimate",
        guidance:
          "Budget figures come from the engineer's estimate and finance staff, never from AI drafting. Verify the current biennium's estimate format in the applicant guidance.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "tribal-consultation-documentation",
        title: "Tribal consultation documentation",
        guidance:
          "Complete applications require documented tribal consultation; projects on tribal lands also need tribal government support documentation. Verify the current requirements in the applicant guidance.",
        required: true,
      },
      {
        key: "engineers-cost-estimate",
        title: "Engineer's cost estimate",
        guidance: "Itemized estimate supporting the funding request. Verify the current biennium's estimate expectations with WSDOT Local Programs.",
        required: true,
      },
      {
        key: "school-partnership-documentation",
        title: "School partnership documentation",
        guidance: "Documentation of the school or district partnership behind the project. Verify what the current guidance accepts as partnership evidence.",
        required: false,
      },
    ],
  },
  {
    key: "wa-fmsib-freight",
    name: "FMSIB Freight Mobility Funding (Six-Year Investment Program)",
    administeringAgency: "Washington State Freight Mobility Strategic Investment Board (FMSIB)",
    level: "state",
    typicalApplicants:
      "Washington local agency partners — in practice cities, counties, and ports with projects on or connected to a Designated Strategic Freight Corridor; confirm eligibility with FMSIB staff",
    eligibleProjectTypes: [
      "Asset preservation and safety on freight corridors (bridge and road preservation and replacement)",
      "Operational improvements to the existing system (intersection modifications, striping)",
      "System expansion (grade separations, corridor expansion)",
      "Innovative freight solutions (truck parking, intermodal facilities)",
    ],
    cycleNote:
      "Biennial call for projects builds FMSIB's Six-Year Investment Program, which the Legislature then funds — verify the next window at fmsib.wa.gov.",
    matchRequirement:
      "No match percentage is stated on the program pages; FMSIB expects projects to carry partner funding and acts as a partial funder — verify leverage expectations with FMSIB staff.",
    url: "https://fmsib.wa.gov/six-year-investment-program/current-funding-opportunities",
    summary:
      "FMSIB does not run a single branded grant program; it runs a biennial call for projects that builds its Six-Year Investment Program of the state's highest-priority freight mobility projects, recommended to the Legislature for funding. Eligible projects must be on or directly connected to a Designated Strategic Freight Corridor, be constructible within six years, and appear in a Regional TIP and the statewide STIP, with applications scored against published criteria.",
    applicationSections: [
      {
        key: "freight-corridor-eligibility",
        title: "Freight corridor eligibility",
        guidance:
          "Show the project is on or directly connected to a Designated Strategic Freight Corridor. Verify the corridor designation and the current round's eligibility rules with FMSIB staff.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "project-description-and-scoring",
        title: "Project description against the scoring criteria",
        guidance:
          "Describe the freight mobility problem and the improvement, mapped to the round's published scoring criteria. Verify the current criteria and point structure on the FMSIB site before drafting.",
        suggestedEvidence: ["project", "modeling", "bca", "kb"],
      },
      {
        key: "programming-status",
        title: "Programming and deliverability status",
        guidance:
          "Document the project's Regional TIP and statewide STIP status and show it is constructible within six years. Verify the current round's programming prerequisites with FMSIB staff.",
        suggestedEvidence: ["project", "funding", "kb"],
      },
      {
        key: "partner-funding-and-cost-estimate",
        title: "Partner funding and cost estimate",
        guidance:
          "The cost estimate and the partner funding stack come from finance staff and funding partners, never from AI drafting. Verify leverage expectations for the current round with FMSIB staff.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "application-and-supporting-documentation",
        title: "Application form and supporting documentation",
        guidance:
          "Recent rounds used direct submission of an application with supporting documentation to FMSIB staff. Verify the current round's submission mechanics and materials list at fmsib.wa.gov.",
        required: true,
      },
      {
        key: "tip-stip-programming-evidence",
        title: "Regional TIP and STIP programming evidence",
        guidance: "Documentation that the project appears in the Regional TIP and the statewide STIP. Verify the accepted evidence with FMSIB staff.",
        required: true,
      },
      {
        key: "freight-corridor-designation-documentation",
        title: "Freight corridor designation documentation",
        guidance: "Documentation tying the project to a Designated Strategic Freight Corridor. Verify how the current round expects the connection shown.",
        required: false,
      },
    ],
  },
];

export const usWaPrograms: GrantProgramBundle = {
  key: "us-wa",
  label: "Washington state programs",
  // Subdivision-scoped: an agency outside Washington cannot apply to these, so
  // the catalog must say so rather than list them as if it could.
  jurisdiction: { country: "US", subdivision: "WA", label: "Washington" },
  programs,
};
