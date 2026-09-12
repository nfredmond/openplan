// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type ServerResponse } from "node:http";
import * as http from "node:http";
import { createServer as createTlsServer } from "node:https";
import * as tls from "node:tls";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { generateText, Output } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { createProviderApiFetch, providerApiNetworkPolicy } from "@/lib/assistant/provider-api-transport";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); vi.unstubAllEnvs(); });
const responseBody = () => ({ id: "synthetic-response", model: "synthetic-model", choices: [
  { index: 0, finish_reason: "stop", message: { role: "assistant", content: '{"answer":"SYNTHETIC answer"}' } },
] });
const requestBody = () => ({ model: "synthetic-model", max_tokens: 4000,
  messages: [{ role: "user", content: "SYNTHETIC question" }],
  response_format: { type: "json_schema", json_schema: { name: "answer", schema: { type: "object" } } },
});

async function fixture(reply: (res: ServerResponse) => void = res => res.end(JSON.stringify(responseBody()))) {
  const calls: Array<{ host: string | undefined; path: string | undefined; auth: string | undefined; body: string }> = [];
  const arrived = Promise.withResolvers<void>();
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    calls.push({ host: req.headers.host, path: req.url, auth: req.headers.authorization, body: Buffer.concat(chunks).toString() });
    arrived.resolve();
    res.setHeader("content-type", "application/json");
    reply(res);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }));
  const port = (server.address() as AddressInfo).port;
  const endpoint = `http://model.fixture.invalid:${port}/custom/v1/`;
  const controller = new AbortController();
  const lookup = vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]);
  const policy = providerApiNetworkPolicy({ NODE_ENV: "test", OPENPLAN_AI_LOCAL_ENDPOINTS: JSON.stringify([endpoint]) });
  const args = { endpoint, model: "synthetic-model", apiKey: "SYNTHETIC-KEY" as string | null,
    signal: controller.signal, policy, lookup, timeoutMs: 1000 };
  const init = { method: "POST", body: JSON.stringify(requestBody()), headers: { "content-type": "application/json", authorization: "Bearer SYNTHETIC-KEY" } };
  return { endpoint, url: `${endpoint}chat/completions`, args, init, calls, lookup, policy, controller, arrived: arrived.promise };
}

describe("one approved API request", () => {
  it("runs the actual compatible SDK through the local transport", async () => {
    const f = await fixture();
    const provider = createOpenAICompatible({ name: "fixture", baseURL: f.endpoint.replace(/\/$/, ""),
      apiKey: f.args.apiKey!, supportsStructuredOutputs: true, fetch: createProviderApiFetch(f.args) });
    const result = await generateText({ model: provider(f.args.model), prompt: "SYNTHETIC question",
      output: Output.object({ schema: z.object({ answer: z.string() }) }), maxOutputTokens: 4000, maxRetries: 0 });
    expect(result.output).toEqual({ answer: "SYNTHETIC answer" });
    expect(result.response.id).toBe("synthetic-response");
    expect(f.calls).toHaveLength(1);
  });
  it("prevents the SDK from filling in a missing provider model ID", async () => {
    const f = await fixture(res => { const body: Record<string, unknown> = responseBody(); delete body.model; res.end(JSON.stringify(body)); });
    const provider = createOpenAICompatible({ name: "fixture", baseURL: f.endpoint.replace(/\/$/, ""),
      apiKey: f.args.apiKey!, supportsStructuredOutputs: true, fetch: createProviderApiFetch(f.args) });
    await expect(generateText({ model: provider(f.args.model), prompt: "SYNTHETIC question",
      output: Output.object({ schema: z.object({ answer: z.string() }) }), maxOutputTokens: 4000, maxRetries: 0 }))
      .rejects.toMatchObject({ code: "api_response_identity_invalid" });
    expect(f.calls).toHaveLength(1);
  });
  it("connects to the single checked address with original host/path and key", async () => {
    const f = await fixture();
    const fetch = createProviderApiFetch(f.args);
    const response = await fetch(f.url, f.init);
    expect(await response.json()).toEqual(responseBody());
    expect(f.lookup).toHaveBeenCalledExactlyOnceWith("model.fixture.invalid");
    expect(f.calls).toEqual([{ host: new URL(f.endpoint).host, path: "/custom/v1/chat/completions", auth: "Bearer SYNTHETIC-KEY", body: f.init.body }]);
    await expect(fetch(f.url, f.init)).rejects.toMatchObject({ code: "api_request_repeated" });
    expect(f.calls).toHaveLength(1);
  });

  it("does not follow changes to the caller's connection or network policy object", async () => {
    const f = await fixture();
    f.policy.allowedHosts = [new URL(f.endpoint).hostname];
    const fetch = createProviderApiFetch(f.args);
    f.args.endpoint = "https://changed.fixture.invalid/"; f.args.model = "changed-model"; f.args.apiKey = "CHANGED-KEY";
    (f.policy.localEndpoints as string[]).splice(0); f.policy.allowedHosts.splice(0, 1, "changed.fixture.invalid");
    expect((await fetch(f.url, f.init)).status).toBe(200);
    expect(f.calls[0].auth).toBe("Bearer SYNTHETIC-KEY");
  });

  it("can connect through an approved IPv4 answer when the local IPv6 address has no listener", async () => {
    const f = await fixture(); f.lookup.mockResolvedValue([{ address: "::1", family: 6 }, { address: "127.0.0.1", family: 4 }]);
    expect((await createProviderApiFetch(f.args)(f.url, f.init)).status).toBe(200);
    expect(f.calls).toHaveLength(1); expect(f.lookup).toHaveBeenCalledTimes(1);
  });

  it("uses an explicit no-key local connection without ambient credentials or proxy", async () => {
    const f = await fixture(); f.args.apiKey = null;
    const proxy = await fixture(); const proxyUrl = new URL(proxy.endpoint); proxyUrl.hostname = "127.0.0.1";
    const proxyControl = http as typeof http & { setGlobalProxyFromEnv(env: NodeJS.ProcessEnv): () => void };
    const restore = proxyControl.setGlobalProxyFromEnv({ NODE_ENV: "test", HTTP_PROXY: proxyUrl.origin });
    cleanups.push(async () => { restore(); });
    vi.stubEnv("OPENAI_API_KEY", "DO-NOT-SEND");
    expect((await createProviderApiFetch(f.args)(f.url, { ...f.init, headers: { "content-type": "application/json" } })).status).toBe(200);
    expect(f.calls).toHaveLength(1); expect(f.calls[0].auth).toBeUndefined(); expect(proxy.calls).toHaveLength(0);
  });

  it("keeps harmless provider metadata and strips response cookies", async () => {
    const f = await fixture(res => { res.setHeader("set-cookie", "private=value"); res.end(JSON.stringify({ ...responseBody(), harmlessExtra: true })); });
    const response = await createProviderApiFetch(f.args)(f.url, f.init);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toMatchObject({ harmlessExtra: true });
  });

  it("accepts empty optional tool metadata without treating it as a tool call", async () => {
    const f = await fixture(res => { const body = responseBody(); Object.assign(body.choices[0].message, { tool_calls: [], function_call: null }); res.end(JSON.stringify(body)); });
    expect((await createProviderApiFetch(f.args)(f.url, f.init)).status).toBe(200);
  });
});

describe("TLS identity with a real local server", () => {
  for (const mode of ["trusted", "untrusted", "wrong-hostname"]) {
    it(`keeps certificate verification: ${mode}`, async () => {
      const root = await mkdtemp(join(tmpdir(), "openplan-api-tls-"));
      cleanups.push(() => rm(root, { recursive: true, force: true }));
      const key = join(root, "fixture-key.pem"), cert = join(root, "fixture-cert.pem");
      await promisify(execFile)("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
        "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=model.fixture.invalid",
        "-addext", "subjectAltName=DNS:model.fixture.invalid"], { timeout: 5000 });
      const certBytes = await readFile(cert, "utf8");
      // Node 24's supported trust API is newer than this app's Node 20 types.
      const trust = tls as typeof tls & { getCACertificates(type: "default"): string[]; setDefaultCACertificates(certs: string[]): void };
      const original = trust.getCACertificates("default");
      if (mode !== "untrusted") trust.setDefaultCACertificates([...original, certBytes]);
      cleanups.push(async () => { trust.setDefaultCACertificates(original); });
      let calls = 0;
      const server = createTlsServer({ key: await readFile(key), cert: certBytes }, (req, res) => {
        calls++; req.resume(); res.setHeader("content-type", "application/json"); res.end(JSON.stringify(responseBody()));
      });
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      cleanups.unshift(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
      const endpoint = `https://${mode === "wrong-hostname" ? "wrong.fixture.invalid" : "model.fixture.invalid"}:${(server.address() as AddressInfo).port}/v1/`;
      const args = { endpoint, model: "synthetic-model", apiKey: null, signal: new AbortController().signal,
        policy: providerApiNetworkPolicy({ NODE_ENV: "test", OPENPLAN_AI_LOCAL_ENDPOINTS: JSON.stringify([endpoint]) }),
        lookup: vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]), timeoutMs: 1000 };
      const pending = createProviderApiFetch(args)(`${endpoint}chat/completions`, {
        method: "POST", body: JSON.stringify(requestBody()), headers: { "content-type": "application/json" },
      });
      if (mode === "trusted") { expect((await pending).status).toBe(200); expect(calls).toBe(1); }
      else { await expect(pending).rejects.toMatchObject({ code: "api_request_failed" }); expect(calls).toBe(0); }
      expect(args.lookup).toHaveBeenCalledTimes(1);
    });
  }
});

describe("endpoint and request refusals", () => {
  for (const endpoint of ["http://example.com/v1", "ftp://example.com/v1", "https://user:password@example.com/v1", "https://example.com/v1?key=secret", "https://example.com/v1#fragment", " https://example.com/v1", "https://example.com:0/v1"]) {
    it(`refuses unsafe endpoint ${endpoint}`, async () => {
      const f = await fixture();
      await expect(async () => createProviderApiFetch({ ...f.args, endpoint })(`${endpoint}/chat/completions`, f.init))
        .rejects.toMatchObject({ code: endpoint === "http://example.com/v1" ? "api_endpoint_denied" : "api_endpoint_invalid" });
      expect(f.calls).toHaveLength(0); expect(f.lookup).not.toHaveBeenCalled();
    });
  }
  for (const localEndpoints of ["broken", "{}", '["http://example.com/?secret=yes"]', '[12]']) {
    it(`refuses malformed operator configuration ${localEndpoints}`, () => {
      expect(() => providerApiNetworkPolicy({ NODE_ENV: "test", OPENPLAN_AI_LOCAL_ENDPOINTS: localEndpoints })).toThrow("api_endpoint_policy_invalid");
    });
  }
  for (const addresses of [[], [{ address: "169.254.169.254", family: 4 }], [{ address: "127.0.0.1", family: 4 }, { address: "93.184.216.34", family: 4 }], [{ address: "::ffff:a9fe:a9fe", family: 6 }], [{ address: "not-an-address", family: 4 }], [{ address: "127.0.0.1", family: 6 }]]) {
    it(`refuses non-loopback or ambiguous local DNS answers ${JSON.stringify(addresses)}`, async () => {
      const f = await fixture(); f.lookup.mockResolvedValue(addresses);
      await expect(createProviderApiFetch(f.args)(f.url, f.init)).rejects.toMatchObject({ code: "api_endpoint_denied" });
      expect(f.calls).toHaveLength(0);
    });
  }
  it("refuses private answers for an ordinary HTTPS endpoint", async () => {
    const f = await fixture(); const endpoint = "https://model.fixture.invalid/v1/";
    await expect(createProviderApiFetch({ ...f.args, endpoint })(`${endpoint}chat/completions`, f.init)).rejects.toMatchObject({ code: "api_endpoint_denied" });
    expect(f.calls).toHaveLength(0);
  });
  it("honors a narrowing operator host allowlist", async () => {
    const f = await fixture(); f.policy.allowedHosts = ["other.example"];
    await expect(createProviderApiFetch(f.args)(f.url, f.init)).rejects.toMatchObject({ code: "api_endpoint_denied" });
    expect(f.lookup).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0);
  });
  it("does not expose resolver error details", async () => {
    const f = await fixture(); f.lookup.mockRejectedValue(new Error("SYNTHETIC_PRIVATE_RESOLVER_MESSAGE"));
    await expect(createProviderApiFetch(f.args)(f.url, f.init)).rejects.toMatchObject({ code: "api_endpoint_unresolvable", message: "api_endpoint_unresolvable" });
    expect(f.calls).toHaveLength(0);
  });
  for (const change of ["destination", "method", "model", "body-limit", "unicode-body-limit", "invalid-json", "tools", "functions", "tool-choice", "stream", "tokens", "fractional-tokens", "zero-tokens", "multiple-answers", "schema", "authorization", "cookie"]) {
    it(`refuses changed ${change} before DNS or network`, async () => {
      const f = await fixture(); let url = f.url; const init = { ...f.init, headers: { ...f.init.headers } };
      const body: Record<string, unknown> = requestBody();
      if (change === "destination") url = `${f.endpoint}other`;
      if (change === "method") init.method = "GET";
      if (change === "model") body.model = "other-model";
      if (change === "body-limit") body.extra = "x".repeat(256_000);
      if (change === "unicode-body-limit") body.extra = "é".repeat(130_000);
      if (change === "tools") body.tools = [{ type: "function" }];
      if (change === "functions") body.functions = [{ name: "unexpected" }];
      if (change === "tool-choice") body.tool_choice = "auto";
      if (change === "stream") body.stream = true;
      if (change === "tokens") body.max_tokens = 4001;
      if (change === "fractional-tokens") body.max_tokens = 1.5;
      if (change === "zero-tokens") body.max_tokens = 0;
      if (change === "multiple-answers") body.n = 2;
      if (change === "schema") body.response_format = { type: "json_object" };
      if (change === "authorization") init.headers.authorization = "Bearer OTHER-KEY";
      if (change === "cookie") Object.assign(init.headers, { cookie: "secret" });
      init.body = change === "invalid-json" ? "{" : JSON.stringify(body);
      const code = ["destination", "method"].includes(change) ? "api_request_destination_changed" :
        ["authorization", "cookie"].includes(change) ? "api_request_headers_invalid" : "api_request_body_invalid";
      await expect(createProviderApiFetch(f.args)(url, init)).rejects.toMatchObject({ code });
      expect(f.lookup).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0);
    });
  }
});

describe("bounded raw response and interruption", () => {
  for (const mutation of ["missing-model", "wrong-model", "missing-id", "bad-id", "long-id", "incomplete", "multiple-choices", "tool-call", "function-call", "invalid-json", "invalid-utf8", "body-limit", "unicode-body-limit", "header-limit", "encoding", "content-type", "redirect", "authentication", "rate-limit"]) {
    it(`refuses ${mutation} without a second provider call`, async () => {
      const f = await fixture(res => {
        const body: Record<string, unknown> = responseBody();
        if (mutation === "missing-model") delete body.model;
        if (mutation === "wrong-model") body.model = "different-model";
        if (mutation === "missing-id") delete body.id;
        if (mutation === "bad-id") body.id = "unsafe\nidentifier";
        if (mutation === "long-id") body.id = "x".repeat(201);
        if (mutation === "incomplete") body.choices = [{ ...responseBody().choices[0], finish_reason: "length" }];
        if (mutation === "multiple-choices") body.choices = [...responseBody().choices, ...responseBody().choices];
        if (mutation === "tool-call") body.choices = [{ ...responseBody().choices[0], message: { ...responseBody().choices[0].message, tool_calls: [{ id: "unexpected-call", type: "function", function: { name: "unexpected", arguments: "{}" } }] } }];
        if (mutation === "function-call") body.choices = [{ ...responseBody().choices[0], message: { ...responseBody().choices[0].message, function_call: { name: "unexpected" } } }];
        if (mutation === "body-limit") body.extra = "x".repeat(512_001);
        if (mutation === "unicode-body-limit") body.extra = "é".repeat(256_001);
        if (mutation === "header-limit") res.setHeader("x-fixture-extra", "x".repeat(20_000));
        if (mutation === "encoding") res.setHeader("content-encoding", "gzip");
        if (mutation === "content-type") res.setHeader("content-type", "text/html");
        if (mutation === "redirect") { res.statusCode = 307; res.setHeader("location", "/redirect-target"); }
        if (mutation === "authentication") res.statusCode = 401;
        if (mutation === "rate-limit") res.statusCode = 429;
        const bytes = Buffer.from(JSON.stringify(body));
        if (mutation === "invalid-utf8") bytes[bytes.indexOf("SYNTHETIC")] = 0xff;
        res.end(mutation === "invalid-json" ? "{" : bytes);
      });
      const code = ["missing-model", "wrong-model", "missing-id", "bad-id", "long-id"].includes(mutation) ? "api_response_identity_invalid" :
        ["incomplete", "tool-call", "function-call"].includes(mutation) ? "api_response_incomplete" :
        ["encoding", "content-type"].includes(mutation) ? "api_response_encoding_invalid" :
        ["body-limit", "unicode-body-limit"].includes(mutation) ? "api_response_too_large" : mutation === "header-limit" ? "api_request_failed" : mutation === "redirect" ? "api_response_failed" :
        mutation === "authentication" ? "api_auth_refused" : mutation === "rate-limit" ? "api_rate_limited" : "api_response_invalid";
      await expect(createProviderApiFetch(f.args)(f.url, f.init)).rejects.toMatchObject({ code });
      expect(f.calls).toHaveLength(1);
    });
  }
  it("pre-cancelled requests never resolve DNS", async () => {
    const f = await fixture(); f.controller.abort();
    await expect(createProviderApiFetch(f.args)(f.url, f.init)).rejects.toMatchObject({ code: "api_request_interrupted" });
    expect(f.lookup).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0);
  });
  it("cancellation while DNS is pending returns without opening a socket", async () => {
    const f = await fixture(); f.args.timeoutMs = 30_000; f.lookup.mockImplementation(() => new Promise(() => {}));
    const pending = createProviderApiFetch(f.args)(f.url, f.init); f.controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "api_request_interrupted" });
    expect(f.calls).toHaveLength(0);
  });
  it("cancels an in-flight response without another generation", async () => {
    const f = await fixture(() => {}); f.args.timeoutMs = 30_000;
    const pending = createProviderApiFetch(f.args)(f.url, f.init);
    await f.arrived; f.controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "api_request_interrupted" });
    expect(f.calls).toHaveLength(1);
  });
  it("honors cancellation from the SDK request signal", async () => {
    const f = await fixture(() => {}); f.args.timeoutMs = 30_000;
    const controller = new AbortController();
    const pending = createProviderApiFetch(f.args)(f.url, { ...f.init, signal: controller.signal });
    await f.arrived; controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "api_request_interrupted" });
    expect(f.calls).toHaveLength(1);
  });
  it("bounds an unresponsive provider", async () => {
    const f = await fixture(() => {});
    await expect(createProviderApiFetch({ ...f.args, timeoutMs: 1000 })(f.url, f.init)).rejects.toMatchObject({ code: "api_request_interrupted" });
    expect(f.calls).toHaveLength(1);
  });
  it("refuses a truncated response", async () => {
    const f = await fixture(res => { res.setHeader("content-length", "10000"); res.flushHeaders(); res.write("{"); setImmediate(() => res.destroy()); });
    await expect(createProviderApiFetch(f.args)(f.url, f.init)).rejects.toMatchObject({ code: "api_response_interrupted" });
    expect(f.calls).toHaveLength(1);
  });
});
