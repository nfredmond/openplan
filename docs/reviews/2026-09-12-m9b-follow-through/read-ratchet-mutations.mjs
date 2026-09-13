import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const review = fileURLToPath(new URL(".", import.meta.url));
const app = resolve(review, "../../../openplan");
const source = join(app, "src/lib/engagement/close-loop.ts");
const original = readFileSync(source, "utf8");
const scratch = mkdtempSync(join(tmpdir(), "openplan-m9b-ratchet-"));
writeFileSync(join(scratch, "original.ts"), original, { mode: 0o600 });
const cases = [
  ["harmless-comment", original.replace("Staff responses for the builder", "Saved staff responses for the builder"), false],
  ["discard-read-error", original
    .replace("const { data, error } = await supabase", "const { data } = await supabase")
    .replace("rows: error ? [] : (data ?? [])", "rows: (data ?? [])")
    .replace("error: error ?? null", "error: null"), true],
];
const results = [];
try {
  for (const [name, mutated, broken] of cases) {
    if (mutated === original) throw new Error(`Missing mutation anchor: ${name}`);
    writeFileSync(source, mutated);
    const output = join(scratch, `${name}.json`);
    const run = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run",
      "src/test/a-library-may-not-discard-a-read-error.test.ts", "--reporter=json", `--outputFile=${output}`],
    { cwd: app, encoding: "utf8", timeout: 60000 });
    writeFileSync(source, original);
    const report = JSON.parse(readFileSync(output, "utf8"));
    if (report.numTotalTests !== 36 || report.numPendingTests !== 0) throw new Error("Unexpected test census");
    const failures = report.testResults.flatMap(file => file.assertionResults
      .filter(test => test.status === "failed")
      .map(test => ({ name: test.fullName, message: test.failureMessages.join("\n").slice(0, 1800) })));
    const matched = broken
      ? run.status === 1 && failures.some(test => /close-loop\.ts/.test(test.message) && /AssertionError/.test(test.message))
      : run.status === 0 && failures.length === 0;
    results.push({ name, outcome: run.status === 0 ? "survived" : "killed", matched, failures });
    writeFileSync(join(review, "read-ratchet-mutations.json"), JSON.stringify(results, null, 2) + "\n");
    process.stdout.write(`${name}: ${results.at(-1).outcome}, matched=${matched}\n`);
    if (!matched) process.exitCode = 1;
  }
} finally {
  writeFileSync(source, original);
  if (readFileSync(source, "utf8") !== original) throw new Error("Restore mismatch");
  writeFileSync(join(scratch, "restored.json"), JSON.stringify({ sha256: createHash("sha256").update(original).digest("hex") }));
  process.stdout.write(`Restored source; recovery ${scratch}\n`);
}
