import { getJurisdictionPlanDescriptor } from "./registry";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { readFrozenPlanDescriptor } from "./descriptor-snapshot";
import { readFrozenPlanIdentity } from "./frozen-identity";

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
  const planResult = await service.from("land_use_plans")
    .select("id, current_adopted_version_id")
    .eq("id", planId).maybeSingle();
  if (planResult.error) return { ok: false, reason: "read_failure" };
  const plan = planResult.data;
  if (!plan?.current_adopted_version_id) return { ok: false, reason: "not_found" };

  const versionResult = await service.from("land_use_plan_versions")
    .select("id, plan_id, version_number, state, content_hash, frozen_snapshot, frozen_at, published_report_id")
    .eq("id", plan.current_adopted_version_id)
    .eq("plan_id", plan.id)
    .eq("state", "adopted")
    .not("published_report_id", "is", null)
    .maybeSingle();
  if (versionResult.error) return { ok: false, reason: "read_failure" };
  const version = versionResult.data;
  if (!version?.frozen_snapshot || !version.published_report_id || !version.content_hash) {
    return { ok: false, reason: "not_found" };
  }
  const identity = readFrozenPlanIdentity(version.frozen_snapshot, plan.id, version.id, version.version_number, version.content_hash);
  if (version.plan_id !== plan.id || !identity) return { ok: false, reason: "incomplete" };

  const decisionResult = await service.from("land_use_plan_decisions")
    .select("decision_kind, decision_body, instrument_type, instrument_identifier, vote, decided_on, effective_on, version_content_hash")
    .eq("version_id", version.id).order("decided_on", { ascending: false }).limit(1).maybeSingle();
  if (decisionResult.error) return { ok: false, reason: "read_failure" };
  const decision = decisionResult.data;
  if (!decision || decision.version_content_hash !== version.content_hash) {
    return { ok: false, reason: "incomplete" };
  }

  const rules = readFrozenPlanDescriptor(version.frozen_snapshot as Record<string, unknown>, identity.descriptorId, identity.planKindKey);
  if (rules.status === "invalid") return { ok: false, reason: "incomplete" };
  const descriptor = rules.status === "retained" ? rules.descriptor : getJurisdictionPlanDescriptor(identity.descriptorId);
  return {
    ok: true,
    packet: {
      descriptorCustody: rules.status === "retained" ? "frozen" : "not_retained",
      plan: { id: identity.id, title: identity.title, planKindKey: identity.planKindKey, authorityLabel: identity.authorityLabel, geographyLabel: identity.geographyLabel },
      version: { id: version.id, versionNumber: version.version_number, contentHash: version.content_hash, frozenAt: version.frozen_at },
      decision,
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
  const descriptor = rules.status === "retained" ? rules.descriptor : getJurisdictionPlanDescriptor(identity.descriptorId);
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
