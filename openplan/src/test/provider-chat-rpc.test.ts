import { describe, expect, it } from "vitest";
import { parseChatRpcResult } from "@/lib/assistant/provider-chat-rpc";
import { canonicalChat, chatHash } from "@/lib/assistant/provider-chat-task";

const wire = (value: unknown) => ({ wireVersion: 1, canonicalResult: canonicalChat(value) });
describe("chat RPC canonical response envelope", () => {
  it.each(["ordinary", "a\u0000\u0000b", "literal \\u0000", "\ue000😀\n\u0000\t"])("keeps exact logical bytes and hashes for %j", text => {
    const logical = { released: true, text, receipt: { rawBody: canonicalChat({ text }) } };
    const encoded = wire(logical), result = parseChatRpcResult(JSON.parse(JSON.stringify(encoded)));
    expect(result).toEqual(logical);
    expect(canonicalChat(result)).toBe(encoded.canonicalResult);
    expect(chatHash(canonicalChat(result))).toBe(chatHash(canonicalChat(logical)));
  });
  it.each([null, {}, { released: true }, { wireVersion: 2, canonicalResult: "{}" },
    { wireVersion: 1, canonicalResult: "{}", extra: true }, { wireVersion: 1, canonicalResult: 1 },
    { wireVersion: 1, canonicalResult: "null" }, { wireVersion: 1, canonicalResult: "[]" },
    { wireVersion: 1, canonicalResult: '{"a":1,"a":2}' }, { wireVersion: 1, canonicalResult: '{ "a":1}' },
    { wireVersion: 1, canonicalResult: '{"a":1.0}' },
  ])("refuses malformed, duplicate or noncanonical wire values %j", value => {
    expect(() => parseChatRpcResult(value)).toThrow();
  });
  it("preserves a logical refusal for existing authorization handling", () => {
    expect(parseChatRpcResult(wire({ released: false, failureCode: "chat_release_unavailable" })))
      .toEqual({ released: false, failureCode: "chat_release_unavailable" });
  });
});
