import { z } from "zod";
import type { createServiceRoleClient } from "@/lib/supabase/server";
import { readFrozenPlanIdentity } from "./frozen-identity";
import { serializeFrozenRecord } from "./versioning";

const scopeSchema = z.object({
  workspaceId: z.string().uuid(), planId: z.string().uuid(), actorId: z.string().uuid(),
  versionId: z.string().uuid(), versionNumber: z.number().int().positive(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/), title: z.string().trim().min(1).max(180),
}).strict();
const resultSchema = z.object({
  workspaceId: z.string().uuid(), planId: z.string().uuid(), versionId: z.string().uuid(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/), reportId: z.string().uuid(), artifactId: z.string().uuid(),
  title: z.string().min(1).max(180), alreadyPublished: z.boolean(),
}).strict();
const statuses = { invalid: 400, forbidden: 403, missing: 404, conflict: 409, unavailable: 503 } as const;
export class PlanPublicationError extends Error {
  readonly status: number;
  constructor(public readonly kind: keyof typeof statuses) { super(kind); this.status = statuses[kind]; }
}

/** Let the locked database transaction choose the single packet for this version. */
export async function publishAdoptedPlan(
  client: ReturnType<typeof createServiceRoleClient>, input: z.infer<typeof scopeSchema>, snapshot: unknown,
) {
  const parsed = scopeSchema.safeParse(input);
  if (!parsed.success) throw new PlanPublicationError("invalid");
  const scope = parsed.data;
  if (!readFrozenPlanIdentity(snapshot, scope.planId, scope.versionId, scope.versionNumber, scope.contentHash)) {
    throw new PlanPublicationError("conflict");
  }
  const snapshotText = serializeFrozenRecord(snapshot);
  if (Buffer.byteLength(snapshotText, "utf8") > 64_000_000) throw new PlanPublicationError("conflict");
  const { data, error } = await client.rpc("publish_land_use_plan_version", {
    p_workspace_id: scope.workspaceId, p_plan_id: scope.planId, p_actor_id: scope.actorId,
    p_version_id: scope.versionId, p_version_content_hash: scope.contentHash,
    p_title: scope.title, p_snapshot_text: snapshotText,
  });
  if (error) throw new PlanPublicationError(error.code === "PT400" ? "invalid" : error.code === "42501" ? "forbidden"
    : error.code === "PT404" ? "missing" : error.code === "PT409" ? "conflict" : "unavailable");
  const result = resultSchema.safeParse(data);
  if (!result.success || result.data.workspaceId !== scope.workspaceId || result.data.planId !== scope.planId
    || result.data.versionId !== scope.versionId || result.data.contentHash !== scope.contentHash
    || (!result.data.alreadyPublished && result.data.title !== scope.title)) throw new PlanPublicationError("unavailable");
  return result.data;
}
