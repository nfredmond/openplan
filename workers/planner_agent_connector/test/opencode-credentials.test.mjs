import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, symlink, readFile, stat, open } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareOpenCodeCredentials } from "../opencode-credentials.mjs";

async function fixture(value = { openai: { type: "api", key: "SYNTHETIC_KEY" } }) {
  const root = await mkdtemp(join(tmpdir(), "openplan-opencode-credentials-"));
  const auth = join(root, "auth.json"), directory = join(root, "snapshot");
  if (value !== undefined) await writeFile(auth, JSON.stringify(value), { mode: 0o600 });
  return { auth, directory };
}

test("copies only the inspected provider and known fields into a private fixed snapshot", async () => {
  const f = await fixture({ openai: { type: "api", key: "SYNTHETIC_KEY", metadata: { project: "SYNTHETIC_PROJECT" }, extra: "PRIVATE_EXTRA" },
    anthropic: { type: "api", key: "SYNTHETIC_OTHER_PROVIDER" } });
  const result = await prepareOpenCodeCredentials(f.auth, f.directory);
  assert.deepEqual(result.account, { status: "connected", authMode: "opencode_api", planType: null });
  assert.deepEqual(Object.keys(result).sort(), ["account", "snapshotPath"]);
  assert.equal((await stat(f.directory)).mode & 0o777, 0o700);
  assert.equal((await stat(result.snapshotPath)).mode & 0o777, 0o400);
  const expected = { openai: { type: "api", key: "SYNTHETIC_KEY", metadata: { project: "SYNTHETIC_PROJECT" } } };
  assert.deepEqual(JSON.parse(await readFile(result.snapshotPath, "utf8")), expected);
  await writeFile(f.auth, JSON.stringify({ openai: { type: "oauth", access: "SYNTHETIC_CHANGED" } }));
  assert.deepEqual(JSON.parse(await readFile(result.snapshotPath, "utf8")), expected);
});

test("refuses reused snapshot storage without overwriting it", async () => {
  const f = await fixture(); const first = await prepareOpenCodeCredentials(f.auth, f.directory);
  await writeFile(f.auth, JSON.stringify({ openai: { type: "api", key: "SYNTHETIC_CHANGED" } }));
  await assert.rejects(prepareOpenCodeCredentials(f.auth, f.directory), { code: "EEXIST" });
  assert.equal(JSON.parse(await readFile(first.snapshotPath, "utf8")).openai.key, "SYNTHETIC_KEY");
});

test("refuses a preexisting snapshot directory even without an auth file", async () => {
  const f = await fixture(); await mkdir(f.directory, { mode: 0o700 });
  await writeFile(join(f.directory, "private-canary"), "SYNTHETIC_EXISTING");
  await assert.rejects(prepareOpenCodeCredentials(f.auth, f.directory), { code: "EEXIST" });
  await assert.rejects(stat(join(f.directory, "auth.json")), { code: "ENOENT" });
});

for (const valid of [true, false]) test(`closes the inspected descriptor after ${valid ? "success" : "invalid JSON"}`, async t => {
  const f = await fixture();
  if (!valid) await writeFile(f.auth, "PRIVATE_BROKEN_JSON");
  const probe = await open(f.auth), prototype = Object.getPrototypeOf(probe); await probe.close();
  const originalStat = prototype.stat; let inspected;
  t.mock.method(prototype, "stat", function (...args) { inspected = this; return originalStat.apply(this, args); });
  try {
    if (valid) await prepareOpenCodeCredentials(f.auth, f.directory);
    else await assert.rejects(prepareOpenCodeCredentials(f.auth, f.directory), { message: "native_account_unreadable" });
    assert.ok(inspected);
    await assert.rejects(originalStat.call(inspected), { code: "EBADF" });
  } finally { if (inspected?.fd >= 0) await inspected.close(); }
});

test("missing credentials stay missing without creating a snapshot", async () => {
  const f = await fixture();
  const result = await prepareOpenCodeCredentials(join(f.auth, "..", "absent"), f.directory);
  assert.deepEqual(result, { account: { status: "needs_login", authMode: null, planType: null }, snapshotPath: null });
  await assert.rejects(stat(f.directory), { code: "ENOENT" });
});

for (const type of ["oauth", "wellknown"]) test(`does not copy unsupported ${type} credentials`, async () => {
  const f = await fixture({ openai: { type, key: "SYNTHETIC_KEY" } });
  assert.deepEqual(await prepareOpenCodeCredentials(f.auth, f.directory), {
    account: { status: "unsupported_auth_mode", authMode: null, planType: null }, snapshotPath: null,
  });
  await assert.rejects(stat(f.directory), { code: "ENOENT" });
});

test("unreadable JSON yields a fixed error without echoing private text", async () => {
  const f = await fixture(); await writeFile(f.auth, "PRIVATE_BROKEN_JSON");
  await assert.rejects(prepareOpenCodeCredentials(f.auth, f.directory), { message: "native_account_unreadable" });
});

test("refuses credential symlinks before copying their target", async () => {
  const f = await fixture(); const link = join(f.auth, "..", "link"); await symlink(f.auth, link);
  await assert.rejects(prepareOpenCodeCredentials(link, f.directory), { message: "native_credentials_not_private" });
});

test("refuses credential directories", async () => {
  const f = await fixture(); await mkdir(f.directory, { mode: 0o700 });
  await assert.rejects(prepareOpenCodeCredentials(f.directory, join(f.directory, "copy")), { message: "native_credentials_not_private" });
});

// Fake only metadata that a normal local user cannot create, and force short
// reads to challenge the reader independently of the operating system's timing.
for (const kind of ["foreign owner", "public mode", "large file", "large read", "short reads"]) test(`descriptor check: ${kind}`, async t => {
  const f = await fixture();
  if (kind === "large file" || kind === "large read") await writeFile(f.auth, (await readFile(f.auth, "utf8")).padEnd(256001, " "));
  const probe = await open(f.auth), prototype = Object.getPrototypeOf(probe); await probe.close();
  const originalStat = prototype.stat, originalRead = prototype.read;
  t.mock.method(prototype, "stat", async function (...args) {
    const value = await originalStat.apply(this, args);
    if (kind === "foreign owner") value.uid = process.getuid() + 1;
    if (kind === "public mode") value.mode |= 0o004;
    if (kind === "large read") value.size = 0;
    return value;
  });
  if (kind === "short reads") t.mock.method(prototype, "read", function (buffer, offset, length, position) {
    return originalRead.call(this, buffer, offset, Math.min(length, 7), position);
  });
  if (kind === "short reads") assert.equal((await prepareOpenCodeCredentials(f.auth, f.directory)).account.authMode, "opencode_api");
  else await assert.rejects(prepareOpenCodeCredentials(f.auth, f.directory), { message: "native_credentials_not_private" });
});

test("non-regular credentials cannot hold a reader open", { timeout: 5000 }, async () => {
  const f = await fixture(); const fifo = join(f.auth, "..", "fifo");
  await promisify(execFile)("mkfifo", ["-m", "600", fifo]);
  const moduleUrl = new URL("../opencode-credentials.mjs", import.meta.url).href;
  const script = `import {prepareOpenCodeCredentials} from ${JSON.stringify(moduleUrl)};
    try { await prepareOpenCodeCredentials(process.argv[1],process.argv[2]); console.log('unexpected_success'); }
    catch (error) { console.log(error.code); }`;
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script, fifo, f.directory], { timeout: 1500 });
  assert.equal(stdout.trim(), "native_credentials_not_private");
});
