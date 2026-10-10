import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { createRequire } from "node:module";
import { admitGtfsSubmission } from "../../../openplan/src/lib/gtfs/managed-admission.ts";
import { runGtfsSubmissionRecoveryPass } from "../../../openplan/src/lib/gtfs/managed-submission-recovery.ts";
import { authorizeManagedGtfsSubmission } from "../../../openplan/src/lib/gtfs/managed-source.ts";
import { readGtfsStatus } from "../../../openplan/src/lib/gtfs/managed-worker-service.ts";
import { runGtfsQueuePass } from "../../../openplan/src/lib/gtfs/managed-worker-queue.ts";

const require = createRequire(process.cwd() + "/package.json");
const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
const [directory, mode, archiveFile, kind] = process.argv.slice(2);
await mkdir(directory, { recursive: true, mode: 0o700 });
const restUrl = process.env.OPENPLAN_PROOF_HTTP_URL!, storageUrl = process.env.OPENPLAN_PROOF_STORAGE_URL!;
const bytes = await readFile(archiveFile), sha256 = createHash("sha256").update(bytes).digest("hex");
let uploads = 0, resolutions = 0, publication = null;
const calls: string[] = [];
const identityPath = join(directory, "identity.json");
let identity: { installationId: string; requestId: string; workspaceId: string; actorId: string; feedId?: string; versionId?: string };
if (mode === "seed") {
  identity = { installationId: randomUUID(), requestId: randomUUID(), workspaceId: process.env.OPENPLAN_PROOF_WORKSPACE!, actorId: process.env.OPENPLAN_PROOF_ACTOR! };
  await writeFile(identityPath, JSON.stringify(identity), { mode: 0o600 }); process.exit(0);
}
identity = JSON.parse(await readFile(identityPath, "utf8"));
const marker = async (boundary: string) => {
  await writeFile(join(directory, "interrupted.json"), JSON.stringify({ boundary, uploads, resolutions, calls }), { mode: 0o600 }); await new Promise(() => {});
};
const transport: typeof fetch = async (input, init) => {
  const target = new URL(String(input)); assert.equal(target.origin, new URL(restUrl).origin);
  if (target.pathname.startsWith("/storage/v1/")) {
    const headers = new Headers(init?.headers); headers.set("Authorization", "Bearer " + process.env.OPENPLAN_PROOF_STORAGE_TOKEN!); headers.set("apikey", process.env.OPENPLAN_PROOF_STORAGE_TOKEN!);
    const response = await fetch(storageUrl + target.pathname.slice("/storage/v1".length) + target.search, { ...init, headers });
    if (init?.method === "POST") {
      uploads++; assert.equal(new Headers(init.headers).get("x-upsert"), "false"); assert.ok(init.signal); assert.equal(response.status, 200);
      if (mode === "interrupt-upload") await marker("upload-committed");
    }
    return response;
  }
  assert.ok(target.pathname.startsWith("/rest/v1/")); const name = target.pathname.split("/").at(-1)!; calls.push(name);
  if (name === "admit_gtfs_ingest" && mode === "interrupt-local") await marker("private-bytes-before-admission");
  target.pathname = target.pathname.slice("/rest/v1".length); const response = await fetch(target, init);
  if (name === "admit_gtfs_ingest" && response.ok) {
    const receipt = await response.clone().json(); identity = { ...identity, feedId: receipt.feedId, versionId: receipt.versionId };
    await writeFile(identityPath, JSON.stringify(identity), { mode: 0o600 });
    if (mode === "interrupt-admit") await marker("admission-committed");
  }
  if (name === "confirm_gtfs_archive" && mode === "interrupt-confirm") { assert.equal(response.status, 200); await marker("confirmation-committed"); }
  return response;
};
const service = createClient(restUrl, process.env.OPENPLAN_PROOF_HTTP_TOKEN!, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport } });
const options = { ...identity, directory: join(directory, "submissions", identity.requestId), target: restUrl,
  intent: { source: kind, name: basename(directory) }, signal: new AbortController().signal, service, serviceKey: process.env.OPENPLAN_PROOF_HTTP_TOKEN!, storageFetch: transport,
  upload: kind === "upload" && mode.startsWith("interrupt-") ? bytes : undefined, env: {},
  resolve: async archive => {
    resolutions++; assert.ok(mode.startsWith("interrupt-"), "Recovery resolved mutable source metadata");
    if (kind === "upload") { assert.equal(archive!.sha256, sha256); return { feedId: null, source: { kind: "upload", provisionalName: "BART native submission", uploadSha256: archive!.sha256, uploadBytes: archive!.bytes } }; }
    const sourceUrl = `https://example.invalid/${identity.requestId}.zip`;
    return { feedId: null, source: { kind: kind as "url" | "catalog", provisionalName: "Synthetic native URL/catalog submission", sourceUrl, normalizedSourceUrl: sourceUrl,
      ...(kind === "catalog" ? { catalogProvider: "Synthetic catalog", catalogSourceId: identity.requestId, catalogRowStatus: "active" } : {}) } };
  } } satisfies Parameters<typeof admitGtfsSubmission>[0];
let handoff = null;
let result;
if (mode.startsWith("resume-")) {
  handoff = await runGtfsSubmissionRecoveryPass({ ...options, directory: join(directory, "submissions"),
    authorize: (saved, signal) => authorizeManagedGtfsSubmission(service, saved, signal), resolve: (_saved, archive) => options.resolve(archive), maxJobs: 1 });
  assert.deepEqual(handoff.outcomes, [{requestId: identity.requestId, state: "handed_off"}]); assert.equal(handoff.pendingCount, 0);
  const saved = JSON.parse(await readFile(join(options.directory, "pending.json"), "utf8"));
  result = { registration: saved.response, status: await readGtfsStatus(service, { workspaceId: identity.workspaceId, actorId: identity.actorId, versionId: saved.response.versionId }, options.signal) };
  const retained = await runGtfsSubmissionRecoveryPass({ ...options, directory: join(directory, "submissions"), authorize: async () => { throw new Error("Handed off history should be skipped"); }, resolve: () => { throw new Error("Retained metadata should be skipped"); } });
  assert.deepEqual(retained, { outcomes: [], pendingCount: 0 });
} else result = await admitGtfsSubmission(options);
assert.equal(result.registration.requestId, identity.requestId); assert.equal(result.registration.versionId, identity.versionId);
assert.equal(resolutions, 0, "Fresh process did not reuse retained resolution");
assert.equal(result.status.archiveConfirmed, kind === "upload");
assert.equal(uploads, kind === "upload" && ["resume-local", "resume-admit"].includes(mode) ? 1 : 0, "Recovery repeated committed upload");
if (kind === "upload" && mode !== "retained") {
  const queue = await runGtfsQueuePass({ directory: join(directory, "queue"), installationId: identity.installationId, target: restUrl,
    signal: new AbortController().signal, service, serviceKey: process.env.OPENPLAN_PROOF_HTTP_TOKEN!, storageFetch: transport,
    parserBuild: process.env.OPENPLAN_PROOF_PARSER_BUILD!, batchSize: 100, maxJobs: 1,
    onUnconfirmed: (_version, error) => console.error(error instanceof Error ? error.message : "Unconfirmed native fixture"),
    parser: { maxOutputBytes: 32 * 1024 * 1024, maxOldSpaceMb: 384, renewEveryMs: 100, renewTimeoutMs: 1000, maxRuntimeMs: 30_000, terminationGraceMs: 200 } });
  assert.deepEqual(queue.outcomes, [{ versionId: identity.versionId, state: "finished" }]); assert.equal(queue.pendingCount, 0); publication = queue;
}
console.log(JSON.stringify({ mode, kind, registration: result.registration, state: result.status.state, uploads, resolutions, calls, handoff, publication, maxRssKiB: process.resourceUsage().maxRSS }));
