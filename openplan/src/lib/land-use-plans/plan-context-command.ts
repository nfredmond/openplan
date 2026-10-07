import { z } from "zod";
import { studyAreaCaptureSchema } from "@/lib/geographies/study-area-capture";
import { planAuthorityAssessmentSchema } from "./plan-context";

export const planContextCommandSchema = z.object({
  place: studyAreaCaptureSchema,
  assessment: planAuthorityAssessmentSchema,
}).strict();
export type PlanContextCommand = z.infer<typeof planContextCommandSchema>;

export const planContextSaveSchema = planContextCommandSchema.extend({
  commandId: z.string().uuid(),
  versionId: z.string().uuid(),
  expectedContextHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  descriptorId: z.string().min(1).max(120),
  planKindKey: z.string().min(1).max(120),
}).strict();
export type PlanContextSave = z.infer<typeof planContextSaveSchema>;

/** Normalize form values before retaining the exact command that will be sent. */
export function serializePlanContextSave(value: unknown): string {
  return JSON.stringify(planContextSaveSchema.parse(value));
}
