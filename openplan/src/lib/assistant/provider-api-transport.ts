import { lookup as dnsLookup } from "node:dns/promises";
import { Agent as HttpAgent, request as httpRequest, type RequestOptions } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { isIP, type LookupFunction, type TcpNetConnectOpts } from "node:net";
import { classifyAddress, hostIsAllowlisted, resolveOutboundAllowedHosts } from "@/lib/http/outbound-url";

export class ProviderApiTransportError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export type ProviderApiNetworkPolicy = {
  localEndpoints: readonly string[];
  allowedHosts: string[] | null;
};
type Lookup = (host: string) => Promise<Array<{ address: string; family: number }>>;
const defaultLookup: Lookup = host => dnsLookup(host, { all: true, verbatim: true });
function fail(code: string): never { throw new ProviderApiTransportError(code); }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

// Operator configuration is server-only. It never comes from a connection POST.
// Local exceptions name an exact loopback endpoint, not a network or host glob.
export function providerApiNetworkPolicy(env: NodeJS.ProcessEnv = process.env): ProviderApiNetworkPolicy {
  let local: unknown = [];
  if (env.OPENPLAN_AI_LOCAL_ENDPOINTS !== undefined) {
    try { local = JSON.parse(env.OPENPLAN_AI_LOCAL_ENDPOINTS); } catch { fail("api_endpoint_policy_invalid"); }
  }
  if (!Array.isArray(local) || local.length > 32 || local.some(value => typeof value !== "string")) fail("api_endpoint_policy_invalid");
  const localEndpoints = (local as string[]).map(value => {
    try { return apiEndpointUrl(value).href; } catch { return fail("api_endpoint_policy_invalid"); }
  });
  return { localEndpoints, allowedHosts: resolveOutboundAllowedHosts(env) };
}

function apiEndpointUrl(value: string): URL {
  if (typeof value !== "string" || value.length > 2048 || /[\s\u0000-\u001f\u007f\\]/.test(value)) fail("api_endpoint_invalid");
  let url: URL;
  try { url = new URL(value); } catch { return fail("api_endpoint_invalid"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.port === "0") fail("api_endpoint_invalid");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new ProviderApiTransportError("api_request_interrupted"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

// Resolve once and retain only those addresses for connection establishment.
// Every answer must satisfy policy. TLS still checks the original hostname.
async function resolveEndpoint(endpoint: string, policy: ProviderApiNetworkPolicy, lookup: Lookup, signal: AbortSignal) {
  const base = apiEndpointUrl(endpoint);
  const hostname = base.hostname.replace(/^\[|\]$/g, "");
  if (policy.allowedHosts && !hostIsAllowlisted(base.hostname, policy.allowedHosts)) fail("api_endpoint_denied");
  const local = policy.localEndpoints.includes(base.href);
  if (base.protocol !== "https:" && !local) fail("api_endpoint_denied");
  const literalFamily = isIP(hostname);
  let addresses: Awaited<ReturnType<Lookup>>;
  try {
    addresses = literalFamily ? [{ address: hostname, family: literalFamily }] : await untilAborted(lookup(hostname), signal);
  } catch { return fail(signal.aborted ? "api_request_interrupted" : "api_endpoint_unresolvable"); }
  if (!addresses.length || addresses.length > 64 || addresses.some(row =>
    !isIP(row.address) || isIP(row.address) !== row.family ||
    (local ? !["127.0.0.1", "::1"].includes(row.address) : classifyAddress(row.address).kind !== "public"))) fail("api_endpoint_denied");
  return { target: new URL("chat/completions", base), addresses: addresses.map(({ address, family }) => ({ address, family })) };
}

function checkedRequestBody(body: unknown, model: string): string {
  if (typeof body !== "string" || Buffer.byteLength(body) > 256_000) fail("api_request_body_invalid");
  let parsed: unknown;
  try { parsed = JSON.parse(body as string); } catch { return fail("api_request_body_invalid"); }
  if (!record(parsed) || parsed.model !== model || parsed.stream === true ||
    parsed.tools !== undefined || parsed.functions !== undefined || parsed.tool_choice !== undefined ||
    (parsed.n !== undefined && parsed.n !== 1) || !Number.isInteger(parsed.max_tokens) ||
    (parsed.max_tokens as number) < 1 || (parsed.max_tokens as number) > 4000 ||
    !record(parsed.response_format) || parsed.response_format.type !== "json_schema") fail("api_request_body_invalid");
  return body as string;
}

function checkedResponseBody(body: string, model: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return fail("api_response_invalid"); }
  if (!record(parsed) || typeof parsed.id !== "string" || !parsed.id.length || parsed.id.length > 200 ||
    /[\s\u0000-\u001f\u007f]/.test(parsed.id) || parsed.model !== model) fail("api_response_identity_invalid");
  if (!Array.isArray(parsed.choices) || parsed.choices.length !== 1 || !record(parsed.choices[0])) fail("api_response_invalid");
  const choice = parsed.choices[0];
  if (choice.finish_reason !== "stop" || !record(choice.message) || choice.message.role !== "assistant" ||
    typeof choice.message.content !== "string" ||
    (choice.message.tool_calls != null && (!Array.isArray(choice.message.tool_calls) || choice.message.tool_calls.length > 0)) ||
    choice.message.function_call != null) fail("api_response_incomplete");
}

// A fresh closure belongs to one saved attempt. The SDK may not redirect,
// substitute credentials, or make a second request through it. Caller owns
// project authorization, immutable connection revisions and business approvals.
export function createProviderApiFetch(args: {
  endpoint: string; model: string; apiKey: string | null; signal: AbortSignal;
  policy?: ProviderApiNetworkPolicy; lookup?: Lookup; timeoutMs?: number;
}): typeof fetch {
  const { endpoint, model, apiKey, signal: attemptSignal, lookup = defaultLookup } = args;
  const selectedPolicy = args.policy ?? providerApiNetworkPolicy();
  const policy = { localEndpoints: [...selectedPolicy.localEndpoints], allowedHosts: selectedPolicy.allowedHosts ? [...selectedPolicy.allowedHosts] : null };
  const base = apiEndpointUrl(endpoint);
  if (!model || model.length > 160 || /[\u0000-\u001f\u007f]/.test(model) ||
    (apiKey !== null && (!apiKey.length || apiKey.length > 8192 || /[^\x21-\x7e]/.test(apiKey)))) fail("api_connection_invalid");
  const timeoutMs = args.timeoutMs ?? 55_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 900_000) fail("api_connection_invalid");
  let called = false;
  return async (input, init) => {
    if (called) fail("api_request_repeated");
    called = true;
    const signal = AbortSignal.any([attemptSignal, ...(init?.signal ? [init.signal] : []), AbortSignal.timeout(timeoutMs)]);
    if (signal.aborted) fail("api_request_interrupted");
    if (!(typeof input === "string" || input instanceof URL) || String(input) !== new URL("chat/completions", base).href ||
      init?.method !== "POST") fail("api_request_destination_changed");
    const body = checkedRequestBody(init.body, model);
    const headers = new Headers(init.headers);
    for (const key of headers.keys()) if (!["content-type", "authorization", "user-agent"].includes(key)) fail("api_request_headers_invalid");
    if (headers.get("content-type") !== "application/json" || headers.get("authorization") !==
      (apiKey === null ? null : `Bearer ${apiKey}`)) fail("api_request_headers_invalid");
    const resolved = await resolveEndpoint(endpoint, policy, lookup, signal);
    if (signal.aborted) fail("api_request_interrupted");
    return new Promise<Response>((resolve, reject) => {
      // New non-global agents do not inherit NODE_USE_ENV_PROXY or global pools.
      const agent = resolved.target.protocol === "https:" ? new HttpsAgent({ keepAlive: false }) : new HttpAgent({ keepAlive: false });
      const pinnedLookup: LookupFunction = (_host, options, callback) => {
        if (options.all) callback(null, resolved.addresses);
        else callback(null, resolved.addresses[0].address, resolved.addresses[0].family);
      };
      const requestOptions: RequestOptions & Pick<TcpNetConnectOpts, "autoSelectFamily"> = {
        method: "POST", agent, lookup: pinnedLookup, autoSelectFamily: true, signal, maxHeaderSize: 16_384,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body),
          "accept": "application/json", "accept-encoding": "identity",
          ...(apiKey === null ? {} : { authorization: `Bearer ${apiKey}` }) },
      };
      const request = (resolved.target.protocol === "https:" ? httpsRequest : httpRequest)(resolved.target, requestOptions);
      const stop = (code: string) => { request.destroy(); agent.destroy(); reject(new ProviderApiTransportError(code)); };
      request.on("error", () => stop(signal.aborted ? "api_request_interrupted" : "api_request_failed"));
      request.on("response", response => {
        if (response.statusCode !== 200) {
          stop(response.statusCode === 429 ? "api_rate_limited" : [401, 403].includes(response.statusCode ?? 0) ? "api_auth_refused" : "api_response_failed"); return;
        }
        if (!/^application\/json(?:\s*;|$)/i.test(response.headers["content-type"] ?? "") ||
          ![undefined, "identity"].includes(response.headers["content-encoding"])) { stop("api_response_encoding_invalid"); return; }
        const chunks: Buffer[] = []; let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 512_000) stop("api_response_too_large"); else chunks.push(chunk);
        });
        response.on("error", () => stop(signal.aborted ? "api_request_interrupted" : "api_response_interrupted"));
        response.on("end", () => {
          agent.destroy();
          if (signal.aborted) { stop("api_request_interrupted"); return; }
          if (!response.complete) { stop("api_response_interrupted"); return; }
          try {
            const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
            checkedResponseBody(text, model); resolve(new Response(text, { headers: { "content-type": "application/json" } }));
          } catch (error) { reject(error instanceof ProviderApiTransportError ? error : new ProviderApiTransportError("api_response_invalid")); }
        });
      });
      request.end(body);
    });
  };
}
