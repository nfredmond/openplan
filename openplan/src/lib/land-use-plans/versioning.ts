import { createHash } from "node:crypto";

export type FrozenPlanContent = {
  plan: {
    id: string;
    descriptorId: string;
    planKindKey: string;
    title: string;
    authorityLabel: string;
    geographyLabel: string;
  };
  version: {
    id: string;
    versionNumber: number;
    versionKind: string;
    basedOnVersionId: string | null;
    applicableRequirementKeys: string[];
  };
  nodes: unknown[];
  relationships: unknown[];
  designations: unknown[];
  implementationActions: unknown[];
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

export function serializeFrozenPlanContent(content: FrozenPlanContent): string {
  return JSON.stringify(canonicalize(content));
}

export function hashFrozenPlanContent(content: FrozenPlanContent): string {
  return createHash("sha256").update(serializeFrozenPlanContent(content)).digest("hex");
}

export function adoptionHashMatches(
  frozenVersion: { contentHash: string | null; state: string },
  requestedHash: string
): boolean {
  return (
    frozenVersion.state === "public_review" &&
    frozenVersion.contentHash !== null &&
    frozenVersion.contentHash === requestedHash
  );
}

export function hashFrozenRecord(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}
