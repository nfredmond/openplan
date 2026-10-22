import { z } from "zod";
import { canonicalChat, parseChatJson } from "./provider-chat-task";

const chatRpcWireSchema = z.object({ wireVersion: z.literal(1), canonicalResult: z.string() }).strict();

// Decode the public RPC envelope after PostgREST. Logical NUL stays escaped
// inside canonical text until JavaScript receives the authenticated response.
export function parseChatRpcResult(raw: unknown): Record<string, unknown> {
  const wire = chatRpcWireSchema.parse(raw);
  const result = z.record(z.string(), z.unknown()).parse(parseChatJson(wire.canonicalResult));
  if (canonicalChat(result) !== wire.canonicalResult) throw new Error("chat_rpc_result_noncanonical");
  return result;
}
