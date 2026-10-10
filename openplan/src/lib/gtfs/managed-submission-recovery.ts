import { isAbsolute, join } from "node:path";
import { lstat, readdir } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { acquireConnectorLock, privateConnectorDirectory, writeConnectorJournal } from "../../../../workers/planner_agent_connector/connector-worker.mjs";
import { readPrivateJson } from "../../../../workers/planner_agent_connector/connector-client.mjs";
import { admitGtfsSubmission, readGtfsSavedSubmission, type GtfsAdmissionOptions, type GtfsSavedSubmission } from "./managed-admission";

const id = z.string().uuid().transform(value => value.toLowerCase());
const rootSchema = z.object({ schemaVersion: z.literal(1), target: z.string(), installationId: id, cursor: id.nullable() }).strict();
type Outcome = { requestId: string; state: "handed_off" | "unconfirmed" };
export type GtfsSubmissionRecoveryOptions = Pick<GtfsAdmissionOptions, "target" | "installationId" | "service" | "serviceKey" | "signal" | "storageFetch" | "env" | "uploadTimeoutMs"> & {
  directory: string; maxJobs?: number; maxRecords?: number;
  authorize: (saved: GtfsSavedSubmission, signal: AbortSignal) => Promise<void>;
  resolve: (saved: GtfsSavedSubmission, archive: Parameters<GtfsAdmissionOptions["resolve"]>[0], signal: AbortSignal) => ReturnType<GtfsAdmissionOptions["resolve"]>;
};
function requireMatch(value: boolean, message: string): asserts value { if (!value) throw new Error(message); }
function absent(error: unknown) { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
async function optional(path: string) {
  try { return await readPrivateJson(path, 65536); }
  catch (error) { if (!absent(error)) throw error; return null; }
}

/** Recover retained client submissions before discovering worker candidates.
 * A private handoff marker skips already enrolled history, without declaring
 * processing complete or adoption. Cursor rotation bounds repeated refusals.
 */
export async function runGtfsSubmissionRecoveryPass(options: GtfsSubmissionRecoveryOptions) {
  const maxJobs = z.number().int().min(1).max(100).parse(options.maxJobs ?? 10);
  const maxRecords = z.number().int().min(maxJobs).max(100000).parse(options.maxRecords ?? 10000);
  const target = new URL(options.target);
  requireMatch(["http:", "https:"].includes(target.protocol) && !target.username && !target.password && !target.search && !target.hash, "GTFS recovery target is invalid");
  requireMatch(isAbsolute(options.directory), "GTFS recovery directory must be absolute");
  const binding = { schemaVersion: 1 as const, target: target.href.replace(/\/$/, ""), installationId: id.parse(options.installationId) };
  options.signal.throwIfAborted();
  const lock = await acquireConnectorLock(options.directory), ending = new AbortController();
  const signal = AbortSignal.any([options.signal, lock.signal, ending.signal]);
  try {
    signal.throwIfAborted();
    const raw = await optional(join(options.directory, "pending.json"));
    const root = raw === null ? { ...binding, cursor: null } : rootSchema.parse(raw);
    requireMatch(root.target === binding.target && root.installationId === binding.installationId, "GTFS recovery installation differs");
    await writeConnectorJournal(options.directory, root);
    const entries = await readdir(options.directory, { withFileTypes: true });
    requireMatch(entries.length <= maxRecords + 2, "GTFS recovery inventory exceeds configured bound");
    const requests = entries.filter(entry => id.safeParse(entry.name).success).map(entry => entry.name).sort();
    const ordered = root.cursor === null ? requests : [...requests.filter(request => request > root.cursor!), ...requests.filter(request => request <= root.cursor!)];
    const outcomes: Outcome[] = [];
    let pendingCount = 0;
    for (const requestId of ordered) {
      signal.throwIfAborted();
      const directory = join(options.directory, requestId);
      try {
        const info = await lstat(directory);
        requireMatch(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid?.() && (info.mode & 0o077) === 0, "GTFS recovery request directory is not private");
        const saved = await readGtfsSavedSubmission(directory);
        requireMatch(saved.binding.requestId === requestId && saved.binding.target === binding.target && saved.binding.installationId === binding.installationId, "GTFS recovery request binding differs");
        const markerPath = join(directory, "handoff"), marker = await optional(join(markerPath, "pending.json"));
        if (marker !== null) {
          requireMatch(saved.response !== null && saved.resolved !== null && isDeepStrictEqual(marker, { binding: saved.binding, resolved: saved.resolved, response: saved.response }), "GTFS recovery handoff differs");
          continue;
        }
        if (outcomes.length >= maxJobs) { pendingCount++; continue; }
        await options.authorize(saved, signal); signal.throwIfAborted();
        const result = await admitGtfsSubmission({ ...options, directory, workspaceId: saved.binding.workspaceId, actorId: saved.binding.actorId,
          requestId, intent: saved.binding.intent, signal, resolve: archive => options.resolve(saved, archive, signal) });
        requireMatch(result.registration.requestId === requestId && result.status.requestId === requestId && result.status.workspaceId === saved.binding.workspaceId
          && result.status.versionId === result.registration.versionId && result.status.feedId === result.registration.feedId, "GTFS recovered submission scope differs");
        requireMatch(result.status.state !== "awaiting_archive", "GTFS recovered archive remains unconfirmed");
        signal.throwIfAborted();
        const updated = await readGtfsSavedSubmission(directory);
        requireMatch(updated.response !== null && updated.resolved !== null && isDeepStrictEqual(updated.response, result.registration)
          && isDeepStrictEqual(updated.binding, saved.binding), "GTFS recovered local receipt differs");
        await privateConnectorDirectory(markerPath);
        await writeConnectorJournal(markerPath, { binding: updated.binding, resolved: updated.resolved, response: updated.response });
        outcomes.push({ requestId, state: "handed_off" });
      } catch {
        signal.throwIfAborted();
        if (outcomes.length < maxJobs) { outcomes.push({ requestId, state: "unconfirmed" }); pendingCount++; }
        else pendingCount++;
      } finally {
        if (outcomes.some(outcome => outcome.requestId === requestId)) { root.cursor = requestId; await writeConnectorJournal(options.directory, root); }
      }
    }
    return { outcomes, pendingCount };
  } finally { ending.abort(); await lock.release(); }
}
