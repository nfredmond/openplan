// United States, Texas — state-administered grant programs.
//
// Curated catalog entries for the Texas transportation funding programs a small
// or rural agency most often pursues. Static reference data, not a live
// opportunity feed. Cycle timing is phrased as guidance on purpose — Texas runs
// most of these on a biennial call whose dates move — so every entry tells the
// operator where to verify the current call instead of asserting a deadline.
//
// Every URL below was fetched and confirmed to answer 200 when these entries
// were authored (2026-08-07).
//
// TEXAS'S DISTINGUISHING FEATURE, and the thing an out-of-state planner gets
// wrong: the 200,000-population line. TxDOT's Public Transportation Division
// runs the statewide Transportation Alternatives call ONLY for areas of 200,000
// or fewer; above that, the MPO receives its TA apportionment directly and runs
// its own selection on its own schedule. So for a large Texas metro the answer
// to "when is the call" is not TxDOT's date at all, and every TA entry here
// says so rather than sending a planner to the wrong process.
//
// Deliberately absent, decided at authoring time:
//   - A standalone Safe Routes to School program. Texas does NOT run one:
//     SRTS-type projects compete inside the Transportation Alternatives call.
//     Listing a separate SRTS entry would send a planner looking for a program
//     that does not exist, which is the failure mode this catalog exists to
//     avoid. The TA entry names SRTS work explicitly instead.
//   - The Traffic Safety (eGrants) program's specifics. The public page
//     confirms who may apply and that it is a web-based application system, but
//     publishes neither the eligible project categories nor the match on the
//     page itself — both live behind the Request for Proposals in the eGrants
//     portal. It is listed with what is verifiable and points there.
//   - Per-program transit match rates. TxDOT's public transportation landing
//     page names the programs but publishes match on the individual call
//     documents, which change each cycle. Stating a rate we did not read would
//     be inventing the one number an applicant budgets against.

import type { GrantProgramBundle, GrantProgramCatalogEntry } from "./types";

const programs: readonly GrantProgramCatalogEntry[] = [
  {
    key: "tx-transportation-alternatives",
    name: "Transportation Alternatives Set-Aside (TA)",
    administeringAgency:
      "TxDOT Public Transportation Division (areas of 200,000 or fewer); above that, the MPO awards its own TA apportionment",
    level: "state",
    typicalApplicants:
      "Local governments, MPOs and regional planning organizations, transit agencies, school districts, and other entities eligible under the federal TA set-aside; sponsorship by a local government with maintenance authority is the usual route",
    eligibleProjectTypes: [
      "Pedestrian infrastructure (sidewalks, crossings, ADA improvements)",
      "Bicycle infrastructure (lanes, separated facilities, shared-use paths)",
      "Safe Routes to School infrastructure — Texas has no separate SRTS program; this is where that work competes",
      "Active transportation planning (non-infrastructure)",
    ],
    cycleNote:
      "Roughly biennial statewide call, two-step. Verify it with TxDOT — or with your MPO above 200,000 population, where TxDOT's call does not apply.",
    matchRequirement:
      "A local match is required under the federal set-aside; TxDOT publishes the rate and any sliding scale in each call's program guide rather than on the program page. Verify the current guide before budgeting.",
    url: "https://www.txdot.gov/business/grants-and-funding/bicycle-pedestrian-local-federal-funding-programs.html",
    summary:
      "Texas's principal competitive source for walking and biking infrastructure, distributed from the federal Transportation Alternatives set-aside. TxDOT's Public Transportation Division runs the statewide call for areas of 200,000 or fewer; larger urbanized areas receive their apportionment through their MPO and select projects themselves. The most recent statewide call was sized at roughly $250 million across FY2027–FY2029. Because Texas runs no standalone Safe Routes to School program, school-route projects compete here.",
    applicationSections: [
      {
        key: "project-description",
        title: "Project description and limits",
        guidance:
          "Describe the facility, its termini, and what it connects. The preliminary application establishes eligibility before the detailed application is invited — verify the current call's two-step structure and what each step asks for.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "safety-need",
        title: "Safety need and existing conditions",
        guidance:
          "Document the safety problem the project addresses — crash history, missing facilities, or conditions on a school route. Verify how the current call scores safety need.",
        suggestedEvidence: ["project", "modeling", "kb"],
      },
      {
        key: "demand-and-connectivity",
        title: "Demand and network connectivity",
        guidance:
          "Show who the facility serves and what it connects to. Verify whether the current call asks for counts, modeled demand, or a qualitative network argument.",
        suggestedEvidence: ["modeling", "project"],
      },
      {
        key: "public-support",
        title: "Public and stakeholder support",
        guidance:
          "Evidence of community support and any adopted plan the project comes from. Verify what documentation the current call requires.",
        suggestedEvidence: ["engagement", "kb"],
      },
      {
        key: "budget-and-match",
        title: "Cost estimate and local match",
        guidance:
          "A cost estimate by phase and your committed local match. Verify the current match rate in the call's program guide — it is not published on the program page.",
        suggestedEvidence: ["project"],
        // Never AI-drafted: a fabricated figure here is the number the award is
        // computed from.
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "project-location-map",
        title: "Project location map",
        guidance:
          "A map showing the facility, its termini and what it connects to. Verify the current call's format expectations.",
        required: true,
      },
      {
        key: "cost-estimate",
        title: "Engineer's cost estimate",
        guidance:
          "A phase-level cost estimate. Verify who the current call requires to prepare it.",
        required: true,
      },
      {
        key: "resolution-of-support",
        title: "Sponsoring jurisdiction resolution",
        guidance:
          "Evidence the sponsoring local government commits to the project and its maintenance. Verify the current call's wording requirements.",
        required: true,
      },
    ],
  },
  {
    key: "tx-rural-public-transportation",
    name: "Rural and small-urban public transportation grants (FTA 5311, 5310, 5304)",
    administeringAgency: "Texas Department of Transportation (TxDOT), Public Transportation Division",
    level: "state",
    typicalApplicants:
      "Rural and small-urban transit districts, counties and cities operating or sponsoring transit service, and non-profits providing service to seniors and people with disabilities",
    eligibleProjectTypes: [
      "Rural public transportation operating and capital assistance (49 U.S.C. 5311)",
      "Enhanced mobility of seniors and individuals with disabilities (49 U.S.C. 5310)",
      "Small urban public transportation",
      "Intercity bus service (49 U.S.C. 5311(f))",
      "Rural Transportation Assistance Program — training and technical assistance (49 U.S.C. 5311(b)(3))",
      "Statewide planning assistance (49 U.S.C. 5304)",
    ],
    cycleNote:
      "A coordinated call covers several of these programs together. Verify the current call instructions on the TxDOT public transportation grants page.",
    matchRequirement:
      "Varies by program and by whether the request is capital or operating; TxDOT publishes the rates in each cycle's call instructions rather than on the program page. Verify before budgeting.",
    url: "https://www.txdot.gov/business/grants-and-funding/public-transportation-grants.html",
    summary:
      "TxDOT's Public Transportation Division is the pass-through for the federal transit programs that serve everywhere in Texas outside the large urbanized areas — rural operating and capital assistance, seniors and disabilities mobility, intercity bus, and rural training assistance. Several are solicited together through one coordinated call, so an agency pursuing more than one of them is usually filing once rather than separately.",
    applicationSections: [
      {
        key: "service-description",
        title: "Service description and need",
        guidance:
          "Describe the service, the population it carries, and the need it meets. Verify the current coordinated call instructions for what the narrative must cover.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "coordination",
        title: "Regional coordination",
        guidance:
          "Show how the service coordinates with other providers in the region. Verify how the current call weights coordination.",
        suggestedEvidence: ["engagement", "kb"],
      },
      {
        key: "budget-and-match",
        title: "Budget and local match",
        guidance:
          "Operating and capital budgets with your committed match. Rates differ between capital and operating — verify both in the current call instructions.",
        suggestedEvidence: ["project"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "budget-detail",
        title: "Operating and capital budget detail",
        guidance:
          "Line-item budgets for the funds requested. Verify the format the current coordinated call instructions require.",
        required: true,
      },
      {
        key: "coordination-evidence",
        title: "Regional coordination evidence",
        guidance:
          "Documentation of coordination with other providers. Verify what the current call accepts.",
        required: true,
      },
    ],
  },
  {
    key: "tx-traffic-safety-egrants",
    name: "Traffic Safety grants (eGrants)",
    administeringAgency: "Texas Department of Transportation (TxDOT), Traffic Safety Division",
    level: "state",
    typicalApplicants:
      "State and local government agencies, educational institutions, and non-profit agencies — TxDOT publishes the specific eligibility criteria in the Request for Proposals rather than on the program page",
    eligibleProjectTypes: [
      "Behavioral traffic safety projects proposed against the current Request for Proposals",
    ],
    cycleNote:
      "Annual Request for Proposals in eGrants. Categories, deadlines and match are in the RFP, not on the program page — verify the current one in the portal.",
    matchRequirement:
      "Not published on the program page; stated in the Request for Proposals. Verify there before budgeting.",
    url: "https://www.txdot.gov/business/grants-and-funding/traffic-safety-egrants.html",
    summary:
      "TxDOT's behavioral traffic-safety grants are applied for, scored, and managed entirely through the eGrants system. This entry is deliberately thin: TxDOT publishes eligibility, project categories, deadlines and match in the Request for Proposals behind the portal rather than on any public page, so stating them here would be asserting terms nobody verified. Treat it as a pointer to the portal, and read the current RFP before planning an application.",
    applicationSections: [
      {
        key: "problem-identification",
        title: "Traffic safety problem identification",
        guidance:
          "Describe the behavioral safety problem with the data that establishes it. Verify the current Request for Proposals for the problem areas being solicited.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "budget-detail",
        title: "Budget detail",
        guidance:
          "Line-item budget for the proposed project. Verify the current Request for Proposals for allowable cost categories and any match.",
        suggestedEvidence: ["project"],
        aiDraftingEnabled: false,
      },
    ],
    requiredAttachments: [
      {
        key: "rfp-eligibility-confirmation",
        title: "Eligibility confirmation from the current RFP",
        guidance:
          "Confirmation that your organization type is eligible under the current solicitation. Verify in the eGrants Request for Proposals — the program page does not publish it.",
        required: true,
      },
    ],
  },
];

export const usTxPrograms: GrantProgramBundle = {
  key: "us-tx",
  label: "Texas state programs",
  // Subdivision-scoped: an agency outside Texas cannot apply to these, so the
  // catalog must say so rather than list them as if it could.
  jurisdiction: { country: "US", subdivision: "TX", label: "Texas" },
  programs,
};
