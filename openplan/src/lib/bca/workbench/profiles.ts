export const USDOT_2026_SOURCE =
  "https://www.transportation.gov/sites/dot.gov/files/2025-12/Benefit%20Cost%20Analysis%20Guidance%202026%20Update%20%28Final%29.pdf";
export const CALBC_SOURCE =
  "https://dot.ca.gov/programs/transportation-planning/division-of-transportation-planning/state-planning/transportation-economics";
export type BcaProfile = {
  id: string;
  title: string;
  version: string;
  priceYear: number;
  discountRatePct: number;
  costConvention: "capital-only" | "all-costs";
  source: string;
  controllingSource?: string;
  requirements: string[];
  caution: string;
};
const state = {
  version: "2026 CTC guidelines / Cal-B/C 8.1 state edition",
  priceYear: 2021,
  discountRatePct: 4,
  costConvention: "all-costs" as const,
  source: CALBC_SOURCE,
};
const federal = {
  version: "USDOT December 2025 / 2026 update",
  priceYear: 2024,
  discountRatePct: 7,
  costConvention: "capital-only" as const,
  source: USDOT_2026_SOURCE,
};
export const BCA_PROFILES: BcaProfile[] = [
  {
    id: "custom",
    title: "Custom or other grant",
    version: "Analyst-defined method",
    priceYear: 2024,
    discountRatePct: 7,
    costConvention: "capital-only",
    source: "",
    requirements: [
      "Retain the controlling notice and amendments.",
      "Document applicability, dollar year, discounting, horizon, eligible benefits and required files.",
    ],
    caution:
      "These starting settings are not a verified program rule. Supply the controlling method before application use.",
  },
  {
    id: "usdot-2026",
    title: "USDOT discretionary grants, 2026 method",
    ...federal,
    requirements: [
      "Standalone BCA narrative and unlocked calculation workbook.",
      "Full project capital costs, regardless of funding source; incremental No Build comparison.",
      "O&M changes and residual value in the BCR numerator; upfront capital in the denominator.",
      "Show physical effects that are not monetized separately.",
    ],
    caution:
      "The current notice controls applicability. The 2026 guidance no longer recommends monetizing CO2 or other greenhouse gases.",
  },
  {
    id: "tcep-2026",
    title: "TCEP, 2026 cycle",
    ...state,
    controllingSource:
      "https://catc.ca.gov/-/media/ctc-media/documents/programs/tcep/2026-tcep-guidelines-adopted-a11y.pdf",
    requirements: [
      "Review the adopted 2026 Trade Corridor Enhancement Program guidelines and benefit forms.",
      "Document freight, reliability, safety, emissions and economic benefits using the applicable Cal-B/C method.",
      "Provide remediated accessible PDFs. OpenPlan PDF export does not establish accessibility conformance.",
      "Provide the cost-benefit ratio and applicable public/private benefit split; explain unquantified benefits.",
    ],
    caution:
      "An OpenPlan workbook is a transparent supporting calculation, not a completed official Cal-B/C file.",
  },
  {
    id: "lpp-competitive-2026",
    title: "LPP Competitive, 2026 cycle",
    ...state,
    controllingSource:
      "https://catc.ca.gov/-/media/ctc-media/documents/programs/local-partnership-program/competitive/final-draft-2026-lpp-competitive-guidelines-v16-a11y.pdf",
    requirements: [
      "Use the Competitive Program guidelines, not Formulaic Program rules.",
      "Document project benefits, costs and the required benefit-cost material.",
      "Cal-B/C or an applicant-proposed alternative is permitted. Explain and document the selected method.",
    ],
    caution:
      "Verify project-type requirements in the adopted notice. Do not transfer Formulaic Program rules into a competitive application.",
  },
  {
    id: "sccp-2026",
    title: "SCCP, 2026 cycle",
    ...state,
    controllingSource:
      "https://catc.ca.gov/-/media/ctc-media/documents/programs/sccp/final-2026-sccp-guidelines-a11y.pdf",
    requirements: [
      "Connect the project to its comprehensive multimodal corridor plan.",
      "For multiple elements, prepare an element-level BCR table; a combined project ratio is insufficient.",
      "Document benefit-cost evidence and corridor-wide benefits without overlap.",
      "Cal-B/C or an applicant-proposed alternative is permitted. Retain calculation files and required benefit forms.",
    ],
    caution:
      "Corridor-plan consistency and program eligibility remain separate from the calculated ratio.",
  },
  ...[
    [
      "planning",
      "Planning",
      "A BCA is not required for this project category. Document the planning need and required application evidence.",
    ],
    [
      "resilience",
      "Resilience improvement",
      "A BCA informs prioritization unless the project is included in a qualifying Resilience Improvement Plan. Document the actual exception and plan evidence.",
    ],
    [
      "evacuation",
      "Community resilience and evacuation routes",
      "BCA informs prioritization. Document hazard occurrence, disruption, users and avoided losses.",
    ],
    [
      "coastal",
      "At-risk coastal infrastructure",
      "BCA is not required, but eligibility requires demonstrating avoided long-term maintenance and rebuilding costs.",
    ],
  ].map(
    ([id, title, requirement]): BcaProfile => ({
      id: `protect-${id}-2026`,
      title: `PROTECT: ${title}`,
      ...federal,
      controllingSource:
        "https://files.simpler.grants.gov/opportunities/b5627a85-1b8b-4248-8b79-24722a396422/attachments/d21d3b4d-d7fc-4885-8d22-18eb40912bfc/FY24-FY26_PROTECT_NOFO-FHWA-PROT-26-001.pdf",
      version: "FHWA-PROT-26-001, revised August 27, 2026; USDOT 2026",
      requirements: [
        requirement,
        "Retain project-category and qualifying-plan evidence. Tribal applicants may use the notice's specified raw-data alternative.",
        "When submitting a BCA, include a standalone memo, unlocked spreadsheet and relevant calculation files.",
      ],
      caution:
        "Hazard probability is an input requiring evidence. Return periods are not additive independent events; do not sum exceedance probabilities.",
    }),
  ),
];
export function getBcaProfile(id: string) {
  return BCA_PROFILES.find((profile) => profile.id === id);
}

// Values and units from the 2026 guidance, Appendix A. Selecting a value adds its source.
export const USDOT_PARAMETERS = [
  {
    id: "personal-time",
    label: "Personal travel time",
    unit: "person-hour",
    value: 20.1,
    locator: "Table A-2, printed p. 39",
  },
  {
    id: "all-time",
    label: "All-purpose travel time",
    unit: "person-hour",
    value: 21.8,
    locator: "Table A-2, printed p. 39",
  },
  {
    id: "business-time",
    label: "Business travel time",
    unit: "person-hour",
    value: 34.6,
    locator: "Table A-2, printed p. 39",
  },
  {
    id: "truck-time",
    label: "Truck operator time (driver only)",
    unit: "person-hour",
    value: 37.2,
    locator: "Table A-2, printed p. 39",
  },
  {
    id: "light-voc",
    label: "Light-duty operating cost, includes fuel",
    unit: "vehicle-mile",
    value: 0.56,
    locator: "Table A-4, printed p. 40",
  },
  {
    id: "truck-voc",
    label: "Truck operating cost, includes fuel",
    unit: "vehicle-mile",
    value: 1.23,
    locator: "Table A-4, printed p. 40",
  },
  {
    id: "fatality",
    label: "Fatality, per person",
    unit: "fatality",
    value: 13700000,
    locator: "Table A-1, printed p. 38",
  },
  {
    id: "serious-injury",
    label: "Serious injury, KABCO A, per person",
    unit: "serious-injury",
    value: 1302300,
    locator: "Table A-1, printed p. 38",
  },
  {
    id: "minor-injury",
    label: "Minor injury, KABCO B, per person",
    unit: "minor-injury",
    value: 256300,
    locator: "Table A-1, printed p. 38",
  },
  {
    id: "pdo-crash",
    label: "Property-damage-only crash",
    unit: "crash",
    value: 9700,
    locator: "Table A-1, printed p. 38",
  },
] as const;
