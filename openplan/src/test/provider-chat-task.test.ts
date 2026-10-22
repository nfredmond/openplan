import { describe, expect, it } from "vitest";
import { assertChatGrantBinding, canonicalChat, chatGrantDigest, chatSelectionSchema, checkChatGrant, parseChatJson } from "@/lib/assistant/provider-chat-task";
import { chatFixture, chatNativeFixtures } from "./fixtures/provider-chat-fixture";

describe("one accepted chat preimage", () => {
 it("canonicalizes scalar strings and object order without changing source bytes", () => {
  expect(canonicalChat("\n\t")).toBe('"\\u000a\\u0009"'); expect(canonicalChat("😀/")).toBe('"😀/"');
  expect(canonicalChat("\u0000")).toBe('"\\u0000"');
  expect(canonicalChat({ b: 2, a: 1 })).toBe(canonicalChat({ a: 1, b: 2 }));
  expect(() => canonicalChat({ a: undefined })).toThrow("chat_noncanonical_value");
  expect(() => canonicalChat("\ud800")).toThrow("chat_invalid_unicode");
  expect(() => parseChatJson('{"a":1,"a":2}')).toThrow("chat_duplicate_key");
  expect(() => parseChatJson('{"a":1,"\\u0061":2}')).toThrow("chat_duplicate_key");
 });
 it("accepts its exact complete grant and rejects recombined destination, scope, bytes and cost material", () => {
  const grant = chatFixture(), digest = chatGrantDigest(grant);
  expect(assertChatGrantBinding(JSON.parse(canonicalChat(grant)), digest)).toEqual(grant);
  const changes: Array<(g: typeof grant) => void> = [g => { g.selection.connectionId = g.grantId; }, g => { g.selection.revisionId = g.grantId; },
   g => { g.selection.modelId = "different-model"; }, g => { g.selection.endpoint = "https://other.fixture.invalid/"; }, g => { g.selection.configurationCanonical += " "; },
   g => { g.selection.authRevision.credentialBindingRevision = g.grantId; }, g => { g.selection.credentialSource.connectionId = g.grantId; },
   g => { g.selection.execution.poolConfigurationRevision = g.grantId; }, g => { g.selection.costDisclosure.reason = "Different cost assumption"; },
   g => { g.expiresAt = "2099-02-01T00:00:00.000Z"; }, g => { g.packet.question = "Different request"; },
   g => { g.packet.initialEnvelopes[0].accessAnchors.pop(); }, g => { g.scope.selectedProjectIds = []; }];
  for (const change of changes) { const next = structuredClone(grant); change(next); expect(() => assertChatGrantBinding(next, digest)).toThrow(); }
 });
 it.each(["\u0000", "a\u0000\u0000b", "literal \\u0000", "$openplan_chat_nul_v1", "\ue000/😀\n\u0000\t"])("retains the exact consent question %j", question => {
  const grant = chatFixture(); grant.packet.question = question;
  const canonical = canonicalChat(grant), digest = chatGrantDigest(grant);
  expect((parseChatJson(canonical) as typeof grant).packet.question).toBe(question);
  expect(assertChatGrantBinding(parseChatJson(canonical), digest).packet.question).toBe(question);
  expect(digest).not.toBe(chatGrantDigest({ ...grant, packet: { ...grant.packet, question: question + "x" } }));
 });
 it("refuses missing installed definitions and native/old project authority", () => {
  const changed = chatFixture(); changed.profile.definitionCanonical = "{}";
  expect(() => checkChatGrant(changed)).toThrow("chat_grant_definition_mismatch");
  for (const native of chatNativeFixtures) expect(chatSelectionSchema.safeParse(native).success).toBe(false);
  expect(chatSelectionSchema.safeParse({ kind: "saved_api", token: "op_pc_synthetic" }).success).toBe(false);
 });
});
