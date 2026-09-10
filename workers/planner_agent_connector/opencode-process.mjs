import { spawn } from "node:child_process";
import { OPENCODE_PROTOCOL_VERSION } from "./opencode-launch.mjs";

export class OpenCodeProcessError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// Own one native server until close resolves. The caller may remove its private
// scratch only afterward. Never return raw native diagnostics or provider data.
export async function startOpenCodeServer(launch, {
  signal, startupTimeoutMs = 15_000, lifetimeMs = 180_000,
  requestTimeoutMs = 130_000, killGraceMs = 2000, fetchImpl = fetch,
} = {}) {
  if (signal?.aborted) throw new OpenCodeProcessError("native_cancelled");
  if (launch.account?.status !== "connected" || launch.account.authMode !== "opencode_api") {
    throw new OpenCodeProcessError("native_account_unavailable");
  }
  const password = launch.options?.env?.OPENCODE_SERVER_PASSWORD;
  if (!/^[a-f0-9]{64}$/.test(password ?? "") || launch.options.env.OPENCODE_SERVER_USERNAME !== "openplan") {
    throw new OpenCodeProcessError("native_server_secret_invalid");
  }
  const child = spawn(launch.command, [...launch.args, "serve", "--hostname", "127.0.0.1", "--port", "0"], launch.options);
  const stopped = new AbortController();
  let failure, origin, closing = false, exited = false, killTimer, stdout = "", stdoutBytes = 0, stderrBytes = 0;
  let resolveReady, rejectReady, resolveClosed;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  const stop = () => {
    if (closing || exited) return;
    closing = true;
    stopped.abort();
    child.kill("SIGTERM");
    killTimer = setTimeout(() => child.kill("SIGKILL"), killGraceMs);
  };
  const fail = code => {
    failure ??= new OpenCodeProcessError(code);
    rejectReady(failure);
    stop();
  };
  const abort = () => fail("native_cancelled");
  const startupTimer = setTimeout(() => fail("native_startup_timeout"), startupTimeoutMs);
  const lifetimeTimer = setTimeout(() => fail("native_timeout"), lifetimeMs);
  signal?.addEventListener("abort", abort, { once: true });
  child.stdin.on("error", () => { /* Child exit determines a closed stdin. */ });
  child.stdin.end();
  child.stdout.on("data", chunk => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > 65_536) return fail("native_output_too_large");
    stdout += chunk.toString("utf8");
    const banners = [...stdout.matchAll(/^opencode server listening on ([^\r\n]+)\r?\n/gm)];
    if (banners.length > 1) return fail("native_origin_invalid");
    if (banners.length === 1 && !origin) {
      const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(banners[0][1]);
      if (!match || Number(match[1]) > 65535) return fail("native_origin_invalid");
      origin = banners[0][1]; resolveReady();
    }
  });
  child.stderr.on("data", chunk => {
    stderrBytes += chunk.length;
    if (stderrBytes > 65_536) fail("native_stderr_too_large");
  });
  child.on("error", () => fail("native_process_unavailable"));
  child.on("close", () => {
    if (!closing) fail("native_process_exited");
    exited = true;
    stopped.abort();
    clearTimeout(startupTimer); clearTimeout(lifetimeTimer); clearTimeout(killTimer);
    signal?.removeEventListener("abort", abort);
    stdout = "";
    resolveClosed();
  });
  if (signal?.aborted) abort();

  async function close() {
    if (!closing && child.exitCode !== null) fail("native_process_exited");
    stop();
    await closed;
  }

  async function request(path, { method = "GET", body } = {}) {
    if (failure) throw failure;
    if (closing || exited) throw new OpenCodeProcessError("native_process_closed");
    const allowed = method === "GET" ? /^\/(?:global\/health|session\/[a-zA-Z0-9_-]{1,96}\/message\/[a-zA-Z0-9_-]{1,96})$/ :
      method === "POST" ? /^\/session(?:\/[a-zA-Z0-9_-]{1,96}\/(?:message|abort))?$/ : null;
    if (typeof path !== "string" || !allowed?.test(path) ||
      (method === "GET" && body !== undefined) ||
      (method === "POST" && (!body || typeof body !== "object" || Array.isArray(body)))) {
      throw new OpenCodeProcessError("native_request_invalid");
    }
    let serialized;
    try { serialized = body === undefined ? undefined : JSON.stringify(body); }
    catch { throw new OpenCodeProcessError("native_request_invalid"); }
    if (serialized && Buffer.byteLength(serialized) > 200_000) throw new OpenCodeProcessError("native_input_too_large");
    const deadline = AbortSignal.timeout(requestTimeoutMs);
    try {
      const response = await fetchImpl(`${origin}${path}`, {
        method, redirect: "manual", signal: AbortSignal.any([stopped.signal, deadline]),
        headers: { authorization: `Basic ${Buffer.from(`openplan:${password}`).toString("base64")}`,
          accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: serialized,
      });
      if (!response.ok || !response.body || !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
        await response.body?.cancel();
        throw new OpenCodeProcessError("native_http_failed");
      }
      let size = 0; const chunks = [];
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 256_000) throw new OpenCodeProcessError("native_output_too_large");
        chunks.push(chunk);
      }
      if (failure) throw failure;
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      fail(error instanceof OpenCodeProcessError ? error.code : deadline.aborted ? "native_request_timeout" : "native_http_failed");
      await closed;
      throw failure;
    }
  }

  try {
    await ready;
    const health = await request("/global/health");
    if (health?.healthy !== true || health.version !== OPENCODE_PROTOCOL_VERSION) {
      throw new OpenCodeProcessError("native_health_invalid");
    }
    if (failure) throw failure;
    clearTimeout(startupTimer);
    return { request, close, get failure() { return failure?.code ?? null; } };
  } catch (error) {
    fail(error instanceof OpenCodeProcessError ? error.code : "native_startup_failed");
    await close();
    throw failure;
  }
}
