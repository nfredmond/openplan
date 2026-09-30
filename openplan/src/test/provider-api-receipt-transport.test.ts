// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createProviderApiReceiptRequest, type ProviderApiResponseReceipt } from "@/lib/assistant/provider-api-transport";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.unstubAllEnvs(); });
const requestBody = (max_tokens = 8192) => JSON.stringify({ model: "receipt-fixture", max_tokens,
  messages: [{ role: "user", content: "SYNTHETIC input" }],
  response_format: { type: "json_schema", json_schema: { name: "segment", schema: { type: "object" } } },
});
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function fixture(reply: (res: ServerResponse) => void) {
  const calls: Array<{ path: string | undefined; host: string | undefined; auth: string | undefined; body: string }> = [];
  const arrived = Promise.withResolvers<void>();
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    calls.push({ path: req.url, host: req.headers.host, auth: req.headers.authorization, body: Buffer.concat(chunks).toString() });
    arrived.resolve();
    res.setHeader("content-type", "application/json");
    reply(res);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections(); server.close(error => error ? reject(error) : resolve());
  }));
  const endpoint = `http://receipt.fixture.invalid:${(server.address() as AddressInfo).port}/v1/`;
  const controller = new AbortController();
  const lookup = vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]);
  const args = { endpoint, model: "receipt-fixture", apiKey: "SYNTHETIC-KEY" as string | null,
    signal: controller.signal, lookup, policy: { localEndpoints: [endpoint], allowedHosts: null as string[] | null },
    timeoutMs: 1000, maxOutputTokens: 8192, responseByteLimit: 4096 };
  return { args, calls, controller, lookup, arrived: arrived.promise };
}

function expectBytes(receipt: ProviderApiResponseReceipt, bytes: Buffer) {
  expect(receipt.bodyBase64).toBe(bytes.toString("base64"));
  expect(receipt.bodySha256).toBe(sha(bytes));
  expect(receipt.retainedBytes).toBe(bytes.length);
}

describe("synthesis raw API response custody", () => {
  it("retains the exact bytes and limited headers in a versioned receipt", async () => {
    const bytes = Buffer.from('{"id":"synthetic","extra":"🌉"}\n');
    const f = await fixture(res => {
      res.setHeader("set-cookie", "SYNTHETIC-PRIVATE"); res.setHeader("x-unrelated", "SYNTHETIC-PRIVATE"); res.end(bytes);
    });
    const send = createProviderApiReceiptRequest(f.args);
    const receipt = await send(requestBody());
    expect(receipt).toEqual({ schemaVersion: 1, statusCode: 200, contentType: "application/json", contentEncoding: null,
      bodyBase64: bytes.toString("base64"), bodySha256: sha(bytes), retainedBytes: bytes.length, bodyComplete: true, termination: "complete" });
    expect(f.lookup).toHaveBeenCalledExactlyOnceWith("receipt.fixture.invalid");
    expect(f.calls).toEqual([{ path: "/v1/chat/completions", host: new URL(f.args.endpoint).host,
      auth: "Bearer SYNTHETIC-KEY", body: requestBody() }]);
    await expect(send(requestBody())).rejects.toMatchObject({ code: "api_request_repeated" });
    expect(f.calls).toHaveLength(1);
  });

  for (const mode of ["malformed-json", "invalid-utf8", "incomplete-output", "non-json", "encoded", "redirect", "unauthorized", "rate-limited", "server-error"]) {
    it(`retains ${mode} without semantic approval or a retry`, async () => {
      const bytes = mode === "invalid-utf8" ? Buffer.from([0xff, 0x00, 0xed, 0xa0, 0x80]) :
        Buffer.from(mode === "incomplete-output" ? '{"choices":[{"finish_reason":"length","message":{"content":"partial"}}]}' : "{broken\n");
      const status = mode === "redirect" ? 307 : mode === "unauthorized" ? 401 : mode === "rate-limited" ? 429 : mode === "server-error" ? 500 : 200;
      const f = await fixture(res => {
        res.statusCode = status;
        if (mode === "non-json") res.setHeader("content-type", "text/plain");
        if (mode === "encoded") res.setHeader("content-encoding", "gzip");
        if (mode === "redirect") res.setHeader("location", "/must-not-follow");
        res.end(bytes);
      });
      const send = createProviderApiReceiptRequest(f.args);
      const receipt = await send(requestBody());
      expectBytes(receipt, bytes);
      expect(receipt).toMatchObject({ statusCode: status, bodyComplete: true, termination: "complete",
        contentType: mode === "non-json" ? "text/plain" : "application/json", contentEncoding: mode === "encoded" ? "gzip" : null });
      await expect(send(requestBody())).rejects.toMatchObject({ code: "api_request_repeated" });
      expect(f.calls).toHaveLength(1);
    });
  }

  for (const [length, limit] of [[4096, 4096], [4097, 4096], [4_194_304, 4_194_304], [4_194_305, 4_194_304]]) {
    it(`retains bounded bytes for ${length} bytes at a ${limit} byte limit`, async () => {
      const bytes = Buffer.alloc(length, 0xff);
      const f = await fixture(res => res.end(bytes));
      const receipt = await createProviderApiReceiptRequest({ ...f.args, responseByteLimit: limit })(requestBody());
      expectBytes(receipt, bytes.subarray(0, limit));
      expect(receipt.bodyComplete).toBe(length <= limit);
      expect(receipt.termination).toBe(length <= limit ? "complete" : "response_limit");
      expect(f.calls).toHaveLength(1);
    });
  }

  it("retains the received prefix when the provider ends before its content length", async () => {
    const bytes = Buffer.from('{"part":"🌉');
    const f = await fixture(res => { res.setHeader("content-length", "10000"); res.setHeader("connection", "close"); res.end(bytes); });
    const receipt = await createProviderApiReceiptRequest(f.args)(requestBody());
    expectBytes(receipt, bytes);
    expect(receipt).toMatchObject({ statusCode: 200, bodyComplete: false, termination: "response_interrupted" });
    expect(f.calls).toHaveLength(1);
  });

  it("retains a prefix on deadline without claiming the advertised length arrived", async () => {
    const bytes = Buffer.from("SYNTHETIC prefix");
    const f = await fixture(res => { res.setHeader("content-length", "10000"); res.write(bytes); });
    const send = createProviderApiReceiptRequest({ ...f.args, timeoutMs: 150 });
    const receipt = await send(requestBody());
    expectBytes(receipt, bytes);
    expect(receipt).toMatchObject({ bodyComplete: false, termination: "request_interrupted" });
    await expect(send(requestBody())).rejects.toMatchObject({ code: "api_request_repeated" });
    expect(f.calls).toHaveLength(1);
  });

  it("cancels without headers and records unknown response status", async () => {
    const f = await fixture(() => {});
    const pending = createProviderApiReceiptRequest({ ...f.args, timeoutMs: 30_000 })(requestBody());
    await f.arrived; f.controller.abort();
    const receipt = await pending;
    expectBytes(receipt, Buffer.alloc(0));
    expect(receipt).toMatchObject({ statusCode: null, contentType: null, contentEncoding: null,
      bodyComplete: false, termination: "request_interrupted" });
    expect(f.calls).toHaveLength(1);
  });

  it("records a socket failure without inventing an HTTP response or repeating", async () => {
    const f = await fixture(res => res.destroy());
    const send = createProviderApiReceiptRequest(f.args);
    const receipt = await send(requestBody());
    expectBytes(receipt, Buffer.alloc(0));
    expect(receipt).toMatchObject({ statusCode: null, bodyComplete: false, termination: "request_failed" });
    await expect(send(requestBody())).rejects.toMatchObject({ code: "api_request_repeated" });
    expect(f.calls).toHaveLength(1);
  });

  it("permits the declared larger synthesis packet without widening the project profile", async () => {
    const f = await fixture(res => res.end("{}"));
    const body = JSON.parse(requestBody(65_536));
    body.messages[0].content = "é".repeat(600_000);
    const text = JSON.stringify(body);
    await createProviderApiReceiptRequest({ ...f.args, maxOutputTokens: 65_536 })(text);
    expect(f.calls[0].body).toBe(text);
    expect(f.calls).toHaveLength(1);
  });

  it("snapshots the selected endpoint, credentials, limits and policy", async () => {
    const f = await fixture(res => res.end("{}"));
    const send = createProviderApiReceiptRequest(f.args);
    f.args.endpoint = "http://changed.invalid/"; f.args.apiKey = "CHANGED"; f.args.model = "changed";
    f.args.maxOutputTokens = 1; f.args.responseByteLimit = 1; f.args.policy.localEndpoints.splice(0);
    await send(requestBody());
    expect(f.calls[0]).toMatchObject({ path: "/v1/chat/completions", auth: "Bearer SYNTHETIC-KEY", body: requestBody() });
    expect(f.calls).toHaveLength(1);
  });

  it("uses explicit no-key authentication without an ambient key", async () => {
    const f = await fixture(res => res.end("{}"));
    vi.stubEnv("OPENAI_API_KEY", "DO-NOT-SEND");
    await createProviderApiReceiptRequest({ ...f.args, apiKey: null })(requestBody());
    expect(f.calls[0].auth).toBeUndefined();
  });
});

describe("receipt requests retain network and resource restrictions", () => {
  for (const [field, value] of [["maxOutputTokens", 0], ["maxOutputTokens", 65_537], ["maxOutputTokens", 1.5],
    ["responseByteLimit", 4095], ["responseByteLimit", 4_194_305], ["responseByteLimit", 4096.5]] as const) {
    it(`refuses invalid ${field} ${value}`, async () => {
      const f = await fixture(res => res.end("{}"));
      expect(() => createProviderApiReceiptRequest({ ...f.args, [field]: value })).toThrow("api_receipt_limits_invalid");
      expect(f.calls).toHaveLength(0); expect(f.lookup).not.toHaveBeenCalled();
    });
  }
  for (const mode of ["tokens", "body-limit", "model", "stream", "tools", "json", "schema"]) {
    it(`rejects ${mode} before network and consumes the invocation`, async () => {
      const f = await fixture(res => res.end("{}"));
      const body = JSON.parse(requestBody());
      if (mode === "tokens") body.max_tokens = 8193;
      if (mode === "body-limit") body.messages[0].content = "é".repeat(4 * 1024 * 1024);
      if (mode === "model") body.model = "changed";
      if (mode === "stream") body.stream = true;
      if (mode === "tools") body.tools = [];
      if (mode === "schema") body.response_format.type = "json_object";
      const send = createProviderApiReceiptRequest(f.args);
      await expect(send(mode === "json" ? "{" : JSON.stringify(body))).rejects.toMatchObject({ code: "api_request_body_invalid" });
      await expect(send(requestBody())).rejects.toMatchObject({ code: "api_request_repeated" });
      expect(f.calls).toHaveLength(0); expect(f.lookup).not.toHaveBeenCalled();
    });
  }
  for (const mode of ["endpoint", "host", "mixed-dns", "pre-abort", "resolver"]) {
    it(`refuses ${mode} without opening a provider connection`, async () => {
      const f = await fixture(res => res.end("{}"));
      if (mode === "endpoint") f.args.policy.localEndpoints = [];
      if (mode === "host") f.args.policy.allowedHosts = ["other.invalid"];
      if (mode === "mixed-dns") f.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }, { address: "10.0.0.1", family: 4 }]);
      if (mode === "pre-abort") f.controller.abort();
      if (mode === "resolver") f.lookup.mockRejectedValue(new Error("SYNTHETIC secret"));
      const code = mode === "pre-abort" ? "api_request_interrupted" : mode === "resolver" ? "api_endpoint_unresolvable" : "api_endpoint_denied";
      await expect(createProviderApiReceiptRequest(f.args)(requestBody())).rejects.toMatchObject({ code, message: code });
      expect(f.calls).toHaveLength(0);
      if (["endpoint", "host", "pre-abort"].includes(mode)) expect(f.lookup).not.toHaveBeenCalled();
      else expect(f.lookup).toHaveBeenCalledExactlyOnceWith("receipt.fixture.invalid");
    });
  }
});
