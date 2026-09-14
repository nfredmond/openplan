import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { requireProviderBrowserOrigin } from "@/lib/assistant/provider-server";
import { readBytesWithLimitStreaming } from "@/lib/http/body-limit";
import { synthesisReviewIntentSchema } from "@/lib/engagement/synthesis-review";
import { synthesisReviewListSchema, synthesisReviewRevisionListSchema } from "@/lib/engagement/synthesis-review-records";
import { loadSynthesisReview, retainSynthesisReview, SynthesisReviewError } from "@/lib/engagement/synthesis-review-server";

const headers = { "Cache-Control": "private, no-store" };
const uuid = z.string().uuid();
const paramsSchema = z.object({ campaignId: uuid });
type Context = { params: Promise<{ campaignId: string }> };
function failure(kind: "invalid" | "forbidden" | "conflict" | "unavailable" | "missing", status?: number) {
  const message = { invalid: "Review the draft command or history selection.", forbidden: "Staff campaign access is required. Reopen the campaign if your account changed.",
    conflict: "This request or parent revision differs. Keep the request and reopen the current review.",
    unavailable: "OpenPlan could not confirm this review operation. Keep the same request and retry.", missing: "This review revision has not been saved." };
  return NextResponse.json({ kind, error: message[kind] }, { status: status ?? { invalid: 400, forbidden: 403, conflict: 409, unavailable: 503, missing: 404 }[kind], headers });
}
async function accessFor(request: NextRequest, campaignId: string) {
  const client = await createClient(), { data: { user } } = await client.auth.getUser();
  if (!user) return { response: failure("forbidden", 401) };
  const access = await loadCampaignAccess(client, campaignId, user.id, "engagement.write");
  if (access.error) return { response: failure("unavailable") };
  if (!access.campaign || !access.allowed) return { response: failure("forbidden") };
  const workspaceId = access.campaign.workspace_id;
  if ((request.headers.has("x-openplan-expected-user") && request.headers.get("x-openplan-expected-user") !== user.id)
    || (request.headers.has("x-openplan-expected-workspace") && request.headers.get("x-openplan-expected-workspace") !== workspaceId)) return { response: failure("forbidden") };
  return { client, user, workspaceId };
}

/** Staff send a small bound command; preparation and complete resulting revisions are computed on the server. */
export async function POST(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("engagement.synthesis-review.post", request);
  try {
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) return failure("invalid");
    if (["x-openplan-assistant-execution-source", "x-openplan-assistant-input-hash", "x-openplan-assistant-approval-id"].some(key => request.headers.has(key))) return failure("forbidden");
    try { requireProviderBrowserOrigin(request); } catch { return failure("forbidden"); }
    const bytes = await readBytesWithLimitStreaming(request, 65_536);
    if (!bytes.ok) { bytes.response.headers.set("Cache-Control", headers["Cache-Control"]); return bytes.response; }
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.bytes)); } catch { return failure("invalid"); }
    const intent = synthesisReviewIntentSchema.safeParse(raw);
    if (!intent.success) return failure("invalid");
    const access = await accessFor(request, params.data.campaignId);
    if (access.response) return access.response;
    if (intent.data.actorId !== access.user.id || intent.data.workspaceId !== access.workspaceId) return failure("forbidden");
    const receipt = await retainSynthesisReview(access.client, createServiceRoleClient(), params.data.campaignId, intent.data);
    audit.info("synthesis_review_retained", { campaignId: receipt.campaignId, reviewId: receipt.reviewId, requestId: receipt.requestId, revisionSha256: receipt.revisionSha256, replayed: receipt.replayed });
    return NextResponse.json(receipt, { status: receipt.replayed ? 200 : 201, headers });
  } catch (error) {
    audit.error("synthesis_review_unconfirmed");
    return failure(error instanceof SynthesisReviewError ? error.kind : "unavailable");
  }
}

const querySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("read"), reviewId: uuid, revisionId: uuid.optional() }).strict(),
  z.object({ mode: z.literal("reviews"), sourceId: uuid, beforeId: uuid.optional(), beforeCreatedAt: z.string().datetime({ offset: true }).optional() }).strict(),
  z.object({ mode: z.literal("revisions"), reviewId: uuid, before: z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().positive().max(2_147_483_647)).optional() }).strict(),
]);
/** All review text and history remain private, including draft titles and correction reasons. */
export async function GET(request: NextRequest, context: Context) {
  try {
    const params = paramsSchema.safeParse(await context.params), entries = [...request.nextUrl.searchParams];
    const query = querySchema.safeParse(Object.fromEntries(entries));
    if (!params.success || !query.success || new Set(entries.map(([key]) => key)).size !== entries.length) return failure("invalid");
    if (query.data.mode === "reviews" && Boolean(query.data.beforeId) !== Boolean(query.data.beforeCreatedAt)) return failure("invalid");
    const access = await accessFor(request, params.data.campaignId);
    if (access.response) return access.response;
    const scope = { campaignId: params.data.campaignId, workspaceId: access.workspaceId };
    if (query.data.mode === "read") {
      const saved = await loadSynthesisReview(access.client, { ...scope, reviewId: query.data.reviewId, revisionId: query.data.revisionId });
      if (!saved) return failure("missing");
      const { source: _source, ...review } = saved;
      return NextResponse.json(review, { headers });
    }
    const result = query.data.mode === "reviews"
      ? await access.client.rpc("list_engagement_synthesis_reviews", { p_campaign: scope.campaignId, p_source: query.data.sourceId,
        p_before: query.data.beforeId ? { id: query.data.beforeId, createdAt: query.data.beforeCreatedAt } : null })
      : await access.client.rpc("list_engagement_synthesis_review_revisions", { p_campaign: scope.campaignId, p_review: query.data.reviewId, p_before: query.data.before ?? null });
    if (result.error) return failure(result.error.code === "42501" ? "forbidden" : "unavailable");
    const page = query.data.mode === "reviews" ? synthesisReviewListSchema.parse(result.data) : synthesisReviewRevisionListSchema.parse(result.data);
    if (page.campaignId !== scope.campaignId || page.workspaceId !== scope.workspaceId
      || (query.data.mode === "reviews" && (!('sourceId' in page) || page.sourceId !== query.data.sourceId))
      || (query.data.mode === "revisions" && (!('reviewId' in page) || page.reviewId !== query.data.reviewId))) throw new Error("Saved review history scope differs");
    return NextResponse.json(page, { headers });
  } catch (error) { return failure(error instanceof SynthesisReviewError ? error.kind : "unavailable"); }
}
