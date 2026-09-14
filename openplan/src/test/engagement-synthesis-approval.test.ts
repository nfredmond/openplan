import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  checkSynthesisApprovalIntent, readSynthesisApprovalEvent, readSynthesisApprovalHistory, readSynthesisApprovalReceipt,
  synthesisApprovalForRevision, synthesisApprovalIntentSchema, type SynthesisApprovalContext,
  type SynthesisApprovalIntent, type SynthesisApprovalPacket,
} from "@/lib/engagement/synthesis-approval";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const scope = { campaignId: id(1), workspaceId: id(2), reviewId: id(3), sourceId: id(4), sourceSha256: sha("SYNTHETIC source"), preparationSha256: sha("SYNTHETIC preparation") };
const current: SynthesisApprovalContext = { ...scope, revisionId: id(3), revisionSha256: sha("SYNTHETIC original"), revisionNo: 1 };
const corrected: SynthesisApprovalContext = { ...scope, revisionId: id(5), revisionSha256: sha("SYNTHETIC correction"), revisionNo: 2 };
function intent(changes: Partial<SynthesisApprovalIntent> = {}): SynthesisApprovalIntent {
  return { ...current, requestId: id(10), actorId: id(6), operation: "approve", reason: "SYNTHETIC staff review. Unassessed interpretation stays unassessed. 中文 🚲",
    predecessorId: null, predecessorSha256: null, ...changes };
}
function packet(command = intent(), eventNo = 1, overrides: Record<string, unknown> = {}): SynthesisApprovalPacket {
  const eventText = JSON.stringify({ schemaVersion: 1, purpose: "internal_staff_synthesis", eventNo, createdAt: "2026-09-14T23:50:00.000Z", intent: command, ...overrides });
  return { eventText, eventSha256: sha(eventText) };
}
const event = () => readSynthesisApprovalEvent(packet(), scope);
async function history(commands: SynthesisApprovalIntent[]) {
  const entries = commands.map((command, index) => packet(command, index + 1)), last = entries.at(-1);
  return readSynthesisApprovalHistory({ ...scope, entries, eventCount: entries.length,
    headId: commands.at(-1)?.requestId ?? null, headSha256: last?.eventSha256 ?? null }, scope);
}
async function sequence() {
  const first = await event();
  const withdrawal = intent({ requestId: id(11), operation: "withdraw", reason: "SYNTHETIC unsupported wording needs correction.",
    predecessorId: first.intent.requestId, predecessorSha256: first.eventSha256 });
  const second = await readSynthesisApprovalEvent(packet(withdrawal, 2), scope);
  const renewed = intent({ ...corrected, requestId: id(12), predecessorId: second.intent.requestId, predecessorSha256: second.eventSha256 });
  return { first, withdrawal, second, renewed };
}

describe("exact synthesis approval protocol", () => {
  it("keeps absent approval distinct and validates an empty private history's scope", async () => {
    const empty = await history([]);
    expect(empty.head).toBeNull();
    expect(synthesisApprovalForRevision(empty, current)).toEqual({ state: "unapproved", event: null });
    expect(() => synthesisApprovalForRevision(empty, { ...current, sourceId: id(90) })).toThrow("scope differs");
    await expect(readSynthesisApprovalHistory({ ...scope, entries: [], eventCount: 0, headId: null, headSha256: null }, { ...scope, workspaceId: id(99) })).rejects.toThrow("scope differs");
  });
  it("binds approval to the exact revision and keeps later corrections unapproved", async () => {
    const before = JSON.stringify(current), saved = await history([intent()]);
    expect(synthesisApprovalForRevision(saved, current)).toMatchObject({ state: "approved", event: { intent: { actorId: id(6) } } });
    expect(synthesisApprovalForRevision(saved, corrected)).toEqual({ state: "unapproved", event: null });
    expect(JSON.stringify(current)).toBe(before);
    expect(checkSynthesisApprovalIntent(intent(), current, null)).toEqual(intent());
    expect(() => checkSynthesisApprovalIntent(intent(), corrected, null)).toThrow("newer or different revision");
  });
  it.each(["revisionId", "revisionSha256", "revisionNo"] as const)("rejects changed approval %s even with an otherwise matching context", field => {
    const changed = { ...current, [field]: field === "revisionNo" ? 2 : field === "revisionId" ? id(77) : sha("wrong") };
    expect(() => checkSynthesisApprovalIntent(intent(), changed, null)).toThrow("newer or different revision");
  });
  it("retains original approval after approving a later correction without inheriting it", async () => {
    const first = await event();
    const later = intent({ ...corrected, requestId: id(12), predecessorId: first.intent.requestId, predecessorSha256: first.eventSha256 });
    const saved = await history([intent(), later]);
    expect(synthesisApprovalForRevision(saved, current).event?.intent.requestId).toBe(id(10));
    expect(synthesisApprovalForRevision(saved, corrected).event?.intent.requestId).toBe(id(12));
    expect(saved.head?.intent.requestId).toBe(id(12));
    expect(() => checkSynthesisApprovalIntent(intent({ requestId: id(13), predecessorId: id(12), predecessorSha256: saved.head!.eventSha256 }), current, saved.head)).toThrow("older revision");
    await expect(history([intent(), later, intent({ requestId: id(13), predecessorId: id(12), predecessorSha256: saved.head!.eventSha256 })])).rejects.toThrow("older revision");
  });
  it("withdraws the exact prior approval after correction and permits a new explicit approval", async () => {
    const { first, withdrawal, renewed } = await sequence();
    expect(checkSynthesisApprovalIntent(withdrawal, corrected, first)).toEqual(withdrawal);
    const withdrawn = await history([intent(), withdrawal]);
    expect(synthesisApprovalForRevision(withdrawn, current).state).toBe("withdrawn");
    expect(synthesisApprovalForRevision(withdrawn, corrected).state).toBe("unapproved");
    const saved = await history([intent(), withdrawal, renewed]);
    expect(synthesisApprovalForRevision(saved, corrected).state).toBe("approved");
    expect(synthesisApprovalForRevision(saved, current).state).toBe("withdrawn");
    expect(saved.entries[0]).toEqual(first);
  });
  it("allows reapproval of the same version only after explicit withdrawal", async () => {
    const { first, withdrawal, second } = await sequence();
    expect(() => checkSynthesisApprovalIntent(intent({ requestId: id(12), predecessorId: id(10), predecessorSha256: first.eventSha256 }), current, first)).toThrow("already approved");
    const again = intent({ requestId: id(12), predecessorId: id(11), predecessorSha256: second.eventSha256 });
    const saved = await history([intent(), withdrawal, again]);
    expect(synthesisApprovalForRevision(saved, current).event?.intent.requestId).toBe(id(12));
  });
  it("rejects withdrawal of a different version or an already withdrawn event", async () => {
    const { first, withdrawal, second } = await sequence();
    expect(() => checkSynthesisApprovalIntent({ ...withdrawal, ...corrected }, corrected, first)).toThrow("exact preceding approval");
    expect(() => checkSynthesisApprovalIntent({ ...withdrawal, requestId: id(12), predecessorId: id(11), predecessorSha256: second.eventSha256 }, corrected, second)).toThrow("exact preceding approval");
  });
  it.each(["predecessorId", "predecessorSha256"] as const)("fences a stale or competing %s", async field => {
    const first = await event();
    const command = intent({ ...corrected, requestId: id(12), predecessorId: id(10), predecessorSha256: first.eventSha256 });
    expect(() => checkSynthesisApprovalIntent({ ...command, [field]: field === "predecessorId" ? id(99) : sha("wrong") }, corrected, first)).toThrow("history has changed");
    expect(() => checkSynthesisApprovalIntent(intent({ ...corrected }), corrected, first)).toThrow("history has changed");
  });
  it.each(Object.keys(scope) as (keyof typeof scope)[])("rejects cross-scope %s on reads and writes", async field => {
    const wrong = { ...scope, [field]: field.endsWith("Sha256") ? sha("wrong") : id(99) };
    await expect(readSynthesisApprovalEvent(packet(), wrong)).rejects.toThrow("scope differs");
    expect(() => checkSynthesisApprovalIntent(intent(), { ...current, ...wrong }, null)).toThrow("scope differs");
    const first = await event();
    expect(() => checkSynthesisApprovalIntent(intent({ ...corrected, ...wrong, requestId: id(12), predecessorId: id(10), predecessorSha256: first.eventSha256 }), { ...corrected, ...wrong }, first)).toThrow("scope differs");
  });
  it("rejects altered event bytes and a broader authority claim even if it is rehashed", async () => {
    await expect(readSynthesisApprovalEvent({ ...packet(), eventText: packet().eventText + " " }, scope)).rejects.toThrow("checksum differs");
    await expect(readSynthesisApprovalEvent(packet(intent(), 1, { purpose: "public_release" }), scope)).rejects.toThrow();
    await expect(readSynthesisApprovalEvent(packet(intent(), 1, { schemaVersion: 2 }), scope)).rejects.toThrow();
    await expect(readSynthesisApprovalEvent(packet(intent(), 1, { arbitraryAuthority: true }), scope)).rejects.toThrow();
    const validWhitespace = { eventText: "\n" + packet().eventText, eventSha256: sha("\n" + packet().eventText) };
    expect((await readSynthesisApprovalEvent(validWhitespace, scope)).intent.reason).toBe(intent().reason);
  });
  it.each(["", " \n\t", "x\0y", "\ud800", "x".repeat(2001)])("refuses an invalid reason without silently rewriting it", bad => {
    expect(synthesisApprovalIntentSchema.safeParse(intent({ reason: bad })).success).toBe(false);
  });
  it("preserves full Unicode reasons and refuses unsupported or ambiguous commands", () => {
    expect(synthesisApprovalIntentSchema.parse(intent({ reason: "🚲".repeat(2000) })).reason).toBe("🚲".repeat(2000));
    for (const patch of [{ operation: "publish" }, { approvalRequired: false }, { predecessorId: id(99) },
      { predecessorSha256: sha("wrong") }, { operation: "withdraw" }, { predecessorId: id(10), predecessorSha256: sha("self") },
      { actorId: "invalid" }, { revisionNo: 0 }, { revisionNo: Number.MAX_SAFE_INTEGER + 1 }]) {
      expect(synthesisApprovalIntentSchema.safeParse({ ...intent(), ...patch }).success).toBe(false);
    }
  });
  it("recovers exact old receipts but rejects changes to any bound command field", async () => {
    const original = packet();
    expect(await readSynthesisApprovalReceipt({ event: original, replayed: true }, intent())).toMatchObject({ replayed: true, event: { createdAt: "2026-09-14T23:50:00.000Z" } });
    expect((await readSynthesisApprovalReceipt({ event: original, replayed: false }, intent())).replayed).toBe(false);
    const first = await event();
    for (const patch of [{ actorId: id(77) }, { requestId: id(77) }, { reason: "Changed reason" }, { ...corrected },
      { predecessorId: id(77), predecessorSha256: first.eventSha256 },
      { operation: "withdraw" as const, predecessorId: id(77), predecessorSha256: first.eventSha256 }]) {
      await expect(readSynthesisApprovalReceipt({ event: original, replayed: true }, intent(patch))).rejects.toThrow("exact request");
    }
    await expect(readSynthesisApprovalReceipt({ event: original, replayed: true }, intent({ sourceId: id(77) }))).rejects.toThrow("scope differs");
  });
  it("refuses incomplete, reordered, duplicated or forked approval history", async () => {
    const { withdrawal, second, renewed } = await sequence();
    const entries = [packet(), packet(withdrawal, 2), packet(renewed, 3)];
    const full = { ...scope, entries, eventCount: 3, headId: renewed.requestId, headSha256: entries[2].eventSha256 };
    await expect(readSynthesisApprovalHistory({ ...full, entries: entries.slice(1) }, scope)).rejects.toThrow("incomplete");
    await expect(readSynthesisApprovalHistory({ ...full, entries: entries.slice(1), eventCount: 2 }, scope)).rejects.toThrow("order differs");
    await expect(readSynthesisApprovalHistory({ ...full, entries: [entries[0], entries[2], entries[1]] }, scope)).rejects.toThrow("order differs");
    await expect(readSynthesisApprovalHistory({ ...full, entries: [entries[0], entries[1], packet({ ...renewed, requestId: id(10) }, 3)] }, scope)).rejects.toThrow("order differs");
    await expect(readSynthesisApprovalHistory({ ...full, entries: [entries[0], entries[1], packet({ ...renewed, predecessorId: id(10), predecessorSha256: entries[0].eventSha256 }, 3)] }, scope)).rejects.toThrow("history has changed");
    await expect(readSynthesisApprovalHistory({ ...full, headId: id(99) }, scope)).rejects.toThrow("head differs");
    await expect(readSynthesisApprovalHistory({ ...full, headSha256: second.eventSha256 }, scope)).rejects.toThrow("head differs");
  });
  it.each(["revisionSha256", "revisionNo"] as const)("rejects historical %s corruption instead of claiming no approval", async field => {
    const saved = await history([intent()]);
    expect(() => synthesisApprovalForRevision(saved, { ...current, [field]: field === "revisionNo" ? 2 : sha("wrong") })).toThrow("checksum or number differs");
  });
  it("rejects reassignment of a retained revision ID or sequence number within history", async () => {
    const { withdrawal, renewed } = await sequence();
    await expect(history([intent(), withdrawal, { ...renewed, revisionId: current.revisionId }])).rejects.toThrow("revision identity differs");
    await expect(history([intent(), withdrawal, { ...renewed, revisionNo: current.revisionNo }])).rejects.toThrow("revision identity differs");
    await expect(history([intent(), { ...withdrawal, revisionSha256: sha("wrong") }])).rejects.toThrow("revision identity differs");
  });
});
