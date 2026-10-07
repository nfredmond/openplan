// @vitest-environment node
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { enqueueSynthesisExecution } from "../lib/engagement/synthesis-execution-queue-server";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const command = { schemaVersion: 1, queueId: id(1), authorizationId: id(2), authorizationIntentSha256: "a".repeat(64),
  campaignId: id(3), workspaceId: id(4), requestId: id(5), actorId: id(6), sourceId: id(7),
  sourceSha256: "b".repeat(64), requestIntentSha256: "c".repeat(64), stage: "segment" };
const commandText = JSON.stringify(command, null, 2);
const args = { commandText, campaignId: command.campaignId, workspaceId: command.workspaceId, actorId: command.actorId };
const receipt = { schemaVersion: 1, queueId: command.queueId, commandText,
  commandSha256: createHash("sha256").update(commandText).digest("hex"), createdAt: "2026-10-07T23:00:00Z" };
function client(data: unknown = receipt, code?: string, after?: () => void) {
  const rpc = vi.fn(() => ({ abortSignal: vi.fn(async () => { after?.(); return { data, error: code ? { code } : null }; }) }));
  return { service: { rpc } as unknown as Pick<SupabaseClient, "rpc">, rpc };
}

describe("staff execution enqueue helper", () => {
  it("sends the exact command once and returns the verified receipt", async () => {
    const c = client();
    expect(await enqueueSynthesisExecution(c.service, args, new AbortController().signal)).toEqual(receipt);
    expect(c.rpc).toHaveBeenCalledExactlyOnceWith("enqueue_engagement_synthesis_execution", { p_command_text: commandText });
  });
  it.each(["campaignId", "workspaceId", "actorId"])("refuses changed current %s before writing", async field => {
    const c = client();
    await expect(enqueueSynthesisExecution(c.service, { ...args, [field]: id(99) }, new AbortController().signal))
      .rejects.toMatchObject({ kind: "forbidden", status: 403 });
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it.each([["42501", "forbidden", 403], ["PT409", "conflict", 409], ["22023", "invalid", 400], ["PT503", "unavailable", 503]])(
    "preserves the native %s refusal", async (code, kind, status) => {
      const c = client(null, String(code));
      await expect(enqueueSynthesisExecution(c.service, args, new AbortController().signal)).rejects.toMatchObject({ kind, status });
    });
  it("retains an unconfirmed outcome for a malformed receipt", async () => {
    const c = client({ ...receipt, commandSha256: "0".repeat(64) });
    await expect(enqueueSynthesisExecution(c.service, args, new AbortController().signal)).rejects.toMatchObject({ kind: "unavailable" });
    expect(c.rpc).toHaveBeenCalledTimes(1);
  });
  it("refuses invalid command bytes before transport", async () => {
    const c = client();
    await expect(enqueueSynthesisExecution(c.service, { ...args, commandText: "{" }, new AbortController().signal))
      .rejects.toMatchObject({ kind: "invalid" });
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it("does not acknowledge a result after caller cancellation", async () => {
    const controller = new AbortController();
    const c = client(receipt, undefined, () => controller.abort());
    await expect(enqueueSynthesisExecution(c.service, args, controller.signal)).rejects.toThrow();
    expect(c.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not write after an earlier cancellation", async () => {
    const controller = new AbortController(); controller.abort(); const c = client();
    await expect(enqueueSynthesisExecution(c.service, args, controller.signal)).rejects.toThrow();
    expect(c.rpc).not.toHaveBeenCalled();
  });
});
