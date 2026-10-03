import { describe, expect, it, vi } from "vitest";
import { readPendingSynthesisPreparation, retainPendingSynthesisPreparation, sendPendingSynthesisPreparation,
  preservePendingSynthesisPreparation, listPreservedSynthesisPreparations,
  type PendingSynthesisPreparation } from "@/lib/engagement/synthesis-preparation-recovery";
import { sourceActor, sourceDate, sourceScope } from "./fixtures/engagement/synthesis-source";

const requestId = "e0000000-0000-4000-8000-000000000001", otherId = "e0000000-0000-4000-8000-000000000002";
const scope = { userId: sourceActor, workspaceId: sourceScope.workspaceId, campaignId: sourceScope.campaignId,
  sourceId: sourceScope.requestId, sourceSha256: "a".repeat(64), requestId, intentSha256: "b".repeat(64), stage: "segment" as const };
const pending: PendingSynthesisPreparation = { version: 1, ...scope,
  command: { operation: "enqueue", requestId, stage: scope.stage, intentSha256: scope.intentSha256 } };
const retry: PendingSynthesisPreparation = { ...pending, command: { operation: "retry", requestId, attempt: 2 } };
const receipt = { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId, requestId,
  actorId: scope.userId, intentSha256: scope.intentSha256, stage: scope.stage, status: "queued", attempts: 0,
  leaseUntil: null, failureCode: null, sealSha256: null, cancelled: false, createdAt: sourceDate, updatedAt: sourceDate, replayed: false };
class Store {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem = vi.fn((name: string) => this.data.get(name) ?? null);
  setItem = vi.fn((name: string, value: string) => { this.data.set(name, value); });
  removeItem = vi.fn((name: string) => { this.data.delete(name); });
}
const response = (body: unknown = receipt, status = 200) => new Response(JSON.stringify(body), { status });
function retained(value = pending) {
  const storage = new Store(); retainPendingSynthesisPreparation(storage, value);
  return storage;
}

describe("preparation browser command recovery", () => {
  it("retains exact enqueue and retry commands across reloads", () => {
    for (const value of [pending, retry]) {
      const storage = retained(value);
      expect(readPendingSynthesisPreparation(storage, scope)).toEqual(value);
      expect(retainPendingSynthesisPreparation(storage, value)).toEqual(value);
      expect(() => retainPendingSynthesisPreparation(storage, value === pending ? retry : pending)).toThrow("Another preparation");
    }
  });
  it("separates account, workspace, campaign, source and request slots", () => {
    const storage = retained();
    for (const field of ["userId", "workspaceId", "campaignId", "sourceId", "requestId"] as const) {
      expect(readPendingSynthesisPreparation(storage, { ...scope, [field]: otherId })).toBeNull();
    }
    for (const field of ["sourceSha256", "intentSha256"] as const) {
      expect(() => readPendingSynthesisPreparation(storage, { ...scope, [field]: "c".repeat(64) })).toThrow("another request");
    }
    expect(() => readPendingSynthesisPreparation(storage, { ...scope, stage: "context" })).toThrow("another request");
  });
  it("rejects copied foreign scope and inconsistent command identity", () => {
    const storage = retained(), name = storage.key(0)!;
    for (const field of ["userId", "workspaceId", "campaignId", "sourceId"] as const) {
      storage.data.set(name, JSON.stringify({ ...pending, [field]: otherId }));
      expect(() => readPendingSynthesisPreparation(storage, scope)).toThrow("another request");
    }
    for (const command of [
      { ...pending.command, requestId: otherId }, { ...pending.command, stage: "context" },
      { ...pending.command, intentSha256: "c".repeat(64) }, { ...retry.command, requestId: otherId },
    ]) {
      storage.data.set(name, JSON.stringify({ ...pending, command }));
      expect(() => readPendingSynthesisPreparation(storage, scope)).toThrow("differs from its retained");
    }
  });
  it("rejects invalid versions, unknown authority fields and unsafe attempt numbers", () => {
    const storage = retained(), name = storage.key(0)!;
    for (const value of [ { ...pending, version: 2 }, { ...pending, execute: true },
      { ...pending, command: { ...pending.command, execute: true } },
      ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1].map(attempt => ({ ...retry, command: { ...retry.command, attempt } })),
    ]) {
      storage.data.set(name, JSON.stringify(value));
      expect(() => readPendingSynthesisPreparation(storage, scope)).toThrow();
    }
  });
  it("blocks transport for absent, replaced, unreadable or unretainable commands", async () => {
    const storage = retained(), name = storage.key(0)!, transport = vi.fn<typeof fetch>();
    storage.data.clear(); await expect(sendPendingSynthesisPreparation(storage, pending, transport)).rejects.toThrow("changed");
    storage.data.set(name, JSON.stringify(retry)); await expect(sendPendingSynthesisPreparation(storage, pending, transport)).rejects.toThrow("changed");
    storage.data.set(name, "unreadable"); await expect(sendPendingSynthesisPreparation(storage, pending, transport)).rejects.toThrow();
    storage.data.set(name, JSON.stringify(pending));
    storage.setItem.mockImplementationOnce(() => { throw new Error("SYNTHETIC quota"); });
    await expect(sendPendingSynthesisPreparation(storage, pending, transport)).rejects.toThrow("quota");
    expect(transport).not.toHaveBeenCalled();
  });
  it("requires readback before transport", async () => {
    const storage = retained(), name = storage.key(0)!, transport = vi.fn<typeof fetch>();
    storage.setItem.mockImplementationOnce(() => { storage.data.set(name, JSON.stringify(retry)); });
    await expect(sendPendingSynthesisPreparation(storage, pending, transport)).rejects.toThrow("could not be retained");
    expect(transport).not.toHaveBeenCalled();
  });
  it.each(["segment", "context", "thematic"] as const)("replays exact %s bytes and identity after a lost reply", async stage => {
    const value: PendingSynthesisPreparation = { ...pending, stage,
      command: { operation: "enqueue", requestId, stage, intentSha256: scope.intentSha256 } };
    const storage = retained(value), transport = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("SYNTHETIC lost reply"))
      .mockResolvedValueOnce(response({ ...receipt, stage, replayed: true }));
    await expect(sendPendingSynthesisPreparation(storage, value, transport)).rejects.toThrow("lost reply");
    expect(readPendingSynthesisPreparation(storage, { ...scope, stage })).toEqual(value);
    const result = await sendPendingSynthesisPreparation(storage, value, transport);
    for (const call of transport.mock.calls) expect(call).toEqual([
      `/api/engagement/campaigns/${scope.campaignId}/synthesis/preparation`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-openplan-expected-user": scope.userId,
          "x-openplan-expected-workspace": scope.workspaceId }, body: JSON.stringify(value.command), cache: "no-store", signal: expect.any(AbortSignal),
      }]);
    expect(result.state.replayed).toBe(true); expect(result.cleanupError).toBeNull();
    expect(readPendingSynthesisPreparation(storage, { ...scope, stage })).toBeNull();
  });
  it.each([400, 401, 403, 409, 503])("retains commands after HTTP %s", async status => {
    const storage = retained();
    await expect(sendPendingSynthesisPreparation(storage, pending, vi.fn<typeof fetch>().mockResolvedValue(response({}, status)))).rejects.toMatchObject({ status });
    expect(readPendingSynthesisPreparation(storage, scope)).toEqual(pending);
  });
  it.each<Record<string, unknown>>([
    { campaignId: otherId }, { workspaceId: otherId }, { requestId: otherId }, { actorId: otherId },
    { stage: "context" }, { intentSha256: "c".repeat(64) }, { replayed: undefined },
    { status: "running" }, { failureCode: "preparation_failed" }, { sealSha256: "c".repeat(64) },
    { status: "running", leaseUntil: sourceDate, attempts: 0 }, { status: "cancelled", cancelled: false },
  ])("keeps custody when receipt differs: %j", async change => {
    const storage = retained();
    await expect(sendPendingSynthesisPreparation(storage, pending,
      vi.fn<typeof fetch>().mockResolvedValue(response({ ...receipt, ...change })))).rejects.toThrow();
    expect(readPendingSynthesisPreparation(storage, scope)).toEqual(pending);
  });
  it("refuses null or malformed receipts", async () => {
    for (const body of [null, {}, "bad"]) {
      const storage = retained();
      await expect(sendPendingSynthesisPreparation(storage, pending, vi.fn<typeof fetch>().mockResolvedValue(response(body)))).rejects.toThrow();
      expect(readPendingSynthesisPreparation(storage, scope)).toEqual(pending);
    }
  });
  it("confirms a retained retry against the same or newer native attempt", async () => {
    for (const attempts of [2, 3]) {
      const storage = retained(retry), transport = vi.fn<typeof fetch>().mockResolvedValue(response({ ...receipt, attempts }));
      const result = await sendPendingSynthesisPreparation(storage, retry, transport);
      expect(result.state.attempts).toBe(attempts);
      expect(transport.mock.calls[0][1]?.body).toBe(JSON.stringify(retry.command));
      expect(readPendingSynthesisPreparation(storage, scope)).toBeNull();
    }
    const storage = retained(retry);
    await expect(sendPendingSynthesisPreparation(storage, retry,
      vi.fn<typeof fetch>().mockResolvedValue(response({ ...receipt, attempts: 1 })))).rejects.toThrow("receipt differs");
    expect(readPendingSynthesisPreparation(storage, scope)).toEqual(retry);
  });
  it("accepts later running, prepared, failed and cancelled states without starting work", async () => {
    const states = [ { status: "running", attempts: 1, leaseUntil: sourceDate },
      { status: "prepared", attempts: 1, sealSha256: "c".repeat(64) },
      { status: "failed", attempts: 1, failureCode: "input_unavailable" }, { status: "cancelled", cancelled: true } ];
    for (const change of states) {
      const storage = retained(), transport = vi.fn<typeof fetch>().mockResolvedValue(response({ ...receipt, ...change, replayed: true }));
      const result = await sendPendingSynthesisPreparation(storage, pending, transport);
      expect(result.state.status).toBe(change.status); expect(transport).toHaveBeenCalledTimes(1);
    }
  });
  it("retains commands when aborted before send, after transport or during receipt reading", async () => {
    for (const when of ["before", "transport", "body"]) {
      const storage = retained(), controller = new AbortController(), reply = response();
      const readBody = vi.spyOn(reply, "json");
      if (when === "before") controller.abort(new Error("SYNTHETIC abort"));
      const transport = vi.fn<typeof fetch>().mockImplementation(async () => {
        if (when === "transport") controller.abort(new Error("SYNTHETIC abort"));
        if (when === "body") readBody.mockImplementation(async () => {
          controller.abort(new Error("SYNTHETIC abort")); return receipt;
        });
        return reply;
      });
      await expect(sendPendingSynthesisPreparation(storage, pending, transport, controller.signal)).rejects.toThrow("SYNTHETIC abort");
      expect(transport).toHaveBeenCalledTimes(when === "before" ? 0 : 1);
      expect(readBody).toHaveBeenCalledTimes(when === "body" ? 1 : 0);
      expect(readPendingSynthesisPreparation(storage, scope)).toEqual(pending);
    }
  });
  it("passes a thirty-second deadline and rejects a late successful transport", async () => {
    const storage = retained(), controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(controller.signal);
    try {
      const transport = vi.fn<typeof fetch>().mockImplementation(async () => { controller.abort(); return response(); });
      await expect(sendPendingSynthesisPreparation(storage, pending, transport)).rejects.toThrow();
      expect(timeout).toHaveBeenCalledWith(30_000);
      expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(readPendingSynthesisPreparation(storage, scope)).toEqual(pending);
    } finally { timeout.mockRestore(); }
  });
  it("reports cleanup failure separately from confirmed native state", async () => {
    const storage = retained(); storage.removeItem.mockImplementationOnce(() => undefined);
    const result = await sendPendingSynthesisPreparation(storage, pending, vi.fn<typeof fetch>().mockResolvedValue(response()));
    expect(result.state.requestId).toBe(requestId); expect(result.cleanupError).toContain("Preparation confirmed");
    expect(readPendingSynthesisPreparation(storage, scope)).toEqual(pending);
  });
  it("does not erase a newer command while the response is in flight", async () => {
    const storage = retained(), name = storage.key(0)!;
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => { storage.data.set(name, JSON.stringify(retry)); return response(); });
    const result = await sendPendingSynthesisPreparation(storage, pending, transport);
    expect(result.cleanupError).toContain("cleanup failed"); expect(readPendingSynthesisPreparation(storage, scope)).toEqual(retry);
  });
  it("preserves unreadable bytes plus newer memory and lists both scoped copies", () => {
    const storage = retained(), name = storage.key(0)!; storage.data.set(name, "SYNTHETIC unreadable 日本語");
    preservePendingSynthesisPreparation(storage, scope, retry);
    expect(readPendingSynthesisPreparation(storage, scope)).toBeNull();
    const copies = listPreservedSynthesisPreparations(storage, scope);
    expect(copies.map(copy => copy.raw)).toEqual(["SYNTHETIC unreadable 日本語", JSON.stringify(retry)]);
    expect(copies.map(copy => copy.value)).toEqual([null, retry]);
    expect(listPreservedSynthesisPreparations(storage, { ...scope, userId: otherId })).toEqual([]);
    expect(listPreservedSynthesisPreparations(storage, { ...scope, sourceSha256: "c".repeat(64) }).map(copy => copy.value)).toEqual([null, null]);
  });
  it("preserves only one copy for identical stored and memory values", () => {
    const storage = retained(); preservePendingSynthesisPreparation(storage, scope, readPendingSynthesisPreparation(storage, scope)!);
    expect(listPreservedSynthesisPreparations(storage, scope)).toHaveLength(1);
  });
  it("refuses foreign memory, failed archive readback, changed originals and failed removal", () => {
    const storage = retained(), name = storage.key(0)!;
    expect(() => preservePendingSynthesisPreparation(storage, scope, { ...pending, userId: otherId })).toThrow("another request");
    storage.setItem.mockImplementationOnce(() => undefined);
    expect(() => preservePendingSynthesisPreparation(storage, scope)).toThrow("could not be preserved");
    expect(readPendingSynthesisPreparation(storage, scope)).toEqual(pending);
    storage.setItem.mockImplementationOnce((archive, value) => { storage.data.set(archive, value); storage.data.set(name, JSON.stringify(retry)); });
    expect(() => preservePendingSynthesisPreparation(storage, scope)).toThrow("could not be preserved");
    expect(readPendingSynthesisPreparation(storage, scope)).toEqual(retry);
    storage.removeItem.mockImplementationOnce(() => undefined);
    expect(() => preservePendingSynthesisPreparation(storage, scope)).toThrow("could not be moved aside");
    expect(readPendingSynthesisPreparation(storage, scope)).toEqual(retry);
  });
});
