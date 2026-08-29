import { createHash } from "node:crypto";
import registryJson from "./registry.v1.json";

/** Hash of the exact parsed registry object shipped with this build. */
export function jurisdictionReadinessRegistrySha256(): string {
  return createHash("sha256").update(JSON.stringify(registryJson)).digest("hex");
}
