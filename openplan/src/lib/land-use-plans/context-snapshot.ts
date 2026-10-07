import { isDeepStrictEqual } from "node:util";
import { readSavedPlanContext } from "./plan-context";

/** Validate the reviewed value without normalizing or backfilling retained bytes. */
export function readFrozenPlanContext(snapshot: Record<string, unknown>) {
  if (!Object.hasOwn(snapshot, "planContext")) return { status: "legacy" as const };
  const result = readSavedPlanContext(snapshot.planContext);
  if (result.status === "retained" && !isDeepStrictEqual(result.context, snapshot.planContext)) {
    return { status: "invalid" as const };
  }
  return result;
}
