import { spawn } from "node:child_process";
import { mkdir, open, rename, lstat, mkdtemp, rm } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { connectorRequest, checkedConnectorJob, ConnectorError, readPrivateJson } from "./connector-client.mjs";
import { connectorProviderAdapter } from "./native-provider.mjs";

export async function privateConnectorDirectory(path) {
  if (!isAbsolute(path)) throw new ConnectorError("connector_path_invalid");
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) throw new ConnectorError("connector_directory_not_private");
}
export async function writeConnectorJournal(directory, value) {
  const temporary = join(directory, `pending-${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
  await rename(temporary, join(directory, "pending.json"));
  const parent = await open(directory, "r"); try { await parent.sync(); } finally { await parent.close(); }
}

// flock execs cat without forking, so one child owns both the OS lock and
// this pipe. Parent loss closes the pipe; child loss releases the lock.
export async function acquireConnectorLock(directory) {
  await privateConnectorDirectory(directory);
  const file = await open(join(directory, "run.lock"), "a", 0o600); await file.close();
  const child = spawn("/usr/bin/flock", ["--exclusive", "--nonblock", "--no-fork", join(directory, "run.lock"), "/usr/bin/cat"], { stdio: ["pipe", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin" } });
  const lost = new AbortController(); child.on("exit", () => lost.abort());
  child.stdin.on("error", () => {}); child.stderr.resume();
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.stdin.end(); reject(new ConnectorError("connector_lock_unavailable")); }, 3000);
    child.once("error", () => { clearTimeout(timeout); reject(new ConnectorError("connector_lock_unavailable")); });
    child.once("exit", () => { clearTimeout(timeout); reject(new ConnectorError("connector_already_running")); });
    child.stdout.once("data", data => { clearTimeout(timeout); if (data.toString() === "locked\n") resolve(); else reject(new ConnectorError("connector_lock_unavailable")); });
    child.stdin.write("locked\n");
  });
  return { signal: lost.signal, async release() {
    const ended = child.exitCode === null && child.signalCode === null ? once(child, "exit") : null;
    child.stdin.end();
    if (ended) await ended;
  } };
}

function failureCode(error) {
  const code = error?.code ?? error?.message;
  return typeof code === "string" && /^native_[a-z_]{1,100}$/.test(code) ? code : "native_connector_failed";
}
async function pendingJournal(directory) {
  try { return await readPrivateJson(join(directory, "pending.json"), 500_000); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

// Completed output is synced before delivery. Restart resends the same attempt
// and result. A crash during generation becomes an interruption, never a second
// model call whose cost or duplicate answer the planner did not choose.
export async function connectorCycle(config, directory, options = {}) {
  const request = options.request ?? connectorRequest;
  const adapter = connectorProviderAdapter(config.setup);
  const inspect = options.inspect ?? adapter.inspect;
  const generate = options.generate ?? adapter.generate;
  const signal = options.signal;
  const report = options.report ?? (() => {});
  let pending = await pendingJournal(directory);
  if (pending?.phase === "delivered") pending = null;
  if (pending) {
    if (pending.connectionId !== config.setup.connectionId || pending.appUrl !== config.setup.appUrl || !["running", "completed"].includes(pending.phase)) throw new ConnectorError("connector_journal_mismatch");
    checkedConnectorJob(pending.job, config.setup);
    if (pending.phase === "running") {
      pending = { ...pending, phase: "completed", delivery: { operation: "finish", turnId: pending.job.id, attemptId: pending.job.attemptId,
        answer: null, receipt: null, failureCode: "native_connector_interrupted" } };
      await writeConnectorJournal(directory, pending);
    }
  } else {
    signal?.throwIfAborted();
    const inspectWork = await mkdtemp(join(directory, "inspect-"));
    let account;
    try { account = await inspect({ binaryPath: config.binaryPath, providerHome: config.providerHome, scratchPath: inspectWork, signal }); }
    catch { account = { status: "unavailable", authMode: null }; }
    finally { await rm(inspectWork, { recursive: true, force: true }); }
    const status = account.status === "connected" ? "connected" : account.status === "needs_login" ? "needs_login" : "unavailable";
    const claimed = await request(config.setup, { operation: "claim", status, authMode: ["chatgpt", "apiKey", "claude_subscription", "opencode_api"].includes(account.authMode) ? account.authMode : null }, { signal });
    if (!claimed || typeof claimed.status !== "string" || !("turn" in claimed)) throw new ConnectorError("connector_response_invalid");
    report(claimed.status);
    if (!claimed.turn) return { state: "idle", connectionStatus: claimed.status };
    const job = checkedConnectorJob(claimed.turn, config.setup);
    if (status !== "connected" || claimed.status !== "connected" || account.authMode !== config.setup.expectedAuthMode) throw new ConnectorError("connector_auth_mode_changed");
    pending = { version: 1, connectionId: config.setup.connectionId, appUrl: config.setup.appUrl, phase: "running", job };
    await writeConnectorJournal(directory, pending);
    const aborted = new AbortController();
    const runningSignal = AbortSignal.any([...(signal ? [signal] : []), aborted.signal]);
    let stopWatching = false, timer;
    async function observeStatus() {
      try {
        const current = await request(config.setup, { operation: "status", turnId: job.id }, { signal: runningSignal });
        const deadline = Date.parse(current?.leaseExpiresAt ?? "");
        if (current?.id !== job.id || current?.attemptId !== job.attemptId || current?.state !== "running" || !Number.isFinite(deadline) || deadline <= Date.now()) aborted.abort();
      } catch { aborted.abort(); }
      if (!stopWatching && !runningSignal.aborted) timer = setTimeout(() => { void observeStatus(); }, options.statusIntervalMs ?? 2000);
    }
    let delivery;
    try {
      await observeStatus(); runningSignal.throwIfAborted();
      if (Date.parse(job.leaseExpiresAt) <= Date.now()) throw new ConnectorError("native_attempt_expired");
      report("running");
      const scratchPath = await mkdtemp(join(directory, "turn-"));
      let generated;
      try {
        generated = await generate({ binaryPath: config.binaryPath, providerHome: config.providerHome, scratchPath,
          model: job.model, expectedAuthMode: job.authMode, instructions: job.instructions, prompt: job.prompt, outputSchema: job.outputSchema, signal: runningSignal });
      } finally { await rm(scratchPath, { recursive: true, force: true }); }
      runningSignal.throwIfAborted();
      if (generated.provider !== adapter.provider || generated.model !== job.model || generated.authMode !== job.authMode ||
        typeof generated.answer !== "string" || Buffer.byteLength(generated.answer) > 64_000) throw new ConnectorError("native_result_mismatch");
      delivery = { operation: "finish", turnId: job.id, attemptId: job.attemptId, answer: generated.answer, failureCode: null,
        receipt: { schemaVersion: 1, provider: adapter.provider, model: generated.model, authMode: generated.authMode,
          planType: generated.planType, threadId: generated.threadId, turnId: generated.turnId } };
    } catch (error) {
      delivery = { operation: "finish", turnId: job.id, attemptId: job.attemptId, answer: null, receipt: null,
        failureCode: runningSignal.aborted ? "native_connector_interrupted" : failureCode(error) };
    } finally { stopWatching = true; if (timer) clearTimeout(timer); }
    pending = { ...pending, phase: "completed", delivery };
    await writeConnectorJournal(directory, pending);
  }
  if (pending.delivery?.turnId !== pending.job.id || pending.delivery?.attemptId !== pending.job.attemptId || pending.delivery?.operation !== "finish") throw new ConnectorError("connector_journal_mismatch");
  report("delivering");
  let saved;
  try { saved = await request(config.setup, pending.delivery, { signal }); }
  catch (error) {
    if (error.status !== 409) throw error;
    const current = await request(config.setup, { operation: "status", turnId: pending.job.id }, { signal });
    if (current?.id !== pending.job.id || current?.attemptId !== pending.job.attemptId || !["cancelled", "interrupted"].includes(current?.state)) throw error;
    saved = current;
  }
  if (saved?.id !== pending.job.id || saved?.attemptId !== pending.job.attemptId || !["succeeded", "failed", "cancelled", "interrupted"].includes(saved?.state)) throw new ConnectorError("connector_delivery_mismatch");
  await writeConnectorJournal(directory, { ...pending, phase: "delivered", acknowledgedState: saved.state });
  report(saved.state);
  return { state: saved.state, turnId: saved.id };
}
