import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { loadCampaignAccess } from "./api";
import { loadResponseBroadcast } from "./response-broadcast";
import { createResponseSchema, updateResponseSchema, removeResponseSchema, writeResponse } from "./response-write";
import type { ResponseWriteIntent } from "./response-write";

const campaignParams = z.object({ campaignId: z.string().uuid() });
const entryParams = campaignParams.extend({ entryId: z.string().uuid() });
const headers = { "Cache-Control": "private, no-store" };
const unconfirmed = { error: "OpenPlan could not confirm this save. Keep your words and retry the same request.", kind: "unavailable" };
type RouteContext = { params: Promise<{ campaignId: string; entryId?: string }> };

/** Shared boundary for response creates, corrections and removals; the database owns all write side effects. */
export function responseWriteRoute(
  operation: ResponseWriteIntent["operation"],
  auditForRequest: (request: NextRequest) => ReturnType<typeof createApiAuditLogger> =
    request => createApiAuditLogger(`engagement.response.${operation}`, request),
) {
  return async function handle(request: NextRequest, context: RouteContext) {
    const audit = auditForRequest(request);
    try {
      const params = (operation === "create" ? campaignParams : entryParams).safeParse(await context.params);
      if (!params.success) return NextResponse.json({ error: "Invalid identifiers", kind: "invalid" }, { status: 400, headers });
      const body = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
      if (!body.ok) return body.response;
      const schema = operation === "create" ? createResponseSchema : operation === "update" ? updateResponseSchema : removeResponseSchema;
      const parsed = schema.safeParse(body.data);
      if (!parsed.success) {
        return NextResponse.json({ error: "Review the response fields, saved version and change reason.", kind: "invalid" }, { status: 400, headers });
      }
      // Parse each operation to retain its discriminated type without accepting fields from another operation.
      const intent: ResponseWriteIntent = operation === "create"
        ? { operation, body: createResponseSchema.parse(parsed.data) }
        : operation === "update"
          ? { operation, entryId: entryParams.parse(params.data).entryId, body: updateResponseSchema.parse(parsed.data) }
          : { operation, entryId: entryParams.parse(params.data).entryId, body: removeResponseSchema.parse(parsed.data) };
      const client = await createClient();
      const { data: { user } } = await client.auth.getUser();
      if (!user) return NextResponse.json({ error: "Sign in to save this response.", kind: "forbidden" }, { status: 401, headers });
      const access = await loadCampaignAccess(client, params.data.campaignId, user.id, "engagement.write");
      if (access.error) return NextResponse.json(unconfirmed, { status: 503, headers });
      if (!access.campaign) return NextResponse.json({ error: "Campaign not found", kind: "missing" }, { status: 404, headers });
      if (!access.allowed) return NextResponse.json({ error: "Staff access required", kind: "forbidden" }, { status: 403, headers });

      const written = await writeResponse(client, params.data.campaignId, intent);
      if (written.error) {
        audit.warn("response_write_refused", { campaignId: params.data.campaignId, requestId: intent.body.requestId, kind: written.error.kind });
        return NextResponse.json({ error: written.error.message, kind: written.error.kind }, { status: written.error.status, headers });
      }
      // The receipt proves the save. A later status-read failure must not turn it into a failed save.
      const broadcast = written.result.becamePublished
        ? await loadResponseBroadcast(client, params.data.campaignId, intent.body.requestId)
        : null;
      audit.info("response_write_confirmed", {
        campaignId: params.data.campaignId, userId: user.id, requestId: written.result.requestId,
        entryId: written.result.entryId, replayed: written.result.replayed,
      });
      return NextResponse.json({
        ...written.result,
        broadcast: broadcast?.report ?? null,
        broadcastStatus: broadcast === null ? "not_required" : broadcast.error || !broadcast.report ? "unknown" : "available",
      }, { status: operation === "create" && !written.result.replayed ? 201 : 200, headers });
    } catch {
      audit.error("response_write_unconfirmed", { operation });
      return NextResponse.json(unconfirmed, { status: 503, headers });
    }
  };
}
