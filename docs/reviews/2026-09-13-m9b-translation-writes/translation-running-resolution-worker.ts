import { appendFileSync, closeSync, fsyncSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "../../../openplan/node_modules/zod";
import { createServiceRoleClient } from "../../../openplan/src/lib/supabase/server";
import { runTranslationGenerationWorkerCycle } from "../../../openplan/src/lib/engagement/translation-generation-worker";

// Use the actual worker and SDK against the isolated application database.
// Only the named synthetic field may be claimed, and provider traffic never leaves this process.
async function main() {
  const [configPath, directory, mode] = process.argv.slice(2);
  const config = z.object({ fieldId: z.string().uuid(), requestId: z.string().uuid(), sourceText: z.string().startsWith("SYNTHETIC "), outputText: z.string().includes("SINTÉTICO") }).strict().parse(JSON.parse(readFileSync(configPath, "utf8")));
  const target = "http://127.0.0.1:29821";
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== target || process.env.ANTHROPIC_API_KEY !== "SYNTHETIC-TRANSLATION-BROWSER-KEY" || !directory.startsWith("/home/nathaniel/.local/state/openplan/response-write-probe-20260913/")) throw new Error("Unexpected synthetic worker configuration");
  if (mode !== "running") throw new Error("Unexpected worker mode");
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init); const url = new URL(request.url);
    if (url.href === "https://api.anthropic.com/v1/messages") {
      if (request.headers.get("x-api-key") !== "SYNTHETIC-TRANSLATION-BROWSER-KEY") throw new Error("Wrong synthetic credential");
      const body = await request.json();
      if (body.model !== "synthetic-browser-model" || !JSON.stringify(body).includes(config.sourceText)) throw new Error("Wrong synthetic source or model");
      const eventPath = join(directory, "provider-events.jsonl");
      appendFileSync(eventPath, JSON.stringify({ providerTransportIntercepted: true, fieldId: config.fieldId }) + "\n", { mode: 0o600 });
      const fd = openSync(eventPath, "r"); try { fsyncSync(fd); } finally { closeSync(fd); }
      await new Promise<never>((_resolve, reject) => {
        const record = (event: string) => {
          appendFileSync(eventPath, JSON.stringify({ event, fieldId: config.fieldId }) + "\n", { mode: 0o600 });
          const eventFd = openSync(eventPath, "r"); try { fsyncSync(eventFd); } finally { closeSync(eventFd); }
        };
        const timer = setTimeout(() => {
          request.signal.removeEventListener("abort", abort);
          record("provider_abort_not_observed");
          reject(new Error("Synthetic provider cancellation deadline exceeded"));
        }, 45000);
        function abort() {
          clearTimeout(timer);
          record("provider_abort_observed");
          reject(new DOMException("Synthetic provider observed cancellation", "AbortError"));
        }
        if (request.signal.aborted) abort();
        else request.signal.addEventListener("abort", abort, { once: true });
      });
      throw new Error("Synthetic held provider must never complete");
    }
    if (url.origin !== target || !url.pathname.startsWith("/rest/v1/")) throw new Error("Unexpected network destination");
    if (url.pathname.includes("/rpc/")) {
      const body = await request.clone().json();
      if (body.p_field !== config.fieldId) throw new Error("Worker attempted another field");
    }
    const response = await nativeFetch(request);
    if (response.ok && request.method === "GET" && url.pathname.endsWith("/engagement_translation_generation_fields")) {
      const result = await response.clone().json(); const rows = Array.isArray(result) ? result : result === null ? [] : [result];
      if (rows.some(row => row.id !== config.fieldId || row.request_id !== config.requestId)) throw new Error("Worker selected another queued request");
    }
    if (url.pathname.endsWith("/retain_translation_generation_output")) throw new Error("Held provider has no output to retain");
    return response;
  };
  try {
    const result = await runTranslationGenerationWorkerCycle({ service: createServiceRoleClient(), target, directory, signal: new AbortController().signal, statusIntervalMs: 100 });
    process.stdout.write(JSON.stringify({ result }) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : "worker failed" }) + "\n"); process.exitCode = 1;
  }
}
void main().catch(() => { process.stderr.write("Synthetic browser worker could not start\n"); process.exitCode = 1; });
