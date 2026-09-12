import { test as nodeTest, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectOpenCodeModels } from "../opencode-models.mjs";

const test = (name, fn) => nodeTest(name, { timeout: 2000 }, fn);
const receipts = [];
afterEach(async () => {
  for (const path of receipts.splice(0)) {
    const pid = Number(await readFile(path, "utf8").catch(() => ""));
    if (pid) { try { process.kill(pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } }
  }
});

async function fixture(mode = "normal") {
  const root = await mkdtemp(join(tmpdir(), "openplan-opencode-models-"));
  const command = join(root, "fixture"), receipt = join(root, "pid");
  receipts.push(receipt);
  await writeFile(command, `#!${process.execPath}
    const fs=require('node:fs');fs.writeFileSync(process.env.RECEIPT,String(process.pid));
    if(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['--unshare-net','--pure','models','openai']))process.exit(2);
    const mode=process.env.MODE;
    if(mode==='hold')setInterval(()=>{},1000);
    else if(mode==='stderr')process.stderr.write('PRIVATE'.repeat(10000));
    else if(mode==='stdout')process.stdout.write('x'.repeat(100001));
    else if(mode==='malformed')console.log('PRIVATE_INVALID_CATALOG');
    else {console.log('openai/gpt-6-astra');if(mode==='failed')process.exitCode=7;}
  `, { mode: 0o700 });
  return { receipt, launch: { command, args: ["--pure"], account: { status: "connected", authMode: "opencode_api" },
    options: { stdio: ["pipe", "pipe", "pipe"], shell: false, env: { MODE: mode, RECEIPT: receipt } } } };
}

async function gone(f) {
  const pid = Number(await readFile(f.receipt, "utf8"));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "native catalog command still running");
}

test("uses only the offline plain catalog command and waits for exit", async () => {
  const f = await fixture();
  assert.deepEqual(await inspectOpenCodeModels(f.launch), [{ id: "gpt-6-astra", label: "gpt-6-astra", isDefault: false }]);
  await gone(f);
});

for (const [mode, error] of [["failed", "native_process_failed"], ["stdout", "native_output_too_large"],
  ["stderr", "native_stderr_too_large"], ["malformed", "native_models_unreadable"], ["hold", "native_timeout"]]) {
  test(`catalog command refuses ${mode}`, async () => {
    const f = await fixture(mode);
    await assert.rejects(inspectOpenCodeModels(f.launch, { timeoutMs: 200 }), { message: error });
    await gone(f);
  });
}

test("cancelled catalog inspection cannot leave an owned child", async () => {
  const f = await fixture("hold"), controller = new AbortController();
  const pending = inspectOpenCodeModels(f.launch, { signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 100);
  try { await assert.rejects(pending, { message: "native_cancelled" }); }
  finally { clearTimeout(timer); }
  await gone(f);
});

test("pre-cancelled model inspection refuses before validating a launch", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(inspectOpenCodeModels({}, { signal: controller.signal }), { message: "native_cancelled" });
});

for (const account of [{ status: "needs_login", authMode: "opencode_api" }, { status: "connected", authMode: "apiKey" }]) {
  test(`catalog command requires OpenCode API mode: ${JSON.stringify(account)}`, async () => {
    const f = await fixture(); f.launch.account = account;
    await assert.rejects(inspectOpenCodeModels(f.launch), { message: "native_account_unavailable" });
    await assert.rejects(readFile(f.receipt), { code: "ENOENT" });
  });
}

test("missing catalog binary returns a fixed process error", async () => {
  const f = await fixture(); f.launch.command = "/nonexistent/openplan-model-command";
  await assert.rejects(inspectOpenCodeModels(f.launch), { message: "native_process_unavailable" });
});
