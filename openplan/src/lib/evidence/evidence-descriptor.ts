import { createHash } from "node:crypto";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";

export const EVIDENCE_DESCRIPTOR_VERSION = "openplan.evidence_descriptor.v1" as const;

export type EvidenceDescriptorV1 = {
  schemaVersion: typeof EVIDENCE_DESCRIPTOR_VERSION;
  stableEvidenceId: string;
  source: {
    kind: string | null;
    label: string;
    citation: string | null;
  };
  asOfDate: string | null;
  retrievedAt: string | null;
  evidenceStatus: "observed" | "modeled" | "administrative" | "reference" | "unknown";
  claimTier: string | null;
  uncertainty: string[];
  limits: string[];
  revisionToken: string | null;
  checksumSha256: string | null;
  support: {
    status: "supported" | "unsupported" | "not_a_numeric_claim";
    reason: string | null;
  };
};

type EvidenceDescriptorInput = Omit<EvidenceDescriptorV1, "schemaVersion" | "stableEvidenceId" | "support"> & {
  identity: Record<string, unknown>;
  numericClaim?: boolean;
};

export function buildEvidenceDescriptor(input: EvidenceDescriptorInput): EvidenceDescriptorV1 {
  const hasSource = Boolean(input.source.kind || input.source.citation);
  const hasRevision = Boolean(input.revisionToken || input.checksumSha256 || input.asOfDate);
  const supported = !input.numericClaim || (hasSource && hasRevision && Boolean(input.claimTier));
  return {
    schemaVersion: EVIDENCE_DESCRIPTOR_VERSION,
    stableEvidenceId: createHash("sha256")
      .update(canonicalizeActionPayload(input.identity))
      .digest("hex"),
    source: input.source,
    asOfDate: input.asOfDate,
    retrievedAt: input.retrievedAt,
    evidenceStatus: input.evidenceStatus,
    claimTier: input.claimTier,
    uncertainty: [...input.uncertainty],
    limits: [...input.limits],
    revisionToken: input.revisionToken,
    checksumSha256: input.checksumSha256,
    support: input.numericClaim
      ? supported
        ? { status: "supported", reason: null }
        : {
            status: "unsupported",
            reason: "A numeric claim needs a named source, claim tier, and dated or hashed revision.",
          }
      : { status: "not_a_numeric_claim", reason: null },
  };
}

export function unsupportedNumericEvidence(
  descriptors: readonly EvidenceDescriptorV1[],
): EvidenceDescriptorV1[] {
  return descriptors.filter((descriptor) => descriptor.support.status === "unsupported");
}
