import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { loadCampaignAccess } from "@/lib/engagement/api";
import { loadSynthesisThematicHistory } from "@/lib/engagement/synthesis-thematic-history-server";
import { assertThematicBrowserScope, thematicPreviewSchema, thematicRequestPageSchema } from "@/lib/engagement/synthesis-thematic-browser";

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = { sourceId: id, sourceSha256: hash };
const querySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("list"), ...scope, beforeId: id.optional(), beforeCreatedAt: z.string().datetime({ offset: true }).optional() }).strict(),
  z.object({ mode: z.literal("preview"), ...scope, requestId: id,
    throughSequence: z.string().regex(/^(0|[1-9][0-9]*)$/).transform(Number).pipe(z.number().int().nonnegative().safe()).optional(),
  }).strict(),
]);
const headers = { "Cache-Control": "private, no-store" };
const failure = (status: number, error: string) => NextResponse.json({ error }, { status, headers });
type Context = { params: Promise<{ campaignId: string }> };

/** Browse private request metadata, then replay one selected original under
 * current staff access. Reading never dispatches a provider or changes a review.
 */
export async function GET(request: NextRequest, context: Context) {
  const audit = createApiAuditLogger("engagement.synthesis-proposals.read", request);
  try {
    const params = z.object({ campaignId: id }).safeParse(await context.params), entries = [...request.nextUrl.searchParams];
    const query = querySchema.safeParse(Object.fromEntries(entries));
    if (!params.success || !query.success || new Set(entries.map(([key]) => key)).size !== entries.length) return failure(400, "Review the saved source and proposal selection.");
    if (query.data.mode === "list" && Boolean(query.data.beforeId) !== Boolean(query.data.beforeCreatedAt)) return failure(400, "Use the complete saved history cursor.");
    const client = await createClient(), { data: { user } } = await client.auth.getUser();
    if (!user) return failure(401, "Sign in to inspect private proposal history.");
    const access = await loadCampaignAccess(client, params.data.campaignId, user.id, "engagement.write");
    if (access.error) return failure(503, "Campaign access could not be confirmed. Retry this read.");
    if (!access.campaign || !access.allowed) return failure(403, "Current staff campaign access is required.");
    const workspaceId = access.campaign.workspace_id;
    if ((request.headers.has("x-openplan-expected-user") && request.headers.get("x-openplan-expected-user") !== user.id)
      || (request.headers.has("x-openplan-expected-workspace") && request.headers.get("x-openplan-expected-workspace") !== workspaceId)) return failure(403, "The current account or workspace changed. Reopen the consultation.");
    const selected = { campaignId: params.data.campaignId, workspaceId, sourceId: query.data.sourceId, sourceSha256: query.data.sourceSha256 };
    if (query.data.mode === "list") {
      const result = await client.rpc("list_engagement_synthesis_thematic_requests", { p_campaign: selected.campaignId, p_source: selected.sourceId,
        p_before: query.data.beforeId ? { id: query.data.beforeId, createdAt: query.data.beforeCreatedAt } : null }).abortSignal(request.signal);
      if (result.error) return failure(result.error.code === "42501" ? 403 : 503, "Saved proposal history could not be read. Check access and retry.");
      const page = thematicRequestPageSchema.parse(result.data);
      assertThematicBrowserScope(page, selected);
      if (new Set(page.entries.map(row => row.requestId)).size !== page.entries.length
        || (page.nextCursor && (page.entries.length !== 25 || page.nextCursor.id !== page.entries.at(-1)?.requestId
          || page.nextCursor.createdAt !== page.entries.at(-1)?.createdAt))) throw new Error("Thematic history cursor differs");
      audit.info("history_listed", { entries: page.entries.length, hasMore: page.nextCursor !== null });
      return NextResponse.json(page, { headers });
    }
    const history = await loadSynthesisThematicHistory(client, createServiceRoleClient(), {
      campaignId: selected.campaignId, workspaceId, requestId: query.data.requestId, throughSequence: query.data.throughSequence,
    }, request.signal);
    if (history.request.intent.sourceId !== selected.sourceId || history.request.intent.sourceSha256 !== selected.sourceSha256
      || history.manifest.campaignId !== selected.campaignId || history.manifest.workspaceId !== workspaceId
      || history.manifest.requestId !== query.data.requestId) throw new Error("Thematic preview belongs to another retained source");
    const finalCaptureSha256 = history.entries.at(-1)?.captureSha256;
    const origin = history.proposal && history.manifest.status === "proposal_complete" && history.manifest.throughSequence !== null && finalCaptureSha256
      ? { interpretation: history.interpretation, proposalText: history.proposal.canonical, historyText: history.canonical,
        reference: { requestId: query.data.requestId, selectionSequence: history.manifest.throughSequence,
          historyManifestSha256: history.sha256, proposalSha256: history.proposal.sha256, finalCaptureSha256 } }
      : null;
    if ((history.manifest.status === "proposal_complete") !== Boolean(origin)
      || (query.data.throughSequence !== undefined && history.manifest.throughSequence !== query.data.throughSequence)) throw new Error("Thematic preview is not the selected original");
    const preview = thematicPreviewSchema.parse({ ...selected, requestId: query.data.requestId, status: history.manifest.status,
      selectionSequence: history.manifest.throughSequence, cancelled: history.request.state.cancellation !== null, origin });
    request.signal.throwIfAborted();
    audit.info("proposal_inspected", { status: preview.status });
    return NextResponse.json(preview, { headers });
  } catch {
    audit.warn("proposal_read_unavailable");
    return failure(503, "OpenPlan could not reconstruct this proposal. Keep your saved selection and retry; an unavailable result is not an empty proposal.");
  }
}
