import { z } from "zod";
const amount = z.number().finite().min(0).max(1e12);
const travelSchema = z.object({
  noBuildTrips: amount,
  buildTrips: amount,
  noBuildMinutes: amount,
  buildMinutes: amount,
  occupancy: z.number().positive().max(1000),
  days: z.number().positive().max(366),
});
/** Rule-of-half consumer-surplus approximation for the same users/market and fixed occupancy. */
export function travelTimeQuantity(input: z.infer<typeof travelSchema>) {
  const p = travelSchema.parse(input);
  const trips = (p.noBuildTrips + p.buildTrips) / 2;
  const noBuild = ((trips * p.noBuildMinutes) / 60) * p.occupancy * p.days;
  const build = ((trips * p.buildMinutes) / 60) * p.occupancy * p.days;
  return {
    noBuild,
    build,
    unit: "person-hour" as const,
    method: `Rule-of-half approximation: (${p.noBuildTrips} + ${p.buildTrips}) / 2 vehicle trips/day × travel minutes / 60 × ${p.occupancy} persons/vehicle × ${p.days} days/year. No Build ${p.noBuildMinutes} minutes; Build ${p.buildMinutes} minutes. Separate modes/user classes and validate the generalized-cost assumptions. This is not total network VHT.`,
  };
}
const safetySchema = z.object({
  events: amount,
  years: z.number().positive().max(100),
  cmf: z.number().finite().min(0).max(10),
});
export function safetyQuantity(input: z.infer<typeof safetySchema>) {
  const p = safetySchema.parse(input),
    noBuild = p.events / p.years;
  return {
    noBuild,
    build: noBuild * p.cmf,
    method: `${p.events} observed events / ${p.years} observation years; Build = baseline × CMF ${p.cmf}. Review crash versus person units, treatment applicability, exposure, regression to the mean and overlapping countermeasures. This arithmetic does not validate a CMF or estimate a future baseline.`,
  };
}
export const hazardBinSchema = z.object({
  label: z.string().min(1),
  probability: z.number().min(0).max(1),
  noBuildLoss: amount,
  buildLoss: amount,
});
/** Disjoint annual event bins only, never a sum of cumulative exceedance probabilities. */
export function resilienceQuantity(input: z.infer<typeof hazardBinSchema>[]) {
  const bins = z.array(hazardBinSchema).min(1).max(100).parse(input);
  if (bins.reduce((s, b) => s + b.probability, 0) > 1 + 1e-12)
    throw new Error("Disjoint annual event probabilities cannot sum above 1.");
  return {
    noBuild: bins.reduce((s, b) => s + b.probability * b.noBuildLoss, 0),
    build: bins.reduce((s, b) => s + b.probability * b.buildLoss, 0),
    method: `Expected annual loss = sum of probability × consequence over explicitly mutually exclusive annual bins. ${bins.map((b) => `${b.label}: p=${b.probability}, No Build loss=${b.noBuildLoss}, Build loss=${b.buildLoss}`).join("; ")}. Unlisted probability mass assumes zero loss; justify this and the tail. Exceedance probabilities and repeated event frequencies are not disjoint-bin probabilities. Separate repair costs, disruption and user losses to prevent overlap.`,
  };
}
