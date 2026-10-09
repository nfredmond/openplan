import { beforeEach, expect, it, vi } from "vitest";
import { reviewRecoveryCopy, restoreRecoveryCopy, readRecoveryArchives, readRecoveryDecisions, retainRecoveryDecision, sendRecoveryDecision, recoveryDecisionKey, type SavedRecoveryDecision } from "@/lib/models/pending-recovery-decision";
const [userId, workspaceId, modelId, runId, requestId, stageId] = Array.from({ length: 6 }, (_, i) => `${String(i + 1).padStart(8, "0")}-1111-4111-8111-111111111111`);
export const scope = { userId, workspaceId, modelId, runId };
export const saved = (): SavedRecoveryDecision => ({ version: 1, scope, phase: "pending", receipt: null, decision: { requestId, decision: "abandon_execution", reason: "Synthetic operator review", evidence: { process_termination: "unconfirmed" }, expectedState: { run_id: runId, workspace_id: workspaceId, model_id: modelId, status: "running", attempt_managed: true, updated_at: "2026-10-08T19:00:00Z", stages: [{ id: stageId, status: "running", updated_at: "2026-10-08T19:00:00Z", attempt_managed: true, active_attempt_id: null }] } } });
export const receipt = (record = saved()) => ({ request_id: record.decision.requestId, workspace_id: workspaceId, run_id: runId, actor_id: userId, outcome: "execution_abandoned", run_status: "cancelled", process_termination_verified: false, continuation_authorized: false, model_resumed: false, reported_evidence_verified: false, request_payload: { workspace_id: workspaceId, run_id: runId, actor_id: userId, expected_state: record.decision.expectedState, reason: record.decision.reason, reported_evidence: record.decision.evidence } });
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
it("retains exact bytes before transport and recovers a lost reply after reload", async () => {
 const original = retainRecoveryDecision(localStorage, saved()); let body: string | undefined;
 const lost = vi.fn(async (_url, options) => { expect(readRecoveryDecisions(localStorage, scope).records).toHaveLength(1); body = options?.body as string; throw new Error("Lost reply"); });
 expect((await sendRecoveryDecision(localStorage, original, lost)).phase).toBe("pending");
 const restored = readRecoveryDecisions(localStorage, scope).records[0];
 const retry = vi.fn(async (_url, options) => { expect(options?.body).toBe(body); expect(options?.headers).toMatchObject({ "x-openplan-expected-user": userId, "x-openplan-expected-workspace": workspaceId }); return Response.json(receipt()); });
 expect((await sendRecoveryDecision(localStorage, restored, retry)).phase).toBe("confirmed");
 expect(readRecoveryDecisions(localStorage, scope).records[0].receipt).toEqual(receipt());
});
it("does not send when browser storage fails", async () => {
 const original = retainRecoveryDecision(localStorage, saved()); vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });
 const transport = vi.fn(); await expect(sendRecoveryDecision(localStorage, original, transport)).rejects.toThrow(); expect(transport).not.toHaveBeenCalled();
});
it("keeps an unexpected receipt pending", async () => {
 const original = retainRecoveryDecision(localStorage, saved());
 expect((await sendRecoveryDecision(localStorage, original, vi.fn(async () => Response.json({ ...receipt(), model_resumed: true })))).phase).toBe("pending");
 expect(readRecoveryDecisions(localStorage, scope).records[0].phase).toBe("pending");
});
it("preserves changed copies and never sends their replacement", async () => {
 const original = retainRecoveryDecision(localStorage, saved()); localStorage.setItem(recoveryDecisionKey(original), JSON.stringify({ ...original, decision: { ...original.decision, reason: "Changed elsewhere" } }));
 const transport = vi.fn(); await expect(sendRecoveryDecision(localStorage, original, transport)).rejects.toThrow("changed"); expect(transport).not.toHaveBeenCalled();
 expect(localStorage.getItem(recoveryDecisionKey(original))).toContain("Changed elsewhere");
});
it("retains unreadable bytes and hides another account's copies", () => {
 const original = retainRecoveryDecision(localStorage, saved()); const key = recoveryDecisionKey(original); localStorage.setItem(key, "broken-json");
 expect(readRecoveryDecisions(localStorage, scope).unreadable).toEqual([{ key, raw: "broken-json" }]);
 expect(readRecoveryDecisions(localStorage, { ...scope, userId: stageId })).toEqual({ records: [], unreadable: [] });
 expect(localStorage.getItem(key)).toBe("broken-json");
});
it("retains refused decisions and requires a new review", async () => {
 const original = retainRecoveryDecision(localStorage, saved());
 const conflict = await sendRecoveryDecision(localStorage, original, vi.fn(async () => Response.json({ error: "State changed" }, { status: 409 })));
 expect(conflict.phase).toBe("conflict"); expect(conflict.decision).toEqual(original.decision);
 await expect(sendRecoveryDecision(localStorage, conflict, vi.fn())).rejects.toThrow("Only an unconfirmed");
});
it("does not downgrade a confirmed receipt", async () => {
 const original = retainRecoveryDecision(localStorage, saved()); await sendRecoveryDecision(localStorage, original, vi.fn(async () => Response.json(receipt())));
 const transport = vi.fn(); await expect(sendRecoveryDecision(localStorage, original, transport)).rejects.toThrow("changed"); expect(transport).not.toHaveBeenCalled();
 expect(readRecoveryDecisions(localStorage, scope).records[0].phase).toBe("confirmed");
});

it("restores an imported receipt as pending and requires server confirmation", async () => {
 const text = JSON.stringify({ ...saved(), phase: "confirmed", receipt: receipt() });
 const original = restoreRecoveryCopy(localStorage, text, scope);
 expect(original.phase).toBe("pending"); expect(original.receipt).toBeNull();
 const transport = vi.fn(async (_url: unknown, _options?: RequestInit) => Response.json(receipt()));
 expect((await sendRecoveryDecision(localStorage, original, transport)).phase).toBe("confirmed");
 expect(JSON.parse(transport.mock.calls[0][1]?.body as string)).toEqual(saved().decision);
});
it("refuses imported copies for another account or oversized files", () => {
 expect(() => reviewRecoveryCopy(JSON.stringify(saved()), { ...scope, userId: stageId })).toThrow("another account");
 expect(() => reviewRecoveryCopy(" ".repeat(2_000_001), scope)).toThrow("2 MB");
 expect(localStorage.length).toBe(0);
});
it("preserves exact unreadable bytes before replacing the acknowledged request", () => {
 const key = recoveryDecisionKey(saved()); localStorage.setItem(key, "broken-json");
 expect(() => restoreRecoveryCopy(localStorage, JSON.stringify(saved()), scope)).toThrow("acknowledge");
 expect(localStorage.getItem(key)).toBe("broken-json");
 const set = vi.spyOn(Storage.prototype, "setItem");
 const restored = restoreRecoveryCopy(localStorage, JSON.stringify(saved()), scope, { key, raw: "broken-json" });
 expect(restored.phase).toBe("pending");
 expect(set.mock.calls[0][0]).toContain("model-recovery-archive:");
 expect(JSON.parse(set.mock.calls[0][1])).toEqual({ version: 1, originalKey: key, raw: "broken-json" });
 expect(set.mock.calls[1][0]).toBe(key);
 expect(JSON.parse(readRecoveryArchives(localStorage, scope)[0].raw).raw).toBe("broken-json");
 expect(readRecoveryArchives(localStorage, { ...scope, userId: stageId })).toEqual([]);
 expect(readRecoveryDecisions(localStorage, scope).unreadable).toEqual([]);
});
it("never replaces unreadable data when archiving fails", () => {
 const key = recoveryDecisionKey(saved()); localStorage.setItem(key, "damaged");
 const write = Storage.prototype.setItem;
 vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, storageKey, value) {
  if (!storageKey.includes("model-recovery-archive:")) write.call(this, storageKey, value);
 });
 expect(() => restoreRecoveryCopy(localStorage, JSON.stringify(saved()), scope, { key, raw: "damaged" })).toThrow("did not preserve");
 expect(localStorage.getItem(key)).toBe("damaged");
});
it("refuses stale damage acknowledgement and preserves a different valid request", () => {
 const key = recoveryDecisionKey(saved()); localStorage.setItem(key, "changed");
 expect(() => restoreRecoveryCopy(localStorage, JSON.stringify(saved()), scope, { key, raw: "old" })).toThrow("acknowledge");
 const other = { ...saved(), decision: { ...saved().decision, reason: "Different reason" } }; localStorage.setItem(key, JSON.stringify(other));
 expect(() => restoreRecoveryCopy(localStorage, JSON.stringify(saved()), scope)).toThrow("different decision");
 expect(JSON.parse(localStorage.getItem(key)!)).toEqual(other);
});
it("keeps an existing confirmed receipt on repeated import", () => {
 const confirmed = { ...saved(), phase: "confirmed" as const, receipt: receipt() }; retainRecoveryDecision(localStorage, confirmed);
 expect(restoreRecoveryCopy(localStorage, JSON.stringify(saved()), scope)).toEqual(confirmed);
});
