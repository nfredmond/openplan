import { NextRequest } from "next/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { checkedProviderTurn, PROVIDER_TURN_COLUMNS, ProviderRequestError, providerBearer, providerBody, providerError, providerJson, providerRpcError } from "@/lib/assistant/provider-server";
import { parseProviderProjectAnswer, PROVIDER_PROJECT_INSTRUCTIONS, providerProjectOutputSchema, providerProjectPrompt } from "@/lib/assistant/provider-project-task";

const receiptSchema = z.object({ schemaVersion: z.literal(1), provider: z.literal("codex"), model: z.string().min(1).max(160),
  authMode: z.enum(["chatgpt", "apiKey"]), planType: z.string().max(120).nullable(), threadId: z.string().min(1).max(160), turnId: z.string().min(1).max(160) }).strict();
const requestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("claim"), authMode: z.enum(["chatgpt", "apiKey"]).nullable(), status: z.enum(["connected", "needs_login", "unavailable"]) }).strict(),
  z.object({ operation: z.literal("status"), turnId: z.string().uuid() }).strict(),
  z.object({ operation: z.literal("finish"), turnId: z.string().uuid(), attemptId: z.string().uuid(),
    answer: z.string().max(64_000).nullable(), receipt: receiptSchema.nullable(), failureCode: z.string().regex(/^[a-z_]{1,120}$/).nullable() }).strict(),
]);

// This endpoint accepts only the scoped connector bearer. It has no cookie
// session fallback, tool dispatcher, business-write method or caller-chosen URL.
export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("assistant.providers.native.post", request);
  try {
    const { connectionId, tokenHash } = providerBearer(request);
    const body = await providerBody(request, requestSchema);
    const service = createServiceRoleClient();
    if (body.operation === "claim") {
      const { data, error } = await service.rpc("claim_assistant_provider_turn", { p_connection_id: connectionId,
        p_token_hash: tokenHash, p_auth_mode: body.authMode, p_status: body.status });
      providerRpcError(error);
      const claimed = z.object({ status: z.string(), turn: z.unknown().nullable() }).parse(data);
      if (!claimed.turn) { audit.info("connector_idle"); return providerJson({ status: claimed.status, turn: null }); }
      const { turn, packet } = checkedProviderTurn({ ...z.record(z.string(), z.unknown()).parse(claimed.turn), result: null, provider_receipt: null });
      if (turn.connection_id !== connectionId || turn.provider !== "codex" || turn.auth_mode !== body.authMode || turn.state !== "running" || !turn.attempt_id) {
        throw new ProviderRequestError("provider_claim_mismatch", 409);
      }
      audit.info("request_claimed", { turnId: turn.id, attemptId: turn.attempt_id });
      return providerJson({ status: claimed.status, turn: { id: turn.id, attemptId: turn.attempt_id, workspaceId: turn.workspace_id,
        projectId: turn.project_id, model: turn.model_id, authMode: turn.auth_mode, packetCanonical: turn.packet_canonical, packetHash: turn.packet_hash,
        question: turn.question, leaseExpiresAt: turn.lease_expires_at, instructions: PROVIDER_PROJECT_INSTRUCTIONS,
        prompt: providerProjectPrompt(packet, turn.question), outputSchema: z.toJSONSchema(providerProjectOutputSchema(packet)) } });
    }
    // This locked RPC validates the bearer and current project access before
    // any service read; final delivery repeats the check in its own transaction.
    const status = await service.rpc("read_assistant_provider_turn_status", { p_turn_id: body.turnId,
      p_connection_id: connectionId, p_token_hash: tokenHash });
    providerRpcError(status.error);
    if (body.operation === "status") { audit.info("attempt_status_read", { turnId: body.turnId }); return providerJson(status.data); }
    if ((body.failureCode !== null && (body.answer !== null || body.receipt !== null)) ||
      (body.failureCode === null && (body.answer === null || body.receipt === null))) throw new ProviderRequestError("invalid_provider_result");
    const { data, error } = await service.from("assistant_provider_turns").select(PROVIDER_TURN_COLUMNS)
      .eq("id", body.turnId).eq("connection_id", connectionId).maybeSingle();
    providerRpcError(error);
    if (!data) throw new ProviderRequestError("provider_access_denied", 403);
    const { turn, packet } = checkedProviderTurn(data);
    if (turn.connection_id !== connectionId || turn.id !== body.turnId || turn.attempt_id !== body.attemptId || turn.provider !== "codex") throw new ProviderRequestError("provider_attempt_mismatch", 403);
    if (body.receipt && (body.receipt.model !== turn.model_id || body.receipt.authMode !== turn.auth_mode)) throw new ProviderRequestError("provider_receipt_mismatch", 409);
    const result = body.answer === null ? null : parseProviderProjectAnswer(packet, JSON.parse(body.answer));
    const finished = await service.rpc("finish_assistant_provider_turn", { p_turn_id: body.turnId, p_attempt_id: body.attemptId,
      p_user_id: null, p_connection_id: connectionId, p_token_hash: tokenHash, p_result: result, p_provider_receipt: body.receipt, p_failure_code: body.failureCode });
    providerRpcError(finished.error);
    const saved = checkedProviderTurn(finished.data).turn;
    audit.info("delivery_retained", { turnId: saved.id, state: saved.state });
    return providerJson({ id: saved.id, state: saved.state, attemptId: saved.attempt_id });
  } catch (error) { const response = providerError(error); audit.warn("request_refused", { status: response.status }); return response; }
}
