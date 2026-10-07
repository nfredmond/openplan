import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { readSynthesisExecutionHistory } from "@/lib/engagement/synthesis-execution-history-server";

const id = (n: number) => `c7300000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const date = "2026-10-02T12:00:00.123456+00:00";
const scope = { campaignId: id(1), workspaceId: id(2), requestId: id(3) };
function fixture() {
  const requestText = JSON.stringify({ schemaVersion: 1, sourceId: id(5), sourceSha256: "a".repeat(64),
    connectionId: id(6), configurationRevisionId: id(7), configurationHash: "b".repeat(64), modelId: "synthetic", taskByteLimit: 4096 });
  const request = { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId,
    request: { id: scope.requestId, actorId: id(4), intentText: requestText, intentSha256: hash(requestText), createdAt: date }, cancellation: null };
  const grant = { schemaVersion: 1, headerSha256: "c".repeat(64), maxAttempts: 2, maxOutputTokens: 2048,
    responseByteLimit: 65536, expiresAt: "2026-01-01T00:00:00Z", chargesAcknowledged: true, retryTaskIndex: null, retryOfAttemptId: null };
  const intentText = JSON.stringify(grant, null, 2);
  const row = { id: id(8), request_id: scope.requestId, intent_text: intentText, intent_sha256: hash(intentText), created_at: date };
  const result: { data: unknown; error: unknown } = { data: [row], error: null };
  const trace: Array<unknown[]> = [];
  const chain = {
    select(...args: unknown[]) { trace.push(["select", ...args]); return chain; },
    eq(...args: unknown[]) { trace.push(["eq", ...args]); return chain; },
    order(...args: unknown[]) { trace.push(["order", ...args]); return chain; },
    limit(...args: unknown[]) { trace.push(["limit", ...args]); return chain; },
    or(...args: unknown[]) { trace.push(["or", ...args]); return chain; },
    abortSignal: vi.fn(async () => result),
  };
  const from = vi.fn((table: string) => { trace.push(["from", table]); return chain; });
  const readRequest = vi.fn(async () => ({ data: request as unknown, error: null as null | { code: string } }));
  const client = { rpc: vi.fn(() => ({ abortSignal: readRequest })) } as unknown as Pick<SupabaseClient, "rpc">;
  const service = { from } as unknown as Pick<SupabaseClient, "from">;
  const read = (before: { id: string; createdAt: string } | null = null, signal = new AbortController().signal) =>
    readSynthesisExecutionHistory(client, service, { ...scope, before }, signal);
  return { read, row, grant, request, result, trace, from, chain, readRequest };
}

describe("saved execution authority discovery", () => {
  it("returns original expired authority without credentials or renewed permission", async () => {
    const f = fixture(), result = await f.read();
    expect(result).toMatchObject({ ...scope, actorId: id(4), sourceId: id(5), requestIntentSha256: f.request.request.intentSha256,
      cancelled: false, entries: [{ id: f.row.id, intentText: f.row.intent_text, intentSha256: f.row.intent_sha256, createdAt: date }], nextCursor: null });
    expect(f.readRequest).toHaveBeenCalledTimes(2);
    expect(f.trace).toEqual([
      ["from", "engagement_synthesis_generation_authorizations"],
      ["select", "id,request_id,intent_text,intent_sha256,created_at"],
      ["eq", "request_id", scope.requestId], ["order", "created_at", { ascending: false }],
      ["order", "id", { ascending: false }], ["limit", 26],
    ]);
    expect(JSON.stringify(result)).not.toContain("credential");
  });
  it("keeps timestamp precision and tied-row identity in the continuation cursor", async () => {
    const f = fixture(); f.result.data = Array.from({ length: 26 }, (_, index) => ({ ...f.row, id: id(100 - index) }));
    const page = await f.read();
    expect(page.entries).toHaveLength(25); expect(page.nextCursor).toEqual({ id: id(76), createdAt: date });
    f.result.data = [{ ...f.row, id: id(75) }];
    const older = await f.read(page.nextCursor);
    expect(older.nextCursor).toBeNull(); expect(older.entries[0].id).toBe(id(75));
    expect(f.trace).toContainEqual(["or", `created_at.lt."${date}",and(created_at.eq."${date}",id.lt.${id(76)})`]);
  });
  it("returns an empty page only after a successful bounded native read", async () => {
    const f = fixture(); f.result.data = [];
    expect((await f.read()).entries).toEqual([]);
    f.result.error = { message: "PRIVATE storage" };
    await expect(f.read()).rejects.toMatchObject({ status: 503 });
  });
  it("refuses service reads before current staff access", async () => {
    const f = fixture(); f.readRequest.mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(f.read()).rejects.toMatchObject({ status: 403 }); expect(f.from).not.toHaveBeenCalled();
  });
  it("refuses disclosure after access changes during the read", async () => {
    const f = fixture(); f.readRequest.mockResolvedValueOnce({ data: f.request, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    await expect(f.read()).rejects.toMatchObject({ status: 403 }); expect(f.from).toHaveBeenCalledOnce();
  });
  it("refuses a different actor in the second native read", async () => {
    const f = fixture(); f.readRequest.mockResolvedValueOnce({ data: f.request, error: null })
      .mockResolvedValueOnce({ data: { ...f.request, request: { ...f.request.request, actorId: id(99) } }, error: null });
    await expect(f.read()).rejects.toMatchObject({ status: 503 });
  });
  it("retains cancellation arriving during the grant read without hiding old authority", async () => {
    const f = fixture();
    const receiptText = JSON.stringify({ schemaVersion: 1, id: id(20), ...scope, actorId: id(4),
      reason: "SYNTHETIC cancellation", requestExisted: true, cancelledAt: date });
    const cancellation = { id: id(20), receiptText, receiptSha256: hash(receiptText), createdAt: date };
    f.readRequest.mockResolvedValueOnce({ data: f.request, error: null })
      .mockResolvedValueOnce({ data: { ...f.request, cancellation }, error: null });
    const page = await f.read(); expect(page.cancelled).toBe(true); expect(page.entries).toHaveLength(1);
  });
  it.each(["request", "hash", "intent", "retry", "duplicate", "oversized", "extra-column"])("refuses inconsistent private grant data: %s", async kind => {
    const f = fixture();
    if (kind === "request") f.row.request_id = id(99);
    if (kind === "hash") f.row.intent_sha256 = "d".repeat(64);
    if (kind === "intent") f.row.intent_text = "not JSON";
    if (kind === "retry") { f.row.intent_text = JSON.stringify({ ...f.grant, retryTaskIndex: 1 }); f.row.intent_sha256 = hash(f.row.intent_text); }
    if (kind === "duplicate") f.result.data = [f.row, f.row];
    if (kind === "oversized") f.result.data = Array.from({ length: 27 }, (_, index) => ({ ...f.row, id: id(index + 100) }));
    if (kind === "extra-column") f.result.data = [{ ...f.row, credential_sha256: "d".repeat(64) }];
    await expect(f.read()).rejects.toThrow();
  });
  it("refuses a cancelled transport before service access", async () => {
    const f = fixture(); await expect(f.read(null, AbortSignal.abort())).rejects.toThrow();
    expect(f.from).not.toHaveBeenCalled(); expect(f.readRequest).not.toHaveBeenCalled();
  });
  it("discards a private response arriving after cancellation of the read", async () => {
    const f = fixture(), controller = new AbortController();
    f.chain.abortSignal.mockImplementation(async () => { controller.abort(); return f.result; });
    await expect(f.read(null, controller.signal)).rejects.toThrow();
    expect(f.readRequest).toHaveBeenCalledTimes(1);
  });
});
