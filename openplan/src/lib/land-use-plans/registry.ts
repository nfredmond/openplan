import type { JurisdictionPlanDescriptor } from "./contracts";
import type { HomeJurisdiction } from "@/lib/workspaces/home-geography";
import { selectPlanKindRules } from "./plan-kind-rules";

/** Required and planner-defined sections start applicable; only conditional sections await a choice. */
export function defaultApplicableRequirementKeys(
  descriptor: Pick<JurisdictionPlanDescriptor, "requirements">
): string[] {
  return descriptor.requirements
    .filter((requirement) => requirement.applicability !== "conditional")
    .map((requirement) => requirement.key);
}

const CA_ARTICLE_5 =
  "https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?article=5.&chapter=3.&division=1.&lawCode=GOV&part=&title=7.";
const CA_ARTICLE_6 =
  "https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?article=6.&chapter=3.&division=1.&lawCode=GOV&part=&title=7.";
const CA_ARTICLE_8 =
  "https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?article=8.&chapter=3.&division=1.&lawCode=GOV&part=&title=7.";
const WA_GMA = "https://app.leg.wa.gov/rcw/default.aspx?cite=36.70A";
const TX_CHAPTER_213 = "https://statutes.capitol.texas.gov/Docs/LG/pdf/LG.213.pdf";
const BIA_COMMUNITY_PLANNING =
  "https://www.bia.gov/service/community-planning/how-comprehensive-community-planning-helps-tribes";
const NAVAJO_LOCAL_GOVERNANCE_ACT = "https://omb.navajo-nsn.gov/Mandates/Local-Governance-Act";

const LOCAL_UNCONFIGURED: JurisdictionPlanDescriptor = {
  id: "local-unconfigured",
  jurisdictionLabel: "Local requirements not configured",
  authorityScope: "Planner-defined local authority",
  configured: false,
  verifiedAt: "2026-08-23",
  reviewDueAt: "2027-01-15",
  terminology: {
    plan: "land use plan",
    section: "section",
    adoptionInstrument: "adoption instrument",
    implementationReport: "implementation report",
  },
  planKinds: [
    { key: "comprehensive", label: "Comprehensive plan" },
    { key: "area", label: "Area or neighborhood plan" },
    { key: "community", label: "Community plan" },
  ],
  requirements: [
    {
      key: "locally_defined",
      label: "Locally defined content",
      applicability: "locally_defined",
      sourceUrls: [],
    },
  ],
  processSteps: [
    {
      key: "local_process",
      label: "Locally defined review and adoption process",
      required: true,
      adoptionPrerequisite: true,
      sourceUrls: [],
    },
  ],
  disclosure:
    "Local legal requirements are not configured. This workflow keeps versions, evidence, review records, decisions, maps, and implementation history, but its checklist is not a statement of applicable law.",
  sourceUrls: [],
};

const CALIFORNIA: JurisdictionPlanDescriptor = {
  id: "us-ca-general-plan",
  jurisdictionLabel: "California",
  jurisdictionCoverage: { country: "US", subdivision: "CA" },
  authorityScope: "Local planning agencies governed by the cited California statutes",
  configured: true,
  authorityKinds: ["city", "county"],
  verifiedAt: "2026-08-23",
  reviewDueAt: "2027-01-15",
  terminology: {
    plan: "general plan",
    section: "element",
    adoptionInstrument: "resolution",
    implementationReport: "annual progress report",
  },
  planKinds: [
    { key: "comprehensive", label: "General plan" },
    { key: "area", label: "Specific plan" },
  ],
  requirements: [
    ...[
      ["land_use", "Land use"],
      ["circulation", "Circulation"],
      ["housing", "Housing"],
      ["conservation", "Conservation"],
      ["open_space", "Open space"],
      ["noise", "Noise"],
      ["safety", "Safety"],
    ].map(([key, label]) => ({
      key,
      label,
      applicability: "required" as const,
      sourceUrls: [CA_ARTICLE_5],
    })),
    {
      key: "environmental_justice",
      label: "Environmental justice",
      applicability: "conditional" as const,
      condition:
        "Evaluate the statutory disadvantaged-community and plan-update conditions before marking this applicable.",
      sourceUrls: [CA_ARTICLE_5],
    },
    {
      key: "air_quality",
      label: "Air quality",
      applicability: "conditional" as const,
      condition: "Applies to cities and counties in the San Joaquin Valley Air Pollution Control District; verify the current statutory trigger before marking it applicable.",
      sourceUrls: [CA_ARTICLE_5],
    },
  ],
  processSteps: [
    { key: "setup", label: "Establish the plan and geography", required: true, sourceUrls: [CA_ARTICLE_5] },
    { key: "content", label: "Prepare applicable elements", required: true, sourceUrls: [CA_ARTICLE_5] },
    { key: "consistency", label: "Review internal consistency", required: true, reviewPrerequisite: true, adoptionPrerequisite: true, sourceUrls: [CA_ARTICLE_5] },
    { key: "referrals", label: "Send required referrals and allow the applicable comment period", required: true, adoptionPrerequisite: true, deadline: "Generally 45 days; verify exceptions", sourceUrls: [CA_ARTICLE_6] },
    { key: "tribal_consultation", label: "Complete required tribal consultation while protecting confidential information", required: true, adoptionPrerequisite: true, deadline: "A contacted tribe generally has 90 days to request consultation unless it agrees to less time", sourceUrls: [CA_ARTICLE_6] },
    { key: "environmental_review", label: "Record environmental review", required: true, reviewPrerequisite: true, adoptionPrerequisite: true, sourceUrls: [CA_ARTICLE_6] },
    { key: "public_draft", label: "Freeze the public draft", required: true, sourceUrls: [CA_ARTICLE_6] },
    { key: "hearing", label: "Record the legislative-body hearing and any applicable planning-commission hearing", required: true, adoptionPrerequisite: true, sourceUrls: [CA_ARTICLE_6] },
    { key: "recommendation", label: "Record the planning-agency recommendation when the local structure requires one", required: false, sourceUrls: [CA_ARTICLE_6] },
    {
      key: "adoption",
      label: "Record adoption",
      required: true,
      decisionBody: "Legislative body",
      sourceUrls: [CA_ARTICLE_6],
    },
    { key: "public_inspection", label: "Make adopted diagrams and text available for public inspection", required: true, deadline: "Within one working day after adoption", sourceUrls: [CA_ARTICLE_6] },
    { key: "amendment_limit", label: "Check the amendment-frequency rule and statutory exceptions", required: true, deadline: "A mandatory element is generally limited to four amendments per calendar year, subject to exceptions", sourceUrls: [CA_ARTICLE_6] },
    { key: "implementation_report", label: "Prepare annual implementation report", required: true, deadline: "April 1", sourceUrls: [CA_ARTICLE_5] },
  ],
  disclosure:
    "This is a scoped California statutory workflow, not a complete statement of every law that may apply. OpenPlan tracks cited requirements and attached evidence. It does not determine legal sufficiency, complete environmental review, or replace agency counsel and qualified planning review.",
  sourceUrls: [CA_ARTICLE_5, CA_ARTICLE_6, CA_ARTICLE_8],
};

const CA_SPECIFIC_CONTENT = "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=65451";
const CA_SPECIFIC_PROCEDURE = "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=65453";
const CA_SPECIFIC_CONSISTENCY = "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=65454";
const CA_SPECIFIC_INSPECTION = "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=GOV&sectionNum=65456";
const CA_IMPLEMENTATION_GUIDANCE = "https://lci.ca.gov/wp-content/uploads/OPR_C9_final.pdf";

/** The family ID remains stable; the selected kind determines its own rules. */
const CALIFORNIA_SPECIFIC: JurisdictionPlanDescriptor = {
  ...CALIFORNIA,
  // Preserve the family's earlier review date. October 7 reviews the distinct
  // content/procedure provisions, not every inherited referral or review duty.
  terminology: { plan: "specific plan", section: "plan part", adoptionInstrument: "resolution or ordinance", implementationReport: "implementation update" },
  planKinds: [{ key: "area", label: "Specific plan" }],
  requirements: [
    { key: "specific_land_use", label: "Land uses and open space", applicability: "required", sourceUrls: [CA_SPECIFIC_CONTENT] },
    { key: "specific_facilities", label: "Transportation, utilities and essential facilities", applicability: "required", sourceUrls: [CA_SPECIFIC_CONTENT] },
    { key: "specific_standards", label: "Development and natural-resource standards", applicability: "required", condition: "Address natural-resource conservation, development and use where applicable. Text and diagrams must describe the required detail.", sourceUrls: [CA_SPECIFIC_CONTENT] },
    { key: "specific_implementation", label: "Implementation measures and financing", applicability: "required", sourceUrls: [CA_SPECIFIC_CONTENT] },
    { key: "specific_general_plan_relationship", label: "Relationship to the general plan", applicability: "required", sourceUrls: [CA_SPECIFIC_CONTENT, CA_SPECIFIC_CONSISTENCY] },
  ],
  processSteps: [
    { key: "setup", label: "Identify the plan area and adopted parent plan", required: true, sourceUrls: [CA_ARTICLE_8] },
    { key: "content", label: "Prepare the required text and diagrams", required: true, sourceUrls: [CA_SPECIFIC_CONTENT] },
    { key: "general_plan_consistency", label: "Document consistency with the general plan", required: true, reviewPrerequisite: true, adoptionPrerequisite: true, sourceUrls: [CA_SPECIFIC_CONSISTENCY] },
    ...CALIFORNIA.processSteps.filter(step => ["referrals", "tribal_consultation", "environmental_review", "public_draft", "hearing", "recommendation", "adoption"].includes(step.key)),
    { key: "public_inspection", label: "Make adopted text and diagrams available for inspection and requested copies", required: true, deadline: "Inspection within one working day after adoption; requested copies within two working days after receipt of the request and copying payment", sourceUrls: [CA_SPECIFIC_INSPECTION] },
    { key: "specific_amendment_procedure", label: "Apply the specific-plan amendment and repeal procedure", required: true, deadline: "Amendments may occur as often as the legislative body finds necessary; each amendment must remain consistent with the general plan", sourceUrls: [CA_SPECIFIC_PROCEDURE, CA_SPECIFIC_CONSISTENCY, CA_IMPLEMENTATION_GUIDANCE] },
    { key: "implementation_report", label: "Prepare an agency-defined implementation update", required: false, sourceUrls: [] },
  ],
  disclosure: "This specific-plan checklist covers selected cited provisions, not a complete statement of every law that may apply. It requires text and diagrams, supporting facilities, standards, implementation measures and the relationship to the general plan. The general-plan element checklist and its amendment-frequency limit do not define this plan. The implementation update is an agency process choice; it does not replace the agency's separate general-plan reporting duties. Verify local procedures, environmental review and consultation. OpenPlan does not determine legal sufficiency or replace counsel and qualified planning review.",
  sourceUrls: [CA_SPECIFIC_CONTENT, CA_SPECIFIC_PROCEDURE, CA_SPECIFIC_CONSISTENCY, CA_SPECIFIC_INSPECTION, CA_ARTICLE_6, CA_IMPLEMENTATION_GUIDANCE],
};

const PLAN_KIND_RULES: Readonly<Record<string, Readonly<Record<string, JurisdictionPlanDescriptor>>>> = {
  [CALIFORNIA.id]: { area: CALIFORNIA_SPECIFIC },
};

const NEUTRALITY_FIXTURES: JurisdictionPlanDescriptor[] = [
  {
    id: "us-wa-comprehensive-plan-fixture",
    jurisdictionLabel: "Washington",
    authorityScope: "Neutrality fixture only",
    configured: false,
    verifiedAt: "2026-08-23",
    reviewDueAt: "2027-01-15",
    terminology: { plan: "comprehensive plan", section: "element", adoptionInstrument: "local legislative action", implementationReport: "implementation record" },
    planKinds: [{ key: "comprehensive", label: "Comprehensive plan" }],
    requirements: [
      ...[
        ["land_use", "Land use"],
        ["housing", "Housing"],
        ["capital_facilities", "Capital facilities"],
        ["utilities", "Utilities"],
        ["transportation", "Transportation"],
        ["parks_and_recreation", "Parks and recreation"],
        ["climate_resiliency", "Climate resiliency"],
      ].map(([key, label]) => ({ key, label, applicability: "required" as const, sourceUrls: [WA_GMA] })),
      { key: "economic_development", label: "Economic development", applicability: "conditional", condition: "Verify the statutory residential-community exception.", sourceUrls: [WA_GMA] },
      { key: "county_rural", label: "Rural", applicability: "conditional", condition: "Applies to counties planning under the Growth Management Act.", sourceUrls: [WA_GMA] },
      { key: "climate_greenhouse_gas", label: "Greenhouse-gas reduction", applicability: "conditional", condition: "Applies only to jurisdictions identified by current state law.", sourceUrls: [WA_GMA] },
    ],
    processSteps: [
      { key: "gma_applicability", label: "Verify Growth Management Act applicability", required: true, sourceUrls: [WA_GMA] },
      { key: "annual_amendment_cycle", label: "Apply the annual amendment cycle and its exceptions", required: true, deadline: "Generally no more than once each year", sourceUrls: [WA_GMA] },
      { key: "periodic_review", label: "Apply the jurisdiction's periodic review cycle", required: true, deadline: "Ten-year cycle on the applicable county-group schedule", sourceUrls: [WA_GMA] },
      { key: "state_pre_adoption_notice", label: "Notify the Department of Commerce before adoption", required: true, deadline: "At least 60 days before final adoption", sourceUrls: [WA_GMA] },
      { key: "state_post_adoption_transmission", label: "Send the adopted plan to the Department of Commerce", required: true, deadline: "Within 10 days after adoption", sourceUrls: [WA_GMA] },
    ],
    disclosure: "This descriptor proves the shared model can carry Washington terminology. It is not a configured legal bundle and must not be used as a requirements checklist.",
    sourceUrls: [WA_GMA],
  },
  {
    id: "us-tx-comprehensive-plan-fixture",
    jurisdictionLabel: "Texas",
    authorityScope: "Neutrality fixture only",
    configured: false,
    verifiedAt: "2026-08-23",
    reviewDueAt: "2027-01-15",
    terminology: { plan: "comprehensive plan", section: "component", adoptionInstrument: "local adoption instrument", implementationReport: "implementation record" },
    planKinds: [{ key: "comprehensive", label: "Comprehensive plan" }],
    requirements: [{ key: "locally_defined", label: "Locally selected content", applicability: "locally_defined", sourceUrls: [TX_CHAPTER_213] }],
    processSteps: [{ key: "local_process", label: "Locally established preparation and adoption process", required: true, sourceUrls: [TX_CHAPTER_213] }],
    disclosure: "This descriptor proves the shared model does not require a fixed element list. It is not a configured legal bundle.",
    sourceUrls: [TX_CHAPTER_213],
  },
  {
    id: "tribal-sovereign-plan-fixture",
    jurisdictionLabel: "Tribal government",
    authorityScope: "Sovereign-process neutrality fixture only",
    configured: false,
    verifiedAt: "2026-08-23",
    reviewDueAt: "2027-01-15",
    terminology: { plan: "community plan", section: "plan part", adoptionInstrument: "instrument defined by the governing nation", implementationReport: "implementation record" },
    planKinds: [{ key: "community", label: "Community plan" }],
    requirements: [
      { key: "sovereign_requirements", label: "Requirements set by the governing nation", applicability: "locally_defined", sourceUrls: [BIA_COMMUNITY_PLANNING, NAVAJO_LOCAL_GOVERNANCE_ACT] },
    ],
    processSteps: [
      { key: "community_assessment", label: "Prepare the community assessment and land-use plan", required: true, sourceUrls: [NAVAJO_LOCAL_GOVERNANCE_ACT] },
      { key: "chapter_resolution", label: "Record the Chapter's resolution", required: true, decisionBody: "Chapter", sourceUrls: [NAVAJO_LOCAL_GOVERNANCE_ACT] },
      { key: "community_review", label: "Hold community review and accept comments", required: true, deadline: "60-day comment period in the cited source", sourceUrls: [NAVAJO_LOCAL_GOVERNANCE_ACT] },
      { key: "sovereign_certification", label: "Record the governing nation's separate certification", required: true, decisionBody: "Certifying body named by current Navajo law", sourceUrls: [NAVAJO_LOCAL_GOVERNANCE_ACT] },
      { key: "periodic_reevaluation", label: "Reevaluate the plan", required: true, deadline: "Five-year cycle in the cited source", sourceUrls: [NAVAJO_LOCAL_GOVERNANCE_ACT] },
    ],
    disclosure: "OpenPlan does not infer a tribe's legal process from state law or federal guidance. Configure the governing nation's own requirements before using a checklist.",
    sourceUrls: [BIA_COMMUNITY_PLANNING, NAVAJO_LOCAL_GOVERNANCE_ACT],
  },
];

export const JURISDICTION_PLAN_DESCRIPTORS = [CALIFORNIA, LOCAL_UNCONFIGURED, ...NEUTRALITY_FIXTURES] as const;

export const SELECTABLE_JURISDICTION_PLAN_DESCRIPTORS = [CALIFORNIA, LOCAL_UNCONFIGURED] as const;

export type JurisdictionPlanRecommendation = {
  descriptor: JurisdictionPlanDescriptor;
  kind:
    | "jurisdiction_matched"
    | "no_workspace_jurisdiction"
    | "no_configured_bundle"
    | "ambiguous_configured_bundles";
};

function normalizedPart(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized || null;
}

/**
 * Recommend a selectable legal bundle from the workspace's existing home
 * jurisdiction. A neutral workflow is the answer whenever there is no unique
 * configured match. Registration order never decides the result.
 */
export function recommendJurisdictionPlanDescriptor(
  jurisdiction: HomeJurisdiction | null | undefined,
  descriptors: readonly JurisdictionPlanDescriptor[] = SELECTABLE_JURISDICTION_PLAN_DESCRIPTORS
): JurisdictionPlanRecommendation {
  const neutral =
    descriptors.find((descriptor) => descriptor.id === LOCAL_UNCONFIGURED.id) ??
    LOCAL_UNCONFIGURED;
  const country = normalizedPart(jurisdiction?.country);
  const subdivision = normalizedPart(jurisdiction?.subdivision);

  if (!country) {
    return { descriptor: neutral, kind: "no_workspace_jurisdiction" };
  }

  const configured = descriptors.filter(
    (descriptor) =>
      descriptor.configured &&
      normalizedPart(descriptor.jurisdictionCoverage?.country) === country
  );
  const subdivisionMatches = subdivision
    ? configured.filter(
        (descriptor) =>
          normalizedPart(descriptor.jurisdictionCoverage?.subdivision) === subdivision
      )
    : [];
  const candidates =
    subdivisionMatches.length > 0
      ? subdivisionMatches
      : configured.filter(
          (descriptor) => normalizedPart(descriptor.jurisdictionCoverage?.subdivision) === null
        );

  if (candidates.length === 1) {
    return { descriptor: candidates[0], kind: "jurisdiction_matched" };
  }
  if (candidates.length > 1) {
    return { descriptor: neutral, kind: "ambiguous_configured_bundles" };
  }
  return { descriptor: neutral, kind: "no_configured_bundle" };
}

export function getJurisdictionPlanDescriptor(id: string): JurisdictionPlanDescriptor | null {
  return JURISDICTION_PLAN_DESCRIPTORS.find((descriptor) => descriptor.id === id) ?? null;
}

/** Resolve installed rules only after checking both halves of the selection. */
export function getPlanKindDescriptor(descriptorId: string, planKindKey: string): JurisdictionPlanDescriptor | null {
  const family = getJurisdictionPlanDescriptor(descriptorId);
  return family ? selectPlanKindRules(family, planKindKey, PLAN_KIND_RULES[descriptorId]) : null;
}

export function descriptorIsOverdue(descriptor: JurisdictionPlanDescriptor, now = new Date()): boolean {
  return new Date(`${descriptor.reviewDueAt}T23:59:59.999Z`).getTime() < now.getTime();
}
