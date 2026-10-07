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

type Props = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  metadata: Record<string, unknown>;
  planId: string;
  versionId: string;
  contentHash: string;
};

/** Read the decision retained by this report, including editions later superseded. */
export async function LandUsePlanReportAdoption({ supabase, metadata, planId, versionId, contentHash }: Props) {
  const heading = <h2 id="report-adoption-heading" className="text-2xl font-semibold">Saved adoption decision</h2>;
  if (metadata.adoptionManifest == null && metadata.adoptionManifestHash == null) {
    return <section aria-labelledby="report-adoption-heading" className="mt-8 rounded-lg border p-5">{heading}<p className="mt-3">This report did not retain the adoption details. OpenPlan has not substituted a later decision. This does not establish whether an agency adopted the plan.</p></section>;
  }

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
  if (!verified || !parsed.success) {
    return <section aria-labelledby="report-adoption-heading" className="mt-8 rounded-lg border p-5">{heading}<p role="alert" className="mt-3">The adoption details could not be verified against the version retained in this report. OpenPlan withheld the decision details. The plan content below passed its separate version check.</p></section>;
  }
  const decision = parsed.data.decision;
  return <section aria-labelledby="report-adoption-heading" className="mt-8 rounded-lg border p-5">
    {heading}
    <p className="mt-3 text-sm text-muted-foreground">This is the decision retained when this report was published. Later decisions do not replace it here. These details do not establish legal validity.</p>
    <dl className="mt-4 grid gap-4 sm:grid-cols-2">
      <div><dt className="text-sm text-muted-foreground">Decision body</dt><dd className="mt-1 whitespace-pre-wrap">{decision.body}</dd></div>
      <div><dt className="text-sm text-muted-foreground">Decision type</dt><dd className="mt-1 capitalize">{decision.kind}</dd></div>
      <div><dt className="text-sm text-muted-foreground">Instrument</dt><dd className="mt-1">{decision.instrumentType} {decision.instrumentIdentifier}</dd></div>
      <div><dt className="text-sm text-muted-foreground">Decision date</dt><dd className="mt-1">{decision.decidedOn}</dd></div>
      <div><dt className="text-sm text-muted-foreground">Effective date</dt><dd className="mt-1">{decision.effectiveOn ?? "Not recorded"}</dd></div>
      <div><dt className="text-sm text-muted-foreground">Vote</dt><dd className="mt-1 whitespace-pre-wrap">{decision.vote || "Not recorded"}</dd></div>
    </dl>
  </section>;
}
