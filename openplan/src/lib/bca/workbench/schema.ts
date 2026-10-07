import { z } from "zod";

const text = z.string().trim().max(4000);
const year = z.number().int().min(1900).max(2200);
const value = z.number().finite().min(0).max(1e14);
const id = z.string().trim().min(1).max(100);
export const BCA_UNITS = [
  "person-hour",
  "vehicle-hour",
  "vehicle-mile",
  "fatality",
  "serious-injury",
  "minor-injury",
  "crash",
  "metric-ton",
  "short-ton",
  "dollar",
  "trip",
  "other",
] as const;
export const BCA_CATEGORIES = [
  "travel-time",
  "safety",
  "vehicle-operating",
  "emissions",
  "resilience",
  "active-travel",
  "capital",
  "maintenance",
  "rehabilitation",
  "residual",
  "other",
] as const;
export const evidenceSchema = z
  .object({
    id,
    title: text,
    reference: text,
    locator: text,
    observedYear: year.nullable(),
    status: z.enum(["documented", "assumption", "missing", "model-screening"]),
    method: text,
    limitation: text,
    owner: text,
    dueDate: z.string().max(10),
  })
  .strict();
export const flowSchema = z
  .object({
    id,
    label: z.string().trim().max(200),
    side: z.enum(["benefit", "cost"]),
    component: z.string().trim().min(1).max(120).default("Whole project"),
    category: z.enum(BCA_CATEGORIES),
    benefitDirection: z.enum(["reduction", "increase"]),
    unit: z.enum(BCA_UNITS),
    startYear: year,
    endYear: year,
    noBuild: value.nullable(),
    build: value.nullable(),
    annualization: z.number().finite().min(0).max(8760).nullable(),
    unitValue: value.nullable(),
    priceYear: year,
    priceFactor: z.number().finite().positive().max(100).nullable(),
    quantityGrowthPct: z.number().finite().min(-100).max(100),
    realValueGrowthPct: z.number().finite().min(-100).max(100),
    discountRatePct: z.number().finite().min(0).max(100).nullable(),
    sourceIds: z.array(id).max(30),
    parameterSourceId: id.nullable(),
    conversionSourceId: id.nullable(),
    overlapGroup: z.string().trim().max(100),
    overlapResolution: text,
    rationale: text,
    // Explicit annual overrides support changing forecasts, hazard exposure and parameter schedules.
    annualOverrides: z
      .array(
        z
          .object({
            year,
            noBuild: value.nullable(),
            build: value.nullable(),
            unitValue: value.nullable(),
          })
          .strict(),
      )
      .max(101),
  })
  .strict();
export const bcaDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().trim().min(1).max(200),
    projectId: z.string().uuid(),
    alternative: text,
    noBuildDescription: text,
    geography: text,
    programId: z.string().max(100),
    programVersion: text,
    applicability: text,
    methodology: text,
    priceYear: year,
    discountYear: year,
    startYear: year,
    openingYear: year,
    endYear: year,
    discountRatePct: z.number().finite().min(0).max(100),
    costConvention: z.enum(["capital-only", "all-costs"]),
    evidence: z.array(evidenceSchema).max(150),
    flows: z.array(flowSchema).max(150),
    qualitativeBenefits: text,
    exclusions: text,
    reviewNotes: text,
    sensitivity: z
      .object({
        benefitLowPct: z.number().min(-100).max(0),
        benefitHighPct: z.number().min(0).max(300),
        costLowPct: z.number().min(-100).max(0),
        costHighPct: z.number().min(0).max(300),
        alternateDiscountRatePct: z.number().min(0).max(100),
        rationale: text,
      })
      .strict(),
  })
  .strict()
  .superRefine((doc, ctx) => {
    if (
      doc.endYear < doc.startYear ||
      doc.endYear - doc.startYear > 100 ||
      doc.openingYear < doc.startYear ||
      doc.openingYear > doc.endYear
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Analysis years must include opening year and span no more than 101 years.",
      });
    for (const [name, rows] of [
      ["evidence", doc.evidence],
      ["flows", doc.flows],
    ] as const) {
      if (new Set(rows.map((row) => row.id)).size !== rows.length)
        ctx.addIssue({
          code: "custom",
          message: `Duplicate ${name} identifiers.`,
        });
    }
    for (const flow of doc.flows) {
      if (
        flow.startYear < doc.startYear ||
        flow.endYear > doc.endYear ||
        flow.endYear < flow.startYear
      )
        ctx.addIssue({
          code: "custom",
          message: `${flow.label || flow.id}: flow years extend outside the analysis. Costs must not be clipped.`,
        });
      if (
        new Set(flow.annualOverrides.map((row) => row.year)).size !==
          flow.annualOverrides.length ||
        flow.annualOverrides.some(
          (row) => row.year < flow.startYear || row.year > flow.endYear,
        )
      )
        ctx.addIssue({
          code: "custom",
          message: `${flow.label || flow.id}: annual overrides must have unique years inside the flow period.`,
        });
    }
  });
export type BcaDocument = z.infer<typeof bcaDocumentSchema>;
export type BcaFlow = z.infer<typeof flowSchema>;
export type BcaEvidence = z.infer<typeof evidenceSchema>;
