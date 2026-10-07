import { placeOfRecordFromBoundary, placeOfRecordFromCapturedArea } from "@/lib/geographies/study-area-capture";
import { resolvePlaceBoundary } from "@/lib/geographies/place-resolver";
import { planApplicabilityBlocker, savedPlanContextSchema, type SavedPlanContext } from "./plan-context";
import type { JurisdictionPlanDescriptor } from "./contracts";

import type { PlanContextCommand } from "./plan-context-command";
export { planContextCommandSchema } from "./plan-context-command";
export type { PlanContextCommand } from "./plan-context-command";

/** Resolve only the study place. Authority/applicability remains an attributed staff statement. */
export async function preparePlanContext(command: PlanContextCommand, descriptor: JurisdictionPlanDescriptor, userId: string): Promise<
  { ok: true; context: SavedPlanContext } | { ok: false; status: 400 | 409 | 503; error: string }
> {
  const blocker = planApplicabilityBlocker(command.assessment, descriptor);
  if (blocker) return { ok: false, status: 409, error: blocker };
  let place;
  if (command.place.mode === "place") {
    try {
      const boundary = await resolvePlaceBoundary(command.place.kind, command.place.geoid);
      if (!boundary || boundary.kind !== command.place.kind || boundary.geoid !== command.place.geoid) {
        return { ok: false, status: 503, error: "The selected study place could not be verified. Keep your draft and try the place lookup again." };
      }
      place = placeOfRecordFromBoundary(boundary, command.place.label);
    } catch {
      return { ok: false, status: 503, error: "The study-area service is unavailable. No place identity was saved." };
    }
  } else {
    place = placeOfRecordFromCapturedArea(command.place);
  }
  if (!place) return { ok: false, status: 400, error: "The study area has no usable coordinates." };
  const parsed = savedPlanContextSchema.safeParse({ schemaVersion: 1, place, assessment: command.assessment,
    savedBy: userId, savedAt: new Date().toISOString() });
  if (!parsed.success) return { ok: false, status: 400, error: "The plan context could not be validated." };
  return { ok: true, context: parsed.data };
}
