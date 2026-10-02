import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSynthesisResponseLinkHistory, loadSynthesisResponseLinkRequest, retainSynthesisResponseLink, retainSynthesisResponseLinkCommand } from "@/lib/engagement/synthesis-response-write-server";
import { readSynthesisResponseContext } from "@/lib/engagement/synthesis-response-context-server";
import { SynthesisResponseLinkError } from "@/lib/engagement/synthesis-response-links-server";
import { synthesisResponseLinkIntentSchema } from "@/lib/engagement/synthesis-response-records-server";
import { id, fixture, scope, event, packet, history, changed, chain, contextScope } from "./fixtures/engagement/synthesis-response-link";
import { sourceHash } from "./fixtures/engagement/synthesis-source";

const m = vi.hoisted(() => ({ current: vi.fn() }));
vi.mock("@/lib/engagement/synthesis-response-links-server", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/engagement/synthesis-response-links-server")>(), loadSynthesisResponseContext: m.current,
}));
const readRpc = vi.fn(), writeRpc = vi.fn();
const client = { rpc: readRpc } as unknown as Pick<SupabaseClient, "rpc">;
const service = { rpc: writeRpc } as unknown as Pick<SupabaseClient, "rpc">;
const value = event(fixture()), original = packet(value), actor = { campaignId: scope.campaignId, workspaceId: scope.workspaceId, actorId: value.intent.actorId };
const command = { intent: synthesisResponseLinkIntentSchema.parse(value.intent), contextText: value.context.contextText };
let events: ReturnType<typeof packet>[];
const missing = { data: null, error: null };
async function read(name: string, args: Record<string, unknown>) {
  if (name === "read_engagement_synthesis_response_link") {
    expect(args).toEqual({ p_campaign: scope.campaignId, p_request: args.p_request });
    return { data: events.find(row => JSON.parse(row.eventText).intent.requestId === args.p_request) ?? null, error: null };
  }
  expect(name).toBe("read_engagement_synthesis_response_links");
  expect(args).toEqual({ p_campaign: scope.campaignId, p_review: scope.reviewId, p_response: scope.responseId, p_group: scope.groupId });
  return { data: history(events), error: null };
}
beforeEach(() => {
  events = []; readRpc.mockReset().mockImplementation(read); writeRpc.mockReset().mockResolvedValue({ data: { event: original, replayed: false }, error: null });
  m.current.mockReset().mockImplementation(() => readSynthesisResponseContext(value.context, contextScope));
});

describe("authenticated synthesis response link writes", () => {
  it("uses staff reads, exact context bytes and route-authenticated service identity", async () => {
    const result = await retainSynthesisResponseLink(client, service, actor, command);
    expect(result.event.eventText).toBe(original.eventText); expect(result.replayed).toBe(false);
    expect(readRpc).toHaveBeenNthCalledWith(1, "read_engagement_synthesis_response_link", { p_campaign: actor.campaignId, p_request: command.intent.requestId });
    expect(readRpc.mock.calls.map(([name]) => name)).toEqual(["read_engagement_synthesis_response_link", "read_engagement_synthesis_response_links"]);
    expect(m.current).toHaveBeenCalledWith(client, scope, service);
    expect(writeRpc).toHaveBeenCalledExactlyOnceWith("retain_engagement_synthesis_response_link", {
      p_campaign: actor.campaignId, p_actor: actor.actorId, p_workspace: actor.workspaceId, p_intent: command.intent, p_context_text: command.contextText,
    });
  });
  it("recovers an exact old request before current review and history checks", async () => {
    events = [original]; m.current.mockRejectedValue(new Error("Current response removed"));
    readRpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name !== "read_engagement_synthesis_response_link") throw new Error("SYNTHETIC newer history unavailable");
      return read(name, args);
    });
    const result = await retainSynthesisResponseLink(client, service, actor, command);
    expect(result.replayed).toBe(true); expect(result.event.eventText).toBe(original.eventText);
    expect(readRpc).toHaveBeenCalledTimes(1); expect(m.current).not.toHaveBeenCalled(); expect(writeRpc).not.toHaveBeenCalled();
  });
  it.each(["campaignId", "workspaceId", "actorId"] as const)("denies a mismatched authenticated %s before any read or write", async key => {
    await expect(retainSynthesisResponseLink(client, service, { ...actor, [key]: id(99) }, command)).rejects.toMatchObject({ kind: "forbidden" });
    expect(readRpc).not.toHaveBeenCalled(); expect(writeRpc).not.toHaveBeenCalled();
  });
  it("rejects malformed commands and incorrect context presence", async () => {
    for (const raw of [{ ...command, extra: true }, { ...command, contextText: null }, { ...command, intent: { ...command.intent, reason: "" } }]) {
      await expect(retainSynthesisResponseLink(client, service, actor, raw)).rejects.toMatchObject({ kind: "invalid" });
    }
    expect(readRpc).not.toHaveBeenCalled(); expect(writeRpc).not.toHaveBeenCalled();
  });
  it.each(["reason", "actorId", "contextText"] as const)("refuses a different retained command %s", async key => {
    events = [original];
    const request = key === "contextText" ? { ...command, contextText: command.contextText + " " }
      : { ...command, intent: { ...command.intent, [key]: key === "reason" ? "Different exact reason" : id(99) } };
    const who = key === "actorId" ? { ...actor, actorId: id(99) } : actor;
    await expect(retainSynthesisResponseLink(client, service, who, request)).rejects.toMatchObject({ kind: "conflict" });
    expect(writeRpc).not.toHaveBeenCalled();
  });
  it("classifies a verified request for another group as a conflict", async () => {
    events = [original];
    await expect(loadSynthesisResponseLinkRequest(client, { ...scope, groupId: "different" }, command.intent.requestId)).rejects.toMatchObject({ kind: "conflict" });
  });
  it("keeps corrupt evidence unavailable even when the retained command has another group", async () => {
    readRpc.mockResolvedValue({ data: packet({ ...value, context: { ...value.context, contextText: value.context.contextText + " " } }), error: null });
    await expect(loadSynthesisResponseLinkRequest(client, { ...scope, groupId: "different" }, command.intent.requestId)).rejects.toMatchObject({ kind: "unavailable" });
  });
  it("preserves unavailable versus absent and rejects a different returned request ID", async () => {
    expect(await loadSynthesisResponseLinkRequest(client, scope, id(90))).toBeNull();
    readRpc.mockResolvedValue({ data: original, error: null });
    await expect(loadSynthesisResponseLinkRequest(client, scope, id(90))).rejects.toMatchObject({ kind: "unavailable" });
    readRpc.mockRejectedValue(new Error("SYNTHETIC private transport detail"));
    await expect(loadSynthesisResponseLinkRequest(client, scope, command.intent.requestId)).rejects.toMatchObject({ kind: "unavailable" });
    await expect(loadSynthesisResponseLinkRequest(client, scope, command.intent.requestId)).rejects.not.toThrow("private transport detail");
  });
  it("refuses malformed lookup addresses without invoking RPC", async () => {
    await expect(loadSynthesisResponseLinkRequest(client, { ...scope, extra: true }, id(1))).rejects.toMatchObject({ kind: "invalid" });
    await expect(loadSynthesisResponseLinkRequest(client, scope, "bad")).rejects.toMatchObject({ kind: "invalid" });
    await expect(loadSynthesisResponseLinkHistory(client, { ...scope, groupId: "/" })).rejects.toMatchObject({ kind: "invalid" });
    expect(readRpc).not.toHaveBeenCalled();
  });
  it.each(["42501", "XX000"])("denies a failed request read carrying valid data: %s", async code => {
    readRpc.mockResolvedValue({ data: original, error: { code, message: "SYNTHETIC private detail" } });
    await expect(retainSynthesisResponseLink(client, service, actor, command)).rejects.toMatchObject({ kind: code === "42501" ? "forbidden" : "unavailable" });
    expect(writeRpc).not.toHaveBeenCalled();
  });
  it.each([null, { ...history([]), eventCount: 1 }])("refuses missing or incomplete history %j", async data => {
    readRpc.mockResolvedValueOnce(missing).mockResolvedValueOnce({ data, error: null });
    await expect(retainSynthesisResponseLink(client, service, actor, command)).rejects.toMatchObject({ kind: "unavailable" });
    expect(writeRpc).not.toHaveBeenCalled();
  });
  it("refuses corrupt saved records instead of retrying a write", async () => {
    readRpc.mockResolvedValue({ data: { ...original, eventText: original.eventText + " " }, error: null });
    await expect(retainSynthesisResponseLink(client, service, actor, command)).rejects.toMatchObject({ kind: "unavailable" });
    expect(writeRpc).not.toHaveBeenCalled();
  });
  it("recovers a concurrent exact request after the observed history head changes", async () => {
    readRpc.mockResolvedValueOnce(missing).mockResolvedValueOnce({ data: history([original]), error: null }).mockResolvedValueOnce({ data: original, error: null });
    expect((await retainSynthesisResponseLink(client, service, actor, command)).replayed).toBe(true);
    expect(writeRpc).not.toHaveBeenCalled();
  });
  it("refuses an unrelated changed head when the exact request is absent", async () => {
    const other = packet({ ...value, intent: { ...value.intent, requestId: id(90) } });
    events = [other];
    await expect(retainSynthesisResponseLink(client, service, actor, command)).rejects.toMatchObject({ kind: "conflict" });
    expect(writeRpc).not.toHaveBeenCalled();
  });
  it("verifies submitted context before current reads or service writes", async () => {
    await expect(retainSynthesisResponseLink(client, service, actor, { ...command, contextText: command.contextText + " " })).rejects.toMatchObject({ kind: "invalid" });
    expect(m.current).not.toHaveBeenCalled(); expect(writeRpc).not.toHaveBeenCalled();
  });
  it("rejects stale context and recovers a racing exact request after current-state conflict", async () => {
    const stale = JSON.stringify(changed());
    m.current.mockResolvedValue(await readSynthesisResponseContext({ contextText: stale, contextSha256: sourceHash(stale) }, contextScope));
    await expect(retainSynthesisResponseLink(client, service, actor, command)).rejects.toMatchObject({ kind: "conflict" });
    expect(writeRpc).not.toHaveBeenCalled();
    readRpc.mockReset().mockResolvedValueOnce(missing).mockResolvedValueOnce({ data: history([]), error: null }).mockResolvedValueOnce({ data: original, error: null });
    expect((await retainSynthesisResponseLink(client, service, actor, command)).replayed).toBe(true);
  });
  it("does not turn lost current access into a service write", async () => {
    m.current.mockRejectedValue(new SynthesisResponseLinkError("forbidden", "Staff access changed"));
    await expect(retainSynthesisResponseLink(client, service, actor, command)).rejects.toMatchObject({ kind: "forbidden" });
    expect(writeRpc).not.toHaveBeenCalled();
  });
  it.each(["PT409", "PT503", "transport"])("recovers an exact committed request after %s", async failure => {
    writeRpc.mockImplementation(async () => {
      events = [original];
      if (failure === "transport") throw new Error("SYNTHETIC interrupted acknowledgement");
      return { data: null, error: { code: failure } };
    });
    expect((await retainSynthesisResponseLink(client, service, actor, command)).replayed).toBe(true);
    expect(writeRpc).toHaveBeenCalledTimes(1);
  });
  it.each([["PT409", "conflict"], ["PT503", "unavailable"], ["22023", "invalid"], ["42501", "forbidden"], ["XX000", "unavailable"]])("keeps unrecovered %s distinct as %s", async (code, kind) => {
    writeRpc.mockResolvedValue({ data: { event: original, replayed: false }, error: { code } });
    await expect(retainSynthesisResponseLink(client, service, actor, command)).rejects.toMatchObject({ kind });
  });
  it("keeps an interrupted write unconfirmed when its request is still absent", async () => {
    writeRpc.mockRejectedValue(new Error("SYNTHETIC interrupted acknowledgement"));
    await expect(retainSynthesisResponseLink(client, service, actor, command)).rejects.toMatchObject({ kind: "unavailable" });
    expect(writeRpc).toHaveBeenCalledTimes(1);
  });
  it("verifies acknowledgement bytes and exact intent before success", async () => {
    const other = packet({ ...value, intent: { ...value.intent, reason: "SYNTHETIC another command" } });
    writeRpc.mockResolvedValue({ data: { event: other, replayed: false }, error: null });
    await expect(retainSynthesisResponseLink(client, service, actor, command)).rejects.toMatchObject({ kind: "conflict" });
    writeRpc.mockResolvedValue({ data: { event: { ...original, eventText: original.eventText + " " }, replayed: false }, error: null });
    await expect(retainSynthesisResponseLink(client, service, actor, command)).rejects.toMatchObject({ kind: "unavailable" });
  });
  it("withdraws retained context without loading current source or response state", async () => {
    const { first, second, third } = chain(); events = [first, second];
    const withdrawal = JSON.parse(third.eventText); const request = { intent: withdrawal.intent, contextText: null };
    writeRpc.mockResolvedValue({ data: { event: third, replayed: false }, error: null });
    const result = await retainSynthesisResponseLink(client, service, actor, request);
    expect(result.event.context).toEqual(JSON.parse(second.eventText).context);
    expect(m.current).not.toHaveBeenCalled(); expect(writeRpc.mock.calls[0][1].p_context_text).toBeNull();
  });
});


describe("synthesis response write boundaries", () => {
  it("refreshes changed context with the exact observed predecessor", async () => {
    const { first, second } = chain(), next = JSON.parse(second.eventText); events = [first];
    m.current.mockResolvedValue(await readSynthesisResponseContext(next.context, contextScope));
    writeRpc.mockResolvedValue({ data: { event: second, replayed: false }, error: null });
    const result = await retainSynthesisResponseLink(client, service, actor, { intent: next.intent, contextText: next.context.contextText });
    expect(result.event.eventText).toBe(second.eventText); expect(result.event.eventNo).toBe(2);
  });
  it("rejects a wrong predecessor ID even when its digest matches the current head", async () => {
    const { first, second } = chain(), next = JSON.parse(second.eventText); events = [first];
    next.intent.predecessorId = id(99);
    m.current.mockResolvedValue(await readSynthesisResponseContext(next.context, contextScope));
    writeRpc.mockResolvedValue({ data: { event: packet(next), replayed: false }, error: null });
    await expect(retainSynthesisResponseLink(client, service, actor, { intent: next.intent, contextText: next.context.contextText })).rejects.toMatchObject({ kind: "conflict" });
    expect(m.current).not.toHaveBeenCalled(); expect(writeRpc).not.toHaveBeenCalled();
  });
  it("rejects a wrong predecessor digest before current reads or writes", async () => {
    const { first, second } = chain(), next = JSON.parse(second.eventText); events = [first];
    next.intent.predecessorSha256 = sourceHash("wrong");
    await expect(retainSynthesisResponseLink(client, service, actor, { intent: next.intent, contextText: next.context.contextText })).rejects.toMatchObject({ kind: "conflict" });
    expect(m.current).not.toHaveBeenCalled(); expect(writeRpc).not.toHaveBeenCalled();
  });
  it("rejects a context for a different group before current reads or writes", async () => {
    readRpc.mockResolvedValueOnce(missing).mockResolvedValueOnce({ data: { ...history([]), groupId: "different" }, error: null });
    await expect(retainSynthesisResponseLink(client, service, actor, { ...command, intent: { ...command.intent, groupId: "different" } })).rejects.toMatchObject({ kind: "invalid" });
    expect(m.current).not.toHaveBeenCalled(); expect(writeRpc).not.toHaveBeenCalled();
  });
  it("does not withdraw an already withdrawn link", async () => {
    const { first, second, third, fourth } = chain(); events = [first, second, third];
    const intent = JSON.parse(fourth.eventText).intent;
    await expect(retainSynthesisResponseLink(client, service, actor, { intent: { ...intent, operation: "withdraw", expectedContextSha256: null }, contextText: null })).rejects.toMatchObject({ kind: "conflict" });
    expect(writeRpc).not.toHaveBeenCalled();
  });
  it("requires a clean history read even when it includes valid data", async () => {
    readRpc.mockResolvedValueOnce(missing).mockResolvedValueOnce({ data: history([]), error: { code: "42501" } });
    await expect(retainSynthesisResponseLink(client, service, actor, command)).rejects.toMatchObject({ kind: "forbidden" });
    expect(writeRpc).not.toHaveBeenCalled();
  });
  it("keeps failed current-context reads unavailable without exposing details", async () => {
    m.current.mockRejectedValue(new Error("SYNTHETIC private provider detail"));
    await expect(retainSynthesisResponseLink(client, service, actor, command)).rejects.toMatchObject({ kind: "unavailable" });
    await expect(retainSynthesisResponseLink(client, service, actor, command)).rejects.not.toThrow("private provider detail");
    expect(writeRpc).not.toHaveBeenCalled();
  });
  it("refuses a fresh acknowledgement with a missing intermediate event", async () => {
    const { first, second } = chain(), next = JSON.parse(second.eventText); events = [first];
    m.current.mockResolvedValue(await readSynthesisResponseContext(next.context, contextScope));
    writeRpc.mockResolvedValue({ data: { event: packet({ ...next, eventNo: 3 }), replayed: false }, error: null });
    await expect(retainSynthesisResponseLink(client, service, actor, { intent: next.intent, contextText: next.context.contextText })).rejects.toMatchObject({ kind: "unavailable" });
  });
  it("refuses an acknowledgement that changes withdrawn context", async () => {
    const { first, second, third } = chain(), next = JSON.parse(third.eventText); events = [first, second];
    writeRpc.mockResolvedValue({ data: { event: packet({ ...next, context: JSON.parse(first.eventText).context }), replayed: false }, error: null });
    await expect(retainSynthesisResponseLink(client, service, actor, { intent: next.intent, contextText: null })).rejects.toMatchObject({ kind: "unavailable" });
  });
});

describe("compact synthesis response commands", () => {
  it("resolves the expected context on the server without a browser-supplied packet", async () => {
    const result = await retainSynthesisResponseLinkCommand(client, service, actor, command.intent);
    expect(result.event.eventText).toBe(original.eventText);
    expect(m.current).toHaveBeenCalledExactlyOnceWith(client, scope, service);
    expect(writeRpc).toHaveBeenCalledExactlyOnceWith("retain_engagement_synthesis_response_link", {
      p_campaign: actor.campaignId, p_actor: actor.actorId, p_workspace: actor.workspaceId,
      p_intent: command.intent, p_context_text: command.contextText,
    });
  });
  it("recovers exact old intent before unavailable current context or history", async () => {
    events = [original]; m.current.mockRejectedValue(new Error("Removed response"));
    readRpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name !== "read_engagement_synthesis_response_link") throw new Error("Later history unavailable");
      return read(name, args);
    });
    expect((await retainSynthesisResponseLinkCommand(client, service, actor, command.intent)).replayed).toBe(true);
    expect(m.current).not.toHaveBeenCalled(); expect(writeRpc).not.toHaveBeenCalled();
  });
  it("refuses a different command reusing a retained request identity", async () => {
    events = [original];
    await expect(retainSynthesisResponseLinkCommand(client, service, actor, { ...command.intent, reason: "Different compact command" })).rejects.toMatchObject({ kind: "conflict" });
    expect(writeRpc).not.toHaveBeenCalled();
  });
  it("requires the current context checksum to match the frozen preview", async () => {
    await expect(retainSynthesisResponseLinkCommand(client, service, actor, { ...command.intent, expectedContextSha256: sourceHash("old preview") })).rejects.toMatchObject({ kind: "conflict" });
    expect(writeRpc).not.toHaveBeenCalled();
  });
  it("recovers a racing saved command after current context becomes unavailable", async () => {
    readRpc.mockResolvedValueOnce(missing).mockResolvedValueOnce({ data: history([]), error: null }).mockResolvedValueOnce({ data: original, error: null });
    m.current.mockRejectedValue(new SynthesisResponseLinkError("conflict", "Response removed after save"));
    expect((await retainSynthesisResponseLinkCommand(client, service, actor, command.intent)).replayed).toBe(true);
    expect(writeRpc).not.toHaveBeenCalled();
  });
  it("withdraws after source removal without requesting a current packet", async () => {
    const { first, second, third } = chain(); events = [first, second];
    writeRpc.mockResolvedValue({ data: { event: third, replayed: false }, error: null });
    const result = await retainSynthesisResponseLinkCommand(client, service, actor, JSON.parse(third.eventText).intent);
    expect(result.event.eventText).toBe(third.eventText); expect(m.current).not.toHaveBeenCalled();
    expect(writeRpc.mock.calls[0][1].p_context_text).toBeNull();
  });
  it.each(["campaignId", "workspaceId", "actorId"] as const)("binds compact command %s to the authenticated caller", async field => {
    await expect(retainSynthesisResponseLinkCommand(client, service, { ...actor, [field]: id(99) }, command.intent)).rejects.toMatchObject({ kind: "forbidden" });
    expect(readRpc).not.toHaveBeenCalled(); expect(writeRpc).not.toHaveBeenCalled();
  });
  it("rejects a full browser packet or extra fields instead of changing the command format", async () => {
    for (const raw of [command, { ...command.intent, contextText: command.contextText }, { ...command.intent, reason: "" }]) {
      await expect(retainSynthesisResponseLinkCommand(client, service, actor, raw)).rejects.toMatchObject({ kind: "invalid" });
    }
    expect(readRpc).not.toHaveBeenCalled(); expect(writeRpc).not.toHaveBeenCalled();
  });
  it("recovers a committed compact command after acknowledgement loss with one write", async () => {
    writeRpc.mockImplementation(async () => { events = [original]; throw new Error("SYNTHETIC lost acknowledgement"); });
    const result = await retainSynthesisResponseLinkCommand(client, service, actor, command.intent);
    expect(result.replayed).toBe(true); expect(result.event.eventText).toBe(original.eventText); expect(writeRpc).toHaveBeenCalledTimes(1);
  });
});
