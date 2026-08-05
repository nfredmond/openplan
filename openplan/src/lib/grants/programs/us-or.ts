// United States, Oregon — state grant programs.
//
// Curated catalog entries for Oregon state transportation funding programs
// relevant to small and rural agencies. This is static reference data, not a
// live opportunity feed. Cycle timing is phrased as guidance text on purpose —
// funding cycles shift, so every entry tells the operator where to verify the
// current call instead of asserting a deadline. URLs point at the official
// program pages, each fetched and verified when these entries were authored.
//
// Two honesty notes carried into the copy below: Great Streets is NOT an
// applicant-driven grant (ODOT and the Oregon Transportation Commission select
// projects), and the TGM planning grants are a JOINT ODOT/DLCD program whose
// state/federal funding split the entry does not assert.

import type { GrantProgramBundle, GrantProgramCatalogEntry } from "./types";

const programs: readonly GrantProgramCatalogEntry[] = [
  {
    key: "or-odot-srts",
    name: "ODOT Safe Routes to School (SRTS)",
    administeringAgency: "Oregon Department of Transportation (ODOT)",
    level: "state",
    typicalApplicants:
      "Road-authority local agencies (cities, counties) partnering with schools; applicant eligibility is set by the current application materials on the ODOT SRTS page",
    eligibleProjectTypes: [
      "Safe crossings",
      "Sidewalks",
      "Bike lanes",
      "Flashing beacons and similar safety infrastructure near schools",
      "Education, outreach, and technical assistance",
    ],
    cycleNote:
      "Construction funding is currently paused after a state budget redirection; education and technical assistance continue — verify status on the ODOT SRTS page.",
    matchRequirement:
      "No match percentage is stated on the program page; construction grants have historically carried a statutory local match with reductions for qualifying areas — verify in the current application packet.",
    url: "https://www.oregon.gov/odot/programs/pages/srts.aspx",
    summary:
      "Oregon's Safe Routes to School program at ODOT funds both infrastructure — crossings, sidewalks, bike lanes, beacons near schools — and education and technical assistance to help children walk and bike to school safely. It is a hybrid, not purely state-funded: the construction lane runs on state highway funds and the education lane on federal funds, and projects are recommended for funding by a Safe Routes to School Advisory Committee. The construction funding opportunity is temporarily suspended following a state budget redirection and is expected to reopen in a future cycle.",
    applicationSections: [
      {
        key: "project-narrative",
        title: "Project description and scope",
        guidance:
          "Describe the school-route improvement and how its elements work together for children walking and biking. Verify the current cycle's application questions on the ODOT SRTS page — the advisory committee's criteria control.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "school-safety-need",
        title: "School travel safety need",
        guidance:
          "Document the safety problem on the route to school: crash history, speeds, crossings, and gaps. Verify the current cycle's required data sources with ODOT before drafting.",
        suggestedEvidence: ["project", "modeling", "kb"],
      },
      {
        key: "education-and-encouragement",
        title: "Education and encouragement activities",
        guidance:
          "For the education lane, describe the outreach, education, and technical-assistance activities and the partners delivering them. Verify eligible activities with the ODOT SRTS program.",
        suggestedEvidence: ["engagement", "kb"],
      },
      {
        key: "budget-and-cost-estimate",
        title: "Budget and cost estimate",
        guidance:
          "Budget figures come from the engineer's estimate and finance staff, never from AI drafting. Verify the current cycle's estimate format and match terms in the application packet.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "engineers-cost-estimate",
        title: "Engineer's cost estimate",
        guidance: "Itemized estimate supporting the funding request. Verify the current cycle's estimate expectations with ODOT.",
        required: true,
      },
      {
        key: "location-map",
        title: "Project location map",
        guidance: "Map showing the project relative to the school and its walk zone. Verify format expectations in the current application materials.",
        required: true,
      },
      {
        key: "school-support-documentation",
        title: "School partnership documentation",
        guidance: "Documentation of the school or district partnership. Verify what the current cycle accepts as partnership evidence.",
        required: false,
      },
    ],
  },
  {
    key: "or-community-paths",
    name: "Oregon Community Paths Program (OCP)",
    administeringAgency: "Oregon Department of Transportation (ODOT)",
    level: "state",
    typicalApplicants:
      "Cities, towns, counties, and tribal governments; transit and natural resource management agencies; nonprofits responsible for local transportation safety programs. Non-certified agencies may partner with ODOT for project management.",
    eligibleProjectTypes: [
      "Development and construction of multiuse paths",
      "Reconstruction and major resurfacing of existing paths",
      "Planning, design, and engineering tied to an eligible path project",
    ],
    cycleNote:
      "Periodic calls for applications rather than a fixed annual cycle, and the next call is on hold — verify whether a call is open on the ODOT Community Paths page.",
    matchRequirement:
      "No match is stated on the program page; match terms vary with each award's funding source (state funds or federal Transportation Alternatives) — verify in the solicitation documents.",
    url: "https://www.oregon.gov/odot/programs/pages/ocp.aspx",
    summary:
      "Oregon Community Paths is ODOT's grant program for multiuse paths — building new ones and maintaining existing ones — open to local and tribal governments and certain agencies and nonprofits. It is funded from a blend of state sources (bicycle excise tax, vehicle privilege tax, lottery bonds) and federal Transportation Alternatives Program funds, so it is state-anchored but not exclusively state-funded, and it runs as discrete competitive calls rather than an annual cycle.",
    applicationSections: [
      {
        key: "path-project-narrative",
        title: "Path project description",
        guidance:
          "Describe the multiuse path work — new construction, reconstruction, or the planning and design tied to it — and its limits. Verify the current solicitation's application outline on the ODOT Community Paths page.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "connectivity-and-need",
        title: "Connections and community need",
        guidance:
          "Explain the connections the path creates and the community need it serves. Verify the current solicitation's evaluation criteria with ODOT before drafting.",
        suggestedEvidence: ["project", "modeling", "engagement", "kb"],
      },
      {
        key: "delivery-and-partnership",
        title: "Delivery approach and partnerships",
        guidance:
          "Describe who delivers the project; non-certified agencies may partner with ODOT for project management. Verify certification and delivery expectations in the current solicitation.",
        suggestedEvidence: ["project", "funding", "kb"],
      },
      {
        key: "budget-and-cost-estimate",
        title: "Budget and cost estimate",
        guidance:
          "Budget figures come from the engineer's estimate and finance staff, never from AI drafting. Verify the current solicitation's estimate format and match terms before committing figures.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "engineers-cost-estimate",
        title: "Engineer's cost estimate",
        guidance: "Itemized estimate supporting the funding request. Verify the current solicitation's estimate expectations with ODOT.",
        required: true,
      },
      {
        key: "path-alignment-map",
        title: "Path alignment map",
        guidance: "Map showing the path alignment and the destinations it connects. Verify format expectations in the current solicitation.",
        required: true,
      },
      {
        key: "partnership-documentation",
        title: "Partnership documentation",
        guidance: "Documentation of any delivery partnership, including with ODOT for non-certified agencies. Verify what the current solicitation requires.",
        required: false,
      },
    ],
  },
  {
    key: "or-connect-oregon",
    name: "Connect Oregon",
    administeringAgency: "Oregon Department of Transportation (ODOT), with awards approved by the Oregon Transportation Commission",
    level: "state",
    typicalApplicants:
      "Public, private, and nonprofit entities capable of meeting the match and delivering the project; small cities and counties compete statewide against ports, railroads, and airports",
    eligibleProjectTypes: [
      "Aviation capital infrastructure",
      "Rail capital infrastructure",
      "Marine and port capital infrastructure",
    ],
    cycleNote:
      "Periodic competitive rounds plus a rolling federal grant match option between rounds — verify the next round's status on the ODOT Connect Oregon page.",
    matchRequirement:
      "A substantial local match is required — program materials describe a matching-funds requirement; verify the current percentage in the application instructions on the ODOT page.",
    url: "https://www.oregon.gov/odot/programs/pages/connectoregon.aspx",
    summary:
      "Connect Oregon is ODOT's state-funded program for non-highway transportation, awarding competitive grants approved by the Oregon Transportation Commission plus a rolling federal-grant-match option between rounds. Its scope has narrowed to aviation, rail, and marine projects — bicycle and pedestrian projects are no longer in scope, so an agency seeking path or sidewalk money should look to the Oregon Community Paths Program instead. Awards are reimbursement-based per program materials.",
    applicationSections: [
      {
        key: "project-description",
        title: "Project description and mode",
        guidance:
          "Describe the aviation, rail, or marine capital investment and the facility it improves. Verify the current round's application outline and eligibility rules on the ODOT Connect Oregon page.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "transportation-and-economic-benefit",
        title: "Transportation and economic benefit",
        guidance:
          "Document how the project improves the non-highway transportation system and the economic activity it supports. Verify the current round's evaluation criteria with ODOT before drafting.",
        suggestedEvidence: ["project", "modeling", "bca", "kb"],
      },
      {
        key: "readiness-and-delivery",
        title: "Readiness and delivery",
        guidance:
          "Document site control, permits, and the delivery schedule. Verify the current round's readiness expectations and the commission's approval timeline with ODOT.",
        suggestedEvidence: ["project", "funding", "kb"],
      },
      {
        key: "match-and-funding-plan",
        title: "Match and funding plan",
        guidance:
          "The funding plan and match demonstration are financial exhibits built from committed sources, never AI-drafted. Verify the current match requirement in the application instructions.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "match-commitment-documentation",
        title: "Match commitment documentation",
        guidance: "Evidence committing the required matching funds. Verify the accepted commitment forms in the current application instructions.",
        required: true,
      },
      {
        key: "cost-estimate",
        title: "Cost estimate",
        guidance: "Itemized estimate for the capital investment. Verify the current round's estimate expectations with ODOT.",
        required: true,
      },
      {
        key: "site-control-documentation",
        title: "Site control documentation",
        guidance: "Documentation of ownership or control of the project site. Verify what the current round accepts as site control.",
        required: false,
      },
    ],
  },
  {
    key: "or-small-city-allotment",
    name: "Small City Allotment (SCA) Program",
    administeringAgency: "Oregon Department of Transportation (ODOT) — Local Government section",
    level: "state",
    typicalApplicants: "Incorporated cities with populations of 5,000 or less; counties are not eligible",
    eligibleProjectTypes: [
      "Local street repair and improvement projects, particularly streets inadequate for the capacity they serve or in a condition detrimental to safety",
    ],
    cycleNote:
      "Annual cycle: spring application window, advisory-committee review in summer, agreements by early fall — verify the current window on the ODOT SCA page.",
    matchRequirement:
      "No match requirement is stated on the program page; the program is characterized as a direct state allotment to small cities — verify terms in the current-year application instructions.",
    url: "https://www.oregon.gov/odot/localgov/pages/sca_program.aspx",
    summary:
      "The Small City Allotment is ODOT's annual state-funded competitive allocation for street projects in Oregon's incorporated cities of 5,000 or fewer residents — a genuinely state-funded, small-city-specific program drawn from city gas-tax revenue and the State Highway Fund. Applications are ranked competitively with regional distribution and reviewed by the Small City Allotment Advisory Committee, with one representative per ODOT region. Counties cannot use it; it is city-only.",
    applicationSections: [
      {
        key: "street-condition-narrative",
        title: "Street condition and project description",
        guidance:
          "Describe the street, its condition, and the repair or improvement proposed. Verify the current year's application questions in the instructions posted on the ODOT SCA page.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "capacity-and-safety-need",
        title: "Capacity and safety need",
        guidance:
          "Document why the street is inadequate for the capacity it serves or detrimental to safety. Verify the current year's eligibility standard in the application instructions before drafting.",
        suggestedEvidence: ["project", "modeling", "kb"],
      },
      {
        key: "delivery-readiness",
        title: "Delivery readiness",
        guidance:
          "Show the city can deliver the project on the program's agreement timeline. Verify the current year's delivery expectations with ODOT's Local Government section.",
        suggestedEvidence: ["project", "funding", "kb"],
      },
      {
        key: "budget-and-cost-estimate",
        title: "Budget and cost estimate",
        guidance:
          "Budget figures come from the engineer's estimate and finance staff, never from AI drafting. Verify the current year's estimate format and award limits in the application instructions.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "cost-estimate",
        title: "Cost estimate",
        guidance: "Itemized estimate for the street work. Verify the current year's estimate expectations in the application instructions.",
        required: true,
      },
      {
        key: "location-map",
        title: "Project location map",
        guidance: "Map locating the street segment within the city. Verify format expectations in the current application instructions.",
        required: true,
      },
      {
        key: "street-condition-photos",
        title: "Street condition photos",
        guidance: "Photos documenting the street's condition. Verify quantity and labeling expectations in the current application instructions.",
        required: false,
      },
    ],
  },
  {
    key: "or-great-streets",
    name: "Great Streets Program",
    administeringAgency: "Oregon Department of Transportation (ODOT), with the Oregon Transportation Commission",
    level: "state",
    typicalApplicants:
      "Not an applicant-driven program: ODOT and the Oregon Transportation Commission identify and select projects; local agencies advocate for corridors through their ODOT region office rather than applying",
    eligibleProjectTypes: [
      "Multimodal improvements on state highways functioning as community main streets",
      "Sidewalk gap completion",
      "Intersection and crossing improvements",
      "Bike lanes",
      "Transit facilities",
      "Drainage and stormwater treatment",
    ],
    cycleNote:
      "Not a recurring open call — funded through one-time infusions programmed via the STIP; verify status with your ODOT region office and the Great Streets page.",
    matchRequirement:
      "No local match is stated — project funding is programmed by ODOT rather than granted to applicants; verify any cost-sharing expectations with your ODOT region office.",
    url: "https://www.oregon.gov/odot/programs/pages/great-streets-program.aspx",
    summary:
      "Great Streets bundles complete-streets improvements — sidewalks, crossings, bike lanes, transit facilities, drainage — into single projects on state highways that serve as community main streets. It is not a grant a city or county applies to: ODOT and the Oregon Transportation Commission identify and select projects using eligibility and scoring criteria, with community support required, and the page states funding is primarily federal with State Highway Funds secondary. It appears here so agencies on a state-highway main street know the lane exists and can advocate for their corridor.",
    applicationSections: [
      {
        key: "corridor-needs-narrative",
        title: "Corridor needs narrative",
        guidance:
          "There is no application to file — this is the advocacy case for your corridor: the main-street function, the gaps, and the safety needs. Verify the current selection criteria with your ODOT region office.",
        suggestedEvidence: ["project", "modeling", "kb"],
      },
      {
        key: "community-support",
        title: "Community support",
        guidance:
          "Selection requires demonstrated community support. Document the engagement behind the corridor's improvements and verify what the current selection process accepts as support evidence with ODOT.",
        suggestedEvidence: ["engagement", "kb"],
      },
      {
        key: "plan-consistency",
        title: "Plan consistency",
        guidance:
          "Show the corridor's improvements in adopted local and regional plans. Verify how the current STIP-based selection weighs plan consistency with your ODOT region office.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "cost-estimate-and-funding-context",
        title: "Cost estimate and funding context",
        guidance:
          "Any cost figures shared with ODOT come from engineering and finance staff, never from AI drafting. Verify how the current selection process uses local cost information with your region office.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "corridor-location-map",
        title: "Corridor location map",
        guidance: "Map of the state-highway corridor and its main-street context. Verify what materials your ODOT region office wants when advocating a corridor.",
        required: false,
      },
      {
        key: "adopted-plan-excerpts",
        title: "Adopted plan excerpts",
        guidance: "Excerpts from adopted plans showing the corridor's improvements. Verify what the current selection process accepts as plan evidence.",
        required: false,
      },
      {
        key: "letters-of-support",
        title: "Letters of community support",
        guidance: "Community and partner support documentation for the corridor. Verify what the current selection process expects with ODOT.",
        required: false,
      },
    ],
  },
  {
    key: "or-tgm-planning",
    name: "Transportation and Growth Management (TGM) Planning Grants",
    administeringAgency:
      "Joint program of the Oregon Department of Transportation (ODOT) and the Department of Land Conservation and Development (DLCD)",
    level: "state",
    typicalApplicants:
      "Oregon cities and counties; the program also offers non-grant assistance to local governments (code assistance, quick response, transportation plan assessments)",
    eligibleProjectTypes: [
      "Transportation System Plans (new or updated) and TSP elements meeting Transportation Planning Rule requirements",
      "Integrated land use and transportation planning: area plans, downtown plans, urban growth boundary concept plans",
    ],
    cycleNote:
      "Annual cycle opening late spring with a late-summer deadline and awards in the fall — verify the current window on the DLCD TGM Planning Grants page.",
    matchRequirement:
      "Grantees must provide match, satisfiable with cash, staff time, monetized volunteer time, or direct project expenses; no percentage is stated on the page — verify the rate in the current application packet.",
    url: "https://www.oregon.gov/lcd/TGM/Pages/Planning-Grants.aspx",
    summary:
      "TGM is a long-standing joint ODOT/DLCD program whose planning grants fund local governments to produce Transportation System Plans and integrated land-use/transportation plans such as downtown and urban growth boundary concept plans — planning work only, not construction. It runs an annual application cycle with two grant categories and roughly two-year project terms, and its match can be satisfied in-kind. TGM has historically drawn on both federal transportation planning funds and state funds — confirm the funding source with the program before assuming either applies to your award.",
    applicationSections: [
      {
        key: "planning-project-description",
        title: "Planning project description",
        guidance:
          "Describe the plan or plan element to be produced and the questions it answers for the community. Verify the current cycle's grant categories and application outline on the DLCD TGM page.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "tpr-consistency",
        title: "Transportation Planning Rule consistency",
        guidance:
          "Explain how the planning work meets Transportation Planning Rule requirements and fits the jurisdiction's planning obligations. Verify the current cycle's consistency expectations with TGM staff.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "community-and-agency-engagement",
        title: "Community and agency engagement",
        guidance:
          "Describe how the planning process will engage the community and coordinate with ODOT and DLCD. Verify the current cycle's engagement expectations in the application packet.",
        suggestedEvidence: ["engagement", "kb"],
      },
      {
        key: "budget-and-match",
        title: "Budget and match demonstration",
        guidance:
          "The budget and the match demonstration — cash, staff time, monetized volunteer time, or direct expenses — are finance work products, never AI-drafted. Verify the current match rate in the application packet.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "draft-scope-of-work",
        title: "Draft scope of work",
        guidance: "The proposed planning scope and deliverables. Verify the current cycle's scope template on the DLCD TGM Planning Grants page.",
        required: true,
      },
      {
        key: "match-commitment-documentation",
        title: "Match commitment documentation",
        guidance: "Documentation of the cash or in-kind match commitment. Verify accepted match forms in the current application packet.",
        required: true,
      },
      {
        key: "adopted-plan-excerpts",
        title: "Adopted plan excerpts",
        guidance: "Excerpts from adopted plans the new planning work builds on. Verify what the current cycle asks for as background documentation.",
        required: false,
      },
    ],
  },
];

export const usOrPrograms: GrantProgramBundle = {
  key: "us-or",
  label: "Oregon state programs",
  // Subdivision-scoped: an agency outside Oregon cannot apply to these, so the
  // catalog must say so rather than list them as if it could.
  jurisdiction: { country: "US", subdivision: "OR", label: "Oregon" },
  programs,
};
