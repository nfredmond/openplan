import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { synthesisRequestHistoryCursorSchema, verifySynthesisRequestHistory } from "@/lib/engagement/synthesis-request-history";

const id = z.string().uuid();
const querySchema = z.object({ sourceId: id, sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  beforeId: id.optional(), beforeCreatedAt: synthesisRequestHistoryCursorSchema.shape.createdAt.optional(),
}).strict();
const headers = { "Cache-Control": "private, no-store" };
const failure = (status: number) => NextResponse.json({ error: status === 400 ? "Review the saved source and history cursor."
  : status === 401 || status === 403 ? "Current staff access in the selected account and workspace is required."
  : "Saved generation history could not be confirmed. Keep the current selection and retry this read." }, { status, headers });
type Context = { params: Promise<{ campaignId: string }> };

/** Discover all retained stages through caller-scoped native access. This route cannot queue or execute work. */
export async function GET(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("engagement.synthesis-generation.history", request);
  try {
    const params = z.object({ campaignId: id }).safeParse(await context.params), entries = [...request.nextUrl.searchParams];
    const query = querySchema.safeParse(Object.fromEntries(entries));
    if (!params.success || !query.success || new Set(entries.map(([key]) => key)).size !== entries.length
      || Boolean(query.data.beforeId) !== Boolean(query.data.beforeCreatedAt)) return failure(400);
    const client = await createClient(), { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return failure(401);
    const campaignId = params.data.campaignId;
    const access = await loadCampaignAccess(client, campaignId, user.id, "engagement.write");
    if (access.error) return failure(503);
    if (!access.campaign || !access.allowed) return failure(403);
    const workspaceId = access.campaign.workspace_id;
    if (request.headers.get("x-openplan-expected-user") !== user.id || request.headers.get("x-openplan-expected-workspace") !== workspaceId) return failure(403);
    const before = query.data.beforeId ? { id: query.data.beforeId, createdAt: query.data.beforeCreatedAt! } : null;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
    signal.throwIfAborted();
    const result = await client.rpc("list_engagement_synthesis_generation_requests", {
      p_campaign: campaignId, p_source: query.data.sourceId, p_before: before,
    }).abortSignal(signal);
    signal.throwIfAborted();
    if (result.error) return failure(result.error.code === "42501" ? 403 : result.error.code === "22023" ? 400 : 503);
    const page = verifySynthesisRequestHistory(result.data, { campaignId, workspaceId,
      sourceId: query.data.sourceId, sourceSha256: query.data.sourceSha256 }, before);
    audit.info("history_listed", { entries: page.entries.length, hasMore: page.nextCursor !== null });
    return NextResponse.json(page, { headers });
  } catch {
    audit.warn("history_unconfirmed", {});
    return failure(503);
  }
}
