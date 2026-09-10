import { createServer } from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../connector.mjs", import.meta.url));
const connectionId = "11111111-1111-4111-8111-111111111111";
const setup = { version: 1, appUrl: "http://127.0.0.1:3219", connectionId, workspaceId: "22222222-2222-4222-8222-222222222222",
  projectId: "33333333-3333-4333-8333-333333333333", expectedAuthMode: "chatgpt", token: `op_pc_${connectionId}.${"x".repeat(43)}` };
const run = args => promisify(execFile)(process.execPath, [cli, ...args], { timeout: 5000, maxBuffer: 10_000 });
test("CLI imports only the supplied connection into private files without logging its token", async () => {
  const root = await mkdtemp(join(tmpdir(), "openplan-connector-cli-"));
  const downloaded = join(root, "download.json"), config = join(root, "private", "connection.json");
  await writeFile(downloaded, JSON.stringify(setup), { mode: 0o644 });
  const args = ["configure", "--config", config, "--setup", downloaded, "--binary", "/usr/bin/false", "--profile", root];
  const first = await run(args);
  assert.ok(!JSON.stringify(first).includes(setup.token));
  const saved = JSON.parse(await readFile(config, "utf8")); assert.deepEqual(saved.setup, setup);
  assert.equal((await stat(config)).mode & 0o077, 0); assert.equal((await stat(downloaded)).mode & 0o077, 0);
  await assert.rejects(run(args), error => error.code === 1 && !error.stderr.includes(setup.token));
  assert.deepEqual(JSON.parse(await readFile(config, "utf8")), saved, "Repeated setup overwrote an existing connection");
});
test("CLI refuses extra provider-endpoint arguments and does not echo secrets", async () => {
  await assert.rejects(run(["run", "--config", "/synthetic/config", "--model-provider", "PRIVATE_ARGUMENT_CANARY"]), error => {
    assert.match(error.stderr, /connector_arguments_invalid/); assert.ok(!error.stderr.includes("PRIVATE_ARGUMENT_CANARY")); return true;
  });
  const help = await run(["--help"]); assert.match(help.stdout, /configure/); assert.match(help.stdout, /Native sign-in remains in/);
});

test("one-shot polling distinguishes an idle reply from an unavailable app", async () => {
  const root=await mkdtemp(join(tmpdir(),"openplan-connector-once-"));
  let status=200,calls=0;
  const server=createServer((request,response)=>{calls++;request.resume();response.writeHead(status,{"content-type":"application/json"});response.end(status===200?JSON.stringify({status:"unavailable",turn:null}):JSON.stringify({error:"PRIVATE_HTTP_BODY"}));});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const config=join(root,"connection.json"),appUrl=`http://127.0.0.1:${server.address().port}`;
    await writeFile(config,JSON.stringify({setup:{...setup,appUrl},binaryPath:"/usr/bin/false",providerHome:root}),{mode:0o600});
    const control=await run(["run","--config",config,"--once"]);assert.match(control.stdout,/unavailable/);assert.equal(calls,1);
    status=503;
    await assert.rejects(run(["run","--config",config,"--once"]),error=>{
      assert.equal(error.code,1);assert.match(error.stderr,/connector_request_refused/);assert.ok(!error.stderr.includes("PRIVATE_HTTP_BODY"));assert.ok(!error.stderr.includes(setup.token));return true;
    });
    assert.equal(calls,2,"One-shot failure must not retry automatically");
  } finally {await new Promise(resolve=>server.close(resolve));}
});
