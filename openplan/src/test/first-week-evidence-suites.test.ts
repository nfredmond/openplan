// @vitest-environment node
import { execFileSync } from "node:child_process";
import { describe, it } from "vitest";
import { locateHarnessDir } from "./qa-harness-location-helpers";

// These suites build temporary evidence records; they never launch a browser or
// connect to an application. Run their existing assertions in the ordinary app
// suite so acceptance-verifier regressions also fail local QA and shuffled CI.
describe("first-week evidence decisions", () => {
  for (const suite of [
    "first-week-discovery.test.js",
    "first-week-evidence.test.js",
    "first-week-regression.test.js",
    "verify-first-week-model-downloads.test.js",
  ]) {
    it(suite, () => {
      execFileSync(process.execPath, [suite], {
        cwd: locateHarnessDir(),
        encoding: "utf8",
        timeout: 20_000,
        stdio: "pipe",
      });
    }, 25_000);
  }
});
