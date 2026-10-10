import { randomUUID, createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { open, readdir, lstat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { acquireConnectorLock, privateConnectorDirectory, writeConnectorJournal } from "../../../../workers/planner_agent_connector/connector-worker.mjs";
import { readPrivateJson } from "../../../../workers/planner_agent_connector/connector-client.mjs";
import { listGtfsCandidates, claimGtfsAttempt, readGtfsAttempt } from "./managed-worker-service";
import { runGtfsOwnedAttempt, type GtfsOwnedWork } from "./managed-worker-attempt";
import { processGtfsSourceArchive, type GtfsIntakeOptions } from "./managed-worker-intake";
import type { GtfsArtifactOptions } from "./managed-worker-artifact";
import type { GtfsDurableMutation } from "./managed-worker-dispatch";

const id = z.string().uuid().transform(value => value.toLowerCase());
const rootSchema = z.object({ schemaVersion: z.literal(1), installationId: id, target: z.string(), cursor: id.nullable(),
  discovery: id.nullable().default(null), next: z.enum(["retained", "candidates"]) }).strict();
const jobSchema = z.object({ schemaVersion: z.literal(1), versionId: id, attempt: id, settled: z.boolean() }).strict();
const identitySchema = z.object({ schemaVersion: z.literal(1), installationId: id, target: z.string(), versionId: id, token: id }).strict();
type Terminal = Extract<GtfsDurableMutation, { operation: "complete" | "fail" }>;
type Outcome = { versionId: string; state: "finished" | "recovered_terminal" | "observed_terminal" | "not_active" | "unavailable" | "unconfirmed" };
export type GtfsQueueOptions = Omit<GtfsIntakeOptions, "directory" | "owned"> & {
  directory: string; signal: AbortSignal; maxJobs?: number; maxRecords?: number;
  parserBuild: string; parser: GtfsArtifactOptions["parser"]; batchSize: number;
  /** Optional operator diagnostic. Never included in planner-facing outcomes. */
  onUnconfirmed?: (versionId: string, error: unknown) => void;
};

function requireMatch(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}
function absent(error: unknown) { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
async function optionalRecord(path: string) {
  try { return await readPrivateJson(path, 65536); }
  catch (error) { if (!absent(error)) throw error; return null; }
}
async function syncDirectory(path: string) {
  const file = await open(path, "r"); try { await file.sync(); } finally { await file.close(); }
}

/** Recover locally retained work as well as newly eligible database versions.
 * Run jobs serially under one installation lock. Cursor rotation keeps a failed
 * retained job from blocking every later job. A pass is bounded, not a drain.
 */
export async function runGtfsQueuePass(options: GtfsQueueOptions, work?: (owned: GtfsOwnedWork,
  paths: { source: string; artifact: string }) => Promise<Terminal>) {
  const maxJobs = z.number().int().min(1).max(100).parse(options.maxJobs ?? 10);
  const maxRecords = z.number().int().min(maxJobs).max(100000).parse(options.maxRecords ?? 10000);
  const target = new URL(options.target);
  requireMatch(["http:", "https:"].includes(target.protocol) && !target.username && !target.password && !target.search && !target.hash,
    "GTFS queue target is invalid");
  const binding = { schemaVersion: 1 as const, installationId: id.parse(options.installationId), target: target.href.replace(/\/$/, "") };
  requireMatch(isAbsolute(options.directory), "GTFS queue directory must be absolute");
  const directory = resolve(options.directory);
  options.signal.throwIfAborted();
  const lock = await acquireConnectorLock(directory), ending = new AbortController();
  const signal = AbortSignal.any([options.signal, lock.signal, ending.signal]);
  const outcomes: Outcome[] = [];
  try {
    signal.throwIfAborted();
    const rawRoot = await optionalRecord(join(directory, "pending.json"));
    const root = rawRoot === null ? { ...binding, cursor: null, discovery: null, next: "retained" as const } : rootSchema.parse(rawRoot);
    requireMatch(root.installationId === binding.installationId && root.target === binding.target, "GTFS queue binding differs");
    await writeConnectorJournal(directory, root);
    const candidates = await listGtfsCandidates(options.service, maxJobs, signal, root.discovery);
    const eligible = new Set(candidates);
    const entries = await readdir(directory, { withFileTypes: true });
    requireMatch(entries.length <= maxRecords + 2, "GTFS queue inventory exceeds configured bound");
    const versions: string[] = [];
    for (const entry of entries) {
      if (!entry.name.startsWith("version-")) continue;
      const version = id.parse(entry.name.slice("version-".length));
      requireMatch(entry.isDirectory() && !entry.isSymbolicLink(), "GTFS queue job directory is invalid");
      const path = join(directory, entry.name), info = await lstat(path);
      requireMatch(info.uid === globalThis.process.getuid?.() && (info.mode & 0o077) === 0, "GTFS queue job directory is not private");
      const rawJob = await optionalRecord(join(path, "pending.json"));
      // A crash during initial allocation may leave an empty private directory.
      if (rawJob === null) continue;
      const job = jobSchema.parse(rawJob);
      requireMatch(job.versionId === version, "GTFS queue job scope differs");
      if (!job.settled) versions.push(version);
    }
    versions.sort();
    const after = root.cursor === null ? versions : versions.filter(version => version > root.cursor!);
    const before = root.cursor === null ? [] : versions.filter(version => version <= root.cursor!);
    const retained = [...after, ...before];
    const priority = root.next === "retained" ? [retained, candidates] : [candidates, retained];
    const selected: string[] = [];
    for (let ordinal = 0; ordinal < Math.max(retained.length, candidates.length) && selected.length < maxJobs; ordinal++) {
      for (const list of priority) {
        const version = list[ordinal];
        if (version && !selected.includes(version) && selected.length < maxJobs) selected.push(version);
      }
    }
    root.next = root.next === "retained" ? "candidates" : "retained";
    await writeConnectorJournal(directory, root);
    const considered = new Set<string>();
    for (const versionId of selected) {
      signal.throwIfAborted();
      const jobDirectory = join(directory, `version-${versionId}`);
      try {
        await privateConnectorDirectory(jobDirectory);
        const raw = await optionalRecord(join(jobDirectory, "pending.json"));
        let job = raw === null ? { schemaVersion: 1 as const, versionId, attempt: randomUUID(), settled: false } : jobSchema.parse(raw);
        requireMatch(job.versionId === versionId, "GTFS queue job scope differs");
        await writeConnectorJournal(jobDirectory, job); await syncDirectory(directory);
        let attemptDirectory = join(jobDirectory, `attempt-${job.attempt}`);
        const rawIdentity = await optionalRecord(join(attemptDirectory, "commands/pending.json"));
        if (rawIdentity !== null) {
          const identity = identitySchema.parse(rawIdentity);
          requireMatch(identity.target === binding.target && identity.installationId === binding.installationId && identity.versionId === versionId,
            "GTFS queue attempt scope differs");
          const scope = { versionId, token: identity.token };
          const claim = await claimGtfsAttempt(options.service, scope, signal);
          if (!claim) { outcomes.push({ versionId, state: "unavailable" }); continue; }
          const snapshot = await readGtfsAttempt(options.service, scope, signal);
          if (!snapshot.active && ["ready", "failed", "cancelled"].includes(snapshot.state) && snapshot.claim.attempt < snapshot.attempts) {
            job.settled = true; await writeConnectorJournal(jobDirectory, job);
            outcomes.push({ versionId, state: "observed_terminal" }); continue;
          }
          if (!snapshot.active && snapshot.state === "running") {
            if (!eligible.has(versionId)) { outcomes.push({ versionId, state: "not_active" }); continue; }
            // Eligibility is a hint. The new claim still obtains ownership in SQL.
            // Retain the old command/artifact directory as historical evidence.
            job = { ...job, attempt: randomUUID(), settled: false };
            await writeConnectorJournal(jobDirectory, job);
            attemptDirectory = join(jobDirectory, `attempt-${job.attempt}`);
          }
        }
        await privateConnectorDirectory(attemptDirectory); await syncDirectory(jobDirectory);
        const outcome = await runGtfsOwnedAttempt({ directory: join(attemptDirectory, "commands"),
          ...binding, versionId, service: options.service, maxCommandBytes: 4 * 1024 * 1024, signal,
          work: async owned => {
            const paths = { source: join(jobDirectory, "source"), artifact: join(attemptDirectory, "artifact") };
            if (work) return work(owned, paths);
            const result = await processGtfsSourceArchive({ ...options, directory: paths.source, owned,
              artifact: { directory: paths.artifact, parserBuild: options.parserBuild, parser: options.parser } });
            return result.terminal;
          } });
        const settled = ["finished", "recovered_terminal", "observed_terminal"].includes(outcome.state);
        if (settled) { job.settled = true; await writeConnectorJournal(jobDirectory, job); }
        outcomes.push({ versionId, state: outcome.state });
      } catch (error) {
        signal.throwIfAborted();
        // Keep exact retained state. A transport/error exception is not a feed failure.
        options.onUnconfirmed?.(versionId, error);
        outcomes.push({ versionId, state: "unconfirmed" });
      } finally {
        considered.add(versionId);
        root.discovery = candidates.filter(version => considered.has(version)).at(-1) ?? root.discovery;
        root.cursor = versionId; await writeConnectorJournal(directory, root);
      }
    }
    return { outcomes, pendingCount: versions.length - selected.filter(version => versions.includes(version)).length
      + outcomes.filter(outcome => ["unconfirmed", "not_active", "unavailable"].includes(outcome.state)).length,
      candidateCount: candidates.length };
  } finally { ending.abort(); await lock.release(); }
}

/** Select a durable target-specific installation directory. The installation ID
 * must be retained with operator configuration across service restarts.
 */
export function gtfsQueueOptions(argv: string[], env: Partial<NodeJS.ProcessEnv>) {
  if (argv.length === 1 && argv[0] === "--help") return { help: true as const };
  requireMatch(argv.length <= 1 && (argv.length === 0 || argv[0] === "--once"), "GTFS worker arguments are invalid");
  const target = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  requireMatch(["http:", "https:"].includes(target.protocol) && !target.username && !target.password && !target.search && !target.hash,
    "GTFS worker target is invalid");
  const normalized = target.href.replace(/\/$/, "");
  const directory = env.OPENPLAN_GTFS_WORK_DIR ?? join(homedir(), ".local/state/openplan/gtfs-managed-worker");
  requireMatch(isAbsolute(directory), "GTFS worker directory must be absolute");
  return { help: false as const, once: argv[0] === "--once", target: normalized,
    installationId: id.parse(env.OPENPLAN_GTFS_INSTALLATION_ID), parserBuild: z.string().regex(/^[a-f0-9]{40,64}$/).parse(env.OPENPLAN_GTFS_PARSER_BUILD),
    directory: join(directory, createHash("sha256").update(normalized).digest("hex")) };
}

/** Poll serial passes and stop source, parser and transport work on shutdown.
 * Report unconfirmed work without inventing completion, adoption or failure.
 */
export async function runGtfsQueueService(options: GtfsQueueOptions & { once: boolean;
  report: (pass: Awaited<ReturnType<typeof runGtfsQueuePass>>) => void; reportError: () => void;
}) {
  while (!options.signal.aborted) {
    let pause = 2000;
    try {
      const result = await runGtfsQueuePass(options); options.signal.throwIfAborted(); options.report(result);
      if (options.once) return result.pendingCount > 0 ? "unconfirmed" as const : "pass_complete" as const;
      if (result.pendingCount > 0) pause = 5000;
    } catch {
      if (options.signal.aborted) return "stopped" as const;
      options.reportError(); if (options.once) return "error" as const; pause = 5000;
    }
    try { await delay(pause, undefined, { signal: options.signal }); }
    catch { if (!options.signal.aborted) throw new Error("GTFS polling wait failed"); }
  }
  return "stopped" as const;
}
