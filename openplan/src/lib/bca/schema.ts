import { z } from "zod";
import type { BcaAnalysisInputs } from "@/lib/bca/types";

// Wire-format validation for persisted BCA screening inputs. The engine
// re-validates semantics (horizon bounds, rate sanity) and throws its own
// errors; this schema exists so a stored inputs_json can never smuggle
// unexpected shapes, NaN/Infinity, or absurd magnitudes into the recompute.

const dollars = z.number().finite().min(0).max(1e12);
const smallCount = z.number().finite().min(0).max(1e6);
const hours = z.number().finite().min(0).max(1e9);
const miles = z.number().finite().min(0).max(1e12);
const ratePct = z.number().finite().min(-100).max(100);
const label = z.string().trim().min(1).max(160);

const benefitInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("travelTime"),
      label: label.optional(),
      annualHoursSaved: z
        .object({
          commuter: hours.optional(),
          commercial: hours.optional(),
          freight: hours.optional(),
        })
        .strict(),
      annualGrowthRatePct: ratePct.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("safety"),
      label: label.optional(),
      annualCrashesAvoided: z
        .object({
          fatal: smallCount.optional(),
          injury: smallCount.optional(),
          propertyDamageOnly: smallCount.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("emissions"),
      label: label.optional(),
      annualMetricTonsCo2eReduced: z.number().finite().min(0).max(1e9).optional(),
      annualVmtReduced: miles.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("vehicleOperating"),
      label: label.optional(),
      annualVmtReduced: miles,
    })
    .strict(),
  z
    .object({
      kind: z.literal("other"),
      label,
      annualValue: dollars,
      annualGrowthRatePct: ratePct.optional(),
    })
    .strict(),
]);

const costInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("capital"),
      label: label.optional(),
      totalAmount: dollars,
      spreadYears: z.number().int().min(1).max(100).optional(),
      startYearOffset: z.number().int().min(0).max(100).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("operationsMaintenance"),
      label: label.optional(),
      annualAmount: dollars,
      escalationRatePct: ratePct.optional(),
      startYearOffset: z.number().int().min(0).max(100).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("other"),
      label,
      annualAmount: dollars,
      escalationRatePct: ratePct.optional(),
      startYearOffset: z.number().int().min(0).max(100).optional(),
    })
    .strict(),
]);

export const bcaAnalysisInputsSchema: z.ZodType<BcaAnalysisInputs> = z
  .object({
    baseYear: z.number().int().min(1900).max(2200),
    analysisHorizonYears: z.number().int().min(1).max(100),
    discountRatePct: z.number().finite().min(0).max(100),
    co2DiscountRatePct: z.number().finite().min(0).max(100).optional(),
    benefits: z.array(benefitInputSchema).max(20),
    costs: z.array(costInputSchema).max(20),
  })
  .strict();
