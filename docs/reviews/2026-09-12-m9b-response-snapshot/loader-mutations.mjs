import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const review = fileURLToPath(new URL(".", import.meta.url));
const app = resolve(review, "../../../openplan");
const lib = "src/lib/engagement/close-loop.ts";
const translation = "src/lib/engagement/campaign-translations.ts";
const originals = new Map([lib, translation].map(path => [path, readFileSync(join(app, path), "utf8")]));
const scratch = mkdtempSync(join(tmpdir(), "openplan-m9b-snapshot-"));
for (const [path, source] of originals) writeFileSync(join(scratch, path.replaceAll("/", "_")), source, { mode: 0o600 });
const cases = [
  ["harmless-comment", lib, "Read a complete database snapshot", "Read one complete database snapshot", null],
  ["lost-error", lib, "if (result.error) return { rows: [], error: result.error };", "if (result.error) return { rows: [], error: null };", "preserves the database error"],
  ["wrong-rpc", lib, 'supabase.rpc("read_engagement_response_snapshot"', 'supabase.rpc("wrong_snapshot"', "requests the exact campaign"],
  ["missing-decoder", lib, "entries: closeLoopEntrySchema.array()", "entries: z.array(z.unknown())", "refuses malformed entry"],
  ["malformed-pass-through", lib, 'if (!snapshot.success) return { rows: [], error: { message: "Saved responses could not be read completely" } };', 'if (!snapshot.success) return { rows: result.data.entries, error: null };', "withholds unreadable published-response translation fields"],
  ["missing-count", lib, "entries.length !== count", "false", "refuses count mismatch"],
  ["foreign-receipt", lib, "snapshot.data.campaignId !== campaignId", "false", "refuses foreign receipt"],
  ["wrong-publication-receipt", lib, "snapshot.data.publishedOnly !== publishedOnly", "false", "refuses wrong publication receipt"],
  ["duplicate-row", lib, "new Set(entries.map(row => row.id)).size !== entries.length", "false", "refuses duplicate row"],
  ["foreign-row", lib, "row.campaign_id !== campaignId", "false", "refuses foreign row"],
  ["draft-public-row", lib, '(publishedOnly && row.status !== "published")', "false", "refuses a draft"],
  ["public-scope-request", lib, "return loadResponseSnapshot(supabase, campaignId, true);", "return loadResponseSnapshot(supabase, campaignId, false);", "requests the exact campaign"],
  ["translation-scope", translation, "loadPublishedCloseLoopEntries(supabase, campaign.id)", 'loadPublishedCloseLoopEntries(supabase, "foreign")', "asks the database for what a participant sees"],
  ["translation-loses-error", translation, "if (closeLoop.error)", "if (false && closeLoop.error)", "withholds unreadable published-response translation fields"],
];
const tests = ["close-loop.test.ts", "engagement-campaign-detail-page.test.tsx", "public-engagement-page.test.tsx", "an-operator-can-author-a-campaigns-translations.test.tsx"].map(file => `src/test/${file}`);
const results = [];
try {
  for (const [name, path, before, after, expected] of cases) {
    const original = originals.get(path);
    if (!original.includes(before)) throw new Error(`Missing anchor: ${name}`);
    writeFileSync(join(app, path), original.replace(before, after));
    const output = join(scratch, `${name}.json`);
    const run = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", ...tests, "--reporter=json", `--outputFile=${output}`], { cwd: app, encoding: "utf8", timeout: 60000 });
    writeFileSync(join(app, path), original);
    const report = JSON.parse(readFileSync(output, "utf8"));
    if (report.numTotalTests !== 157 || report.numPendingTests !== 0) throw new Error("Unexpected census");
    const failures = report.testResults.flatMap(file => file.assertionResults.filter(test => test.status === "failed")
      .map(test => ({ name: test.fullName, message: test.failureMessages.join("\n").slice(0, 1000) })));
    const matched = expected === null ? run.status === 0 && failures.length === 0
      : run.status === 1 && failures.some(test => test.name.includes(expected) && /AssertionError|expect\(/.test(test.message));
    results.push({ name, outcome: run.status === 0 ? "survived" : "killed", matched, expected, failures });
    writeFileSync(join(review, "loader-mutations.json"), JSON.stringify(results, null, 2) + "\n");
    process.stdout.write(`${name}: ${results.at(-1).outcome}, matched=${matched}\n`);
    if (!matched) process.exitCode = 1;
  }
} finally {
  for (const [path, original] of originals) {
    writeFileSync(join(app, path), original);
    if (readFileSync(join(app, path), "utf8") !== original) throw new Error("Restore mismatch");
  }
  process.stdout.write(`Restored sources; recovery ${scratch}\n`);
}
