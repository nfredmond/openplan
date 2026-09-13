import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const review = fileURLToPath(new URL(".", import.meta.url)), app = resolve(review, "../../../openplan");
const source = join(app, "src/lib/engagement/close-loop.ts"), original = readFileSync(source, "utf8");
const scratch = mkdtempSync(join(tmpdir(), "openplan-m9b-consumers-"));
writeFileSync(join(scratch, "original.ts"), original, { mode: 0o600 });
const consumers = ["accepting-a-machine-translation-makes-it-the-agencys-own.test.ts", "engagement-portal-preview-page.test.tsx", "engagement-public-slug-resolution.test.ts", "close-loop-route.test.ts"];
const tests = [...consumers, "migrations/release-ordering.test.ts"].map(file => `src/test/${file}`);
const results = [];
try {
  for (const [name, before, after, broken] of [
    ["harmless-comment", "Read a complete database snapshot", "Read one complete database snapshot", false],
    ["wrong-rpc", 'supabase.rpc("read_engagement_response_snapshot"', 'supabase.rpc("wrong_snapshot"', true],
  ]) {
    if (!original.includes(before)) throw new Error("Missing mutation anchor");
    writeFileSync(source, original.replace(before, after));
    const output = join(scratch, `${name}.json`);
    const run = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", ...tests, "--reporter=json", `--outputFile=${output}`], { cwd: app, encoding: "utf8", timeout: 60000 });
    writeFileSync(source, original);
    const report = JSON.parse(readFileSync(output, "utf8"));
    if (report.numTotalTests !== 64 || report.numPendingTests !== 0) throw new Error("Unexpected census");
    const failures = report.testResults.flatMap(file => file.assertionResults.filter(test => test.status === "failed").map(test => ({ file: file.name.slice(app.length + 1), name: test.fullName, message: test.failureMessages.join("\n").slice(0, 700) })));
    const matched = broken ? run.status === 1 && consumers.every(file => failures.some(test => test.file.endsWith(file) && /AssertionError|expect\(/.test(test.message))) : run.status === 0 && failures.length === 0;
    results.push({ name, outcome: run.status === 0 ? "survived" : "killed", matched, failures });
    writeFileSync(join(review, "consumer-mutations.json"), JSON.stringify(results, null, 2) + "\n");
    process.stdout.write(`${name}: ${results.at(-1).outcome}, matched=${matched}\n`);
    if (!matched) process.exitCode = 1;
  }
} finally {
  writeFileSync(source, original);
  if (readFileSync(source, "utf8") !== original) throw new Error("Restore mismatch");
  process.stdout.write(`Restored source; recovery ${scratch}\n`);
}
