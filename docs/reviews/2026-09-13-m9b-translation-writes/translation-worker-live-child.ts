import { appendFileSync, closeSync, fsyncSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "../../../openplan/node_modules/@supabase/supabase-js";
import { runTranslationGenerationWorkerCycle } from "../../../openplan/src/lib/engagement/translation-generation-worker";

// Only synthetic provider transport is intercepted. Every database query and
// command crosses the real local PostgREST service into the dedicated proof DB.
async function main() {
const [configPath, directory, mode] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configPath, "utf8")) as { token: string; target: string };
if (config.target !== "http://127.0.0.1:38962") throw new Error("Unexpected proof target");
process.env.OPENPLAN_INTEGRATION_KEY_SECRET = "SYNTHETIC-QUEUE-PROBE-SECRET-0123456789";
const nativeFetch = globalThis.fetch;
async function barrier(name: string): Promise<never> {
  process.stdout.write(JSON.stringify({ barrier: name }) + "\n");
  return new Promise(() => { setInterval(() => {}, 1000); });
}
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.href === "https://api.anthropic.com/v1/messages") {
    if (request.headers.get("x-api-key") !== "SYNTHETIC-QUEUE-PROVIDER-KEY") throw new Error("Wrong synthetic payer");
    const body = await request.json();
    if (body.model !== "synthetic-queue-model" || !JSON.stringify(body).includes("Keep the final words.")) throw new Error("Wrong synthetic packet");
    const eventPath = join(directory, "provider-events.jsonl");
    appendFileSync(eventPath, JSON.stringify({ providerTransportIntercepted: true }) + "\n", { mode: 0o600 });
    const fd = openSync(eventPath, "r"); try { fsyncSync(fd); } finally { closeSync(fd); }
    if (mode === "running-crash") return barrier("provider-awaiting-response");
    return new Response(JSON.stringify({ id: "SYNTHETIC\0response", type: "message", role: "assistant", model: "synthetic\ud800model",
      content: [{ type: "text", text: "  SYNTHETIC translated words.  " }], stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 7 } }), { headers: { "content-type": "application/json" } });
  }
  if (url.origin !== config.target || !url.pathname.startsWith("/rest/v1/")) throw new Error("Unexpected network destination");
  if (url.pathname.endsWith("/retain_translation_generation_output") && mode === "completed-crash") return barrier("completion-before-delivery");
  url.pathname = url.pathname.replace(/^\/rest\/v1/, "");
  const response = await nativeFetch(new Request(url, request));
  if (response.ok && url.pathname.endsWith("/authorize_translation_generation_dispatch") && mode === "dispatch-loss") throw new Error("Synthetic dispatch acknowledgement loss");
  if (response.ok && url.pathname.endsWith("/retain_translation_generation_output") && mode === "output-loss") throw new Error("Synthetic output acknowledgement loss");
  return response;
};
const service = createClient(config.target, config.token, { auth: { persistSession: false, autoRefreshToken: false } });
try {
  const result = await runTranslationGenerationWorkerCycle({ service, target: config.target, directory, signal: new AbortController().signal, statusIntervalMs: 100 });
  process.stdout.write(JSON.stringify({ result }) + "\n");
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : "worker failed" }) + "\n"); process.exitCode = 1;
}

}
void main().catch(() => { process.stderr.write("Synthetic worker harness failed to start\n"); process.exitCode = 1; });
