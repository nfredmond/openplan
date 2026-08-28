import { createHash } from "node:crypto";
import { z } from "zod";
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

const optionalEvidenceText = z.string().trim().min(1).nullable();
const evidenceDate = z.string().trim().min(1).refine(
  (value) => Number.isFinite(Date.parse(value)),
  "Expected a readable date or timestamp.",
).nullable();
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Stored descriptors cross an approval boundary, so TypeScript alone is not
 * enough. This schema rejects partial lookalikes and contradictory support
 * verdicts before a bundle can be submitted or approved.
 */
export const evidenceDescriptorV1Schema: z.ZodType<EvidenceDescriptorV1> = z.object({
  schemaVersion: z.literal(EVIDENCE_DESCRIPTOR_VERSION),
  stableEvidenceId: sha256Schema,
  source: z.object({
    kind: optionalEvidenceText,
    label: z.string().trim().min(1),
    citation: optionalEvidenceText,
  }).strict(),
  asOfDate: evidenceDate,
  retrievedAt: evidenceDate,
  evidenceStatus: z.enum(["observed", "modeled", "administrative", "reference", "unknown"]),
  claimTier: optionalEvidenceText,
  uncertainty: z.array(z.string().trim().min(1)),
  limits: z.array(z.string().trim().min(1)),
  revisionToken: optionalEvidenceText,
  checksumSha256: sha256Schema.nullable(),
  support: z.discriminatedUnion("status", [
    z.object({ status: z.literal("supported"), reason: z.null() }).strict(),
    z.object({ status: z.literal("unsupported"), reason: z.string().trim().min(1) }).strict(),
    z.object({ status: z.literal("not_a_numeric_claim"), reason: z.null() }).strict(),
  ]),
}).strict().superRefine((descriptor, context) => {
  if (descriptor.support.status !== "supported") return;
  if (!descriptor.source.kind && !descriptor.source.citation) {
    context.addIssue({
      code: "custom",
      path: ["source"],
      message: "Supported numeric evidence needs a named source kind or citation.",
    });
  }
  if (!descriptor.claimTier) {
    context.addIssue({
      code: "custom",
      path: ["claimTier"],
      message: "Supported numeric evidence needs a claim tier.",
    });
  }
  if (!descriptor.revisionToken && !descriptor.checksumSha256 && !descriptor.asOfDate) {
    context.addIssue({
      code: "custom",
      path: ["revisionToken"],
      message: "Supported numeric evidence needs a dated or hashed revision.",
    });
  }
});

export function parseEvidenceDescriptor(value: unknown): EvidenceDescriptorV1 | null {
  const parsed = evidenceDescriptorV1Schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

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
