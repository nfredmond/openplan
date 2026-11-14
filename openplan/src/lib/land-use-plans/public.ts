import { getPlanKindDescriptor } from "./registry";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { readFrozenPlanDescriptor } from "./descriptor-snapshot";
import { readFrozenPlanIdentity } from "./frozen-identity";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { retainedAdoptionManifestSchema } from "./report-adoption";

const publicationSourceSchema = z.object({
  plan: z.object({ id: z.string().uuid(), workspace_id: z.string().uuid(), current_adopted_version_id: z.string().uuid() }),
  version: z.object({ id: z.string().uuid(), plan_id: z.string().uuid(), workspace_id: z.string().uuid(),
    version_number: z.number().int().positive(), state: z.literal("adopted"), content_hash: z.string().regex(/^[a-f0-9]{64}$/),
    frozen_snapshot: z.record(z.string(), z.unknown()), frozen_at: z.string().nullable(), published_report_id: z.string().uuid() }),
  report: z.object({ id: z.string().uuid(), workspace_id: z.string().uuid(), land_use_plan_id: z.string().uuid(),
    project_id: z.null(), report_type: z.literal("land_use_plan_packet"), status: z.literal("generated") }),
  decisions: z.array(z.object({ id: z.string().uuid(), workspace_id: z.string().uuid(), plan_id: z.string().uuid(),
    version_id: z.string().uuid(), version_content_hash: z.string(), decision_kind: z.enum(["adoption", "amendment"]),
    decision_body: z.string(), instrument_type: z.string(), instrument_identifier: z.string(), vote: z.string().nullable(),
    decided_on: z.string().date(), effective_on: z.string().date().nullable(), review_release_id: z.string().uuid(),
    adoption_manifest: retainedAdoptionManifestSchema.passthrough().extend({
      // Validate without normalizing the native manifest's retained bytes.
      decision: retainedAdoptionManifestSchema.shape.decision.extend({
        body: z.string().refine(value => value.trim().length > 0),
        instrumentType: z.string().refine(value => value.trim().length > 0),
        instrumentIdentifier: z.string().refine(value => value.trim().length > 0),
      }).passthrough(),
    }), adoption_manifest_hash: z.string().regex(/^[a-f0-9]{64}$/),
    manifest_hash_verified: z.literal(true),
  })).length(1),
  artifacts: z.array(z.object({ id: z.string().uuid(), report_id: z.string().uuid(), artifact_kind: z.literal("html"),
    metadata_json: z.record(z.string(), z.unknown()),
  })).length(1),
});

export type PublishedLandUsePlanPacket = {
  descriptorCustody: "frozen" | "not_retained";
  plan: { id: string; title: string; planKindKey: string; authorityLabel: string; geographyLabel: string };
  version: { id: string; versionNumber: number; contentHash: string; frozenAt: string | null };
  decision: {
    decision_kind: string;
    decision_body: string;
    instrument_type: string;
    instrument_identifier: string;
    vote: string | null;
    decided_on: string;
    effective_on: string | null;
    version_content_hash: string;
  };
  descriptor: {
    terminology: { plan: string; section: string; adoptionInstrument: string; implementationReport: string };
    disclosure: string;
    sourceUrls: string[];
    verifiedAt: string;
    reviewDueAt: string;
  } | null;
  content: Record<string, unknown>;
  privacy: string;
};

export type PublicLandUsePlanReviewPacket = {
  descriptorCustody: PublishedLandUsePlanPacket["descriptorCustody"];
  release: {
    id: string;
    roundNumber: number;
    reviewOpenOn: string;
    reviewCloseOn: string;
    reviewMethod: string;
    status: "open" | "closed";
    outcomeHash: string | null;
  };
  plan: PublishedLandUsePlanPacket["plan"];
  version: PublishedLandUsePlanPacket["version"];
  descriptor: PublishedLandUsePlanPacket["descriptor"];
  content: Record<string, unknown>;
  privacy: string;
};

export async function loadPublishedLandUsePlanPacket(
  planId: string,
): Promise<{ ok: true; packet: PublishedLandUsePlanPacket } | { ok: false; reason: "not_found" | "read_failure" | "incomplete" }> {
  const service = createServiceRoleClient();
  const source = await service.rpc("land_use_plan_publication_source_v1", { p_plan_id: planId });
  if (source.error) return { ok: false, reason: "read_failure" };
  if (source.data === null) return { ok: false, reason: "not_found" };
  const parsed = publicationSourceSchema.safeParse(source.data);
  if (!parsed.success) return { ok: false, reason: "incomplete" };
  const { plan, version, report, decisions: [decision], artifacts: [artifact] } = parsed.data;
  const metadata = artifact.metadata_json;
  if (plan.id !== planId || plan.current_adopted_version_id !== version.id
    || version.workspace_id !== plan.workspace_id || report.id !== version.published_report_id
    || report.workspace_id !== plan.workspace_id || report.land_use_plan_id !== plan.id
    || artifact.report_id !== report.id || metadata.kind === "land_use_plan_implementation_report"
    || metadata.landUsePlanId !== plan.id || metadata.versionId !== version.id || metadata.contentHash !== version.content_hash
    || !isDeepStrictEqual(metadata.frozenSnapshot, version.frozen_snapshot)
    || decision.workspace_id !== plan.workspace_id || decision.plan_id !== plan.id || decision.version_id !== version.id
    || decision.version_content_hash !== version.content_hash
    || decision.adoption_manifest.planId !== plan.id || decision.adoption_manifest.versionId !== version.id
    || decision.adoption_manifest.versionContentHash !== version.content_hash
    || decision.adoption_manifest.reviewReleaseId !== decision.review_release_id
    || metadata.adoptionManifestHash !== decision.adoption_manifest_hash || metadata.reviewReleaseId !== decision.review_release_id
    || !isDeepStrictEqual(metadata.adoptionManifest, decision.adoption_manifest)
    || decision.adoption_manifest.decision.kind !== decision.decision_kind
    || decision.adoption_manifest.decision.body !== decision.decision_body
    || decision.adoption_manifest.decision.instrumentType !== decision.instrument_type
    || decision.adoption_manifest.decision.instrumentIdentifier !== decision.instrument_identifier
    || decision.adoption_manifest.decision.vote !== decision.vote
    || decision.adoption_manifest.decision.decidedOn !== decision.decided_on
    || decision.adoption_manifest.decision.effectiveOn !== decision.effective_on) return { ok: false, reason: "incomplete" };
  const identity = readFrozenPlanIdentity(version.frozen_snapshot, plan.id, version.id, version.version_number, version.content_hash);
  if (version.plan_id !== plan.id || !identity) return { ok: false, reason: "incomplete" };

  const rules = readFrozenPlanDescriptor(version.frozen_snapshot as Record<string, unknown>, identity.descriptorId, identity.planKindKey);
  if (rules.status === "invalid") return { ok: false, reason: "incomplete" };
  const descriptor = rules.status === "retained" ? rules.descriptor : getPlanKindDescriptor(identity.descriptorId, identity.planKindKey);
  return {
    ok: true,
    packet: {
      descriptorCustody: rules.status === "retained" ? "frozen" : "not_retained",
      plan: { id: identity.id, title: identity.title, planKindKey: identity.planKindKey, authorityLabel: identity.authorityLabel, geographyLabel: identity.geographyLabel },
      version: { id: version.id, versionNumber: version.version_number, contentHash: version.content_hash, frozenAt: version.frozen_at },
      decision: { decision_kind: decision.decision_kind, decision_body: decision.decision_body,
        instrument_type: decision.instrument_type, instrument_identifier: decision.instrument_identifier, vote: decision.vote,
        decided_on: decision.decided_on, effective_on: decision.effective_on, version_content_hash: decision.version_content_hash },
      descriptor: descriptor ? { terminology: descriptor.terminology, disclosure: descriptor.disclosure, sourceUrls: descriptor.sourceUrls, verifiedAt: descriptor.verifiedAt, reviewDueAt: descriptor.reviewDueAt } : null,
      content: version.frozen_snapshot as Record<string, unknown>,
      privacy: "Consultation records, confidential notes, and sensitive-location information are excluded from this packet.",
    },
  };
}

export async function loadPublicLandUsePlanReviewPacket(
  shareToken: string,
): Promise<{ ok: true; packet: PublicLandUsePlanReviewPacket } | { ok: false; reason: "not_found" | "read_failure" | "incomplete" }> {
  const service = createServiceRoleClient();
  const releaseResult = await service.from("land_use_plan_review_releases")
    .select("id, plan_id, version_id, version_content_hash, round_number, review_open_on, review_close_on, review_method, status, outcome_hash")
    .eq("share_token", shareToken).neq("status", "withdrawn").maybeSingle();
  if (releaseResult.error) return { ok: false, reason: "read_failure" };
  const release = releaseResult.data;
  if (!release) return { ok: false, reason: "not_found" };

  const [planResult, versionResult] = await Promise.all([
    service.from("land_use_plans")
      .select("id")
      .eq("id", release.plan_id).maybeSingle(),
    service.from("land_use_plan_versions")
      .select("id, plan_id, version_number, content_hash, frozen_snapshot, frozen_at")
      .eq("id", release.version_id).eq("plan_id", release.plan_id).maybeSingle(),
  ]);
  if (planResult.error || versionResult.error) return { ok: false, reason: "read_failure" };
  const plan = planResult.data;
  const version = versionResult.data;
  if (!plan || !version?.frozen_snapshot || version.content_hash !== release.version_content_hash) {
    return { ok: false, reason: "incomplete" };
  }
  const identity = readFrozenPlanIdentity(version.frozen_snapshot, plan.id, version.id, version.version_number, version.content_hash);
  if (version.plan_id !== plan.id || !identity) return { ok: false, reason: "incomplete" };
  const rules = readFrozenPlanDescriptor(version.frozen_snapshot as Record<string, unknown>, identity.descriptorId, identity.planKindKey);
  if (rules.status === "invalid") return { ok: false, reason: "incomplete" };
  const descriptor = rules.status === "retained" ? rules.descriptor : getPlanKindDescriptor(identity.descriptorId, identity.planKindKey);
  return {
    ok: true,
    packet: {
      descriptorCustody: rules.status === "retained" ? "frozen" : "not_retained",
      release: {
        id: release.id,
        roundNumber: release.round_number,
        reviewOpenOn: release.review_open_on,
        reviewCloseOn: release.review_close_on,
        reviewMethod: release.review_method,
        status: release.status as "open" | "closed",
        outcomeHash: release.outcome_hash,
      },
      plan: { id: identity.id, title: identity.title, planKindKey: identity.planKindKey, authorityLabel: identity.authorityLabel, geographyLabel: identity.geographyLabel },
      version: { id: version.id, versionNumber: version.version_number, contentHash: version.content_hash, frozenAt: version.frozen_at },
      descriptor: descriptor ? { terminology: descriptor.terminology, disclosure: descriptor.disclosure, sourceUrls: descriptor.sourceUrls, verifiedAt: descriptor.verifiedAt, reviewDueAt: descriptor.reviewDueAt } : null,
      content: version.frozen_snapshot as Record<string, unknown>,
      privacy: "Consultation records, confidential notes, and sensitive-location information are excluded from this review release.",
    },
  };
}
