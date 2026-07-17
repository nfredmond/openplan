// Curated catalog of real California + federal transportation funding programs
// relevant to small and rural California agencies.
//
// This is static reference data, not a live opportunity feed. Cycle timing is
// phrased as guidance text on purpose — funding cycles shift, so every entry
// tells the operator where to verify the current call instead of asserting a
// deadline. URLs point at the official program pages.

export type GrantProgramLevel = "federal" | "state";

export type GrantProgramCatalogEntry = {
  /** Stable unique key for the catalog entry. */
  key: string;
  /** Program name as an operator would track it. */
  name: string;
  /** Who administers the program (as encountered by a California applicant). */
  administeringAgency: string;
  level: GrantProgramLevel;
  /** Who typically applies from a small/rural CA agency perspective. */
  typicalApplicants: string;
  /** Short list of eligible project types. */
  eligibleProjectTypes: string[];
  /** Timing guidance — no hard dates; always says where to verify. */
  cycleNote: string;
  /** Local match posture guidance — verify against current guidelines. */
  matchRequirement: string;
  /** Official program page. */
  url: string;
  /** 2-3 sentence orientation summary. */
  summary: string;
};

export const GRANT_PROGRAM_CATALOG: readonly GrantProgramCatalogEntry[] = [
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
  },
  {
    key: "hsip",
    name: "Highway Safety Improvement Program (HSIP)",
    administeringAgency: "FHWA, administered by Caltrans Division of Local Assistance",
    level: "federal",
    typicalApplicants: "Cities, counties, tribal governments",
    eligibleProjectTypes: [
      "Signals and roundabouts",
      "Pedestrian crossing enhancements",
      "Guardrail and shoulder treatments",
      "Systemic safety improvements",
    ],
    cycleNote: "Local HSIP calls run roughly every one to two years — verify the current call with Caltrans Local Assistance.",
    matchRequirement:
      "Typically 90% federal / 10% local; certain safety countermeasures qualify for 100% federal funding — verify the current call.",
    url: "https://dot.ca.gov/programs/local-assistance/fed-and-state-programs/highway-safety-improvement-program",
    summary:
      "Federal safety funding for infrastructure countermeasures on local roads, awarded through data-driven benefit/cost scoring against crash history. A workhorse program for small agencies with documented collision patterns, and pairs naturally with a Local Roadway Safety Plan or safety action plan.",
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
      "Large-scale federal discretionary funding for freight and highway projects of national or regional significance, with minimum awards of roughly $5M for small projects. For rural agencies, the realistic path is usually a partnership with Caltrans or a regional agency on a goods-movement or corridor application.",
  },
  {
    key: "cmaq",
    name: "Congestion Mitigation and Air Quality Improvement (CMAQ)",
    administeringAgency: "FHWA, programmed through Caltrans and regional MPOs/RTPAs",
    level: "federal",
    typicalApplicants: "Cities, counties, and transit agencies via their MPO/RTPA",
    eligibleProjectTypes: [
      "Transit service and fleet projects",
      "Bicycle and pedestrian facilities",
      "Signal timing and ITS",
      "Clean-vehicle and trip-reduction projects",
    ],
    cycleNote: "Programmed through regional MPO/RTPA cycles rather than a single statewide call — verify timing with your MPO/RTPA.",
    matchRequirement: "Typically 88.53% federal / 11.47% local in California; some projects qualify for higher federal share — verify.",
    url: "https://www.fhwa.dot.gov/environment/air_quality/cmaq/",
    summary:
      "Federal formula funding for projects that reduce transportation emissions in air-quality nonattainment and maintenance areas, programmed regionally rather than by statewide competition. Availability depends on your county's air-quality designation, so confirm eligibility with the regional agency first.",
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
  },
  {
    key: "fta-5310",
    name: "FTA Section 5310 (Enhanced Mobility of Seniors & Individuals with Disabilities)",
    administeringAgency: "FTA, administered in California by Caltrans Division of Rail and Mass Transportation",
    level: "federal",
    typicalApplicants: "Nonprofits and public agencies serving seniors and people with disabilities",
    eligibleProjectTypes: [
      "Accessible vehicles and equipment",
      "Mobility management",
      "Operating support for specialized services",
    ],
    cycleNote: "Statewide competitive cycles roughly every two years — verify the current call with Caltrans DRMT.",
    matchRequirement: "Typically 80/20 federal/local for capital and 50/50 for operating; toll credits may cover match — verify.",
    url: "https://www.transit.dot.gov/funding/grants/enhanced-mobility-seniors-individuals-disabilities-section-5310",
    summary:
      "Federal formula funds passed through Caltrans to improve mobility for seniors and people with disabilities where transit is unavailable or insufficient. The standard source for paratransit vehicle replacement and mobility management in small and rural communities.",
  },
  {
    key: "fta-5311",
    name: "FTA Section 5311 (Formula Grants for Rural Areas)",
    administeringAgency: "FTA, administered in California by Caltrans Division of Rail and Mass Transportation",
    level: "federal",
    typicalApplicants: "Rural transit operators, counties, tribes; intercity bus carriers under 5311(f)",
    eligibleProjectTypes: [
      "Rural transit operating assistance",
      "Transit capital and vehicle replacement",
      "Intercity bus service (5311(f))",
    ],
    cycleNote: "Annual apportionments programmed through Caltrans; periodic competitive 5311(f) intercity bus calls — verify with Caltrans DRMT.",
    matchRequirement: "Operating assistance roughly 50/50 and capital roughly 80/20 federal share; sliding scale and toll credits apply — verify.",
    url: "https://www.transit.dot.gov/rural-formula-grants-5311",
    summary:
      "The backbone federal funding source for public transit in areas under 50,000 population, covering both operating and capital needs. Rural California operators access it through Caltrans, with the 5311(f) set-aside supporting intercity bus connections between rural communities and urban hubs.",
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
  },
  {
    key: "crp",
    name: "Carbon Reduction Program (CRP)",
    administeringAgency: "FHWA, administered through Caltrans Local Assistance and regional MPOs/RTPAs",
    level: "federal",
    typicalApplicants: "Cities, counties, and transit agencies via state and regional programming",
    eligibleProjectTypes: [
      "Active transportation projects",
      "ITS and signal efficiency",
      "Zero-emission vehicle infrastructure",
      "Transit projects that reduce emissions",
    ],
    cycleNote: "Programmed through state and regional cycles rather than one statewide call — verify with Caltrans Local Assistance or your MPO/RTPA.",
    matchRequirement: "Typically 88.53% federal / 11.47% local in California — verify with the programming agency.",
    url: "https://dot.ca.gov/programs/local-assistance/fed-and-state-programs/carbon-reduction-program",
    summary:
      "BIL formula program dedicated to projects that reduce on-road transportation emissions, split in California between a state-programmed share and local shares programmed regionally. Eligibility overlaps heavily with active transportation, ITS, and ZEV infrastructure work small agencies already plan.",
  },
  {
    key: "protect",
    name: "PROTECT (Resilience) Program",
    administeringAgency: "FHWA (formula funds via Caltrans; discretionary NOFOs direct from FHWA)",
    level: "federal",
    typicalApplicants: "States, MPOs, counties, cities, tribes",
    eligibleProjectTypes: [
      "Resilience improvements to at-risk infrastructure",
      "Evacuation route projects",
      "At-risk coastal infrastructure",
      "Resilience planning",
    ],
    cycleNote: "Formula funds flow through Caltrans; discretionary NOFOs are periodic — verify current opportunities with FHWA and Caltrans.",
    matchRequirement: "Typically 80% federal share; planning activities can reach a higher federal share — verify the current guidance.",
    url: "https://highways.dot.gov/iija/fact-sheets/protect-formula-program",
    summary:
      "Federal resilience program funding projects that harden surface transportation against wildfire, flooding, sea-level rise, and other natural hazards, including evacuation routes. Directly relevant to rural California agencies managing fire-country corridors and storm-damaged roads.",
  },
];

export function isGrantProgramTracked(
  program: Pick<GrantProgramCatalogEntry, "name">,
  trackedTitles: Iterable<string>
): boolean {
  const normalized = program.name.trim().toLowerCase();
  for (const title of trackedTitles) {
    if (title.trim().toLowerCase() === normalized) {
      return true;
    }
  }
  return false;
}
