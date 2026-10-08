// @vitest-environment node
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { readSynthesisExecutionQueuePage } from "../lib/engagement/synthesis-execution-queue-reader";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function row(n = 1) {
  const command = { schemaVersion: 1, queueId: id(n), requestId: id(50), authorizationId: id(51), stage: "segment",
    actorId: id(52), workspaceId: id(53), campaignId: id(54), sourceId: id(55), sourceSha256: "a".repeat(64),
    requestIntentSha256: "b".repeat(64), authorizationIntentSha256: "c".repeat(64) };
  const command_text = JSON.stringify(command);
  return { id: command.queueId, request_id: command.requestId, authorization_id: command.authorizationId, stage: command.stage,
    command_text, command_sha256: createHash("sha256").update(command_text).digest("hex"), created_at: "2026-10-07T23:00:00.123456Z" };
}
function client(data: unknown, error: unknown = null, after?: () => void) {
  const query = { select: vi.fn(), order: vi.fn(), limit: vi.fn(), gt: vi.fn(), abortSignal: vi.fn() };
  for (const fn of [query.select, query.order, query.limit, query.gt]) fn.mockReturnValue(query);
  query.abortSignal.mockImplementation(async () => { after?.(); return { data, error }; });
  const from = vi.fn(() => query);
  return { service: { from } as unknown as Pick<SupabaseClient, "from">, from, query };
}
const signal = () => new AbortController().signal;
describe("bounded execution queue discovery", () => {
  it("projects custody fields and continues after a short page", async () => {
    const c = client([row(2)]);
    const result = await readSynthesisExecutionQueuePage(c.service, id(1), signal());
    expect(result.entries[0].command.queueId).toBe(id(2)); expect(result.nextCursor).toBe(id(2));
    expect(c.from).toHaveBeenCalledExactlyOnceWith("engagement_synthesis_execution_queue");
    expect(c.query.select).toHaveBeenCalledExactlyOnceWith("id,request_id,authorization_id,stage,command_text,command_sha256,created_at");
    expect(c.query.order).toHaveBeenCalledExactlyOnceWith("id", { ascending: true });
    expect(c.query.limit).toHaveBeenCalledExactlyOnceWith(32); expect(c.query.gt).toHaveBeenCalledExactlyOnceWith("id", id(1));
  });
  it("returns wrap indication only after an empty page", async () => {
    const c = client([]); expect(await readSynthesisExecutionQueuePage(c.service, null, signal())).toEqual({ entries: [], nextCursor: null });
    expect(c.query.gt).not.toHaveBeenCalled();
  });
  it.each(["request_id", "authorization_id", "stage", "command_sha256"])("rejects altered %s", async field => {
    const c = client([{ ...row(), [field]: field === "stage" ? "context" : field === "command_sha256" ? "0".repeat(64) : id(99) }]);
    await expect(readSynthesisExecutionQueuePage(c.service, null, signal())).rejects.toThrow();
  });
  it.each([[row(2), row(1)], [row(1), row(1)]])("rejects unordered or repeated rows", async (...rows) => {
    await expect(readSynthesisExecutionQueuePage(client(rows).service, null, signal())).rejects.toThrow("order differs");
  });
  it("rejects rows at or before the cursor", async () => {
    await expect(readSynthesisExecutionQueuePage(client([row(1)]).service, id(1), signal())).rejects.toThrow("order differs");
  });
  it("distinguishes unavailable inventory from empty", async () => {
    await expect(readSynthesisExecutionQueuePage(client(null, { code: "error" }).service, null, signal())).rejects.toThrow("unavailable");
  });
  it("rejects oversized pages", async () => {
    await expect(readSynthesisExecutionQueuePage(client(Array.from({ length: 33 }, (_, i) => row(i + 1))).service, null, signal())).rejects.toThrow();
  });
  it("does not return inventory after cancellation", async () => {
    const controller = new AbortController(); const c = client([row()], null, () => controller.abort());
    await expect(readSynthesisExecutionQueuePage(c.service, null, controller.signal)).rejects.toThrow();
  });
});
