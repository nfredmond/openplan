import type { JurisdictionPlanDescriptor } from "./contracts";

/** Descriptor maintenance dates are not evidence of a source review without sources. */
export function describePlanSourceReview(
  descriptor: Pick<JurisdictionPlanDescriptor, "sourceUrls" | "verifiedAt" | "reviewDueAt">,
): string {
  if (descriptor.sourceUrls.length === 0) {
    return "No legal sources are configured; source review is not established.";
  }
  return `Sources reviewed ${descriptor.verifiedAt}; review due ${descriptor.reviewDueAt}.`;
}
