import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

// Mock only the provider's component interfaces. The real provider and result
// validator run; separate native probes exercise the actual installed runtime.
for (const mode of ["good", "needsLogin", "unsupported", "changedMode", "unknownModel", "badSession", "badTurn", "zeroBudget",
  "relayFailure", "lateRelayFailure", "lateServerFailure", "serverCloseFailure", "callerCancellation", "lateCancellation",
  "changedReadback", "inspectGood", "inspectMissing", "inspectNoModels"]) {
  test(`OpenCode provider joins retained components: ${mode}`, async () => {
    const { stdout } = await promisify(execFile)(process.execPath, ["--experimental-test-module-mocks",
      fileURLToPath(new URL("./fixtures/opencode-provider-wiring.mjs", import.meta.url)), mode], { timeout: 5000, maxBuffer: 65_536 });
    assert.equal(stdout.trim(), `provider wiring ${mode} passed`);
  });
}
