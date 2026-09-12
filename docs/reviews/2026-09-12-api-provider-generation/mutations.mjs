import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const review = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(review, "../../..");
const app = join(root, "openplan");
const path = join(app, "src/lib/assistant/provider-api-generation.ts");
const source = readFileSync(path, "utf8");
const scratch = mkdtempSync(join(tmpdir(), "openplan-api-generation-mutations-"));
const changes = [
  ["harmless-comment", "Capture inputs before awaiting anything", "Snapshot inputs before awaiting anything", "survived"],
  ...["workspaceId", "revisionId", "connectionId", "configurationHash"].map(field => [
    `revision-${field}`, `args.revision.${field} !== binding.${field}`, "false", "killed",
  ]),
  ["model-selection", "!configuration.modelIds.includes(binding.modelId)", "false", "killed"],
  ["auth-selection", 'binding.authMode !== (configuration.authMode === "api_key" ? "connection_api_key" : "connection_no_key")', "false", "killed"],
  ["charge-ack", "chargesAcknowledged: z.literal(true)", "chargesAcknowledged: z.boolean()", "killed"],
  ["packet-hash", 'createHash("sha256").update(args.packetCanonical).digest("hex") !== binding.packetHash', "false", "killed"],
  ["packet-byte-limit", "Buffer.byteLength(args.packetCanonical) > 200_000", "false", "killed"],
  ["packet-project", "packet.project.id !== binding.projectId", "false", "killed"],
  ["packet-workspace", "packet.workspaceId !== binding.workspaceId", "false", "killed"],
  ["credential-fallback", "apiKey = openProviderApiRevisionCredential(stored)", 'apiKey = "SYNTHETIC-SAVED-KEY"', "killed"],
  ["binding-snapshot", "binding = bindingSchema.parse(args.binding)", "binding = args.binding", "killed"],
  ["configuration-snapshot", "configuration = providerApiConfigurationSchema.parse(args.revision.configuration)", "configuration = args.revision.configuration", "killed"],
  ["repeated-invocation", "if (consumed)", "if (false)", "killed"],
  ["lost-cancellation", "const parentSignal = args.signal", "const parentSignal = new AbortController().signal", "killed"],
  ["ignored-lease", "Date.parse(binding.leaseExpiresAt) - Date.now()", "60_000", "killed"],
  ["ignored-timeout", "Math.min(configuration.timeoutSeconds * 1000, leaseRemaining)", "leaseRemaining", "killed"],
  ["receipt-revision", "revisionId: binding.revisionId,", "revisionId: binding.connectionId,", "killed"],
  ["wrong-proposal", "return { result, receipt:", 'if (result.proposal) result.proposal.payload.projectId = binding.workspaceId;\n      return { result, receipt:', "killed"],
  ["dropped-citation", "return { result, receipt:", "result.citations = [];\n      return { result, receipt:", "killed"],
];
const results = [];
try {
  for (const [name, before, after, expected] of changes) {
    if (source.split(before).length !== 2) throw new Error(`Mutation ${name} must have exactly one anchor`);
    writeFileSync(path, source.replace(before, after));
    const output = join(scratch, `${name}.json`);
    const run = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "src/test/provider-api-generation.test.ts", "--reporter=json", `--outputFile=${output}`],
      { cwd: app, encoding: "utf8", timeout: 30_000 });
    const report = JSON.parse(readFileSync(output, "utf8"));
    const failures = report.testResults.flatMap(file => file.assertionResults.filter(test => test.status === "failed").map(test => ({
      name: test.fullName, message: test.failureMessages.join("\n").slice(0, 1800),
    })));
    if (report.numTotalTests !== 28 || (run.status !== 0 && failures.length === 0)) throw new Error(`Invalid test execution: ${name}`);
    const outcome = run.status === 0 ? "survived" : "killed";
    results.push({ name, expected, outcome, failures });
    writeFileSync(join(review, "mutations.json"), JSON.stringify(results, null, 2) + "\n");
    process.stdout.write(`${name}: ${outcome}\n`);
    if (outcome !== expected) process.exitCode = 1;
  }
} finally { writeFileSync(path, source); }
