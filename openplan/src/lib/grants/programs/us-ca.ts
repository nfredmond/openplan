// United States, California — state grant programs.
//
// Curated catalog entries for California state transportation funding
// programs relevant to small and rural agencies. This is static reference
// data, not a live opportunity feed. Cycle timing is phrased as guidance text
// on purpose — funding cycles shift, so every entry tells the operator where
// to verify the current call instead of asserting a deadline. URLs point at
// the official program pages.

import type {
  GrantApplicationAttachmentTemplate,
  GrantApplicationEarlierTemplate,
  GrantApplicationSectionTemplate,
  GrantProgramBundle,
  GrantProgramCatalogEntry,
  GrantProgramStateAdministration,
} from "./types";

// THE EARLIER ATP TEMPLATE: the seven sections and five attachments every ATP
// application was seeded from before the 2027 template below. It is not
// offered for a new application. It stays here, unchanged, because a saved
// application is recognised as an ATP application by these section keys
// (identifySeededTemplate), and that is what gives it the ATP packet and the
// evidence appendices. It does not follow the Commission's 2027 application
// (KI-2026-11-16-033). Do not edit it: a test pins its content.
const atpEarlierTemplate: GrantApplicationEarlierTemplate = {
  templateKey: "atp-pre-2027",
  applicationSections: [
    {
      key: "project-narrative",
      title: "Project description and scope",
      guidance:
        "Describe what the project builds, the gap it closes, and how the elements work together for people walking and biking. Verify the current cycle's narrative prompts and scoring rubric with the CTC; question wording and point values change between cycles.",
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
        "Explain which communities the project serves and how benefits reach them. Verify the current cycle's accepted disadvantaged-community definitions and mapping tools with the CTC; the qualifying criteria shift between cycles.",
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
        "Describe committed leveraged funds and how the scope uses ATP funds well. In the 2027 ATP Guidelines, cost effectiveness is a scoring topic for Large applications and leveraging for Large and Medium applications. The Small and Medium scoring rubrics still ask evaluators whether the application shows that cost-effectiveness was considered. The Commission runs its own benefit-cost tool at the program level, so the application asks for no benefit-cost ratio. Verify the current cycle's rubric with the CTC.",
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
      guidance:
        "Relevant pages of the adopted Regional Transportation Plan showing the project is consistent, a screening item in the 2027 ATP. Large applications (infrastructure or combination) also attach the adopted active transportation plan page that shows the project. Verify what the current cycle accepts.",
      required: false,
    },
  ],
};

// THE 2027 ATP TEMPLATE. It follows the Commission's 2027 Small Infrastructure
// application, in the application's order: the three parts of Part A that ask
// for narrative, then the seven numbered questions of Part B. Sources, all
// published by the California Transportation Commission under "2027 ATP
// (Cycle 8)" at https://catc.ca.gov/programs/active-transportation-program
// and read on November 15, 2026:
//   G   2027 Active Transportation Program Guidelines, Resolution G-26-31,
//       adopted March 19, 2026.
//   C   2027 ATP Application Checklist (PDF dated March 18, 2026).
//   Q   List of All Application Questions, Small Infrastructure and
//       Infrastructure/Non-Infrastructure Application (Word file, undated).
//   R   2027 ATP Small Infrastructure and Small Infrastructure +
//       Non-Infrastructure Scoring Rubric (PDF dated March 30, 2026).
//   QM, QL  The Medium and Large lists of application questions (Word files).
// Point values are the maximums in R, and in G section 18's table where R is
// silent (Corps use and past performance). They are stated in guidance, which
// the planner reads on screen; the exported PDF prints section titles only.
// The source of each section and attachment is named beside it and checked in
// src/test/atp-2027-template-follows-the-commissions-application.test.ts.
//
// Every section key starts with "atp-2027-" and appears in no other template,
// so an application seeded from this template is told apart from one seeded
// from the earlier template above. Do not reuse these keys in a later cycle's
// template.
const atp2027Sections: readonly GrantApplicationSectionTemplate[] = [
  // Q Part A1 to A4; G section 13 (application types, the two unscored items).
  {
    key: "atp-2027-part-a-project-information",
    title: "Part A1 to A4: Applicant and project information",
    guidance:
      "This template follows the CTC's 2027 Small Infrastructure application, for a project with a total cost of $3.5 million or less, in the application's order. Parts A1 (applicant), A3 (project type) and A4 (project details) are contact fields, lists and tables filled in on the Commission's online application. Part A2 asks for a project name (10 words), a summary of project scope (300 words), a summary of outcomes and outputs (35 words), a Federal Transportation Improvement Program project description (180 characters) and a project location (180 characters). A project within 500 feet of a freeway or of a roadway with annual average daily traffic over 125,000 also describes the design elements that limit exposure to air pollution and why the location was chosen (300 words). A project with Class III bike routes or sharrows answers questions in Part A4 about the posted speed and the local context (200 words each). The guidelines say neither of those two items is scored. Medium and Large applications add scored questions this template does not carry: Context Sensitive Bikeways/Walkways and Innovative Project Elements and Leveraging Funds in both, and Transformative Projects in the Large application. For a project over $3.5 million, add a custom section for each. Non-infrastructure only and Plan applications use different question lists. Verify the questions and word limits against the current application on the CTC's ATP page.",
    suggestedEvidence: ["project", "kb"],
  },
  // Q Part A5; C Part A5 (amounts in thousands); G section 14 (minimum request).
  {
    key: "atp-2027-part-a5-project-funding",
    title: "Part A5: Project funding",
    guidance:
      "Funding figures come from the engineer's estimate and finance staff, never from AI drafting. Part A5 asks for the total project cost, the total ATP request, the project phases ATP funds will pay for (PA&ED, PS&E, right of way, construction and non-infrastructure) and whether the agency asks for state-only funding, with a 50-word explanation and Exhibit 25-F if it does. The checklist says all amounts are entered in thousands. A completed Project Programming Request is attached. The guidelines set a minimum ATP request of $250,000, which does not apply to non-infrastructure projects, safe routes to school projects, recreational trail projects or plans. Verify the current forms and the minimum request with the CTC.",
    suggestedEvidence: ["funding"],
    aiDraftingEnabled: false,
  },
  // Q Part A6; G section 16 (who screens, and for what).
  {
    key: "atp-2027-part-a6-screening-criteria",
    title: "Part A6: Screening criteria",
    guidance:
      "Part A6 asks yes or no questions, each with a 200-word explanation when the answer calls for one: whether any part of the project is or has been programmed in an RTPA, MPO or Caltrans funding program, and if so why it is not fully funded; whether any element relates to a past or future development or capital improvement project, and why that project cannot fund it; whether adjacent undeveloped or under-developed property could be conditioned to build the improvements; and whether the project is consistent with the adopted regional transportation plan, with the relevant plan pages attached. Caltrans, when it is the implementing agency, attaches two further documents. Commission and Caltrans staff screen every application. OpenPlan does not screen, and nothing in this workspace is a finding that an application passes. Verify the screening criteria in section 16 of the current guidelines.",
    suggestedEvidence: ["project", "funding", "kb"],
  },
  // Q Part B question 1; R Question 1 (0 to 10: Part C 0 to 4, Part D 0 to 2,
  // Part E 0 to 4); G section 12.A (no presumption of benefit); QM and QL
  // question 1 (the two further questions).
  {
    key: "atp-2027-b1-disadvantaged-communities",
    title: "Part B, Question 1: Disadvantaged Communities (DAC)",
    guidance:
      "Rubric maximum for a Small application: 10 points. Evaluators score direct benefit, up to 4 points; Commission staff calculate project location, up to 2, and severity, up to 4. An application that says the project does not benefit a disadvantaged community skips the question and receives 0 points for it. The application asks the applicant to choose one identifier (median household income, CalEnviroScreen, Healthy Places Index, free or reduced-price meals, tribal project, regional definition or other), then to describe how the improvements meet an important need of the disadvantaged community and close a gap, connect to or correct a deficiency in an active transportation network (500 words), and to address displacement or explain why it is not a concern (200 words). A combination application also describes how its non-infrastructure programs reach that community (200 words). The guidelines presume no benefit, even for a project located in a disadvantaged community. OpenPlan makes no disadvantaged-community determination. Medium and Large applications ask two more questions here, on residents' physical access to the project and on their request or support for it. Verify the identifiers, thresholds and data years in the current guidelines and checklist.",
    suggestedEvidence: ["project", "engagement", "kb"],
  },
  // Q Part B question 2; R Question 2 (0 to 52: Part A 0 to 26, Part B 0 to
  // 26); G section 18 table (Need: Large 38, Medium 40, Small 52); C "Potential
  // to Increase Walking and Biking" (gap counts, local health data).
  {
    key: "atp-2027-b2-walking-biking-rolling",
    title: "Part B, Question 2: Potential to Increase Walking, Biking and Rolling",
    guidance:
      "Rubric maximum for a Small application: 52 of the application's 100 points. Part A, the statement of project need, is up to 26 and Part B, how the project addresses the need, is up to 26. The guidelines' table gives this topic 40 points in a Medium application and 38 in a Large one. Part A asks for the community context and the issues the project will address to increase walking, biking and rolling and induce mode shift; how the project benefits non-motorized users of all ages and abilities, including children, older adults, students, working professionals and persons with disabilities; and the desired outcome and how the project best delivers it (1,000 words). A safe routes to school project also completes a school data table. Part B asks which needs the project addresses and how (400 words), a map of each gap closure, new route, barrier and improvement, why the existing routes are not adequate (200 words), and how the project links to named destinations such as schools, transit, medical centers, employment centers, housing and trails (400 words). A combination application describes its non-infrastructure program (500 words). The checklist also asks for the number and length of the gaps closed and for local health data at the smallest geography available. Verify the current questions and rubric with the CTC.",
    suggestedEvidence: ["project", "modeling", "engagement", "kb"],
  },
  // Q Part B question 3; R Question 3 (0 to 25: Part A 0 to 12, Part B 13
  // maximum); G section 18 table (Safety: Large 20, Medium 25, Small 25); C
  // "Potential for Reducing ... Fatalities and Injuries" (data sources).
  {
    key: "atp-2027-b3-fatalities-and-injuries",
    title: "Part B, Question 3: Potential for Reducing the Number and/or Rate of Active Transportation User Fatalities and Injuries",
    guidance:
      "Rubric maximum for a Small application: 25 points. Part A, the collision history and its analysis, is up to 12 and Part B, safety countermeasures, is up to 13. The guidelines' table gives this topic 25 points in a Medium application and 20 in a Large one. Part A asks for collision documentation, from the TIMS ATP tool or another source such as surveys or Street Story, a collision summary table, and an analysis of past collisions: the crash-type trends likely to continue if no action is taken, how far the project limits are one of the agency's top safety priorities, and how the proposed improvements correspond to the types and locations of past collisions (1,000 words). An optional field takes data and methods in writing (200 words). Part B asks how the countermeasures address the underlying factors behind injuries and deaths of people walking, biking and rolling (1,600 words) and, where the project builds or improves bike facilities, what was considered in choosing the bikeway class (600 words). A combination application says how its education and encouragement programs address the same safety issues (300 words). OpenPlan's crash summary appendix reports what its own crash source holds for the study area and years it names; it is not TIMS documentation. Verify the current questions and rubric with the CTC.",
    suggestedEvidence: ["project", "modeling", "kb"],
  },
  // Q Part B question 4; R Question 4 (0 to 10; engagement scored above
  // outreach); QM and QL question 4 (split into parts; the Large plan question).
  {
    key: "atp-2027-b4-public-participation-planning",
    title: "Part B, Question 4: Public Participation and Planning",
    guidance:
      "Rubric maximum for a Small application: 10 points. The question asks for the community-based public participation process that led to the project, and whether the alternatives considered the wide range of active transportation users, such as children, older adults, wheelchair users and people with visual impairments (1,300 words). The rubric tells evaluators to look for how the agency prepared for users' present and future needs, who was engaged, how stakeholders will stay engaged as the project is carried out, and any engagement challenges and how they were addressed. It tells them to give a higher score to an applicant who engages constituents, a two-way process, than to one who conducts outreach only. Public participation documents are attached. Medium and Large applications split this question into parts, and the Large application also asks whether the project is listed in an adopted active transportation plan. Verify the current question and rubric with the CTC.",
    suggestedEvidence: ["engagement", "kb"],
  },
  // Q Part B question 5 ("No application questions"); R Question 5 (0 to 3, one
  // point each for layouts and maps, engineer's estimate and schedule; the
  // cost-effectiveness note); G section 18 table (Medium 5; Large 7 with cost
  // effectiveness) and section 38.2 (the Commission's benefit-cost tool).
  {
    key: "atp-2027-b5-scope-plan-layout-consistency",
    title: "Part B, Question 5: Scope and Plan Layout Consistency",
    guidance:
      "Rubric maximum for a Small application: 3 points, 1 each for the layouts and maps, the engineer's estimate and the project schedule. The application asks no question here, and the Commission's form has no text field for it. Evaluators score from the attachments: whether the layouts and maps, the engineer's estimate and the proposed scope agree, whether the Engineer's Checklist was followed, and whether the schedule covers every phase with enough time. The Small rubric also asks evaluators whether the application shows that cost-effectiveness was considered. The guidelines' table gives this topic 5 points in a Medium application; the Large application scores it together with cost effectiveness, 7 points. The Commission runs its own benefit-cost tool at the program level, and the application asks for no benefit-cost ratio. Use this section for the agency's own check of those documents against each other, or mark it final with a note that the application asks no question here. Verify the current rubric with the CTC.",
    suggestedEvidence: ["project", "funding", "kb"],
  },
  // Q Part B question 6; G section 18 table (Corps Use: 0 or -5) and 18.L.
  {
    key: "atp-2027-b6-conservation-corps",
    title: "Part B, Question 6: Use of California Conservation Corps (CCC) or Certified Local Community Conservation Corps (CALCC)",
    guidance:
      "Points in the guidelines' table: 0 or minus 5. The guidelines deduct points when an applicant does not seek Corps participation, or intends not to use a Corps on a project in which the Corps can take part. This applies to every application type except Plan. The applicant consults the California Conservation Corps and a certified local community conservation corps for each application in each cycle; a consultation from an earlier cycle or for another application does not satisfy the requirement. The application asks the applicant to select the outcome of the consultation, attach the responses from the CCC, the local corps and a Tribal Corps if applicable, and say how a Corps will take part (100 words) or which Corps did not respond. Verify the consultation steps and forms on the Corps websites and the CTC's ATP page.",
    suggestedEvidence: ["project", "kb"],
  },
  // Q Part B question 7 ("No application questions"); G section 18 table (Past
  // Performance: 0 to -10) and 18.M.
  {
    key: "atp-2027-b7-past-performance",
    title: "Part B, Question 7: Performance on Past ATP Projects",
    guidance:
      "Points in the guidelines' table: 0 to minus 10. The application asks no question here, and the Commission's form has no text field for it. The guidelines say points may be deducted for poor performance on a past ATP project, which includes not using a Corps as committed in a past award and adverse audit findings that are the applicant's fault, and that the Commission will assess whether to deduct points for failing to deliver a phase of a project programmed in an earlier cycle. Use this section for the agency's own record of its past ATP projects, or mark it final with a note that the application asks no question here. Verify how the current guidelines treat past performance with the CTC.",
    suggestedEvidence: ["project", "kb"],
  },
];

// THE 2027 ATP ATTACHMENT LIST, in the order of the Commission's 2027 ATP
// Application Checklist (C): Part A, Part B, then "Application Attachments".
// C opens: "The following checklist includes the information and
// documentation needed to complete the 2027 Active Transportation Program
// application." It marks an item "if applicable", limits it to named project
// types, or marks it "if desired". Read that way:
//   - no mark: required.
//   - "if applicable", or a project type or condition a Small application may
//     or may not meet: required with `ifApplicable`.
//   - "if desired": optional (`required: false`).
// Two items come from the application's own attachment fields (Q Part A5) and
// are not on the checklist; each says so. Checklist items that data fields
// answer, not documents (gap counts, local health data, coordinates), are
// named in the section guidance instead.
//
// Left out on purpose, because the checklist limits them to other application
// types: Plan Scope of Work, Exhibit 25-PLAN (Plan projects only);
// documentation of disadvantaged community support (Medium and Large only);
// the adopted active transportation plan page (Large only); transformative
// project documentation (Large only); the leveraging letter of commitment and
// other leveraging documentation (Medium and Large only).
const atp2027Attachments: readonly GrantApplicationAttachmentTemplate[] = [
  // C Part A1: "Letter of Intent with partnering agency, if applicable".
  {
    key: "partnering-agency-letter-of-intent",
    title: "Letter of Intent with partnering agency",
    guidance: "Part A1. The checklist asks for it if applicable: when the project has a partnering agency. Verify against the current checklist.",
    required: true,
    ifApplicable: true,
  },
  // C Part A3: "(Safe Routes to School projects only)"; Q Part A3 "Attach school documentation".
  {
    key: "safe-routes-school-map-and-statements",
    title: "School enrollment area map and statements of support (Safe Routes to School projects only)",
    guidance: "Part A3. A map of student enrollment areas in relation to the project limits and a short statement of support from each school. The checklist asks for it of Safe Routes to School projects only. Verify against the current checklist.",
    required: true,
    ifApplicable: true,
  },
  // C Part A4: "(Projects on Caltrans R/W only)"; Q Part A4 (asked when Caltrans is not the implementing agency).
  {
    key: "state-highway-project-impact-assessment-form",
    title: "State Highway Project Impact Assessment Form (projects on Caltrans right of way only)",
    guidance: "Part A4. An approved form for a project on Caltrans right of way. The application asks for it when Caltrans is not the implementing agency. Verify against the current checklist.",
    required: true,
    ifApplicable: true,
  },
  // C Part A4: "If applicable, ... letters of support or neutrality from each impacted entity".
  {
    key: "railroad-and-agency-letters",
    title: "Letters of support or neutrality from railroads and other governmental agencies",
    guidance: "Part A4. One from each railroad company or governmental agency other than Caltrans whose parcels, easements or approval the project needs. The checklist asks for them if applicable. Verify against the current checklist.",
    required: true,
    ifApplicable: true,
  },
  // C Part A5: "A completed Project Programming Request (PPR)"; Q Part A5 names Exhibit 25-I.
  {
    key: "project-programming-request",
    title: "Project Programming Request (PPR)",
    guidance: "Part A5. The checklist asks for a completed Project Programming Request; the application names it Exhibit 25-I. Verify the current form with the CTC.",
    required: true,
  },
  // Q Part A5 only; not on C.
  {
    key: "ceqa-nepa-signature-pages",
    title: "CEQA and NEPA signature pages (applications showing PA&ED complete)",
    guidance: "Part A5. The application says an application showing the PA&ED phase as complete must attach the signature pages of the CEQA and NEPA documents, including project descriptions covering the full scope. The checklist does not list this item. Verify against the current application.",
    required: true,
    ifApplicable: true,
  },
  // Q Part A5 only; not on C.
  {
    key: "right-of-way-certification",
    title: "Caltrans-approved Right of Way Certification (applications showing right of way complete)",
    guidance: "Part A5. The application says an application showing the right of way phase as complete must attach the certification. The checklist does not list this item. Verify against the current application.",
    required: true,
    ifApplicable: true,
  },
  // C Part A6, no mark; Q Part A6 (attached on a "yes" answer); G section 16.
  {
    key: "regional-transportation-plan-pages",
    title: "Regional Transportation Plan pages showing the project is consistent",
    guidance: "Part A6, a screening item. The checklist lists the relevant plan pages with no 'if applicable' note. The application asks for them when the applicant answers that the project is consistent with the adopted regional transportation plan, and for a 200-word explanation when the answer is no. Verify against the current checklist.",
    required: true,
  },
  // C Part A6: "For Caltrans-implemented projects, ...".
  {
    key: "caltrans-need-for-atp-funds",
    title: "Caltrans-implemented projects: need to use ATP funds",
    guidance: "Part A6. For a project Caltrans implements: documentation of the need to complete the project with ATP funds instead of other funding streams. Verify against the current checklist.",
    required: true,
    ifApplicable: true,
  },
  // C Part A6: "For Caltrans-implemented projects, ...".
  {
    key: "caltrans-local-coordination",
    title: "Caltrans-implemented projects: coordination with local and regional agencies",
    guidance: "Part A6. For a project Caltrans implements: documentation of coordination with the local and regional agencies the project affects. Verify against the current checklist.",
    required: true,
    ifApplicable: true,
  },
  // C Part B, Disadvantaged Communities: "(Projects that benefit disadvantaged communities only)"; R Question 1.A "Required".
  {
    key: "disadvantaged-community-map",
    title: "Disadvantaged community map",
    guidance: "Question 1. A scaled map showing the project boundaries, disadvantaged community access points and key destinations, with every census tract (or school, under the school meals option) labeled. The checklist asks for it only of projects that benefit a disadvantaged community, and the rubric marks the map required for those. Verify against the current checklist.",
    required: true,
    ifApplicable: true,
  },
  // C Part B, Disadvantaged Communities: the identifier and its data, same limit.
  {
    key: "disadvantaged-community-identifier-data",
    title: "Disadvantaged community identifier data",
    guidance: "Question 1. The data the chosen identifier calls for, for every census tract in the project area and not only the disadvantaged ones: for example tract number, population and median household income, with copies of the Census tables. The checklist says a tribal applicant selects the tribal project option and needs no other data. Verify the identifiers, thresholds and data years in the current checklist and guidelines.",
    required: true,
    ifApplicable: true,
  },
  // C Part B, Potential to Increase Walking and Biking, no mark; Q question 2 Part B attachment field.
  {
    key: "gap-closure-and-route-maps",
    title: "Maps of gap closures, new routes, barriers to mobility and other improvements",
    guidance: "Question 2. The checklist says more than one map may go in a map field, combined into one file. A combination application also shows its non-infrastructure program boundaries. Verify against the current checklist.",
    required: true,
  },
  // C Part B, Potential for Reducing ... Fatalities and Injuries, no mark; Q question 3 Part A attachment fields.
  {
    key: "collision-data",
    title: "Bicycle and pedestrian collision data or other safety data",
    guidance: "Question 3. Bicycle and pedestrian collision data, or other data showing the safety concerns in the project area. The checklist accepts the ATP TIMS tool or another source such as surveys, Street Story or other crowd-sourced data; for TIMS it asks for a heat map of the area around the project limits, a project area collision map and any collision summaries. Verify against the current checklist.",
    required: true,
  },
  // C Part B, Public Participation and Planning, no mark; Q question 4 attachment field.
  {
    key: "public-participation-documentation",
    title: "Documentation of public participation and planning",
    guidance: "Question 4. The checklist's examples are photos, sign-in sheets, minutes, participant lists, presentations, survey results and flyers. Verify against the current checklist.",
    required: true,
  },
  // C Part B, Use of CCC or CALCC: "(All Infrastructure, Combination, and Non-Infrastructure projects)"; Q question 6 marks only the Tribal Corps response "if applicable".
  {
    key: "corps-consultation-responses",
    title: "Responses from the CCC, CALCC and Tribal Corps (if applicable)",
    guidance: "Question 6. The checklist lists the Corps responses for every infrastructure, combination and non-infrastructure project, after the applicant completes the CCC and CALCC consultation form. The application marks only the Tribal Corps response 'if applicable'. Verify the consultation steps on the Corps websites.",
    required: true,
  },
  // C Application Attachments, no mark; G section 13 (signature on every application).
  {
    key: "signature-page",
    title: "Signature Page",
    guidance: "Part C. The guidelines require every application to carry the signature of the Chief Executive Officer or another officer authorized by the applicant's governing board. Verify the current form with the CTC.",
    required: true,
  },
  // C Application Attachments: "(All Infrastructure and Combination projects)".
  {
    key: "engineers-checklist",
    title: "Engineer's Checklist",
    guidance: "Part C. The checklist asks for it of every infrastructure and combination project. Verify the current form with the CTC.",
    required: true,
  },
  // C Application Attachments, no mark; C Part A2 (what the map must show).
  {
    key: "project-location-map",
    title: "Project Location Map",
    guidance: "Part C. The checklist says the map must show the project boundaries in relation to the implementing agency's boundaries. Verify against the current checklist.",
    required: true,
  },
  // C Application Attachments: "(All Infrastructure and Combination projects)"; R Question 5 (1 point).
  {
    key: "project-layouts-and-plans",
    title: "Project Layouts/Plans with Existing and Proposed Conditions",
    guidance: "Part C. The checklist asks for them of every infrastructure and combination project. The Small rubric allows up to 1 point on whether the layouts and maps are complete and clear enough to show the full scope. Verify against the current checklist.",
    required: true,
  },
  // C Application Attachments, no mark; Q Part C lists it with no "(Optional)" or "(if applicable)".
  {
    key: "photos-of-existing-conditions",
    title: "Photos of Existing Conditions",
    guidance: "Part C. The checklist and the application list the photos with no 'if applicable' or 'optional' note. Verify against the current checklist.",
    required: true,
  },
  // C Application Attachments: "(All Infrastructure and Combination projects)"; R Question 5 (1 point).
  {
    key: "project-estimate",
    title: "Project Estimate",
    guidance: "Part C. The engineer's estimate, asked of every infrastructure and combination project. The Small rubric allows up to 1 point on whether it is thorough and consistent with the scope and phases of the project. Verify the current estimate form with the CTC.",
    required: true,
  },
  // C Application Attachments: "(All Non-Infrastructure and Combination projects)".
  {
    key: "non-infrastructure-work-plan",
    title: "Non-Infrastructure Work Plan (Exhibit 25-R)",
    guidance: "Part C. The checklist asks for it of every non-infrastructure and combination project. An infrastructure-only application marks it not applicable. Verify the current exhibit with the CTC.",
    required: true,
    ifApplicable: true,
  },
  // C Application Attachments, no mark; Q Part C lists it with no "(Optional)" or "(if applicable)".
  {
    key: "letters-of-support",
    title: "Letters of Support",
    guidance: "Part C. The checklist and the application list letters of support with no 'if applicable' or 'optional' note. Verify against the current checklist.",
    required: true,
  },
  // C Part A5 and Application Attachments: "State-Only Funds Request (Exhibit 25-F), if applicable".
  {
    key: "state-only-funds-request",
    title: "State-Only Funds Request (Exhibit 25-F)",
    guidance: "Parts A5 and C. The checklist asks for a completed Exhibit 25-F if the applicant requests state-only funds. Verify the current exhibit with the CTC.",
    required: true,
    ifApplicable: true,
  },
  // C Application Attachments: "Additional attachments, if desired"; Q Part C "Other Attachments (Optional)".
  {
    key: "additional-attachments",
    title: "Additional attachments",
    guidance: "Part C. The checklist lists additional attachments 'if desired', and the application calls them Other Attachments (Optional). Verify against the current checklist.",
    required: false,
  },
];


const programs: readonly GrantProgramCatalogEntry[] = [
  // ATP facts from the CTC's 2027 ATP Guidelines (Resolution G-26-31, adopted
  // March 19, 2026): sections 3, 5, 6, 7, 10, 11, 18 and 38.2, and the 2027 ATP
  // Application Checklist, read November 15, 2026. A new application seeds
  // from the 2027 template. One seeded earlier keeps the earlier template's
  // sections and is still recognised by their keys.
  {
    key: "atp",
    name: "Active Transportation Program (ATP)",
    administeringAgency: "California Transportation Commission / Caltrans",
    level: "state",
    typicalApplicants:
      "Cities, counties, MPOs and RTPAs, transit agencies, public schools or school districts, natural resource or public land agencies, federally recognized tribal governments",
    eligibleProjectTypes: [
      "Bicycle and pedestrian infrastructure",
      "Safe routes to school",
      "Trails",
      "Active transportation plans",
      "Non-infrastructure education and encouragement programs",
    ],
    cycleNote: "The 2027 ATP is Cycle 8. The CTC adopts a program no later than a statutory date in each odd-numbered year. Verify the current call with the CTC.",
    matchRequirement:
      "No local match required; an MPO may require one in the MPO Component. Committed leveraged funds earn points only in Large and Medium project applications. Verify current guidelines.",
    url: "https://catc.ca.gov/programs/active-transportation-program",
    summary:
      "Competitive California program for walking, biking and rolling projects, plans and non-infrastructure programs, funded from federal and state sources. Under the 2027 ATP Guidelines (Cycle 8, adopted March 19, 2026), funds are split 50 percent to the Statewide Component, 10 percent to the Small Urban and Rural Component (areas of 5,001 to 200,000 people, and rural areas of 5,000 or less) and 40 percent to the MPO Component; each component directs at least 25 percent to projects that benefit disadvantaged communities.",
    applicationTemplateKey: "atp-2027",
    applicationSections: atp2027Sections,
    requiredAttachments: atp2027Attachments,
    earlierApplicationTemplates: [atpEarlierTemplate],
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
    cycleNote: "Biennial STIP cycle adopted in even years. Verify the current fund estimate and RTIP submission schedule with the CTC and your RTPA.",
    matchRequirement: "No fixed local match for STIP county-share programming; funding posture is project-specific. Verify with your RTPA.",
    url: "https://catc.ca.gov/programs/state-transportation-improvement-program",
    summary:
      "California's core biennial capital programming document, with 75% of funds flowing to regional shares that each county's RTPA programs through its RTIP. For small agencies this is less a grant application than a programming negotiation: a project must first be in the RTIP.",
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
    cycleNote: "Formulaic shares plus periodic competitive cycles. Verify the current programming cycle with the CTC.",
    matchRequirement: "Generally a dollar-for-dollar (1:1) local match from the qualifying tax or fee revenue. Verify current guidelines.",
    url: "https://catc.ca.gov/programs/sb1/local-partnership-program",
    summary:
      "SB 1 program that rewards self-help jurisdictions (those with voter-approved transportation sales taxes, developer fees, or tolls) with matching state dollars. It applies only where the agency or county has a qualifying revenue measure.",
    applicationSections: [
      {
        key: "project-narrative",
        title: "Project narrative",
        guidance:
          "Describe the project and its transportation benefits. Verify the current programming cycle's nomination format with the CTC; the competitive and formulaic components use different paperwork.",
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
    cycleNote: "Competitive cycles roughly every one to two years. Verify the current call for projects with CalSTA.",
    matchRequirement: "No formal minimum match; demonstrated leverage and ridership/GHG benefits drive competitiveness. Verify guidelines.",
    url: "https://calsta.ca.gov/subject-areas/transit-intercity-rail-capital-prog",
    summary:
      "Cap-and-trade-funded program for transformative transit and rail capital investments that reduce greenhouse gas emissions and grow ridership. Rural and small-urban operators have won awards for fleet electrification and connectivity projects, including through joint applications.",
    applicationSections: [
      {
        key: "project-background",
        title: "Project background and description",
        guidance:
          "Describe the service context, the capital investment, and how the elements form one transformative project. Verify the current call's narrative outline with CalSTA; the application structure changes between cycles.",
        suggestedEvidence: ["project", "kb"],
      },
      {
        key: "ghg-reduction-narrative",
        title: "Greenhouse gas reduction",
        guidance:
          "Explain the mechanism for GHG reduction and summarize the quantified estimate. The controlling figures come from the program's required calculator. Verify the current cycle's CARB quantification methodology with CalSTA.",
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
    cycleNote: "Continuous annual formula apportionments; an adopted project list is due to the CTC each year. Verify the submission window.",
    matchRequirement: "No local match required; maintenance-of-effort spending requirements apply. Verify current reporting rules.",
    url: "https://catc.ca.gov/programs/sb1/local-streets-roads-program",
    summary:
      "SB 1 formula funding (roughly $1.5B statewide per year) apportioned directly to cities and counties for basic maintenance, rehabilitation, and safety on the local network. Not competitive; each city and county submits an adopted project list to the CTC every year.",
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
    cycleNote: "Periodic cycles subject to state budget action. Verify whether a current call is open with Caltrans.",
    matchRequirement: "Little to no match historically required, with emphasis on underserved communities. Verify current guidelines.",
    url: "https://cleancalifornia.dot.ca.gov/local-grant-program",
    summary:
      "State beautification program funding litter abatement, community gateways, and placemaking in and around the transportation right-of-way.",
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

/**
 * How California runs federal programs from the nationwide bundle. These facts
 * used to sit in the federal entries themselves, so a planner in every state
 * was told to check with Caltrans. They reach only a California workspace now,
 * through `resolveGrantProgramForJurisdiction`.
 */
const federalProgramAdministration: readonly GrantProgramStateAdministration[] = [
  {
    programKey: "hsip",
    administeringAgency: "FHWA, administered by Caltrans Division of Local Assistance",
    cycleNote: "Local HSIP calls run roughly every one to two years. Verify the current call with Caltrans Local Assistance.",
    url: "https://dot.ca.gov/programs/local-assistance/fed-and-state-programs/highway-safety-improvement-program",
    summary:
      "Federal safety funding for infrastructure countermeasures on local roads, awarded through data-driven benefit/cost scoring against crash history. A Local Roadway Safety Plan or safety action plan can document the collision patterns an application cites.",
    bcaNote:
      "Awards are scored on benefit/cost computed with the Caltrans Local Roadway Safety Manual (LRSM) method. Countermeasure crash-reduction factors and Caltrans-published crash costs control the actual score. The screening BCA is a USDOT-style screening analogue (crashes avoided by severity at USDOT crash costs), not a preview of the LRSM B/C.",
    sections: {
      "project-description": {
        guidance:
          "Describe the location, the safety problem, and the proposed countermeasures. Verify the current call's application form and countermeasure list with Caltrans Local Assistance. Both change between calls.",
      },
      "crash-history-analysis": {
        guidance:
          "Summarize the crash history that motivates the project: pattern, severity, and time window. Verify the current call's required crash-data window and source with Caltrans Local Assistance.",
      },
      "countermeasure-selection": {
        guidance:
          "Explain why the selected countermeasures fit the documented crash pattern. Verify the current call's approved countermeasure set and crash-reduction factors with Caltrans Local Assistance.",
      },
      "benefit-cost-calculation": {
        title: "Benefit/cost calculation (LRSM tool)",
        guidance:
          "The score-controlling B/C is computed in the Caltrans Local Roadway Safety Manual tool from your crash data and countermeasures. It is a calculation, never drafted prose, and OpenPlan's screening BCA is only an early-warning analogue. Verify the current call's B/C tool version with Caltrans Local Assistance.",
      },
      "implementation-schedule": {
        guidance:
          "Lay out design, environmental, right-of-way, and construction milestones. Verify the current call's delivery deadlines with Caltrans Local Assistance.",
      },
    },
    attachments: {
      "lrsm-bc-tool-output": {
        title: "LRSM benefit/cost tool output",
        guidance: "Output of the Caltrans LRSM B/C tool for the selected countermeasures. Verify the required tool version with the current call.",
      },
      "engineers-cost-estimate": {
        guidance: "Itemized project cost estimate. Verify the current call's estimate format with Caltrans Local Assistance.",
      },
    },
  },
  {
    programKey: "infra",
    summary:
      "Large-scale federal discretionary funding for freight and highway projects of national or regional significance, with minimum awards of roughly $5M for small projects. A rural agency can apply in partnership with Caltrans or a regional agency on a goods-movement or corridor application.",
    attachments: {
      "letters-of-support": {
        guidance: "Match commitments and partner support, often including Caltrans or the regional agency on partnership applications. Verify commitment-evidence requirements in the current NOFO.",
      },
    },
  },
  {
    programKey: "cmaq",
    administeringAgency: "FHWA, programmed through Caltrans and regional MPOs/RTPAs",
    typicalApplicants: "Cities, counties, and transit agencies via their MPO/RTPA",
    cycleNote: "Programmed through regional MPO/RTPA cycles rather than a single statewide call. Verify timing with your MPO/RTPA.",
    matchRequirement: "Typically 88.53% federal / 11.47% local in California; some projects qualify for higher federal share. Verify.",
  },
  {
    programKey: "fta-5310",
    administeringAgency: "FTA, administered in California by Caltrans Division of Rail and Mass Transportation",
    cycleNote: "Statewide competitive cycles roughly every two years. Verify the current call with Caltrans DRMT.",
    summary:
      "Federal formula funds passed through Caltrans to improve mobility for seniors and people with disabilities where transit is unavailable or insufficient. Eligible uses include paratransit vehicle replacement and mobility management.",
    sections: {
      "need-for-service": {
        guidance:
          "Document the mobility gap for seniors and people with disabilities in the service area. Verify the current call's need-documentation expectations with Caltrans DRMT.",
      },
      "project-implementation-plan": {
        guidance:
          "Describe the service or capital project, staffing, and operating approach. Verify the current call's implementation-plan format with Caltrans DRMT.",
      },
      "coordination-narrative": {
        guidance:
          "Show how the project derives from the region's coordinated public transit-human services transportation plan. Verify which plan and adoption date the current call recognizes with Caltrans DRMT.",
      },
      "management-capacity": {
        guidance:
          "Document the organization's capacity to manage federal awards and maintain vehicles or services. Verify the current call's capacity questions with Caltrans DRMT.",
      },
      "budget-narrative": {
        guidance:
          "Budget figures come from vendor quotes and finance staff, never from AI drafting. Verify current capital and operating share splits and toll-credit availability with Caltrans DRMT.",
      },
    },
    attachments: {
      "authorizing-resolution": {
        guidance: "Governing-body resolution authorizing the application. Verify the current call's resolution template with Caltrans DRMT.",
      },
      "vehicle-specifications": {
        guidance: "Specifications for requested vehicles or equipment. Verify the current call's accepted vehicle categories with Caltrans DRMT.",
      },
    },
  },
  {
    programKey: "fta-5311",
    administeringAgency: "FTA, administered in California by Caltrans Division of Rail and Mass Transportation",
    cycleNote: "Annual apportionments programmed through Caltrans; periodic competitive 5311(f) intercity bus calls. Verify with Caltrans DRMT.",
    summary:
      "Federal formula funding for public transit in areas under 50,000 population, covering both operating and capital needs. Rural California operators access it through Caltrans, with the 5311(f) set-aside supporting intercity bus connections between rural communities and urban hubs.",
    sections: {
      "service-description": {
        guidance:
          "Describe the rural transit service: routes, span, ridership, and the communities connected. Verify the current programming cycle's service-data requirements with Caltrans DRMT.",
      },
      "program-of-projects": {
        guidance:
          "List the operating and capital items requested for the apportionment year. Verify the current cycle's program-of-projects format with Caltrans DRMT.",
      },
      "operating-capital-budget": {
        guidance:
          "Budget figures come from the operator's adopted budget, never from AI drafting. Verify current sliding-scale shares and toll-credit rules with Caltrans DRMT.",
      },
      "compliance-certifications": {
        guidance:
          "Certifications and assurances are executed legal documents, never AI-drafted. Verify the current federal fiscal year's certification package with Caltrans DRMT.",
      },
    },
    attachments: {
      "authorizing-resolution": {
        guidance: "Governing-body resolution authorizing the application and execution. Verify the current cycle's resolution language with Caltrans DRMT.",
      },
      "certifications-and-assurances": {
        guidance: "The current federal fiscal year's executed certifications. Verify the applicable package with Caltrans DRMT.",
      },
    },
  },
  {
    programKey: "crp",
    administeringAgency: "FHWA, administered through Caltrans Local Assistance and regional MPOs/RTPAs",
    cycleNote: "Programmed through state and regional cycles rather than one statewide call. Verify with Caltrans Local Assistance or your MPO/RTPA.",
    matchRequirement: "Typically 88.53% federal / 11.47% local in California. Verify with the programming agency.",
    url: "https://dot.ca.gov/programs/local-assistance/fed-and-state-programs/carbon-reduction-program",
    summary:
      "BIL formula program dedicated to projects that reduce on-road transportation emissions, split in California between a state-programmed share and local shares programmed regionally. Eligible projects include active transportation, ITS, and ZEV infrastructure.",
    sections: {
      "project-description": {
        guidance:
          "Describe the project and its eligible carbon-reduction category. Verify the current programming cycle's application format with Caltrans Local Assistance or your MPO/RTPA. CRP is programmed through state and regional cycles, not one statewide call.",
      },
    },
  },
  {
    programKey: "protect",
    administeringAgency: "FHWA (formula funds via Caltrans; discretionary NOFOs direct from FHWA)",
    cycleNote: "Formula funds flow through Caltrans, and discretionary NOFOs are periodic. Verify current opportunities with FHWA and Caltrans.",
    summary:
      "Federal resilience program funding projects that harden surface transportation against wildfire, flooding, sea-level rise, and other natural hazards, including evacuation routes.",
    sections: {
      "resilience-need": {
        guidance:
          "Document the natural hazards threatening the asset (wildfire, flooding, storm damage, sea-level rise) and the consequence of failure, including evacuation function. Verify the current opportunity's hazard-documentation expectations with FHWA or Caltrans.",
      },
      "planning-consistency": {
        guidance:
          "Show consistency with resilience planning. A resilience improvement plan can raise the federal share. Verify the current opportunity's planning-consistency provisions with FHWA or Caltrans.",
      },
      "budget-narrative": {
        guidance:
          "Budget figures come from the engineer's estimate, never from AI drafting. Verify the current opportunity's federal share and match rules with FHWA or Caltrans.",
      },
    },
  },
];

export const usCaPrograms: GrantProgramBundle = {
  key: "us-ca",
  label: "California state programs",
  // Subdivision-scoped: an agency outside California cannot apply to these, so
  // the catalog must say so rather than list them as if it could.
  jurisdiction: { country: "US", subdivision: "CA", label: "California" },
  programs,
  federalProgramAdministration,
};
