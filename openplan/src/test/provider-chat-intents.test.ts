import { canonicalChat } from "@/lib/assistant/provider-chat-task";
import { describe, expect, it, vi } from "vitest";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { hashAssistantActionPayload } from "@/lib/assistant/action-approval-server";
import { issueChatIntentApproval, readChatIntentReview } from "@/lib/assistant/provider-chat-intents";
import type { ChatSession } from "@/lib/assistant/provider-chat-projection";
import { executableProjectSubmittalAction, type ProjectSubmittalAction } from "@/lib/assistant/project-submittal-receipt";
import { chatIds as id } from "./fixtures/provider-chat-fixture";
const wire = (value: unknown) => ({ wireVersion: 1, canonicalResult: canonicalChat(value) });
const action: ProjectSubmittalAction = { kind: "create_project_record", projectId: id.project, recordType: "submittal", title: "Synthetic draft", submittalType: "other", status: "draft" };
describe("original intent association", () => {
 it("uses the session atomic issuance with exact normalized action, grant and original context", async () => {
  const hash = hashAssistantActionPayload(action), rpc = vi.fn(async () => ({ data: wire({ approvalId: id.accept, inputHash: hash, expiresAt: "2099-01-01T00:00:00Z", replayed: true }), error: null }));
  const session = { rpc } as unknown as ChatSession, context = { version: 1, action: executableProjectSubmittalAction(action), project: { id: id.project, workspaceId: id.workspace, name: "Synthetic project" } };
  const binding = { intentId: id.call, approvalRequestId: id.request, expectedExecutableHash: hash, expectedGrantDigest: "a".repeat(64) };
  const result = await issueChatIntentApproval(session, binding, { action, workspaceId: id.workspace, inputHash: hash, approvalId: id.accept, expiresAt: "2099-01-01T00:00:00Z", executionContext: context });
  expect(result).toMatchObject({ approvalId: id.accept, replayed: true });
  expect(rpc).toHaveBeenCalledWith("assistant_chat_intent", { p_operation: "issue", p_intent_id: id.call, p_payload: { canonicalPayload: canonicalChat({ ...binding, executableCanonical: canonicalizeActionPayload(executableProjectSubmittalAction(action)), approvalId: id.accept,
   expiresAt: "2099-01-01T00:00:00Z", workspaceId: id.workspace, executionContext: context }) } });
  await expect(issueChatIntentApproval(session, { ...binding, expectedExecutableHash: "b".repeat(64) }, { action, workspaceId: id.workspace, inputHash: hash, approvalId: id.accept, expiresAt: "2099-01-01T00:00:00Z", executionContext: context })).rejects.toThrow("chat_approval_action_mismatch");
  expect(rpc).toHaveBeenCalledTimes(1);
 });
 it.each([
  { submittalType: "other" as const, status: "draft" as const, notes: "" },
  { submittalType: "progress_report" as const, notes: "Line 1\nLine 2\tend" },
 ])("reviews normalized executable bytes with effective draft defaults %j", async fields => {
  const normalized = executableProjectSubmittalAction({ ...action, ...fields });
  const canonical = canonicalizeActionPayload(normalized), hash = hashAssistantActionPayload(normalized);
  const rpc = vi.fn(async () => ({ data: wire({ released: true, intent: { id: id.call, workspace_id: id.workspace,
   executable_canonical: canonical, executable_hash: hash, grant_digest: "a".repeat(64), state: "proposed", original_approval_id: null, execution_state: "not_requested" } }), error: null }));
  const review = await readChatIntentReview({ rpc } as unknown as ChatSession, id.call);
  expect(review?.action).toEqual(normalized); expect(review?.executableHash).toBe(hash);
  expect(review?.action.status ?? "draft").toBe("draft");
  expect(normalized).not.toHaveProperty("status");
  if (fields.submittalType === "other") { expect(normalized).not.toHaveProperty("submittalType"); expect(normalized).not.toHaveProperty("notes"); }
 });
 it.each(["submitted", "wrong_hash", "explicit_defaults"])("refuses a proposed intent with %s", async fault => {
  const normalized = executableProjectSubmittalAction(action);
  const raw = fault === "submitted" ? { ...normalized, status: "submitted" } : fault === "explicit_defaults" ? action : normalized;
  const rpc = vi.fn(async () => ({ data: wire({ released: true, intent: { id: id.call, workspace_id: id.workspace,
   executable_canonical: canonicalizeActionPayload(raw), executable_hash: fault === "wrong_hash" ? "b".repeat(64) : hashAssistantActionPayload(raw), grant_digest: "a".repeat(64), state: "proposed", original_approval_id: null, execution_state: "not_requested" } }), error: null }));
  await expect(readChatIntentReview({ rpc } as unknown as ChatSession, id.call)).rejects.toThrow("chat_intent_executable_mismatch");
 });
 it.each(["approved", "execution_requested", "reconciling", "succeeded", "expired"])("does not return a fresh actionable card for %s", async state => {
  const rpc = vi.fn(async () => ({ data: wire({ released: true, intent: { id: id.call, workspace_id: id.workspace, executable_canonical: canonicalizeActionPayload(action), executable_hash: hashAssistantActionPayload(action), grant_digest: "a".repeat(64), state,
   original_approval_id: id.accept, execution_state: "uncertain" } }), error: null }));
  expect(await readChatIntentReview({ rpc } as unknown as ChatSession, id.call)).toBeNull();
 });
 it("does not convert unavailable body/status into permission", async () => {
  const rpc = vi.fn(async () => ({ data: wire({ released: false }), error: null }));
  await expect(readChatIntentReview({ rpc } as unknown as ChatSession, id.call)).rejects.toThrow("chat_intent_body_unavailable");
 });
});
