import { createHash } from "node:crypto";
import frozenSegmentV1 from "./synthesis-generation-segment-v1.json";

const canonical = JSON.stringify(frozenSegmentV1);
const sha256 = createHash("sha256").update(canonical, "utf8").digest("hex");

/** Return a detached copy of the retained recipe, independent of runtime schema generation.
 * Persist both its versioned identity and hash with a plan. Future recipes must
 * leave this version available for replay; a matching label alone is not identity.
 */
export function synthesisGenerationSegmentRecipe() {
  return { ...structuredClone(frozenSegmentV1), sha256 };
}
