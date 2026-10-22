// United States — federal grant programs.
//
// Curated catalog entries for federal transportation funding programs. Several
// reach local agencies through a state pass-through. This text is read in every
// state, so it names no state's agency or tools: a state bundle's
// `federalProgramAdministration` carries those (see ./state-administration.ts).
// This is static reference data, not a live opportunity feed. Cycle timing is phrased as guidance text on
// purpose — funding cycles shift, so every entry tells the operator where to
// verify the current call instead of asserting a deadline. URLs point at the
// official program pages.

import type { GrantProgramBundle, GrantProgramCatalogEntry } from "./types";

const programs: readonly GrantProgramCatalogEntry[] = [
  {
    key: "hsip",
    name: "Highway Safety Improvement Program (HSIP)",
    administeringAgency: "FHWA, administered by your state DOT",
    level: "federal",
    typicalApplicants: "Cities, counties, tribal governments",
    eligibleProjectTypes: [
      "Signals and roundabouts",
      "Pedestrian crossing enhancements",
      "Guardrail and shoulder treatments",
      "Systemic safety improvements",
    ],
    cycleNote: "Each state sets its own HSIP call for local agencies. Verify the current call with your state DOT's local assistance office.",
    matchRequirement:
      "Typically 90% federal / 10% local; certain safety countermeasures qualify for 100% federal funding — verify the current call.",
    url: "https://highways.dot.gov/safety/hsip",
    summary:
      "Federal safety funding for infrastructure countermeasures on local roads, awarded through data-driven benefit/cost scoring against crash history. A workhorse program for small agencies with documented collision patterns, and pairs naturally with a local road safety plan or safety action plan.",
    bcaNote:
      "States that select local HSIP projects by benefit/cost compute it with the state's own method, crash-reduction factors and crash costs, and those control the actual score. The screening BCA is a USDOT-style screening analogue (crashes avoided by severity at USDOT crash costs), not a preview of the state's B/C.",
    applicationSections: [
      {
        key: "project-description",
        title: "Project description",
        guidance:
          "Describe the location, the safety problem, and the proposed countermeasures. Verify the current call's application form and countermeasure list with your state DOT. Both change between calls.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "crash-history-analysis",
        title: "Crash history and safety analysis",
        guidance:
          "Summarize the crash history that motivates the project: pattern, severity, and time window. Verify the current call's required crash-data window and source with your state DOT.",
        // Same reason as SS4A's safety-problem section: the crash history a
        // community reported is evidence about the crash history.
        suggestedEvidence: ["project", "bca", "engagement", "kb"],
      },
      {
        key: "countermeasure-selection",
        title: "Countermeasure selection rationale",
        guidance:
          "Explain why the selected countermeasures fit the documented crash pattern. Verify the current call's approved countermeasure set and crash-reduction factors with your state DOT.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "benefit-cost-calculation",
        title: "Benefit/cost calculation (state tool)",
        guidance:
          "Where the state scores by benefit/cost, the score-controlling B/C comes from the state's own tool, using your crash data and countermeasures. It is a calculation, never drafted prose, and OpenPlan's screening BCA is only an early-warning analogue. Verify the current call's B/C tool and version with your state DOT.",
        suggestedEvidence: ["bca"],
        aiDraftingEnabled: false,
      },
      {
        key: "implementation-schedule",
        title: "Delivery schedule",
        guidance:
          "Lay out design, environmental, right-of-way, and construction milestones. Verify the current call's delivery deadlines with your state DOT.",
        suggestedEvidence: ["project", "funding", "kb"],
      },
    ],
    requiredAttachments: [
      {
        key: "lrsm-bc-tool-output",
        title: "Benefit/cost tool output",
        guidance: "Output of the state's B/C tool for the selected countermeasures, where the call requires one. Verify the required tool and version with the current call.",
        required: true,
      },
      {
        key: "crash-data-summary",
        title: "Crash data summary",
        guidance: "Tabulated crash history for the project location. Verify the accepted data source and analysis window with the current call.",
        required: true,
      },
      {
        key: "engineers-cost-estimate",
        title: "Engineer's cost estimate",
        guidance: "Itemized project cost estimate. Verify the current call's estimate format with your state DOT.",
        required: true,
      },
      {
        key: "vicinity-map",
        title: "Vicinity map",
        guidance: "Map locating the project on the local network. Verify format expectations in the current application instructions.",
        required: true,
      },
      {
        key: "collision-diagrams",
        title: "Collision diagrams",
        guidance: "Diagrams of the crash pattern at treated locations. Verify whether the current call requires them for your project type.",
        required: false,
      },
    ],
  },
  {
    key: "ss4a",
    name: "Safe Streets and Roads for All (SS4A)",
    administeringAgency: "U.S. Department of Transportation",
    level: "federal",
    typicalApplicants: "MPOs, counties, cities, tribal governments",
    eligibleProjectTypes: [
      "Comprehensive safety action plans",
      "Safety demonstration activities",
      "Safety implementation projects",
    ],
    cycleNote: "Annual NOFO under BIL through the current authorization — verify current-round status with USDOT before planning an application.",
    matchRequirement: "Generally 80% federal share maximum, so plan for roughly a 20% local match — verify the current NOFO.",
    url: "https://www.transportation.gov/grants/SS4A",
    summary:
      "USDOT discretionary program funding Vision Zero-style safety action plans and the projects that implement them, with dedicated planning grants that are very accessible to small and rural agencies. An adopted action plan is the gateway to larger implementation awards.",
    applicationSections: [
      {
        key: "project-overview",
        title: "Project overview",
        guidance:
          "Summarize the applicant, the proposal, and the award type sought (planning, demonstration, or implementation). Verify the current NOFO's application structure with USDOT — the narrative outline changes between rounds.",
        suggestedEvidence: ["project", "funding", "kb"],
      },
      {
        key: "safety-problem-and-impact",
        title: "Safety problem and expected impact",
        guidance:
          "Document the roadway safety problem — fatality and serious-injury history — and the expected impact of the proposed work. Verify the current NOFO's required safety-data presentation with USDOT.",
        // `engagement` is here for the locations residents mapped and what the
        // collision history holds near them. Without it the section that IS the
        // safety problem could not cite the community's own account of that
        // problem — only the outreach-process section could, where a reviewer
        // scoring the problem statement would never look.
        suggestedEvidence: ["project", "modeling", "bca", "engagement", "kb"],
      },
      {
        key: "equity-and-underserved-communities",
        title: "Equity and underserved communities",
        guidance:
          "Describe how the work serves underserved communities and how burdens and benefits are distributed. Verify the current NOFO's equity criteria and accepted designation tools with USDOT.",
        suggestedEvidence: ["project", "engagement", "kb"],
      },
      {
        key: "engagement-and-collaboration",
        title: "Engagement and collaboration",
        guidance:
          "Describe public engagement performed and planned, and partnerships across agencies and community organizations. Verify the current NOFO's engagement expectations with USDOT.",
        suggestedEvidence: ["engagement", "kb"],
      },
      {
        key: "implementation-and-capacity",
        title: "Implementation approach and capacity",
        guidance:
          "Explain how the work will be delivered, by whom, and on what schedule. Verify the current NOFO's period-of-performance limits with USDOT.",
        suggestedEvidence: ["project", "funding", "kb"],
      },
      {
        key: "budget-narrative",
        title: "Budget narrative",
        guidance:
          "Budget figures come from your cost estimate and finance staff, never from AI drafting. Verify the current NOFO's budget format and cost-share rules with USDOT.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "action-plan-or-self-certification",
        title: "Safety action plan or self-certification worksheet",
        guidance: "Implementation applicants document an established action plan. Verify the current NOFO's self-certification worksheet with USDOT.",
        required: true,
      },
      {
        key: "budget-detail",
        title: "Budget detail",
        guidance: "Itemized budget by activity and funding source. Verify the current NOFO's required budget form with USDOT.",
        required: true,
      },
      {
        key: "project-location-map",
        title: "Project location map",
        guidance: "Map of plan area or project locations. Verify the current NOFO's location-file format with USDOT.",
        required: false,
      },
      {
        key: "letters-of-support",
        title: "Letters of support",
        guidance: "Partner and community support letters. Verify whether the current NOFO accepts them and any limits.",
        required: false,
      },
    ],
  },
  {
    key: "raise",
    name: "BUILD Discretionary Grants (formerly RAISE)",
    administeringAgency: "U.S. Department of Transportation",
    level: "federal",
    typicalApplicants: "States, cities, counties, MPOs, transit agencies, tribes",
    eligibleProjectTypes: [
      "Multimodal surface transportation capital projects",
      "Complete streets and corridor projects",
      "Project planning and design",
    ],
    cycleNote: "Annual NOFO; USDOT renamed RAISE back to BUILD in 2025 — verify the current round and name with USDOT.",
    matchRequirement:
      "Urban projects generally capped at 80% federal share; rural projects can reach up to 100% — verify the current NOFO.",
    url: "https://www.transportation.gov/BUILDgrants",
    summary:
      "USDOT's broad multimodal discretionary program (TIGER, then RAISE, now BUILD) for locally significant capital projects, with funding reserved for rural awards and smaller minimum award sizes for rural applicants. Highly competitive, but one of the few federal programs where a small agency can fund a transformative corridor project directly.",
    bcaNote:
      "USDOT expects a benefit-cost analysis following its BCA Guidance with capital applications. A screening BCR below 1.0 is an early warning to rescope before committing to a full application-of-record analysis.",
    applicationSections: [
      {
        key: "project-description",
        title: "Project description",
        guidance:
          "Describe the transportation challenges, the proposed scope, and project history. Verify the current NOFO's narrative outline and page limits with USDOT — BUILD restructures its application most rounds.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "project-location",
        title: "Project location",
        guidance:
          "Describe the project location, its connections, and its rural or urban designation — the designation drives match rules and set-asides. Verify how the current NOFO defines rural/urban with USDOT.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "merit-criteria",
        title: "Merit criteria narrative",
        guidance:
          "Address each merit criterion in the current NOFO (historically: safety, environmental sustainability, quality of life, mobility and community connectivity, economic competitiveness and opportunity, state of good repair, partnership and collaboration, innovation). Verify the criteria list and weighting in the current NOFO — they shift between rounds.",
        suggestedEvidence: ["modeling", "bca", "engagement", "kb"],
      },
      {
        key: "project-readiness",
        title: "Project readiness and environmental risk",
        guidance:
          "Document technical feasibility, environmental review status, right-of-way, and schedule risk. Verify the current NOFO's obligation deadlines with USDOT.",
        suggestedEvidence: ["project", "funding", "kb"],
      },
      {
        key: "grant-funds-sources-uses",
        title: "Grant funds, sources and uses of project funds",
        guidance:
          "The sources-and-uses table is a financial exhibit built from commitments and estimates, never AI-drafted. Verify the current NOFO's cost-share rules and required funding documentation with USDOT.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "benefit-cost-analysis",
        title: "Benefit-cost analysis",
        guidance:
          "Capital applications include a BCA of record following the current USDOT BCA Guidance — OpenPlan's screening BCA is a rescope signal, not this document. Verify the guidance edition named in the current NOFO.",
        required: true,
      },
      {
        key: "project-location-file",
        title: "Project location file",
        guidance: "Geospatial file of the project location. Verify the current NOFO's required format with USDOT.",
        required: true,
      },
      {
        key: "letters-of-support",
        title: "Letters of funding commitment and support",
        guidance: "Documentation of match commitments and partner support. Verify what the current NOFO requires as commitment evidence.",
        required: false,
      },
    ],
  },
  {
    key: "infra",
    name: "INFRA (Infrastructure for Rebuilding America)",
    administeringAgency: "U.S. Department of Transportation",
    level: "federal",
    typicalApplicants: "States, counties, cities, MPOs (often as partners on larger applications)",
    eligibleProjectTypes: [
      "Freight corridor and goods movement projects",
      "Highway projects of regional significance",
      "Grade separations",
    ],
    cycleNote: "Periodic NOFOs, often combined into the Multimodal Project Discretionary Grant round — verify with USDOT.",
    matchRequirement: "INFRA funds capped at 60% of project cost; total federal share capped at 80% — verify the current NOFO.",
    url: "https://www.transportation.gov/grants/infra-grant-program",
    summary:
      "Large-scale federal discretionary funding for freight and highway projects of national or regional significance, with minimum awards of roughly $5M for small projects. For rural agencies, the realistic path is usually a partnership with the state DOT or a regional agency on a goods-movement or corridor application.",
    bcaNote:
      "USDOT requires a benefit-cost analysis per its BCA Guidance for INFRA applications, with freight benefits typically driving the ratio. Run the screening BCA early — a BCR below 1.0 at screening grade is a signal to rescope or firm up benefit evidence before committing to the full analysis.",
    applicationSections: [
      {
        key: "project-description",
        title: "Project description",
        guidance:
          "Describe the project, the problem it addresses, and its regional or national significance. Verify the current NOFO's narrative outline with USDOT — INFRA rounds are often combined into a multi-program NOFO with shared sections.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "freight-and-economic-significance",
        title: "Freight movement and economic significance",
        guidance:
          "Document goods-movement volumes, bottlenecks, and the economic activity the project supports. Verify the current NOFO's freight-data expectations with USDOT.",
        suggestedEvidence: ["modeling", "bca", "kb"],
      },
      {
        key: "merit-criteria",
        title: "Merit criteria narrative",
        guidance:
          "Address the current NOFO's merit criteria (historically including economic vitality, leverage, innovation, and performance and accountability). Verify the criteria list and weighting in the current NOFO.",
        suggestedEvidence: ["modeling", "bca", "kb"],
      },
      {
        key: "project-readiness-environmental",
        title: "Project readiness and environmental risk",
        guidance:
          "Document environmental review status, permits, right-of-way, and schedule. Verify the current NOFO's readiness documentation requirements with USDOT.",
        suggestedEvidence: ["project", "funding", "kb"],
      },
      {
        key: "grant-funds-sources-uses",
        title: "Grant funds, sources and uses of project funds",
        guidance:
          "The sources-and-uses exhibit is built from commitments and estimates, never AI-drafted. Verify the current NOFO's INFRA share caps and match documentation rules with USDOT.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "benefit-cost-analysis",
        title: "Benefit-cost analysis",
        guidance:
          "A BCA of record per the current USDOT BCA Guidance, typically freight-benefit driven — OpenPlan's screening BCA is an early-warning analogue, not this document. Verify the guidance edition in the current NOFO.",
        required: true,
      },
      {
        key: "project-location-file",
        title: "Project location file",
        guidance: "Geospatial file of the project location. Verify the current NOFO's required format with USDOT.",
        required: false,
      },
      {
        key: "letters-of-support",
        title: "Letters of funding commitment and support",
        guidance: "Match commitments and partner support, often including the state DOT or the regional agency on partnership applications. Verify commitment-evidence requirements in the current NOFO.",
        required: false,
      },
    ],
  },
  {
    key: "cmaq",
    name: "Congestion Mitigation and Air Quality Improvement (CMAQ)",
    administeringAgency: "FHWA, programmed through your state DOT and regional planning agencies",
    level: "federal",
    typicalApplicants: "Cities, counties, and transit agencies through their MPO or regional planning agency",
    eligibleProjectTypes: [
      "Transit service and fleet projects",
      "Bicycle and pedestrian facilities",
      "Signal timing and ITS",
      "Clean-vehicle and trip-reduction projects",
    ],
    cycleNote: "Programmed through regional cycles rather than a single statewide call. Verify timing with your MPO or regional planning agency.",
    matchRequirement: "Typically 80% federal / 20% local; states with large areas of federal land use a higher sliding-scale federal share, and some projects qualify for more. Verify with the programming agency.",
    url: "https://www.fhwa.dot.gov/environment/air_quality/cmaq/",
    summary:
      "Federal formula funding for projects that reduce transportation emissions in air-quality nonattainment and maintenance areas, programmed regionally rather than by statewide competition. Availability depends on your county's air-quality designation, so confirm eligibility with the regional agency first.",
    applicationSections: [
      {
        key: "project-description",
        title: "Project description",
        guidance:
          "Describe the project and how it reduces transportation emissions or congestion. Verify your regional planning agency's current programming application format. CMAQ is programmed regionally and each agency structures its call differently.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "emissions-benefit-narrative",
        title: "Emissions benefit narrative",
        guidance:
          "Explain the mechanism by which the project reduces emissions and summarize the quantified estimate. The quantified figures come from the required emissions calculation methodology. Verify which calculator your regional planning agency's current call requires.",
        suggestedEvidence: ["modeling", "kb"],
      },
      {
        key: "eligibility-and-air-quality-context",
        title: "Eligibility and air-quality context",
        guidance:
          "Document the area's nonattainment or maintenance designation and the project's CMAQ eligibility category. Verify current designations and eligible categories with your regional planning agency.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "implementation-schedule",
        title: "Implementation schedule",
        guidance:
          "Lay out delivery milestones and obligation timing. Verify programming-year and obligation expectations with your regional planning agency's current cycle.",
        suggestedEvidence: ["project", "funding", "kb"],
      },
      {
        key: "cost-estimate",
        title: "Cost estimate",
        guidance:
          "Cost figures come from the engineer's estimate, never from AI drafting. Verify the current cycle's estimate format and the applicable federal share with your regional planning agency.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "emissions-calculation-worksheet",
        title: "Emissions calculation worksheet",
        guidance: "Quantified emissions-reduction estimate on the required methodology. Verify the accepted calculator with your regional planning agency's current call.",
        required: true,
      },
      {
        key: "project-location-map",
        title: "Project location map",
        guidance: "Map locating the project. Verify format expectations with your regional planning agency's current application instructions.",
        required: false,
      },
    ],
  },
  {
    key: "fta-5310",
    name: "FTA Section 5310 (Enhanced Mobility of Seniors & Individuals with Disabilities)",
    administeringAgency: "FTA, through your state DOT's transit office for small urban and rural areas and through designated recipients in large urbanized areas",
    level: "federal",
    typicalApplicants: "Nonprofits and public agencies serving seniors and people with disabilities",
    eligibleProjectTypes: [
      "Accessible vehicles and equipment",
      "Mobility management",
      "Operating support for specialized services",
    ],
    cycleNote: "Each state or designated recipient sets its own call. Verify the current call with your state DOT's transit office or your area's designated recipient.",
    matchRequirement: "Typically 80/20 federal/local for capital and 50/50 for operating; toll credits may cover match — verify.",
    url: "https://www.transit.dot.gov/funding/grants/enhanced-mobility-seniors-individuals-disabilities-section-5310",
    summary:
      "Federal formula funds passed through states and designated recipients to improve mobility for seniors and people with disabilities where transit is unavailable or insufficient. The standard source for paratransit vehicle replacement and mobility management in small and rural communities.",
    applicationSections: [
      {
        key: "need-for-service",
        title: "Need for service",
        guidance:
          "Document the mobility gap for seniors and people with disabilities in the service area. Verify the current call's need-documentation expectations with the agency running the call.",
        suggestedEvidence: ["project", "engagement", "kb"],
      },
      {
        key: "project-implementation-plan",
        title: "Project implementation plan",
        guidance:
          "Describe the service or capital project, staffing, and operating approach. Verify the current call's implementation-plan format with the agency running the call.",
        suggestedEvidence: ["project", "funding", "kb"],
      },
      {
        key: "coordination-narrative",
        title: "Coordination with the coordinated plan",
        guidance:
          "Show how the project derives from the region's coordinated public transit-human services transportation plan. Verify which plan and adoption date the current call recognizes with the agency running the call.",
        suggestedEvidence: ["engagement", "kb"],
      },
      {
        key: "management-capacity",
        title: "Management capacity",
        guidance:
          "Document the organization's capacity to manage federal awards and maintain vehicles or services. Verify the current call's capacity questions with the agency running the call.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "budget-narrative",
        title: "Budget narrative",
        guidance:
          "Budget figures come from vendor quotes and finance staff, never from AI drafting. Verify current capital and operating share splits and toll-credit availability with the agency running the call.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "coordinated-plan-consistency",
        title: "Coordinated plan consistency documentation",
        guidance: "Excerpt or citation showing the project in the coordinated plan. Verify the accepted form of consistency evidence with the current call.",
        required: true,
      },
      {
        key: "authorizing-resolution",
        title: "Authorizing resolution",
        guidance: "Governing-body resolution authorizing the application. Verify the current call's resolution template with the agency running the call.",
        required: true,
      },
      {
        key: "vehicle-specifications",
        title: "Vehicle specifications",
        guidance: "Specifications for requested vehicles or equipment. Verify the current call's accepted vehicle categories with the agency running the call.",
        required: false,
      },
    ],
  },
  {
    key: "fta-5311",
    name: "FTA Section 5311 (Formula Grants for Rural Areas)",
    administeringAgency: "FTA, administered by your state DOT's transit office",
    level: "federal",
    typicalApplicants: "Rural transit operators, counties, tribes; intercity bus carriers under 5311(f)",
    eligibleProjectTypes: [
      "Rural transit operating assistance",
      "Transit capital and vehicle replacement",
      "Intercity bus service (5311(f))",
    ],
    cycleNote: "Annual apportionments programmed through the state, with periodic 5311(f) intercity bus calls. Verify with your state DOT's transit office.",
    matchRequirement: "Operating assistance roughly 50/50 and capital roughly 80/20 federal share; sliding scale and toll credits apply — verify.",
    url: "https://www.transit.dot.gov/rural-formula-grants-5311",
    summary:
      "The backbone federal funding source for public transit in areas under 50,000 population, covering both operating and capital needs. Rural operators access it through their state, with the 5311(f) set-aside supporting intercity bus connections between rural communities and urban hubs.",
    applicationSections: [
      {
        key: "service-description",
        title: "Service description",
        guidance:
          "Describe the rural transit service: routes, span, ridership, and the communities connected. Verify the current programming cycle's service-data requirements with your state DOT's transit office.",
        suggestedEvidence: ["project", "engagement", "kb"],
      },
      {
        key: "program-of-projects",
        title: "Program of projects",
        guidance:
          "List the operating and capital items requested for the apportionment year. Verify the current cycle's program-of-projects format with your state DOT's transit office.",
        suggestedEvidence: ["project", "funding", "kb"],
      },
      {
        key: "operating-capital-budget",
        title: "Operating and capital budget",
        guidance:
          "Budget figures come from the operator's adopted budget, never from AI drafting. Verify current sliding-scale shares and toll-credit rules with your state DOT's transit office.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
      {
        key: "compliance-certifications",
        title: "Compliance certifications",
        guidance:
          "Certifications and assurances are executed legal documents, never AI-drafted. Verify the current federal fiscal year's certification package with your state DOT's transit office.",
        suggestedEvidence: ["project"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "authorizing-resolution",
        title: "Authorizing resolution",
        guidance: "Governing-body resolution authorizing the application and execution. Verify the current cycle's resolution language with your state DOT's transit office.",
        required: true,
      },
      {
        key: "certifications-and-assurances",
        title: "Certifications and assurances",
        guidance: "The current federal fiscal year's executed certifications. Verify the applicable package with your state DOT's transit office.",
        required: true,
      },
    ],
  },
  {
    key: "crp",
    name: "Carbon Reduction Program (CRP)",
    administeringAgency: "FHWA, administered through your state DOT and regional planning agencies",
    level: "federal",
    typicalApplicants: "Cities, counties, and transit agencies via state and regional programming",
    eligibleProjectTypes: [
      "Active transportation projects",
      "ITS and signal efficiency",
      "Zero-emission vehicle infrastructure",
      "Transit projects that reduce emissions",
    ],
    cycleNote: "Programmed through state and regional cycles rather than one statewide call. Verify with your state DOT's local assistance office or your MPO.",
    matchRequirement: "Typically 80% federal / 20% local; states with large areas of federal land use a higher sliding-scale federal share. Verify with the programming agency.",
    url: "https://highways.dot.gov/iija/fact-sheets/carbon-reduction-program-crp",
    summary:
      "BIL formula program dedicated to projects that reduce on-road transportation emissions, split between a share the state programs and shares suballocated by population and programmed regionally. Eligibility overlaps heavily with active transportation, ITS, and ZEV infrastructure work small agencies already plan.",
    applicationSections: [
      {
        key: "project-description",
        title: "Project description",
        guidance:
          "Describe the project and its eligible carbon-reduction category. Verify the current programming cycle's application format with your state DOT or your MPO. CRP is programmed through state and regional cycles, not one statewide call.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "emissions-reduction-rationale",
        title: "Emissions reduction rationale",
        guidance:
          "Explain the mechanism by which the project reduces on-road emissions and summarize any quantified estimate. Verify whether the current cycle requires quantification and which methodology with the programming agency.",
        suggestedEvidence: ["modeling", "kb"],
      },
      {
        key: "carbon-reduction-strategy-consistency",
        title: "Carbon reduction strategy consistency",
        guidance:
          "Show consistency with the state's Carbon Reduction Strategy and any regional strategy. Verify the current strategy documents the cycle references with the programming agency.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "cost-estimate",
        title: "Cost estimate",
        guidance:
          "Cost figures come from the engineer's estimate, never from AI drafting. Verify the current cycle's estimate format and federal share with the programming agency.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "emissions-estimate-documentation",
        title: "Emissions estimate documentation",
        guidance: "Supporting calculation for any claimed emissions reduction. Verify the accepted methodology with the current cycle's programming agency.",
        required: false,
      },
      {
        key: "project-location-map",
        title: "Project location map",
        guidance: "Map locating the project. Verify format expectations with the current cycle's application instructions.",
        required: false,
      },
    ],
  },
  {
    key: "protect",
    name: "PROTECT (Resilience) Program",
    administeringAgency: "FHWA (formula funds through your state DOT; discretionary NOFOs direct from FHWA)",
    level: "federal",
    typicalApplicants: "States, MPOs, counties, cities, tribes",
    eligibleProjectTypes: [
      "Resilience improvements to at-risk infrastructure",
      "Evacuation route projects",
      "At-risk coastal infrastructure",
      "Resilience planning",
    ],
    cycleNote: "Formula funds flow through your state DOT, and discretionary NOFOs are periodic. Verify current opportunities with FHWA and your state DOT.",
    matchRequirement: "Typically 80% federal share; planning activities can reach a higher federal share — verify the current guidance.",
    url: "https://highways.dot.gov/iija/fact-sheets/protect-formula-program",
    summary:
      "Federal resilience program funding projects that harden surface transportation against wildfire, flooding, sea-level rise, and other natural hazards, including evacuation routes. Directly relevant to rural agencies managing wildfire corridors and storm-damaged roads.",
    applicationSections: [
      {
        key: "resilience-need",
        title: "Resilience need and hazard exposure",
        guidance:
          "Document the natural hazards threatening the asset (wildfire, flooding, storm damage, sea-level rise) and the consequence of failure, including evacuation function. Verify the current opportunity's hazard-documentation expectations with FHWA or your state DOT.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "project-description",
        title: "Project description",
        guidance:
          "Describe the resilience improvement and the asset it protects. Verify eligible activity categories in the current formula guidance or discretionary NOFO.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "resilience-benefits",
        title: "Resilience benefits",
        guidance:
          "Explain avoided damage, maintained access, and continuity of the network during hazard events. Verify how the current opportunity expects benefits to be presented — some discretionary rounds ask for benefit-cost information.",
        suggestedEvidence: ["modeling", "bca", "kb"],
      },
      {
        key: "planning-consistency",
        title: "Planning consistency",
        guidance:
          "Show consistency with resilience planning. A resilience improvement plan can raise the federal share. Verify the current opportunity's planning-consistency provisions with FHWA or your state DOT.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "budget-narrative",
        title: "Budget narrative",
        guidance:
          "Budget figures come from the engineer's estimate, never from AI drafting. Verify the current opportunity's federal share and match rules with FHWA or your state DOT.",
        suggestedEvidence: ["funding"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "hazard-exposure-documentation",
        title: "Hazard exposure documentation",
        guidance: "Maps, damage history, or hazard designations documenting exposure. Verify accepted sources with the current opportunity.",
        required: false,
      },
      {
        key: "benefit-cost-analysis",
        title: "Benefit-cost analysis",
        guidance: "Some discretionary PROTECT rounds request benefit-cost information — OpenPlan's screening BCA is not that document. Verify whether the current NOFO requires one and to what guidance.",
        required: false,
      },
      {
        key: "letters-of-support",
        title: "Letters of support",
        guidance: "Partner and community support letters. Verify whether the current opportunity accepts them and any limits.",
        required: false,
      },
    ],
  },
];

export const usFederalPrograms: GrantProgramBundle = {
  key: "us",
  label: "US federal programs",
  // No subdivision: these programs are open to eligible applicants anywhere in
  // the United States. Several are administered through a state pass-through,
  // which changes who you apply TO, not who may apply.
  jurisdiction: { country: "US", label: "United States" },
  programs,
};
