import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { loadLandUsePlanAccess } from "@/lib/land-use-plans/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { getJurisdictionPlanDescriptor } from "@/lib/land-use-plans/registry";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";

const paramsSchema = z.object({ planId: z.string().uuid() });
const payloadSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("adopt"),
    versionId: z.string().uuid(),
    versionContentHash: z.string().regex(/^[0-9a-f]{64}$/),
    decisionKind: z.enum(["adoption", "amendment"]),
    decisionBody: z.string().trim().min(1).max(240),
    instrumentType: z.string().trim().min(1).max(120),
    instrumentIdentifier: z.string().trim().min(1).max(160),
    vote: z.string().trim().max(240).nullable().optional(),
    decidedOn: z.string().date(),
    effectiveOn: z.string().date().nullable().optional(),
    supportingDocumentId: z.string().uuid(),
  }).strict(),
  z.object({
    operation: z.literal("publish"),
    versionId: z.string().uuid(),
    versionContentHash: z.string().regex(/^[0-9a-f]{64}$/),
    title: z.string().trim().min(1).max(180),
  }).strict(),
]);
type Context = { params: Promise<{ planId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("land-use-plans.decisions", request);
  audit.info("land_use_plan_decision_requested");
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Invalid plan id" }, { status: 400 });
  const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
  if (!body.ok) return body.response;
  const parsed = payloadSchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Invalid decision operation", issues: parsed.error.issues }, { status: 400 });
  const loaded = await loadLandUsePlanAccess(params.data.planId, { write: true });
  if (!loaded.ok) return loaded.response;
  const { access } = loaded;
  const payload = parsed.data;

  const { data: version, error: versionError } = await access.supabase.from("land_use_plan_versions")
    .select("id, state, content_hash, frozen_snapshot, published_report_id")
    .eq("id", payload.versionId).eq("plan_id", access.plan.id).maybeSingle();
  if (versionError) return NextResponse.json({ error: "Failed to verify the frozen version" }, { status: 500 });
  if (!version || version.content_hash !== payload.versionContentHash) {
    return NextResponse.json({ error: "The decision does not match the exact frozen version hash" }, { status: 409 });
  }

  if (payload.operation === "adopt") {
    if (version.state !== "public_review") return NextResponse.json({ error: "Only the frozen public-review version can be adopted" }, { status: 409 });
    const [documentResult, processResult, releaseResult] = await Promise.all([
      access.supabase.from("kb_documents").select("id, title").eq("id", payload.supportingDocumentId).eq("workspace_id", access.plan.workspace_id).eq("status", "ready").maybeSingle(),
      access.supabase.from("land_use_plan_process_records").select("process_key, status, due_on, completed_on, evidence_document_id").eq("version_id", version.id),
      access.supabase.from("land_use_plan_review_releases").select("id, version_id, version_content_hash, round_number, outcome_snapshot, outcome_hash, closed_at")
        .eq("plan_id", access.plan.id).eq("status", "closed").order("round_number", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (documentResult.error || processResult.error || releaseResult.error) return NextResponse.json({ error: "Failed to verify adoption evidence and review history" }, { status: 500 });
    const document = documentResult.data;
    if (!document) return NextResponse.json({ error: "Select a ready supporting document in this workspace" }, { status: 400 });
    const descriptor = getJurisdictionPlanDescriptor(access.plan.descriptor_id);
    if (!descriptor) return NextResponse.json({ error: "Plan descriptor is not installed" }, { status: 409 });
    const processByKey = new Map((processResult.data ?? []).map((record) => [record.process_key, record]));
    const missing = descriptor.processSteps
      .filter((step) => step.required && step.adoptionPrerequisite)
      .map((step) => step.key)
      .filter((key) => processByKey.get(key)?.status !== "complete");
    if (missing.length) return NextResponse.json({ error: "Adoption review is incomplete", missing }, { status: 409 });
    const release = releaseResult.data;
    if (!release || release.version_id !== version.id || release.version_content_hash !== payload.versionContentHash || !release.outcome_hash) {
      return NextResponse.json({ error: "Adoption requires the exact latest closed review release for this version" }, { status: 409 });
    }

    const adoptionManifest = {
      planId: access.plan.id,
      versionId: version.id,
      versionContentHash: payload.versionContentHash,
      reviewReleaseId: release.id,
      reviewRound: release.round_number,
      reviewOutcomeHash: release.outcome_hash,
      commentDispositionSnapshot: release.outcome_snapshot,
      processEvidence: (processResult.data ?? []).map((record) => ({
        processKey: record.process_key,
        status: record.status,
        dueOn: record.due_on,
        completedOn: record.completed_on,
        evidenceDocumentId: record.evidence_document_id,
      })),
      decision: {
        kind: payload.decisionKind,
        body: payload.decisionBody,
        instrumentType: payload.instrumentType,
        instrumentIdentifier: payload.instrumentIdentifier,
        vote: payload.vote ?? null,
        decidedOn: payload.decidedOn,
        effectiveOn: payload.effectiveOn ?? null,
      },
      supportingDocuments: [{ id: document.id, title: document.title }],
      confidentialityExclusions: ["land_use_plan_consultation_records", "confidential_notes", "sensitive_location_flags"],
    };

    const service = createServiceRoleClient();
    const { data: decisionId, error } = await service.rpc("record_land_use_plan_adoption_v2", {
      p_workspace_id: access.plan.workspace_id,
      p_plan_id: access.plan.id,
      p_version_id: version.id,
      p_version_content_hash: payload.versionContentHash,
      p_review_release_id: release.id,
      p_adoption_manifest: adoptionManifest,
      p_decision_kind: payload.decisionKind,
      p_decision_body: payload.decisionBody,
      p_instrument_type: payload.instrumentType,
      p_instrument_identifier: payload.instrumentIdentifier,
      p_vote: payload.vote ?? null,
      p_decided_on: payload.decidedOn,
      p_effective_on: payload.effectiveOn ?? null,
      p_supporting_document_id: payload.supportingDocumentId,
      p_created_by: access.userId,
    });
    if (error) return NextResponse.json({ error: "Failed to record adoption of the exact reviewed version" }, { status: 500 });
    return NextResponse.json({ decisionId });
  }

  if (version.state !== "adopted" || !version.frozen_snapshot) {
    return NextResponse.json({ error: "Only an adopted frozen version can be published" }, { status: 409 });
  }
  if (version.published_report_id) return NextResponse.json({ reportId: version.published_report_id, alreadyPublished: true });

  const { data: decision, error: decisionError } = await access.supabase.from("land_use_plan_decisions")
    .select("id, review_release_id, adoption_manifest, adoption_manifest_hash")
    .eq("version_id", version.id).order("decided_on", { ascending: false }).limit(1).maybeSingle();
  if (decisionError || !decision?.adoption_manifest_hash) return NextResponse.json({ error: "The adoption manifest could not be verified for publication" }, { status: 409 });

  const { data: report, error: reportError } = await access.supabase.from("reports").insert({
    workspace_id: access.plan.workspace_id,
    project_id: null,
    land_use_plan_id: access.plan.id,
    title: payload.title,
    report_type: "land_use_plan_packet",
    status: "generated",
    summary: `Frozen adopted plan packet. Content hash ${payload.versionContentHash}.`,
    created_by: access.userId,
    generated_at: new Date().toISOString(),
    latest_artifact_url: `/published-plans/${access.plan.id}`,
    latest_artifact_kind: "html",
  }).select("id").single();
  if (reportError) return NextResponse.json({ error: "Failed to create the frozen public packet" }, { status: 500 });
  const { error: artifactError } = await access.supabase.from("report_artifacts").insert({
    report_id: report.id,
    artifact_kind: "html",
    generated_by: access.userId,
    metadata_json: {
      landUsePlanId: access.plan.id,
      versionId: version.id,
      contentHash: payload.versionContentHash,
      frozenSnapshot: version.frozen_snapshot,
      adoptionManifest: decision.adoption_manifest,
      adoptionManifestHash: decision.adoption_manifest_hash,
      reviewReleaseId: decision.review_release_id,
      confidentialityExclusions: ["land_use_plan_consultation_records"],
    },
  });
  if (artifactError) {
    const cleanup = await access.supabase.from("reports").delete().eq("id", report.id).select("id");
    if (cleanup.error) audit.error("land_use_plan_publication_cleanup_failed", { error: cleanup.error });
    return NextResponse.json({ error: "Failed to freeze the public packet artifact" }, { status: 500 });
  }
  const publishResult = await access.supabase.from("land_use_plan_versions").update({ published_report_id: report.id }).eq("id", version.id).eq("state", "adopted").select("id").maybeSingle();
  if (isWriteFailure(publishResult.error)) return NextResponse.json({ error: "The public plan was generated but publication could not be saved" }, { status: 500 });
  if (writeMatchedNoRows(publishResult)) return noRowsMatchedResponse({ subject: "adopted plan version", targetWasVerified: true });
  return NextResponse.json({ reportId: report.id, publicUrl: `/published-plans/${access.plan.id}` });
}
