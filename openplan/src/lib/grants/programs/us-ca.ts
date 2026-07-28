// United States, California — state grant programs.
//
// Curated catalog entries for California state transportation funding
// programs relevant to small and rural agencies. This is static reference
// data, not a live opportunity feed. Cycle timing is phrased as guidance text
// on purpose — funding cycles shift, so every entry tells the operator where
// to verify the current call instead of asserting a deadline. URLs point at
// the official program pages.

import type { GrantProgramBundle, GrantProgramCatalogEntry } from "./types";

const programs: readonly GrantProgramCatalogEntry[] = [
  {
    key: "atp",
    name: "Active Transportation Program (ATP)",
    administeringAgency: "California Transportation Commission / Caltrans",
    level: "state",
    typicalApplicants: "Cities, counties, RTPAs/MPOs, transit agencies, tribes, school districts",
    eligibleProjectTypes: [
      "Bicycle and pedestrian infrastructure",
      "Safe routes to school",
      "Trails",
      "Active transportation plans",
    ],
    cycleNote: "Biennial statewide call — verify the current cycle and application window with the CTC.",
    matchRequirement:
      "No minimum local match required; leverage and disadvantaged-community benefit strengthen competitiveness — verify current guidelines.",
    url: "https://catc.ca.gov/programs/active-transportation-program",
    summary:
      "California's flagship competitive program for walking and biking projects, consolidating federal and state active transportation funds. Strong fit for small and rural agencies pursuing safe routes to school, gap-closing bikeways, and pedestrian safety work, with a statewide component plus regional components in large MPO areas.",
    applicationSections: [
      {
        key: "project-narrative",
        title: "Project description and scope",
        guidance:
          "Describe what the project builds, the gap it closes, and how the elements work together for people walking and biking. Verify the current cycle's narrative prompts and scoring rubric with the CTC — question wording and point values change between cycles.",
        suggestedEvidence: ["project", "funding", "kb"],
      },
      {
        key: "need-and-safety",
        title: "Statement of need: safety and mobility",
        guidance:
          "Document the safety and mobility need with collision history, demand, and network gaps. Verify the current application's required data sources and analysis window with the CTC before drafting.",
        suggestedEvidence: ["project", "modeling", "bca", "kb"],
      },
      {
        key: "disadvantaged-communities",
        title: "Benefit to disadvantaged communities",
        guidance:
          "Explain which communities the project serves and how benefits reach them. Verify the current cycle's accepted disadvantaged-community definitions and mapping tools with the CTC — the qualifying criteria shift between cycles.",
        suggestedEvidence: ["project", "engagement", "kb"],
      },
      {
        key: "community-engagement",
        title: "Public participation and planning",
        guidance:
          "Describe how the community shaped the project: outreach performed, input received, and how it changed the scope. Verify the current cycle's engagement documentation expectations with the CTC.",
        suggestedEvidence: ["engagement", "kb"],
      },
      {
        key: "cost-effectiveness-leverage",
        title: "Cost effectiveness and leveraging",
        guidance:
          "Relate expected benefit to cost and describe leveraged funds. Verify how the current cycle scores cost effectiveness and whether leverage earns points with the CTC before committing figures.",
        suggestedEvidence: ["funding", "bca", "kb"],
      },
      {
        key: "implementation-schedule",
        title: "Deliverability and schedule",
        guidance:
          "Lay out delivery milestones, environmental and right-of-way status, and agency capacity. Verify the current cycle's programming-year expectations with the CTC.",
        suggestedEvidence: ["project", "funding", "kb"],
      },
      {
        key: "budget-narrative",
        title: "Budget and engineer's estimate narrative",
        guidance:
          "Budget figures come from the engineer's estimate and finance staff, never from AI drafting. Verify the current cycle's estimate format and escalation assumptions with the CTC.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "location-vicinity-map",
        title: "Project location and vicinity map",
        guidance: "Map showing project limits and context. Verify the current cycle's map format requirements with the CTC.",
        required: true,
      },
      {
        key: "engineers-cost-estimate",
        title: "Engineer's cost estimate",
        guidance: "Itemized estimate on the program's template. Verify the current cycle's template with the CTC.",
        required: true,
      },
      {
        key: "existing-conditions-photos",
        title: "Existing conditions photos",
        guidance: "Photos documenting current conditions at the project site. Verify quantity and labeling expectations in the current application instructions.",
        required: false,
      },
      {
        key: "letters-of-support",
        title: "Letters of support",
        guidance: "Support letters from partner agencies, schools, and community organizations. Verify whether the current cycle caps or scores them.",
        required: false,
      },
      {
        key: "plan-consistency-documentation",
        title: "Plan consistency documentation",
        guidance: "Excerpts from adopted plans (ATP plan, general plan, safe-routes plan) showing the project. Verify what the current cycle accepts as plan consistency.",
        required: false,
      },
    ],
  },
  {
    key: "stip-rtip",
    name: "STIP / RTIP (State Transportation Improvement Program)",
    administeringAgency: "California Transportation Commission (regional shares proposed by RTPAs via the RTIP)",
    level: "state",
    typicalApplicants: "RTPAs/counties propose regional-share projects; cities work through their RTPA",
    eligibleProjectTypes: [
      "Highway and roadway capital improvements",
      "Rail and transit capital",
      "Complete streets elements of capital projects",
    ],
    cycleNote: "Biennial STIP cycle adopted in even years — verify the current fund estimate and RTIP submission schedule with the CTC and your RTPA.",
    matchRequirement: "No fixed local match for STIP county-share programming; funding posture is project-specific — verify with your RTPA.",
    url: "https://catc.ca.gov/programs/state-transportation-improvement-program",
    summary:
      "California's core biennial capital programming document, with 75% of funds flowing to regional shares that each county's RTPA programs through its RTIP. For small agencies this is less a grant application than a programming negotiation — getting a project into the RTIP is the essential step.",
    applicationSections: [
      {
        key: "project-description",
        title: "Project description",
        guidance:
          "Describe the capital project as it will appear in the programming request: limits, elements, and phases. Verify the current cycle's RTIP submission format with your RTPA and the CTC guidelines.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "purpose-and-need",
        title: "Purpose and need",
        guidance:
          "State the transportation problem and how the project addresses it, consistent with the RTP. Verify the current STIP guidelines' consistency expectations with the CTC.",
        suggestedEvidence: ["project", "modeling", "kb"],
      },
      {
        key: "performance-metrics",
        title: "Performance metrics",
        guidance:
          "Summarize expected performance outcomes the programming documents ask for. Verify the current cycle's required performance measures with the CTC and your RTPA.",
        suggestedEvidence: ["modeling", "kb"],
      },
      {
        key: "funding-plan",
        title: "Funding plan",
        guidance:
          "The funding plan is a programming exhibit of committed and proposed amounts by phase and year, never AI-drafted. Verify the current fund estimate and your county share with your RTPA.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "project-programming-request-form",
        title: "Project Programming Request (PPR) form",
        guidance: "The CTC's PPR form carries the programming data of record. Verify the current form version with the CTC before submitting.",
        required: true,
      },
      {
        key: "board-resolution",
        title: "Governing board resolution",
        guidance: "Many RTPAs require an adopted resolution supporting the RTIP submission. Verify your RTPA's current submission requirements.",
        required: false,
      },
    ],
  },
  {
    key: "lpp",
    name: "Local Partnership Program (LPP)",
    administeringAgency: "California Transportation Commission",
    level: "state",
    typicalApplicants: "Self-help cities, counties, and districts with voter-approved transportation taxes or dedicated fees",
    eligibleProjectTypes: [
      "Road maintenance and rehabilitation",
      "Transit and rail improvements",
      "Active transportation and safety projects",
    ],
    cycleNote: "Formulaic shares plus periodic competitive cycles — verify the current programming cycle with the CTC.",
    matchRequirement: "Generally a dollar-for-dollar (1:1) local match from the qualifying tax or fee revenue — verify current guidelines.",
    url: "https://catc.ca.gov/programs/sb1/local-partnership-program",
    summary:
      "SB 1 program that rewards self-help jurisdictions — those with voter-approved transportation sales taxes, developer fees, or tolls — with matching state dollars. Only relevant if your agency or county has a qualifying revenue measure, but a dependable leverage source when it does.",
    applicationSections: [
      {
        key: "project-narrative",
        title: "Project narrative",
        guidance:
          "Describe the project and its transportation benefits. Verify the current programming cycle's nomination format with the CTC — the competitive and formulaic components use different paperwork.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "benefits-and-community-need",
        title: "Benefits and community need",
        guidance:
          "Document congestion, safety, or state-of-good-repair benefits and the communities served. Verify the current guidelines' evaluation criteria with the CTC.",
        suggestedEvidence: ["project", "modeling", "bca", "engagement", "kb"],
      },
      {
        key: "delivery-schedule",
        title: "Delivery schedule",
        guidance:
          "Lay out milestones and demonstrate readiness to deliver within programming deadlines. Verify the current cycle's allocation timing rules with the CTC.",
        suggestedEvidence: ["project", "funding", "kb"],
      },
      {
        key: "qualifying-revenue-demonstration",
        title: "Qualifying revenue and match demonstration",
        guidance:
          "The demonstration of the voter-approved measure and the dollar-for-dollar match is a certification built from adopted revenue documents, never AI-drafted. Verify current match rules with the CTC guidelines.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "match-commitment-documentation",
        title: "Match commitment documentation",
        guidance: "Evidence committing the qualifying revenue as match. Verify the accepted commitment forms with the current CTC guidelines.",
        required: true,
      },
      {
        key: "adopted-measure-documentation",
        title: "Adopted measure documentation",
        guidance: "Documentation of the voter-approved tax, fee, or toll that qualifies the jurisdiction. Verify qualifying-measure criteria in the current guidelines.",
        required: true,
      },
    ],
  },
  {
    key: "tircp",
    name: "Transit and Intercity Rail Capital Program (TIRCP)",
    administeringAgency: "California State Transportation Agency (CalSTA), with Caltrans",
    level: "state",
    typicalApplicants: "Transit operators, rail agencies, JPAs; rural operators often via joint or consolidated applications",
    eligibleProjectTypes: [
      "Transit and rail capital projects",
      "Zero-emission bus fleets and charging",
      "Service integration and connectivity projects",
    ],
    cycleNote: "Competitive cycles roughly every one to two years — verify the current call for projects with CalSTA.",
    matchRequirement: "No formal minimum match; demonstrated leverage and ridership/GHG benefits drive competitiveness — verify guidelines.",
    url: "https://calsta.ca.gov/subject-areas/transit-intercity-rail-capital-prog",
    summary:
      "Cap-and-trade-funded program for transformative transit and rail capital investments that reduce greenhouse gas emissions and grow ridership. Awards skew large, but rural and small-urban operators have won for fleet electrification and connectivity projects, especially via joint applications.",
    applicationSections: [
      {
        key: "project-background",
        title: "Project background and description",
        guidance:
          "Describe the service context, the capital investment, and how the elements form one transformative project. Verify the current call's narrative outline with CalSTA — the application structure changes between cycles.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "ghg-reduction-narrative",
        title: "Greenhouse gas reduction",
        guidance:
          "Explain the mechanism for GHG reduction and summarize the quantified estimate. The controlling figures come from the program's required calculator — verify the current cycle's CARB quantification methodology with CalSTA.",
        suggestedEvidence: ["modeling", "kb"],
      },
      {
        key: "ridership-and-service-benefits",
        title: "Ridership and service benefits",
        guidance:
          "Document expected ridership growth, service integration, and connectivity benefits. Verify the current call's ridership-forecast expectations with CalSTA.",
        suggestedEvidence: ["modeling", "engagement", "kb"],
      },
      {
        key: "disadvantaged-community-benefits",
        title: "Benefits to disadvantaged communities",
        guidance:
          "Describe benefits reaching priority populations, using the definitions the current call names. Verify the current cycle's accepted designation tools with CalSTA.",
        suggestedEvidence: ["project", "engagement", "kb"],
      },
      {
        key: "readiness-and-implementation",
        title: "Readiness and implementation",
        guidance:
          "Document environmental status, procurement approach, and delivery schedule. Verify the current call's readiness expectations with CalSTA.",
        suggestedEvidence: ["project", "funding", "kb"],
      },
      {
        key: "funding-plan",
        title: "Funding plan",
        guidance:
          "The funding plan is a financial exhibit of committed and requested amounts, never AI-drafted. Verify leverage expectations in the current call with CalSTA.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "ghg-calculator-workbook",
        title: "GHG quantification calculator workbook",
        guidance: "Completed CARB quantification workbook for the project. Verify the current cycle's required calculator version with CalSTA.",
        required: true,
      },
      {
        key: "board-resolution",
        title: "Governing board resolution",
        guidance: "Authorizing resolution for the application. Verify whether the current call requires it at application or at award.",
        required: false,
      },
      {
        key: "letters-of-support",
        title: "Letters of support",
        guidance: "Partner-operator and community support letters, especially for joint applications. Verify limits in the current call.",
        required: false,
      },
    ],
  },
  {
    key: "sb1-lsr",
    name: "SB 1 Local Streets and Roads Program (LSRP)",
    administeringAgency: "California Transportation Commission / State Controller's Office",
    level: "state",
    typicalApplicants: "Every city and county (formula apportionment)",
    eligibleProjectTypes: [
      "Road maintenance and rehabilitation",
      "Safety projects on local streets",
      "Complete streets elements within eligible projects",
    ],
    cycleNote: "Continuous annual formula apportionments; an adopted project list is due to the CTC each year — verify the submission window.",
    matchRequirement: "No local match required; maintenance-of-effort spending requirements apply — verify current reporting rules.",
    url: "https://catc.ca.gov/programs/sb1/local-streets-roads-program",
    summary:
      "SB 1 formula funding — roughly $1.5B statewide per year — apportioned directly to cities and counties for basic maintenance, rehabilitation, and safety on the local network. Not competitive, but the annual CTC project-list adoption is a compliance gate worth tracking alongside discretionary pursuits.",
    applicationSections: [
      {
        key: "project-list-description",
        title: "Proposed project list description",
        guidance:
          "Describe each proposed project: location, scope, and useful life. Verify the current year's project-list data fields and submission window with the CTC.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "expenditure-reporting",
        title: "Expenditure reporting",
        guidance:
          "The annual expenditure report is an accounting exhibit built from the jurisdiction's financial records, never AI-drafted. Verify current maintenance-of-effort and reporting rules with the CTC and the State Controller's Office.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "adopted-project-list-resolution",
        title: "Adopted project list resolution",
        guidance: "Governing-body adoption of the proposed project list at a regular public meeting. Verify the current year's adoption requirements with the CTC.",
        required: true,
      },
    ],
  },
  {
    key: "clean-california",
    name: "Clean California Local Grant Program",
    administeringAgency: "Caltrans",
    level: "state",
    typicalApplicants: "Cities, counties, tribes, transit agencies; nonprofits in partnership with a public agency",
    eligibleProjectTypes: [
      "Beautification and litter abatement",
      "Community placemaking near transportation facilities",
      "Public space and gateway improvements",
    ],
    cycleNote: "Periodic cycles subject to state budget action — verify whether a current call is open with Caltrans.",
    matchRequirement: "Little to no match historically required, with emphasis on underserved communities — verify current guidelines.",
    url: "https://cleancalifornia.dot.ca.gov/local-grant-program",
    summary:
      "State beautification program funding litter abatement, community gateways, and placemaking in and around the transportation right-of-way. Application lift is modest relative to capital programs, making it a practical entry point for small agencies building grant capacity.",
    applicationSections: [
      {
        key: "community-need-narrative",
        title: "Community need",
        guidance:
          "Describe the site conditions, the community it serves, and the underserved-community context. Verify the current call's priority-community definitions with Caltrans.",
        suggestedEvidence: ["project", "engagement", "kb"],
      },
      {
        key: "scope-and-site-plan",
        title: "Scope and site plan",
        guidance:
          "Describe the beautification elements and their placement. Verify eligible improvement types in the current call's guidelines with Caltrans.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "community-engagement",
        title: "Community engagement",
        guidance:
          "Describe how the community shaped the design and will participate in stewardship. Verify the current call's engagement documentation expectations with Caltrans.",
        suggestedEvidence: ["engagement", "kb"],
      },
      {
        key: "maintenance-plan",
        title: "Maintenance plan",
        guidance:
          "Explain who maintains the improvements and how. Verify the current call's maintenance-commitment duration with Caltrans.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "budget-narrative",
        title: "Budget narrative",
        guidance:
          "Budget figures come from your cost estimate, never from AI drafting. Verify eligible cost categories in the current call with Caltrans.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "site-photos",
        title: "Site photos",
        guidance: "Photos of existing conditions at the project site. Verify quantity and labeling expectations in the current application instructions.",
        required: true,
      },
      {
        key: "maintenance-commitment",
        title: "Maintenance commitment",
        guidance: "Executed commitment to maintain the improvements. Verify the required duration and signatory in the current call.",
        required: true,
      },
      {
        key: "location-map",
        title: "Location map",
        guidance: "Map locating the site relative to the transportation facility. Verify format expectations in the current application instructions.",
        required: false,
      },
    ],
  },
];

export const usCaPrograms: GrantProgramBundle = {
  key: "us-ca",
  label: "California state programs",
  programs,
};
