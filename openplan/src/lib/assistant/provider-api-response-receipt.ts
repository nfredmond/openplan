import { createHash } from "node:crypto";
import { z } from "zod";
import type { ProviderApiResponseReceipt } from "./provider-api-transport";

const limitSchema = z.number().int().min(4096).max(4_194_304);
const receiptSchema = z.object({
  schemaVersion: z.literal(1), statusCode: z.number().int().min(100).max(999).nullable(),
  contentType: z.string().max(16_384).nullable(), contentEncoding: z.string().max(16_384).nullable(),
  bodyBase64: z.string(), bodySha256: z.string().regex(/^[a-f0-9]{64}$/),
  retainedBytes: z.number().int().nonnegative(), bodyComplete: z.boolean(),
  termination: z.enum(["complete", "response_limit", "request_interrupted", "response_interrupted", "request_failed"]),
}).strict();

/** Validate custody before interpreting or replaying saved provider bytes.
 * A matching local checksum does not authenticate a provider or prove billing.
 */
export function verifyProviderApiResponseReceipt(raw: unknown, responseByteLimit: number) {
  const limit = limitSchema.parse(responseByteLimit);
  const receipt: ProviderApiResponseReceipt = receiptSchema.parse(raw);
  if (receipt.retainedBytes > limit || receipt.bodyBase64.length > Math.ceil(limit / 3) * 4) {
    throw new Error("API receipt exceeds its authorized byte bound");
  }
  const bytes = Buffer.from(receipt.bodyBase64, "base64");
  if (bytes.toString("base64") !== receipt.bodyBase64 || bytes.length !== receipt.retainedBytes ||
    createHash("sha256").update(bytes).digest("hex") !== receipt.bodySha256) {
    throw new Error("API receipt bytes or checksum differ");
  }
  if (receipt.bodyComplete !== (receipt.termination === "complete") ||
    (receipt.termination === "response_limit" && receipt.retainedBytes !== limit) ||
    (receipt.statusCode === null ? receipt.contentType !== null || receipt.contentEncoding !== null || bytes.length !== 0 ||
      !["request_failed", "request_interrupted"].includes(receipt.termination) : receipt.termination === "request_failed")) {
    throw new Error("API receipt completion state is inconsistent");
  }
  return { receipt, bytes };
}
