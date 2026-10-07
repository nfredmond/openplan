import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { readSynthesisProgress } from "@/lib/engagement/synthesis-progress-server";
import { SynthesisGenerationRequestError } from "@/lib/engagement/synthesis-generation-requests-server";

const id = z.string().uuid();
const querySchema = z.object({ requestId: id, stage: z.enum(["segment", "context", "thematic"]) }).strict();
const headers = { "Cache-Control": "private, no-store" };
const failure = (status: number) => NextResponse.json({ error: status === 400 ? "Review the saved analysis request."
  : status === 401 || status === 403 ? "Current staff access in the selected account and workspace is required."
  : "Analysis results could not be confirmed. Refresh this read; unavailable results do not mean no work occurred." }, { status, headers });

/** Read selected original outputs without starting, retrying or approving work. */
export async function GET(request: NextRequest, context: { params: Promise<{ campaignId: string }> }) {
  const audit = createApiAuditLogger("engagement.synthesis-progress", request);
  try {
    const params = z.object({ campaignId: id }).safeParse(await context.params), entries = [...request.nextUrl.searchParams];
    const query = querySchema.safeParse(Object.fromEntries(entries));
    if (!params.success || !query.success || new Set(entries.map(([key]) => key)).size !== entries.length) return failure(400);
    const client = await createClient(), { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return failure(401);
    const campaignId = params.data.campaignId;
    const access = await loadCampaignAccess(client, campaignId, user.id, "engagement.write");
    if (access.error) return failure(503);
    if (!access.campaign || !access.allowed) return failure(403);
    const workspaceId = access.campaign.workspace_id;
    if (request.headers.get("x-openplan-expected-user") !== user.id || request.headers.get("x-openplan-expected-workspace") !== workspaceId) return failure(403);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
    signal.throwIfAborted();
    const result = await readSynthesisProgress(client, createServiceRoleClient(), { ...query.data, campaignId, workspaceId }, signal);
    signal.throwIfAborted();
    audit.info("results_read", { requestId: query.data.requestId, stage: query.data.stage });
    return NextResponse.json(result, { headers });
  } catch (cause) {
    const status = cause instanceof SynthesisGenerationRequestError ? cause.status : 503;
    audit.warn("results_unconfirmed", { status });
    return failure(status);
  }
}
