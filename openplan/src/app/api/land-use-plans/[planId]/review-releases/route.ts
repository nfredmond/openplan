import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { loadLandUsePlanAccess } from "@/lib/land-use-plans/api";
import { hashFrozenRecord } from "@/lib/land-use-plans/versioning";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";

const paramsSchema = z.object({ planId: z.string().uuid() });
const payloadSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("release"),
    versionId: z.string().uuid(),
    versionContentHash: z.string().regex(/^[0-9a-f]{64}$/),
    reviewMethod: z.enum(["engagement_campaign", "external_process"]),
    reviewOpenOn: z.string().date(),
    reviewCloseOn: z.string().date(),
    engagementCampaignId: z.string().uuid().nullable(),
    externalReviewDocumentId: z.string().uuid().nullable(),
  }).strict(),
  z.object({
    operation: z.literal("close"),
    releaseId: z.string().uuid(),
    dispositionSummary: z.string().trim().min(1).max(20_000).nullable(),
  }).strict(),
  z.object({
    operation: z.literal("withdraw"),
    releaseId: z.string().uuid(),
    reason: z.string().trim().min(1).max(2_000),
  }).strict(),
]);

type Context = { params: Promise<{ planId: string }> };

export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("land-use-plans.review-releases", request);
  audit.info("land_use_plan_review_release_requested");
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Invalid plan id" }, { status: 400 });
  const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
  if (!body.ok) return body.response;
  const parsed = payloadSchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Invalid review release operation", issues: parsed.error.issues }, { status: 400 });
  const loaded = await loadLandUsePlanAccess(params.data.planId, { write: true });
  if (!loaded.ok) return loaded.response;
  const { access } = loaded;
  const payload = parsed.data;

  if (payload.operation === "release") {
    if (payload.reviewCloseOn < payload.reviewOpenOn) {
      return NextResponse.json({ error: "Review closing date cannot precede its opening date" }, { status: 400 });
    }
    const { data: version, error: versionError } = await access.supabase.from("land_use_plan_versions")
      .select("id, content_hash, state").eq("id", payload.versionId).eq("plan_id", access.plan.id).maybeSingle();
    if (versionError) return NextResponse.json({ error: "Failed to verify the frozen version" }, { status: 500 });
    if (!version || version.state !== "public_review" || version.content_hash !== payload.versionContentHash) {
      return NextResponse.json({ error: "Release must name the exact frozen public-review version hash" }, { status: 409 });
    }

    if (payload.reviewMethod === "engagement_campaign") {
      if (!payload.engagementCampaignId || payload.externalReviewDocumentId) {
        return NextResponse.json({ error: "Choose one Engagement campaign for this review" }, { status: 400 });
      }
      const { data: campaign, error } = await access.supabase.from("engagement_campaigns").select("id, status")
        .eq("id", payload.engagementCampaignId).eq("workspace_id", access.plan.workspace_id).maybeSingle();
      if (error) return NextResponse.json({ error: "Failed to verify the Engagement campaign" }, { status: 500 });
      if (!campaign || campaign.status !== "active") return NextResponse.json({ error: "The linked Engagement campaign must be active when review opens" }, { status: 400 });
    } else {
      if (!payload.externalReviewDocumentId || payload.engagementCampaignId) {
        return NextResponse.json({ error: "Choose one ready external-review document" }, { status: 400 });
      }
      const { data: document, error } = await access.supabase.from("kb_documents").select("id")
        .eq("id", payload.externalReviewDocumentId).eq("workspace_id", access.plan.workspace_id).eq("status", "ready").maybeSingle();
      if (error) return NextResponse.json({ error: "Failed to verify external-review evidence" }, { status: 500 });
      if (!document) return NextResponse.json({ error: "The external-review document must be ready in this workspace" }, { status: 400 });
    }

    const { data: latest, error: latestError } = await access.supabase.from("land_use_plan_review_releases")
      .select("round_number").eq("plan_id", access.plan.id).order("round_number", { ascending: false }).limit(1);
    if (latestError) return NextResponse.json({ error: "Failed to determine the review round" }, { status: 500 });
    const { data: release, error } = await access.supabase.from("land_use_plan_review_releases").insert({
      workspace_id: access.plan.workspace_id,
      plan_id: access.plan.id,
      version_id: version.id,
      version_content_hash: version.content_hash,
      round_number: (latest?.[0]?.round_number ?? 0) + 1,
      review_method: payload.reviewMethod,
      review_open_on: payload.reviewOpenOn,
      review_close_on: payload.reviewCloseOn,
      engagement_campaign_id: payload.engagementCampaignId,
      external_review_document_id: payload.externalReviewDocumentId,
      created_by: access.userId,
    }).select("id, share_token, round_number").single();
    if (error || !release) return NextResponse.json({ error: "Failed to publish the review release" }, { status: 500 });
    return NextResponse.json({ releaseId: release.id, roundNumber: release.round_number, publicUrl: `/review/land-use-plans/${release.share_token}` }, { status: 201 });
  }

  const { data: release, error: releaseError } = await access.supabase.from("land_use_plan_review_releases")
    .select("id, status, review_method, engagement_campaign_id, version_id, version_content_hash")
    .eq("id", payload.releaseId).eq("plan_id", access.plan.id).maybeSingle();
  if (releaseError) return NextResponse.json({ error: "Failed to load the review release" }, { status: 500 });
  if (!release) return NextResponse.json({ error: "Review release not found" }, { status: 404 });

  if (payload.operation === "withdraw") {
    if (release.status === "withdrawn") return NextResponse.json({ withdrawn: true, alreadyWithdrawn: true });
    const result = await access.supabase.from("land_use_plan_review_releases").update({
      status: "withdrawn", withdrawn_at: new Date().toISOString(), withdrawn_by: access.userId,
      withdrawal_reason: payload.reason,
    }).eq("id", release.id).neq("status", "withdrawn").select("id").maybeSingle();
    if (isWriteFailure(result.error)) return NextResponse.json({ error: "Failed to withdraw the review release" }, { status: 500 });
    if (writeMatchedNoRows(result)) return noRowsMatchedResponse({ subject: "review release", targetWasVerified: true });
    return NextResponse.json({ withdrawn: true });
  }

  if (release.status !== "open") return NextResponse.json({ error: "Only an open review release can be closed" }, { status: 409 });
  let outcomeSnapshot: Record<string, unknown>;
  if (release.review_method === "engagement_campaign" && release.engagement_campaign_id) {
    const [campaignResult, itemsResult, closeLoopResult] = await Promise.all([
      access.supabase.from("engagement_campaigns").select("id, status").eq("id", release.engagement_campaign_id).eq("workspace_id", access.plan.workspace_id).maybeSingle(),
      access.supabase.from("engagement_items").select("id, status, source_type").eq("campaign_id", release.engagement_campaign_id),
      access.supabase.from("engagement_closeloop_entries").select("id, theme_title, you_said, we_did, source_item_ids, published_at").eq("campaign_id", release.engagement_campaign_id).eq("status", "published").order("sort_order"),
    ]);
    if (campaignResult.error || itemsResult.error || closeLoopResult.error) return NextResponse.json({ error: "Failed to verify Engagement closure" }, { status: 500 });
    if (campaignResult.data?.status !== "closed") return NextResponse.json({ error: "Close the linked Engagement campaign before closing this review" }, { status: 409 });
    const items = itemsResult.data ?? [];
    const pending = items.filter((item) => item.status === "pending" || item.status === "flagged");
    if (pending.length) return NextResponse.json({ error: "The Engagement moderation queue must be empty", pendingCount: pending.length }, { status: 409 });
    const statusCounts = Object.fromEntries(["approved", "rejected", "pending", "flagged"].map((status) => [status, items.filter((item) => item.status === status).length]));
    outcomeSnapshot = {
      method: "engagement_campaign",
      campaignId: release.engagement_campaign_id,
      commentCounts: { total: items.length, byStatus: statusCounts },
      publishedCloseLoopEntries: (closeLoopResult.data ?? []).map((entry) => ({ id: entry.id, hash: hashFrozenRecord(entry) })),
    };
  } else {
    if (!payload.dispositionSummary) return NextResponse.json({ error: "External review closure needs a planner-authored disposition summary" }, { status: 400 });
    outcomeSnapshot = { method: "external_process", dispositionSummary: payload.dispositionSummary };
  }

  const closedAt = new Date().toISOString();
  const result = await access.supabase.from("land_use_plan_review_releases").update({
    status: "closed", outcome_snapshot: outcomeSnapshot, closed_at: closedAt, closed_by: access.userId,
  }).eq("id", release.id).eq("status", "open").select("id, outcome_hash").maybeSingle();
  if (isWriteFailure(result.error)) return NextResponse.json({ error: "Failed to freeze the review outcome" }, { status: 500 });
  if (writeMatchedNoRows(result)) return noRowsMatchedResponse({ subject: "open review release", targetWasVerified: true });
  return NextResponse.json({ closed: true, outcomeHash: result.data?.outcome_hash, closedAt });
}
