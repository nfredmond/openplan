import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyProviderApiResponseReceipt } from "@/lib/assistant/provider-api-response-receipt";

function receipt(bytes = Buffer.from([0xff, 0, 0x41])) {
  return { schemaVersion: 1, statusCode: 200, contentType: "application/json", contentEncoding: null,
    bodyBase64: bytes.toString("base64"), bodySha256: createHash("sha256").update(bytes).digest("hex"),
    retainedBytes: bytes.length, bodyComplete: true, termination: "complete" };
}
describe("retained raw API receipts", () => {
  it("checks bytes without lossy decoding or a JSON assumption", () => {
    const bytes = Buffer.from([0xff, 0, 0x41]);
    expect(verifyProviderApiResponseReceipt(receipt(bytes), 4096)).toEqual({ receipt: receipt(bytes), bytes });
    expect(verifyProviderApiResponseReceipt({ ...receipt(), statusCode: 999, contentType: "text/plain", contentEncoding: "gzip" }, 4096).bytes).toEqual(bytes);
  });
  it.each([
    { schemaVersion: 2 }, { extra: true }, { statusCode: 99 }, { statusCode: 1000 }, { statusCode: 200.5 },
    { contentType: "a".repeat(16385) }, { contentEncoding: "a".repeat(16385) },
    { retainedBytes: -1 }, { retainedBytes: 1.5 }, { bodyComplete: "yes" }, { termination: "unknown" },
  ])("refuses invalid receipt fields %j", patch => {
    expect(() => verifyProviderApiResponseReceipt({ ...receipt(), ...patch }, 4096)).toThrow();
  });
  it("bounds retained and encoded byte counts before decoding", () => {
    expect(() => verifyProviderApiResponseReceipt(receipt(Buffer.alloc(4097)), 4096)).toThrow("authorized byte bound");
    expect(() => verifyProviderApiResponseReceipt({ ...receipt(), retainedBytes: 4097 }, 4096)).toThrow("authorized byte bound");
    expect(() => verifyProviderApiResponseReceipt({ ...receipt(), bodyBase64: "A".repeat(5465) }, 4096)).toThrow("authorized byte bound");
    for (const limit of [4095, 4194305, 4096.5]) expect(() => verifyProviderApiResponseReceipt(receipt(), limit)).toThrow();
  });
  it.each([
    { bodyBase64: "/wBB\n" }, { bodyBase64: "_wBB" }, { bodyBase64: "/wBB=" },
    { retainedBytes: 2 }, { bodySha256: "a".repeat(64) },
  ])("refuses changed bytes, encoding or checksum %j", patch => {
    expect(() => verifyProviderApiResponseReceipt({ ...receipt(), ...patch }, 4096)).toThrow("bytes or checksum differ");
  });
  it("accepts a complete response at the limit and an explicitly limited prefix", () => {
    const full = receipt(Buffer.alloc(4096, 0xff));
    expect(verifyProviderApiResponseReceipt(full, 4096).bytes.length).toBe(4096);
    const prefix = { ...full, bodyComplete: false, termination: "response_limit" };
    expect(verifyProviderApiResponseReceipt(prefix, 4096).receipt).toEqual(prefix);
  });
  it.each([
    { bodyComplete: false }, { bodyComplete: true, termination: "response_interrupted" },
    { bodyComplete: false, termination: "response_limit" }, { bodyComplete: false, termination: "request_failed" },
  ])("refuses contradictory completion fields %j", patch => {
    expect(() => verifyProviderApiResponseReceipt({ ...receipt(), ...patch }, 4096)).toThrow("completion state is inconsistent");
  });
  it("keeps an absent response distinct from a complete empty HTTP body", () => {
    const unknown = { ...receipt(Buffer.alloc(0)), statusCode: null, contentType: null, bodyComplete: false, termination: "request_failed" };
    expect(verifyProviderApiResponseReceipt(unknown, 4096).receipt).toEqual(unknown);
    expect(verifyProviderApiResponseReceipt({ ...unknown, termination: "request_interrupted" }, 4096).receipt.statusCode).toBeNull();
    expect(verifyProviderApiResponseReceipt(receipt(Buffer.alloc(0)), 4096).receipt.bodyComplete).toBe(true);
    for (const patch of [{ contentType: "text/plain" }, { contentEncoding: "identity" },
      { bodyComplete: true, termination: "complete" }, { termination: "response_interrupted" },
      { bodyBase64: receipt().bodyBase64, bodySha256: receipt().bodySha256, retainedBytes: 3 }]) {
      expect(() => verifyProviderApiResponseReceipt({ ...unknown, ...patch }, 4096)).toThrow("completion state is inconsistent");
    }
  });
});
