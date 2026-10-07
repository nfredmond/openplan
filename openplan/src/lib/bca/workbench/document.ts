import type { BcaDocument, BcaFlow } from "./schema";
import { getBcaProfile } from "./profiles";

export function newBcaDocument(projectId: string): BcaDocument {
  const profile = getBcaProfile("usdot-2026")!;
  return {
    schemaVersion: 1,
    projectId,
    title: "Benefit-cost analysis",
    alternative: "",
    noBuildDescription: "",
    geography: "",
    programId: profile.id,
    programVersion: profile.version,
    applicability: "",
    methodology: "",
    priceYear: profile.priceYear,
    discountYear: 2026,
    startYear: 2026,
    openingYear: 2028,
    endYear: 2047,
    discountRatePct: profile.discountRatePct,
    costConvention: profile.costConvention,
    evidence: [],
    flows: [],
    qualitativeBenefits: "",
    exclusions: "",
    reviewNotes: "",
    sensitivity: {
      benefitLowPct: -20,
      benefitHighPct: 20,
      costLowPct: -10,
      costHighPct: 30,
      alternateDiscountRatePct: 3,
      rationale:
        "Illustrative stress ranges. Replace with project-specific evidence; these are not confidence bounds.",
    },
  };
}
export function newBcaFlow(
  doc: BcaDocument,
  side: "benefit" | "cost",
  id: string,
): BcaFlow {
  return {
    id,
    label: side === "cost" ? "Capital cost" : "Travel time",
    side,
    component: "Whole project",
    benefitDirection: "reduction",
    category: side === "cost" ? "capital" : "travel-time",
    unit: side === "cost" ? "dollar" : "person-hour",
    startYear: side === "cost" ? doc.startYear : doc.openingYear,
    endYear: side === "cost" ? doc.startYear : doc.endYear,
    noBuild: null,
    build: null,
    annualization: 1,
    unitValue: side === "cost" ? 1 : null,
    priceYear: doc.priceYear,
    priceFactor: 1,
    quantityGrowthPct: 0,
    realValueGrowthPct: 0,
    discountRatePct: null,
    sourceIds: [],
    parameterSourceId: null,
    conversionSourceId: null,
    overlapGroup: "",
    overlapResolution: "",
    rationale: "",
    annualOverrides: [],
  };
}
export function exampleBcaDocument(projectId: string): BcaDocument {
  const doc = newBcaDocument(projectId);
  doc.title = "Synthetic example: corridor travel time";
  doc.alternative =
    "Synthetic Build case with reduced person-hours. No real project or traffic observation.";
  doc.noBuildDescription =
    "Synthetic No Build case with 100,000 annual person-hours.";
  doc.geography = "Synthetic corridor";
  doc.applicability =
    "Training example only. No application eligibility is asserted.";
  doc.methodology =
    "Annual Build/No Build differences in constant 2024 dollars. End-of-year discounting to 2026.";
  doc.exclusions =
    "Synthetic example excludes safety, emissions, induced demand and residual value.";
  doc.evidence = [
    {
      id: "example",
      title: "Synthetic training assumptions",
      reference: "OpenPlan synthetic example",
      locator: "Training example, no observed data",
      observedYear: null,
      status: "assumption",
      method: "Illustrative inputs for inspecting arithmetic",
      limitation: "Not a real project. Do not submit.",
      owner: "",
      dueDate: "",
    },
  ];
  const cost = {
    ...newBcaFlow(doc, "cost", "capital"),
    noBuild: 0,
    build: 2000000,
    sourceIds: ["example"],
    parameterSourceId: "example",
    rationale: "Synthetic full capital cost.",
  };
  const benefit = {
    ...newBcaFlow(doc, "benefit", "time"),
    noBuild: 100000,
    build: 85000,
    unitValue: 21.8,
    sourceIds: ["example"],
    parameterSourceId: "example",
    rationale: "Synthetic annual person-hours, no annualization required.",
  };
  const maintenance = {
    ...newBcaFlow(doc, "cost", "maintenance"),
    label: "Incremental maintenance",
    category: "maintenance" as const,
    startYear: doc.openingYear,
    endYear: doc.endYear,
    noBuild: 10000,
    build: 15000,
    sourceIds: ["example"],
    parameterSourceId: "example",
    rationale: "Synthetic operating cost difference.",
  };
  doc.flows = [cost, benefit, maintenance];
  return doc;
}
