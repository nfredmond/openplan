import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectedWorkers, superviseWorkers } from "./supervise.mjs";

test("selection rejects unknown or duplicate queues", () => {
  assert.deepEqual(selectedWorkers("provider-api,document-exports"), ["provider-api", "document-exports"]);
  assert.throws(() => selectedWorkers("provider-api,typo"));
  assert.throws(() => selectedWorkers("provider-api,provider-api"));
});

test("an unexpected successful exit fails the service and stops its sibling", { timeout: 6000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "openplan-supervisor-"));
  const marker = join(root, "stopped");
  const controller = new AbortController();
  const fallback = setTimeout(() => controller.abort(), 3500);
  try {
    await writeFile(join(root, "provider-api.ts"), "setTimeout(() => process.exit(0), 900);\n");
    await writeFile(join(root, "document-exports.ts"), `import {writeFileSync} from 'node:fs'; process.on('SIGTERM',()=>{writeFileSync(${JSON.stringify(marker)},'stopped');process.exit(0)});setInterval(()=>{},100);`);
    const result = await superviseWorkers({ names: ["provider-api", "document-exports"], directory: root, signal: controller.signal, graceMs: 500, log: () => {} });
    assert.equal(result, 1, "a queue disappearing must fail the service even when it exits zero");
    assert.equal(await readFile(marker, "utf8"), "stopped");
  } finally { clearTimeout(fallback); controller.abort(); await rm(root, { recursive: true, force: true }); }
});

test("operator shutdown stops workers without reporting a queue failure", { timeout: 6000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "openplan-supervisor-"));
  const controller = new AbortController();
  try {
    await writeFile(join(root, "provider-api.ts"), "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},100);\n");
    const pending = superviseWorkers({ names: ["provider-api"], directory: root, signal: controller.signal, graceMs: 500, log: () => {} });
    setTimeout(() => controller.abort(), 900);
    assert.equal(await pending, 0);
  } finally { controller.abort(); await rm(root, { recursive: true, force: true }); }
});
