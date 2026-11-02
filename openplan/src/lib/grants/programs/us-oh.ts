// United States, Ohio — state-administered grant programs.
//
// Curated catalog entries for the Ohio funding programs a small or rural agency
// most often pursues. Static reference data, not a live opportunity feed.
//
// ============================================ A URL PROBLEM WORTH RECORDING
//
// ODOT rebuilt transportation.ohio.gov as a client-rendered application whose
// interior pages are served at opaque `/page/<id>` addresses and which answers
// 404 to any non-browser request — including the human-readable program path
// that ODOT'S OWN 2026 GUIDANCE PDF PRINTS. Every candidate ODOT program URL
// was probed on 2026-08-07 and none answered.
//
// So this bundle links to DOCUMENTS rather than to program pages wherever the
// program page cannot be confirmed to resolve. A grant catalog whose links go
// nowhere is worse than a shorter one: a planner cannot tell a dead link from
// their own mistake, and the whole value of the entry is that it takes them to
// the authority. The links below were each fetched and confirmed to answer 200
// when these entries were authored.
//
// This is why the Ohio bundle is two programs rather than five. The others are
// listed under "deliberately absent" below with what is missing, so a later
// session can add them when a stable address exists rather than rediscovering
// the same dead ends.
//
// Deliberately absent, decided at authoring time:
//   - ODOT Transportation Alternatives (TA). The program exists, but no ODOT
//     page for it could be confirmed to resolve, and its match and caps could
//     not be read from any source that answered. Ohio agencies pursue TA
//     through their ODOT district and MPO; adding an entry with an unverified
//     URL and no verified terms would be worse than the gap.
//   - ODOT Small City Program, Urban Paving, and the Highway Safety
//     Improvement Program. Same reason. All three are real; none had an
//     address that answered.
//   - Ohio Transit Partnership Program. Same reason.
//
// The two below are included because both their terms AND their links were
// verified against sources that answered.

import type { GrantProgramBundle, GrantProgramCatalogEntry } from "./types";

const programs: readonly GrantProgramCatalogEntry[] = [
  {
    key: "oh-safe-routes-to-school",
    name: "Safe Routes to School (SRTS)",
    administeringAgency: "Ohio Department of Transportation (ODOT)",
    level: "state",
    typicalApplicants:
      "Infrastructure applications must be sponsored by the local jurisdiction with maintenance authority (city, village, township, county). Non-infrastructure applications may come from political subdivisions — including school districts and health districts — or a non-profit or public agency affiliated with a jurisdiction, school, or school system. A township applying for infrastructure or plan development also needs a letter of support from its county.",
    eligibleProjectTypes: [
      "Infrastructure: crossings, walkways, bike facilities and trails within 2 miles of a K-12 school",
      "Non-infrastructure: education and encouragement programs, events, crossing-guard programs, data collection and evaluation",
      "School Travel Plan development assistance — ODOT consultant support, or reimbursement for a locally selected consultant",
    ],
    cycleNote:
      "Annual, opening early in the year and closing in spring. Coordinating with your ODOT District SRTS Coordinator first is required — verify this cycle's guidance.",
    matchRequirement:
      "None in the usual sense: the program reimburses up to 100 percent of eligible costs. What the applicant carries instead is overruns — covering project overages is explicitly the local applicant's responsibility, and any work started before FHWA authorization makes that entire phase ineligible.",
    url: "https://dam.assets.ohio.gov/image/upload/transportation.ohio.gov/safety/srts/2026SRTSGuidance.pdf",
    summary:
      "Ohio's Safe Routes to School program funds walking and biking improvements and programming within two miles of K-12 schools, at up to 100 percent reimbursement. Two features shape an application more than the money does. First, ELIGIBILITY IS PLAN-GATED: a project must already be identified in a School Travel Plan, an Active Transportation Plan, or an ODOT-approved equivalent that is less than five years old — so an agency without a current plan applies for plan-development assistance first, not for the project. Second, several disqualifiers are procedural rather than substantive: not coordinating with the District SRTS Coordinator, a cost estimate not prepared with an engineer, or a countermeasure absent from the plan will each end an otherwise sound application. The 2026 cycle raised the infrastructure cap from $500,000 to $1,000,000 and extended eligibility to high schools.",
    applicationSections: [
      {
        key: "plan-basis",
        title: "Plan basis for the project",
        guidance:
          "Name the School Travel Plan, Active Transportation Plan or ODOT-approved equivalent this project comes from, and verify it is less than five years old. A countermeasure not identified as a priority in a current plan is a listed disqualifier — this section is the eligibility gate, not background.",
        suggestedEvidence: ["kb", "project"],
      },
      {
        key: "student-travel-documentation",
        title: "Student travel and parent input",
        guidance:
          "Document student travel and parent input, including the 2-mile Student Radius Maps. ODOT can build the maps from submitted student address data, and in some cases a local or regional planning partner can. Parent surveys and teacher tallies are the standard instruments; verify with your District Coordinator what other surveys or outreach the current guidance accepts.",
        suggestedEvidence: ["engagement", "project"],
      },
      {
        key: "safety-need",
        title: "Safety need and existing conditions",
        guidance:
          "Describe the conditions on the route and the safety problem the project addresses. Verify the current scoring rubric in the guidance appendix — it changed for 2026.",
        suggestedEvidence: ["project", "modeling", "kb"],
      },
      {
        key: "cost-estimate",
        title: "Cost estimate by phase",
        guidance:
          "An estimate identifying which phases are being requested — preliminary engineering, design, right of way, construction, construction engineering. For infrastructure, verify that a professional engineer or other appropriate discipline assisted in preparing it; not doing so is a listed disqualifier, as is an estimate that does not identify its phases.",
        suggestedEvidence: ["project"],
        aiDraftingEnabled: false,
      },
      {
        key: "sustainability",
        title: "Sustainability past the funding (non-infrastructure)",
        guidance:
          "For non-infrastructure requests, show how the plans, programs, policies or environments continue after SRTS funding ends — that is the program's stated intent. Two-year projects are encouraged; verify the current completion window and the recommended per-school limits.",
        suggestedEvidence: ["engagement", "kb", "project"],
      },
    ],
    requiredAttachments: [
      {
        key: "student-radius-maps",
        title: "2-mile Student Radius Maps",
        guidance:
          "Required documentation of the student catchment. ODOT can develop these from submitted student address data if you cannot — verify the submission format with your District Coordinator.",
        required: true,
      },
      {
        key: "district-coordination",
        title: "Evidence of District SRTS Coordinator discussion",
        guidance:
          "Applications must be discussed with the District SRTS Coordinator before submission; not doing so is listed as a disqualifier. Verify who your district coordinator is before starting.",
        required: true,
      },
      {
        key: "mpo-rtpo-support",
        title: "MPO or RTPO letter of support",
        guidance:
          "Required for infrastructure and School Travel Plan applications where applicable. Townships additionally need a letter of support from their county government — verify which apply to you.",
        required: true,
      },
    ],
  },
  {
    key: "oh-opwc-scip-ltip",
    name: "State Capital Improvement Program (SCIP) and Local Transportation Improvement Program (LTIP)",
    administeringAgency:
      "Ohio Public Works Commission (OPWC), awarded through 19 District Public Works Integrating Committees",
    level: "state",
    typicalApplicants:
      "Counties, cities, villages, townships, and water and sewer districts — local subdivisions with authority over the infrastructure being improved",
    eligibleProjectTypes: [
      "Roads and bridges (both SCIP and LTIP)",
      "Culverts (SCIP)",
      "Water supply systems (SCIP)",
      "Wastewater treatment systems (SCIP)",
      "Storm water collection systems (SCIP)",
      "Solid waste disposal facilities (SCIP)",
    ],
    cycleNote:
      "Annual, but each of the 19 district committees sets its own calendar and ranking method. There is no statewide deadline — verify your district's policy manual.",
    matchRequirement:
      "SCIP grant funds cannot exceed 90 percent of total project cost for repair or replacement, or 50 percent for new or expanded facilities. An SCIP loan can be credited as the local match provided it is at least 10 percent. LTIP is grant-only and covers roads and bridges.",
    url: "https://www.publicworks.ohio.gov/",
    summary:
      "OPWC is where most Ohio local road, bridge and utility capital work is actually funded, and it is structurally unlike a state DOT program: the money is distributed to 19 district committees of local officials, and each district writes its own policy manual and ranking methodology. Two consequences for an applicant. First, the competitive criteria that matter are your district's, not the state's — a strong application in one district can be scored differently in the next. Second, the repair-versus-new distinction is the single largest lever on the award: 90 percent for repair or replacement against 50 percent for new or expanded capacity, which frequently decides how a project is scoped rather than merely how it is funded.",
    applicationSections: [
      {
        key: "district-methodology-alignment",
        title: "District methodology alignment",
        guidance:
          "Show how the project scores against YOUR district committee's current ranking methodology, not against a statewide standard — each of the 19 districts publishes its own. Verify the current round's policy manual before drafting.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "infrastructure-condition",
        title: "Infrastructure condition and need",
        guidance:
          "Document the condition of the asset and the consequences of not acting. Verify what condition evidence your district's methodology credits.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "repair-or-new",
        title: "Repair/replacement versus new or expanded",
        guidance:
          "State plainly which the project is: the grant ceiling is 90 percent for repair or replacement and 50 percent for new or expanded facilities. Verify how your district classifies work that does both — getting this wrong changes the award by nearly half.",
        suggestedEvidence: ["project"],
      },
      {
        key: "budget-and-match",
        title: "Budget and local share",
        guidance:
          "Total project cost, the grant requested, and the local share. An SCIP loan can be credited as your match if it is 10 percent or more — verify with your district how it treats loan-as-match in scoring.",
        suggestedEvidence: ["project"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "district-policy-manual-alignment",
        title: "District policy manual alignment",
        guidance:
          "Documentation that the application meets your district committee's current-round requirements. Verify the manual — each of the 19 districts publishes its own.",
        required: true,
      },
      {
        key: "cost-estimate",
        title: "Project cost estimate",
        guidance:
          "A cost estimate supporting the grant request and local share. Verify the level of detail your district requires.",
        required: true,
      },
    ],
  },
];

export const usOhPrograms: GrantProgramBundle = {
  key: "us-oh",
  label: "Ohio state programs",
  // Subdivision-scoped: an agency outside Ohio cannot apply to these, so the
  // catalog must say so rather than list them as if it could.
  jurisdiction: { country: "US", subdivision: "OH", label: "Ohio" },
  programs,
};
