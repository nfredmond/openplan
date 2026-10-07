import { z } from "zod";
import { hashFrozenRecord } from "./versioning";
import { readFrozenPlanContext } from "./context-snapshot";

const frozenIdentitySchema = z.object({
  plan: z.object({
    id: z.string().uuid(), descriptorId: z.string().min(1), planKindKey: z.string().min(1),
    title: z.string().min(1), authorityLabel: z.string().min(1), geographyLabel: z.string().min(1),
  }),
  version: z.object({ id: z.string().uuid(), versionNumber: z.number().int().positive() }),
  nodes: z.array(z.unknown()), relationships: z.array(z.unknown()),
  designations: z.array(z.unknown()), implementationActions: z.array(z.unknown()),
});

/** Reviewed identity belongs to the verified version, independent of later draft edits. */
export function readFrozenPlanIdentity(snapshot: unknown, planId: string, versionId: string, versionNumber: number, contentHash: string) {
  const parsed = frozenIdentitySchema.safeParse(snapshot);
  if (!parsed.success || parsed.data.plan.id !== planId || parsed.data.version.id !== versionId
    || parsed.data.version.versionNumber !== versionNumber || hashFrozenRecord(snapshot) !== contentHash) return null;
  if (readFrozenPlanContext(snapshot as Record<string, unknown>).status === "invalid") return null;
  return parsed.data.plan;
}

export type FrozenPlanIdentity = z.infer<typeof frozenIdentitySchema>["plan"];
