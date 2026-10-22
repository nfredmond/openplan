import { z } from "zod";
import { parseChatRpcResult } from "./provider-chat-rpc";
import { canonicalChat } from "./provider-chat-task";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { assistantApprovalActionSchema, hashAssistantActionPayload } from "./action-approval-server";
import { executableProjectSubmittalAction, type ProjectSubmittalAction } from "./project-submittal-receipt";
import { providerRpcError, ProviderRequestError } from "./provider-server";
import type { ChatSession } from "./provider-chat-projection";

export const chatApprovalBindingSchema = z.object({ intentId: z.string().uuid(), approvalRequestId: z.string().uuid(),
  expectedExecutableHash: z.string().regex(/^[a-f0-9]{64}$/), expectedGrantDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type ChatApprovalBinding = z.infer<typeof chatApprovalBindingSchema>;
export async function chatIntentRpc(session: ChatSession, operation: string, intentId: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await session.rpc("assistant_chat_intent", { p_operation: operation, p_intent_id: intentId, p_payload: { canonicalPayload: canonicalChat(payload) } });
  providerRpcError(error);
  const response = parseChatRpcResult(data);
  if (response.released === false) throw new ProviderRequestError("chat_intent_body_unavailable", 409);
  return response;
}
export async function issueChatIntentApproval(session: ChatSession, raw: ChatApprovalBinding, args: {
  action: ProjectSubmittalAction; inputHash: string; workspaceId: string; approvalId: string; expiresAt: string; executionContext: unknown;
}) {
  const binding = chatApprovalBindingSchema.parse(raw), action = executableProjectSubmittalAction(args.action);
  const executableCanonical = canonicalizeActionPayload(action);
  if (hashAssistantActionPayload(action) !== binding.expectedExecutableHash || args.inputHash !== binding.expectedExecutableHash) throw new ProviderRequestError("chat_approval_action_mismatch", 409);
  // The atomic RPC reconstructs current workspace/project/write authority and
  // context, inserts the human approval and binds the original ID together.
  return chatIntentRpc(session, "issue", binding.intentId, { ...binding, executableCanonical, approvalId: args.approvalId,
    expiresAt: args.expiresAt, executionContext: args.executionContext, workspaceId: args.workspaceId });
}
export type ChatIntentReview = { intentId: string; workspaceId: string; action: ProjectSubmittalAction; executableHash: string; grantDigest: string };
export async function readChatIntentReview(session: ChatSession, intentId: string): Promise<ChatIntentReview | null> {
  const response = await chatIntentRpc(session, "read", intentId);
  const intent = z.object({ id: z.string().uuid(), workspace_id: z.string().uuid(), executable_canonical: z.string(), executable_hash: z.string(), grant_digest: z.string(),
    state: z.string(), original_approval_id: z.string().uuid().nullable(), execution_state: z.string() }).passthrough().parse(response.intent);
  if (intent.state !== "proposed" || intent.original_approval_id || intent.execution_state !== "not_requested") return null;
  const parsed = assistantApprovalActionSchema.parse(JSON.parse(intent.executable_canonical));
  if (parsed.kind !== "create_project_record") throw new Error("chat_intent_executable_mismatch");
  const action = executableProjectSubmittalAction(parsed);
  if ((action.status ?? "draft") !== "draft" || hashAssistantActionPayload(action) !== intent.executable_hash || canonicalizeActionPayload(action) !== intent.executable_canonical) throw new Error("chat_intent_executable_mismatch");
  return { intentId: intent.id, workspaceId: intent.workspace_id, action, executableHash: intent.executable_hash, grantDigest: intent.grant_digest };
}
