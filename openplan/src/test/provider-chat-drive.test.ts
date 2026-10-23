import { canonicalChat } from "@/lib/assistant/provider-chat-task";
import { describe, expect, it, vi } from "vitest";
import { driveChatTurn } from "@/lib/assistant/provider-chat-server";
import type { ChatSession } from "@/lib/assistant/provider-chat-projection";
import { chatIds as id } from "./fixtures/provider-chat-fixture";
const model = vi.hoisted(() => vi.fn());
vi.mock("@/lib/assistant/provider-chat-worker", () => ({ runChatModelStep: model, ChatModelStepError: class extends Error {} }));
describe("read-only recovery never restarts a consumed turn", () => {
 it.each(["running", "uncertain", "succeeded", "access_lost", "cancelled"])("duplicate drive for %s returns retained state without a model invocation", async state => {
  model.mockClear(); const rpc = vi.fn(async (_name: string, args: { p_operation: string }) => ({ data: { wireVersion: 1, canonicalResult: canonicalChat(args.p_operation === "start" ? { started: false, state } : { turnId: id.turn, state }) }, error: null }));
  expect(await driveChatTurn({ rpc } as unknown as ChatSession, id.user, id.turn, new AbortController().signal)).toEqual({ turnId: id.turn, state });
  expect(rpc.mock.calls.map(c => c[1].p_operation)).toEqual(["start", "metadata"]); expect(model).not.toHaveBeenCalled();
 });
});
