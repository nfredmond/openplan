import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import type { createClient } from "@/lib/supabase/server";

const manifestSchema = z.object({
  planId: z.string().uuid(),
  versionId: z.string().uuid(),
  versionContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  reviewReleaseId: z.string().uuid(),
  decision: z.object({
    kind: z.enum(["adoption", "amendment", "repeal"]),
    body: z.string().trim().min(1),
    instrumentType: z.string().trim().min(1),
    instrumentIdentifier: z.string().trim().min(1),
    vote: z.string().nullable(),
    decidedOn: z.string().date(),
    effectiveOn: z.string().date().nullable(),
  }),
});

type Input = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  metadata: Record<string, unknown>;
  planId: string;
  versionId: string;
  contentHash: string;
};

/** Verify the complete retained decision against its native append-only record. */
export async function loadReportAdoption({ supabase, metadata, planId, versionId, contentHash }: Input) {
  if (metadata.adoptionManifest == null && metadata.adoptionManifestHash == null) return { status: "absent" as const };
  const parsed = manifestSchema.safeParse(metadata.adoptionManifest);
  const manifestHash = typeof metadata.adoptionManifestHash === "string" && /^[a-f0-9]{64}$/.test(metadata.adoptionManifestHash)
    ? metadata.adoptionManifestHash : null;
  const result = parsed.success && manifestHash ? await supabase.from("land_use_plan_decisions")
    .select("plan_id, version_id, version_content_hash, review_release_id, adoption_manifest, adoption_manifest_hash")
    .eq("plan_id", planId).eq("version_id", versionId).eq("adoption_manifest_hash", manifestHash).maybeSingle() : null;
  const native = result?.data;
  // PostgreSQL computes this hash from jsonb text. Compare the retained native
  // hash and the complete record; the plan's canonical JSON hash is different.
  const verified = parsed.success && manifestHash && native && !result?.error
    && native.plan_id === planId && native.version_id === versionId && native.version_content_hash === contentHash
    && native.adoption_manifest_hash === manifestHash && isDeepStrictEqual(native.adoption_manifest, metadata.adoptionManifest)
    && parsed.data.planId === planId && parsed.data.versionId === versionId && parsed.data.versionContentHash === contentHash
    && parsed.data.reviewReleaseId === metadata.reviewReleaseId && native.review_release_id === parsed.data.reviewReleaseId;
  if (!verified || !parsed.success) return { status: "invalid" as const };
  return { status: "verified" as const, decision: parsed.data.decision };
}
