import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export class NativeProviderError extends Error {
  constructor(code) { super(code); this.name = "NativeProviderError"; this.code = code; }
}

// Own one stdio process. Only complete, correlated JSON-RPC responses and final
// turn notifications count as results; EOF or a partial stream never does.
export function startCodexSession(launch, { onToolCall = async () => ({ success: false, contentItems: [{ type: "inputText", text: "This tool is not allowed for the selected project." }] }), timeoutMs = 180_000, signal } = {}) {
  const child = spawn(launch.command, launch.args, launch.options);
  const pending = new Map();
  const waiters = new Set();
  const notifications = [];
  const decoder = new StringDecoder("utf8");
  let nextId = 1, buffer = "", bytes = 0, stderrBytes = 0, failure = null, closed = false;
  let closeResolve;
  const exited = new Promise((resolve) => { closeResolve = resolve; });
  const fail = (code) => {
    if (failure) return;
    failure = new NativeProviderError(code);
    for (const call of pending.values()) call.reject(failure);
    pending.clear();
    for (const waiter of waiters) waiter.reject(failure);
    waiters.clear();
    child.kill("SIGTERM");
  };
  const timer = setTimeout(() => fail("native_timeout"), timeoutMs);
  const abort = () => fail("native_cancelled");
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();

  function send(value) {
    if (failure) throw failure;
    if (closed || !child.stdin.writable) throw new NativeProviderError("native_process_closed");
    const line = JSON.stringify(value);
    if (Buffer.byteLength(line) > 512_000) throw new NativeProviderError("native_input_too_large");
    child.stdin.write(`${line}\n`);
  }

  async function receive(message) {
    if (!message || typeof message !== "object" || Array.isArray(message)) return fail("native_protocol_invalid");
    if (Object.hasOwn(message, "id") && typeof message.method === "string") {
      if (message.method === "item/tool/call") {
        const params = message.params;
        if (!params || typeof params.tool !== "string" || typeof params.threadId !== "string" || typeof params.turnId !== "string") return fail("native_protocol_invalid");
        const result = await onToolCall(params);
        if (!closed && !failure) send({ id: message.id, result });
      } else {
        // No provider request can acquire shell, network, filesystem, login or
        // human business approval through this connector.
        send({ id: message.id, error: { code: -32601, message: "Unsupported project connector request" } });
      }
      return;
    }
    if (Object.hasOwn(message, "id")) {
      const call = pending.get(message.id);
      if (!call) return fail("native_response_unmatched");
      if (!Object.hasOwn(message, "result") && !message.error) return fail("native_protocol_invalid");
      pending.delete(message.id);
      if (message.error) call.reject(new NativeProviderError("native_request_failed"));
      else if (Object.hasOwn(message, "result")) call.resolve(message.result);
      else return fail("native_protocol_invalid");
      return;
    }
    if (typeof message.method !== "string" || !Object.hasOwn(message, "params")) return fail("native_protocol_invalid");
    const matches = [...waiters].filter((waiter) => waiter.method === message.method && waiter.matches(message.params));
    if (matches.length) {
      for (const waiter of matches) { waiters.delete(waiter); waiter.resolve(message.params); }
    } else {
      // Deltas are not needed to establish a completed answer. Keep only the
      // lifecycle receipts so a fast final event cannot race its request reply.
      if (["turn/completed", "thread/closed"].includes(message.method)) {
        notifications.push(message);
        if (notifications.length > 32) fail("native_notification_overflow");
      }
    }
  }

  child.stdout.on("data", (chunk) => {
    if (failure || closed) return;
    bytes += chunk.length;
    if (bytes > 8_000_000) return fail("native_output_too_large");
    buffer += decoder.write(chunk);
    if (Buffer.byteLength(buffer) > 512_000) return fail("native_frame_too_large");
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { fail("native_protocol_invalid"); return; }
      receive(message).catch(() => fail("native_tool_or_protocol_failed"));
    }
  });
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes > 256_000) fail("native_stderr_too_large");
  });
  child.stdin.on("error", () => fail("native_process_closed"));
  child.on("error", () => fail("native_process_unavailable"));
  child.on("close", () => {
    closed = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
    if (pending.size || waiters.size || buffer.trim()) fail("native_stream_interrupted");
    closeResolve();
  });

  return {
    request(method, params) {
      if (failure) return Promise.reject(failure);
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try { send({ method, params, id }); } catch (error) { pending.delete(id); reject(error); }
      });
    },
    notify(method, params) { send({ method, ...(params === undefined ? {} : { params }) }); },
    waitFor(method, matches = () => true) {
      if (failure) return Promise.reject(failure);
      const index = notifications.findIndex((item) => item.method === method && matches(item.params));
      if (index !== -1) return Promise.resolve(notifications.splice(index, 1)[0].params);
      if (closed) return Promise.reject(new NativeProviderError("native_stream_interrupted"));
      return new Promise((resolve, reject) => { waiters.add({ method, matches, resolve, reject }); });
    },
    async close() {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (!closed) {
        fail("native_session_closed");
        const force = setTimeout(() => child.kill("SIGKILL"), 2_000);
        await exited;
        clearTimeout(force);
      }
    },
  };
}
