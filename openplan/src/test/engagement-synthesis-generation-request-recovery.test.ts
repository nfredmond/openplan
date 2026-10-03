import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { inspectSynthesisGenerationRequest } from "@/lib/engagement/synthesis-generation-request-browser";
import { readPendingSynthesisGeneration, retainPendingSynthesisGeneration, sendPendingSynthesisGeneration,
  preservePendingSynthesisGeneration, listPreservedSynthesisGeneration,
  type PendingSynthesisGenerationCommand } from "@/lib/engagement/synthesis-generation-request-recovery";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { userId: uuid(1), workspaceId: uuid(2), campaignId: uuid(3), sourceId: uuid(4), sourceSha256: "a".repeat(64) };
const requestId = uuid(5), cancellationId = uuid(6), date = "2026-10-02T12:00:00.000Z";
const intent = { schemaVersion: 1, sourceId: scope.sourceId, sourceSha256: scope.sourceSha256, connectionId: uuid(7),
  configurationRevisionId: uuid(8), configurationHash: "b".repeat(64), modelId: "synthetic-日本語", taskByteLimit: 4096 };
const intentText = JSON.stringify(intent, null, 2) + "\n";
const pending: PendingSynthesisGenerationCommand = { version: 1, ...scope, intentText, command: { operation: "create", requestId, intentText } };
const cancelled: PendingSynthesisGenerationCommand = { ...pending, command: { operation: "cancel", requestId, cancellationId, reason: "SYNTHETIC stop 日本語 é " } };
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function state(exists = true, cancellation = false) {
  const receiptText = JSON.stringify({ schemaVersion: 1, id: cancellationId, requestId, campaignId: scope.campaignId,
    workspaceId: scope.workspaceId, actorId: scope.userId, reason: cancelled.command.operation === "cancel" ? cancelled.command.reason : "",
    requestExisted: exists, cancelledAt: date });
  return { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId,
    request: exists ? { id: requestId, actorId: scope.userId, intentText, intentSha256: digest(intentText), createdAt: date } : null,
    cancellation: cancellation ? { id: cancellationId, receiptText, receiptSha256: digest(receiptText), createdAt: date } : null, replayed: true };
}
class Store {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem = vi.fn((name: string) => this.data.get(name) ?? null);
  setItem = vi.fn((name: string, value: string) => { this.data.set(name, value); });
  removeItem = vi.fn((name: string) => { this.data.delete(name); });
}
function retained(value = pending) { const storage = new Store(); retainPendingSynthesisGeneration(storage, value); return storage; }
const response = (body: unknown = state(), status = 200) => new Response(JSON.stringify(body), { status });
const read = (storage: Store, operation: "create" | "cancel" = "create") => readPendingSynthesisGeneration(storage, scope, operation);

describe("generation request browser recovery", () => {
  it("preserves exact intent whitespace and independent creation/cancellation slots", () => {
    const storage = retained(); retainPendingSynthesisGeneration(storage, cancelled);
    expect(read(storage)).toEqual(pending); expect(read(storage, "cancel")).toEqual(cancelled);
    expect(read(storage)?.intentText).toBe(intentText);
    const different = { ...pending, intentText: JSON.stringify(intent), command: { operation: "create" as const, requestId, intentText: JSON.stringify(intent) } };
    expect(() => retainPendingSynthesisGeneration(storage, different)).toThrow("Another generation");
  });
  it("separates account, workspace, campaign and source and detects changed source hashes", () => {
    const storage = retained();
    for (const field of ["userId", "workspaceId", "campaignId", "sourceId"] as const) {
      expect(readPendingSynthesisGeneration(storage, { ...scope, [field]: uuid(99) }, "create")).toBeNull();
    }
    expect(() => readPendingSynthesisGeneration(storage, { ...scope, sourceSha256: "c".repeat(64) }, "create")).toThrow("another source");
    const name = storage.key(0)!;
    for (const field of ["userId", "workspaceId", "campaignId"] as const) {
      storage.data.set(name, JSON.stringify({ ...pending, [field]: uuid(99) })); expect(() => read(storage)).toThrow("another source");
    }
    storage.data.set(name, JSON.stringify(cancelled)); expect(() => read(storage)).toThrow("operation");
  });
  it("refuses corrupt, mismatched, oversized or authority-bearing commands", () => {
    const storage = retained(), name = storage.key(0)!;
    const textCases = ["{", JSON.stringify({ ...intent, taskByteLimit: 1 }), JSON.stringify({ ...intent, sourceId: uuid(99) }),
      JSON.stringify({ ...intent, sourceSha256: "c".repeat(64) }), JSON.stringify({ ...intent, modelId: "界".repeat(160) }).padEnd(3900, " ")];
    for (const text of textCases) {
      storage.data.set(name, JSON.stringify({ ...pending, intentText: text, command: { ...pending.command, intentText: text } }));
      expect(() => read(storage)).toThrow();
    }
    for (const value of [{ ...pending, version: 2 }, { ...pending, execute: true },
      { ...pending, command: { ...pending.command, execute: true } },
      { ...pending, command: { ...pending.command, intentText: JSON.stringify(intent) } },
      { ...cancelled, command: { ...cancelled.command, reason: "  " } }]) expect(() => retainPendingSynthesisGeneration(new Store(), value as PendingSynthesisGenerationCommand)).toThrow();
  });
  it.each([pending, cancelled])("retries identical $command.operation bytes after a lost acknowledgement", async value => {
    const storage = retained(value), transport = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("SYNTHETIC lost reply"))
      .mockResolvedValueOnce(response(state(true, value.command.operation === "cancel")));
    await expect(sendPendingSynthesisGeneration(storage, value, transport)).rejects.toThrow("lost reply");
    expect(read(storage, value.command.operation)).toEqual(value);
    const result = await sendPendingSynthesisGeneration(storage, value, transport);
    for (const call of transport.mock.calls) expect(call).toEqual([`/api/engagement/campaigns/${scope.campaignId}/synthesis/generation`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-openplan-expected-user": scope.userId,
        "x-openplan-expected-workspace": scope.workspaceId }, body: JSON.stringify(value.command), cache: "no-store", signal: expect.any(AbortSignal),
    }]);
    expect(result.state.replayed).toBe(true); expect(result.cleanupError).toBeNull();
    expect(read(storage, value.command.operation)).toBeNull();
  });
  it("confirms cancellation before creation without losing the uncertain creation command", async () => {
    const storage = retained(); retainPendingSynthesisGeneration(storage, cancelled);
    const result = await sendPendingSynthesisGeneration(storage, cancelled, vi.fn<typeof fetch>().mockResolvedValue(response(state(false, true))));
    expect(result.cancellation?.requestExisted).toBe(false); expect(read(storage)).toEqual(pending); expect(read(storage, "cancel")).toBeNull();
  });
  it("accepts a creation replay that has since been cancelled", async () => {
    const storage = retained(), result = await sendPendingSynthesisGeneration(storage, pending, vi.fn<typeof fetch>().mockResolvedValue(response(state(true, true))));
    expect(result.cancellation?.id).toBe(cancellationId); expect(read(storage)).toBeNull();
  });
  it("does not send absent, replaced, unreadable or unretainable commands", async () => {
    const storage = retained(), name = storage.key(0)!, transport = vi.fn<typeof fetch>();
    for (const raw of [null, "{", JSON.stringify({ ...pending, command: { ...pending.command, requestId: uuid(99) } })]) {
      if (raw === null) storage.data.clear(); else storage.data.set(name, raw);
      await expect(sendPendingSynthesisGeneration(storage, pending, transport)).rejects.toThrow();
    }
    storage.data.set(name, JSON.stringify(pending)); storage.setItem.mockImplementationOnce(() => { throw new Error("SYNTHETIC quota"); });
    await expect(sendPendingSynthesisGeneration(storage, pending, transport)).rejects.toThrow("quota");
    storage.setItem.mockImplementationOnce(() => { storage.data.set(name, "unreadable"); });
    await expect(sendPendingSynthesisGeneration(storage, pending, transport)).rejects.toThrow("could not be retained");
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 409, 503])("keeps custody after HTTP %s", async status => {
    const storage = retained();
    await expect(sendPendingSynthesisGeneration(storage, pending, vi.fn<typeof fetch>().mockResolvedValue(response({}, status)))).rejects.toMatchObject({ status });
    expect(read(storage)).toEqual(pending);
  });
  it.each(["campaign", "workspace", "id", "actor", "text", "hash", "replayed", "missing"])("refuses a changed creation %s", async field => {
    const storage = retained(), saved = state();
    if (field === "campaign") saved.campaignId = uuid(99);
    if (field === "workspace") saved.workspaceId = uuid(99);
    if (field === "id") saved.request!.id = uuid(99);
    if (field === "actor") saved.request!.actorId = uuid(99);
    if (field === "text") { saved.request!.intentText = JSON.stringify(intent); saved.request!.intentSha256 = digest(saved.request!.intentText); }
    if (field === "hash") saved.request!.intentSha256 = "c".repeat(64);
    const raw = field === "replayed" ? { ...saved, replayed: undefined } : field === "missing" ? state(false, true) : saved;
    await expect(sendPendingSynthesisGeneration(storage, pending, vi.fn<typeof fetch>().mockResolvedValue(response(raw)))).rejects.toThrow();
    expect(read(storage)).toEqual(pending);
  });
  it.each(["hash", "id", "requestId", "campaignId", "workspaceId", "actorId", "reason", "requestExisted", "missing"])("refuses a changed cancellation %s", async field => {
    const storage = retained(cancelled), saved = state(false, true), receipt = JSON.parse(saved.cancellation!.receiptText);
    if (field === "hash") saved.cancellation!.receiptSha256 = "c".repeat(64);
    else if (field !== "missing") {
      receipt[field] = field === "reason" ? "Changed reason" : field === "requestExisted" ? true : uuid(99);
      saved.cancellation!.receiptText = JSON.stringify(receipt); saved.cancellation!.receiptSha256 = digest(saved.cancellation!.receiptText);
      if (field === "id") saved.cancellation!.id = uuid(99);
    }
    await expect(sendPendingSynthesisGeneration(storage, cancelled,
      vi.fn<typeof fetch>().mockResolvedValue(response(field === "missing" ? state() : saved)))).rejects.toThrow();
    expect(read(storage, "cancel")).toEqual(cancelled);
  });
  it("verifies portable receipt structure and both original hashes", async () => {
    const expected = { campaignId: scope.campaignId, workspaceId: scope.workspaceId, requestId };
    expect((await inspectSynthesisGenerationRequest(state(true, true), expected)).intent).toEqual(intent);
    for (const raw of [null, {}, state(false)]) await expect(inspectSynthesisGenerationRequest(raw, expected)).rejects.toThrow();
    const invalid = state(); invalid.request!.intentText = JSON.stringify({ ...intent, taskByteLimit: 1 });
    invalid.request!.intentSha256 = digest(invalid.request!.intentText);
    await expect(inspectSynthesisGenerationRequest(invalid, expected)).rejects.toThrow();
    const over = state(); over.request!.intentText = JSON.stringify({ ...intent, modelId: "界".repeat(160) }).padEnd(3900, " ");
    over.request!.intentSha256 = digest(over.request!.intentText);
    await expect(inspectSynthesisGenerationRequest(over, expected)).rejects.toThrow("bytes differ");
    const different = state(true, true); different.cancellation!.id = uuid(99);
    await expect(inspectSynthesisGenerationRequest(different, expected)).rejects.toThrow("cancellation scope differs");
    const actor = state(true, true); actor.request!.actorId = uuid(99);
    await expect(inspectSynthesisGenerationRequest(actor, expected)).rejects.toThrow("cancellation scope differs");
  });
  it("retains custody when aborted before send, after transport, while reading or while hashing", async () => {
    for (const when of ["before", "transport", "body", "hash"]) {
      const storage = retained(), controller = new AbortController(), reply = response(), readBody = vi.spyOn(reply, "json");
      if (when === "before") controller.abort(new Error("SYNTHETIC abort"));
      const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
      const hashSpy = vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => {
        const result = await originalDigest(...args);
        if (when === "hash") controller.abort(new Error("SYNTHETIC abort"));
        return result;
      });
      const transport = vi.fn<typeof fetch>().mockImplementation(async () => {
        if (when === "transport") controller.abort(new Error("SYNTHETIC abort"));
        if (when === "body") readBody.mockImplementation(async () => { controller.abort(new Error("SYNTHETIC abort")); return state(); });
        return reply;
      });
      try {
        await expect(sendPendingSynthesisGeneration(storage, pending, transport, controller.signal)).rejects.toThrow("SYNTHETIC abort");
        expect(transport).toHaveBeenCalledTimes(when === "before" ? 0 : 1);
        expect(readBody).toHaveBeenCalledTimes(["body", "hash"].includes(when) ? 1 : 0);
        expect(hashSpy).toHaveBeenCalledTimes(when === "hash" ? 1 : 0);
        expect(read(storage)).toEqual(pending);
      } finally { hashSpy.mockRestore(); }
    }
  });
  it("uses a thirty-second deadline and rejects a late success", async () => {
    const storage = retained(), controller = new AbortController(), timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(controller.signal);
    try {
      const transport = vi.fn<typeof fetch>().mockImplementation(async () => { controller.abort(); return response(); });
      await expect(sendPendingSynthesisGeneration(storage, pending, transport)).rejects.toThrow();
      expect(timeout).toHaveBeenCalledWith(30_000); expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true); expect(read(storage)).toEqual(pending);
    } finally { timeout.mockRestore(); }
  });
  it("distinguishes failed cleanup and preserves a replacement command", async () => {
    const storage = retained(); storage.removeItem.mockImplementationOnce(() => undefined);
    const result = await sendPendingSynthesisGeneration(storage, pending, vi.fn<typeof fetch>().mockResolvedValue(response()));
    expect(result.cleanupError).toContain("command confirmed"); expect(read(storage)).toEqual(pending);
    const replacement = { ...pending, command: { ...pending.command, requestId: uuid(99) } }, name = storage.key(0)!;
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => { storage.data.set(name, JSON.stringify(replacement)); return response(); });
    expect((await sendPendingSynthesisGeneration(storage, pending, transport)).cleanupError).toContain("cleanup failed");
    expect(read(storage)).toEqual(replacement);
  });
  it("archives unreadable originals and newer memory without clearing the other operation", () => {
    const storage = retained(), name = storage.key(0)!; retainPendingSynthesisGeneration(storage, cancelled);
    storage.data.set(name, "SYNTHETIC unreadable 日本語"); preservePendingSynthesisGeneration(storage, scope, "create", pending);
    expect(read(storage)).toBeNull(); expect(read(storage, "cancel")).toEqual(cancelled);
    const copies = listPreservedSynthesisGeneration(storage, scope, "create");
    expect(copies.map(copy => copy.raw)).toEqual(["SYNTHETIC unreadable 日本語", JSON.stringify(pending)]);
    expect(copies.map(copy => copy.value)).toEqual([null, pending]);
    expect(listPreservedSynthesisGeneration(storage, scope, "cancel")).toEqual([]);
    expect(listPreservedSynthesisGeneration(storage, { ...scope, userId: uuid(99) }, "create")).toEqual([]);
    expect(listPreservedSynthesisGeneration(storage, { ...scope, sourceSha256: "c".repeat(64) }, "create").map(copy => copy.value)).toEqual([null, null]);
    storage.data.set(copies[0].key, JSON.stringify(cancelled));
    expect(listPreservedSynthesisGeneration(storage, scope, "create")[0].value).toBeNull();
  });
  it("requires scoped latest memory and verified archive readback before removal", () => {
    const storage = retained(), name = storage.key(0)!;
    expect(() => preservePendingSynthesisGeneration(storage, scope, "create", cancelled)).toThrow("operation");
    expect(() => preservePendingSynthesisGeneration(storage, scope, "create", { ...pending, userId: uuid(99) })).toThrow("another source");
    storage.setItem.mockImplementationOnce(() => undefined);
    expect(() => preservePendingSynthesisGeneration(storage, scope, "create")).toThrow("could not be preserved"); expect(read(storage)).toEqual(pending);
    storage.setItem.mockImplementationOnce((archive, raw) => { storage.data.set(archive, raw); storage.data.set(name, "Changed original"); });
    expect(() => preservePendingSynthesisGeneration(storage, scope, "create")).toThrow("could not be preserved");
    expect(storage.data.get(name)).toBe("Changed original");
    storage.removeItem.mockImplementationOnce(() => undefined);
    expect(() => preservePendingSynthesisGeneration(storage, scope, "create")).toThrow("could not be moved aside");
  });
});
