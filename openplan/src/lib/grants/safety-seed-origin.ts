import { z } from "zod";

export const SAFETY_SEED_CAVEAT = "Code-built working draft from a frozen Safety report. It does not establish adoption, eligibility, current-notice compliance, engineering effectiveness or submission readiness. Review source caveats and complete the manual gaps. Seeding does not complete attachments.";
export const safetySeedProvenanceSchema = z.object({
  kind: z.literal("openplan.ss4a-safety-seed.v1"),
  artifactId: z.string().uuid(), reportId: z.string().uuid(), acquisitionId: z.string().uuid(),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  caveat: z.literal(SAFETY_SEED_CAVEAT),
  sourceCaveats: z.array(z.string().min(1).max(20000)).min(1).max(100),
}).strict();
export type SafetySeedProvenance = z.infer<typeof safetySeedProvenanceSchema>;

/** The origin column is server-protected; arbitrary grounding JSON cannot label an AI draft as code. */
export function readSafetySeedOrigin(draft: { origin?: unknown; safety_seed_id?: unknown; grounding_json?: unknown } | null | undefined): SafetySeedProvenance | null {
  if (draft?.origin !== "safety_plan_seed" || !z.string().uuid().safeParse(draft.safety_seed_id).success) return null;
  const parsed = safetySeedProvenanceSchema.safeParse(draft.grounding_json);
  return parsed.success ? parsed.data : null;
}
