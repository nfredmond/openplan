import { getJurisdictionPlanDescriptor } from "./registry";
import { createServiceRoleClient } from "@/lib/supabase/server";

export type PublishedLandUsePlanPacket = {
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

export async function loadPublishedLandUsePlanPacket(
  planId: string,
): Promise<{ ok: true; packet: PublishedLandUsePlanPacket } | { ok: false; reason: "not_found" | "read_failure" | "incomplete" }> {
  const service = createServiceRoleClient();
  const planResult = await service.from("land_use_plans")
    .select("id, title, descriptor_id, plan_kind_key, authority_label, geography_label, current_adopted_version_id")
    .eq("id", planId).maybeSingle();
  if (planResult.error) return { ok: false, reason: "read_failure" };
  const plan = planResult.data;
  if (!plan?.current_adopted_version_id) return { ok: false, reason: "not_found" };

  const versionResult = await service.from("land_use_plan_versions")
    .select("id, version_number, state, content_hash, frozen_snapshot, frozen_at, published_report_id")
    .eq("id", plan.current_adopted_version_id)
    .eq("state", "adopted")
    .not("published_report_id", "is", null)
    .maybeSingle();
  if (versionResult.error) return { ok: false, reason: "read_failure" };
  const version = versionResult.data;
  if (!version?.frozen_snapshot || !version.published_report_id || !version.content_hash) {
    return { ok: false, reason: "not_found" };
  }

  const decisionResult = await service.from("land_use_plan_decisions")
    .select("decision_kind, decision_body, instrument_type, instrument_identifier, vote, decided_on, effective_on, version_content_hash")
    .eq("version_id", version.id).order("decided_on", { ascending: false }).limit(1).maybeSingle();
  if (decisionResult.error) return { ok: false, reason: "read_failure" };
  const decision = decisionResult.data;
  if (!decision || decision.version_content_hash !== version.content_hash) {
    return { ok: false, reason: "incomplete" };
  }

  const descriptor = getJurisdictionPlanDescriptor(plan.descriptor_id);
  return {
    ok: true,
    packet: {
      plan: { id: plan.id, title: plan.title, planKindKey: plan.plan_kind_key, authorityLabel: plan.authority_label, geographyLabel: plan.geography_label },
      version: { id: version.id, versionNumber: version.version_number, contentHash: version.content_hash, frozenAt: version.frozen_at },
      decision,
      descriptor: descriptor ? { terminology: descriptor.terminology, disclosure: descriptor.disclosure, sourceUrls: descriptor.sourceUrls, verifiedAt: descriptor.verifiedAt, reviewDueAt: descriptor.reviewDueAt } : null,
      content: version.frozen_snapshot as Record<string, unknown>,
      privacy: "Consultation records, confidential notes, and sensitive-location information are excluded from this packet.",
    },
  };
}
