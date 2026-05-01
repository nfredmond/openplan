import { coerceNumber } from "./_helpers";
import type { HoveredCrash } from "./_types";

export function buildHoveredCrash(properties: Record<string, unknown> | null | undefined): HoveredCrash | null {
  if (!properties) {
    return null;
  }

  return {
    severityLabel: String(properties.severityLabel ?? "Crash"),
    collisionYear: coerceNumber(properties.collisionYear),
    fatalCount: coerceNumber(properties.fatalCount) ?? 0,
    injuryCount: coerceNumber(properties.injuryCount) ?? 0,
    pedestrianInvolved: String(properties.pedestrianInvolved ?? "false") === "true",
    bicyclistInvolved: String(properties.bicyclistInvolved ?? "false") === "true",
  };
}
