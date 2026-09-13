import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";

const review = dirname(fileURLToPath(import.meta.url));
const app = resolve(review, "../../../openplan");
const workerPath = join(app, "scripts/workers/engagement-email.ts");
const original = await readFile(workerPath, "utf8");
const messageText = JSON.stringify({ to: "worker-probe@example.invalid", subject: "SYNTHETIC local worker", text: "No provider delivery. Unsubscribe: http://localhost:3256/synthetic" });
const outboxId = "da000000-0000-4000-8000-000000000001";

async function until(check, message, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(message);
}

async function endpoint(primary) {
  const state = { claims: 0, finishes: [], origin: "" };
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const args = JSON.parse(body || "{}");
    let data = null;
    let status = 200;
    if (request.url === "/rest/v1/rpc/claim_engagement_response_email") {
      state.claims++;
      if (primary && state.claims === 1) data = { outboxId, state: "attempting", attemptToken: args.p_attempt,
        messageText, contentSha256: createHash("sha256").update(messageText).digest("hex") };
    } else if (request.url === "/rest/v1/rpc/finish_engagement_response_email") {
      state.finishes.push(args);
      if (primary && state.finishes.length === 1) { status = 503; data = { code: "SYNTHETIC", message: "Acknowledgement interrupted" }; }
      else data = true;
    } else if (request.url !== "/rest/v1/rpc/prepare_engagement_response_broadcast") {
      status = 404; data = { message: "Unexpected endpoint" };
    }
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(data));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  state.origin = `http://127.0.0.1:${server.address().port}`;
  return { state, server };
}

function startWorker(origin, directory) {
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: origin, NEXT_PUBLIC_SUPABASE_ANON_KEY: "SYNTHETIC",
    SUPABASE_SERVICE_ROLE_KEY: "SYNTHETIC", NEXT_PUBLIC_APP_URL: "http://localhost:3256", OPENPLAN_ENGAGEMENT_EMAIL_WORK_DIR: directory };
  delete env.RESEND_API_KEY;
  delete env.NODE_OPTIONS;
  const workerProcess = spawn("node", ["--conditions=react-server", "--import", "tsx", "scripts/workers/engagement-email.ts"], { cwd: app, env });
  const result = { process: workerProcess, output: "" };
  workerProcess.stdout.on("data", data => { result.output += data; });
  workerProcess.stderr.on("data", data => { result.output += data; });
  return result;
}

async function stop(worker) {
  if (!worker || worker.process.exitCode !== null) return;
  // This is a process started by this probe, never another app's worker.
  worker.process.kill("SIGTERM");
  await until(() => worker.process.exitCode !== null || worker.process.signalCode !== null, "Owned worker did not stop", 10000);
}

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else result.push(path);
  }
  return result;
}

async function exercise() {
  const directory = await mkdtemp("/home/nathaniel/.local/state/openplan/response-write-probe-20260913/worker-process-");
  const a = await endpoint(true);
  const b = await endpoint(false);
  let first, other, resumed;
  try {
    first = startWorker(a.state.origin, directory);
    await until(() => a.state.finishes.length === 1, "Initial worker did not journal its skipped delivery outcome");
    await stop(first);
    assert.equal((await files(directory)).filter(path => path.endsWith(".pending.json")).length, 1);
    other = startWorker(b.state.origin, directory);
    await until(() => b.state.claims > 0, "Second installation worker did not reach its own idle queue");
    await stop(other);
    assert.equal(b.state.finishes.length, 0, "A different installation consumed the first installation's outcome");
    resumed = startWorker(a.state.origin, directory);
    await until(() => a.state.finishes.length === 2, "Restart did not replay the retained outcome");
    await until(async () => (await files(directory)).some(path => path.endsWith(".recorded.json")), "Acknowledged outcome was not archived");
    await stop(resumed);
    assert.deepEqual(a.state.finishes[0], a.state.finishes[1]);
    assert.equal(a.state.finishes[1].p_state, "skipped");
    const output = first.output + other.output + resumed.output;
    assert.equal(output.split("email transport not configured").length - 1, 1, "Restart repeated the transport call");
    assert.ok(!output.includes("worker-probe@example.invalid"), "Worker logs disclosed the recipient");
    return { endpointMode: "local synthetic HTTP contracts", processRestart: true, separateInstallations: true,
      transportCalls: 1, providerConfigured: false, identicalOutcomeAcknowledgements: 2 };
  } finally {
    await stop(first); await stop(other); await stop(resumed);
    await Promise.all([new Promise(resolve => a.server.close(resolve)), new Promise(resolve => b.server.close(resolve))]);
  }
}

const cases = [
  ["baseline", original, null],
  ["harmless-comment", original + "\n// Harmless worker control.\n", null],
  ["lost-recovery", original.replace("await journal.recover(outcome => finishResponseEmail(client, outcome))", "{ unreadable: 0, pending: 0 }"), "Restart did not replay the retained outcome"],
  ["shared-installation-journal", original.replace("const directory = join(root, installation);", "const directory = root;"), "A different installation consumed the first installation's outcome"],
];
const results = [];
try {
  for (const [name, source, expected] of cases) {
    await writeFile(workerPath, source);
    let evidence = null;
    let diagnostic = null;
    try { evidence = await exercise(); } catch (error) { diagnostic = error.message; }
    const matched = expected === null ? diagnostic === null : diagnostic?.includes(expected);
    results.push({ name, matched: Boolean(matched), outcome: diagnostic ? "killed" : "survived", expected, diagnostic, evidence,
      workerSha256: createHash("sha256").update(source).digest("hex") });
    await writeFile(join(review, "worker-process-results.json"), JSON.stringify(results, null, 2) + "\n");
    console.log(name, results.at(-1).outcome, Boolean(matched));
    assert.ok(matched, diagnostic || "Unexpected survivor");
  }
} finally { await writeFile(workerPath, original); }
console.log("Original worker script restored; all owned worker and HTTP processes stopped");
