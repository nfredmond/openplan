import type { SupabaseClient } from "@supabase/supabase-js";

import { AERIAL_IMAGERY_BUCKET } from "@/lib/aerial/imagery";
import { isStagedUploadPath } from "@/lib/files/staged-upload";
import { GTFS_UPLOADS_BUCKET } from "@/lib/gtfs/persist";
import { GTFS_STAGED_UPLOAD_EXTENSION } from "@/lib/gtfs/staged-upload";
import { KB_DOCUMENTS_BUCKET } from "@/lib/knowledge-base/documents";

/**
 * Removes staged uploads whose complete call never came (KI-2026-10-12-017).
 *
 * A staged object at `<workspace>/staged/<user>/<upload>` counts against the
 * workspace's storage until the complete step removes it. A closed tab or a
 * failed PUT leaves it there for good. This sweep removes one once its newest
 * Storage timestamp is a day old.
 *
 * WHY A DAY. The signed upload URL lives two hours, so no PUT starts later than
 * that. An object is timed from the later of its created and updated times, so
 * its age counts from no earlier than the start of its PUT. The largest staged
 * file is a 200 MiB GTFS archive, under 30 minutes at 1 Mbit/s; the browser
 * calls complete as soon as the PUT returns, and every complete route stops at
 * 300 seconds. A day is twelve times the URL lifetime and leaves more than 23
 * hours after the slowest such upload and its complete step.
 *
 * THE RACE WITH A COMPLETE STEP. The two can only meet when a complete call
 * arrives a day after its upload, which the app never sends. If one did, every
 * outcome is a refusal, never a wrong write: removed first, complete answers
 * "upload again"; read first, complete removes the object and the sweep finds
 * nothing to count; removed mid-read, the read fails or comes up short and the
 * size check refuses it. The stored copy lives at a path the sweep never names.
 *
 * WHAT IT MAY REMOVE. Only a listed file whose whole path passes
 * `isStagedUploadPath` with its bucket's extension, the grammar the complete
 * routes check. Anything else the listing returns is counted and left alone.
 *
 * BOUNDS. Each bucket gets its own budget of list requests and removals. The
 * walk starts at a different workspace each day, so a run that stops at its
 * budget does not always skip the same workspaces. A failed list or removal
 * stops that bucket only; what was removed before it stays removed and is
 * counted, and the other buckets still run.
 */

/** Hours since an object's newest Storage timestamp before the sweep may remove it. */
const STAGED_UPLOAD_MAX_AGE_HOURS = 24;
const STAGED_SWEEP_PAGE_SIZE = 100;
const STAGED_SWEEP_MAX_LIST_REQUESTS_PER_BUCKET = 300;
const STAGED_SWEEP_MAX_REMOVALS_PER_BUCKET = 1000;
const REMOVE_BATCH_SIZE = 100;

/** Every bucket a staged door writes to, with the extension its door adds. */
export const STAGED_UPLOAD_BUCKETS: ReadonlyArray<{ bucket: string; extension: string }> = [
  { bucket: AERIAL_IMAGERY_BUCKET, extension: "" },
  { bucket: KB_DOCUMENTS_BUCKET, extension: "" },
  { bucket: GTFS_UPLOADS_BUCKET, extension: GTFS_STAGED_UPLOAD_EXTENSION },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type SweepClient = Pick<SupabaseClient, "storage">;

type ListedEntry = {
  name: string;
  id: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type StagedSweepBucketResult = {
  bucket: string;
  /** Workspace folders whose `staged` folder was listed. */
  workspaces: number;
  /** Entries listed inside `staged` folders. */
  examined: number;
  /** Objects Storage reports it removed. */
  removed: number;
  /** Staged objects newer than the cutoff. */
  tooRecent: number;
  /** Staged objects with no readable timestamp; kept, since their age is unknown. */
  unknownAge: number;
  /** Entries outside the staged grammar; never removed. */
  notStaged: number;
  listRequests: number;
  /** True when the run stopped at a budget with work left. */
  more: boolean;
  /** Why this bucket stopped early, or null. */
  failure: string | null;
};

export type StagedSweepResult = {
  cutoff: string;
  removed: number;
  more: boolean;
  failed: boolean;
  buckets: StagedSweepBucketResult[];
};

export type StagedSweepOptions = {
  now?: Date;
  pageSize?: number;
  maxListRequests?: number;
  maxRemovals?: number;
  /** Which workspace folder the walk starts at; defaults to one derived from the day. */
  rotation?: number;
};

class StagedSweepStop extends Error {}

/** The later of an entry's two timestamps, or null when neither parses. */
function newestTimestamp(entry: ListedEntry): number | null {
  const times = [entry.created_at, entry.updated_at]
    .map((value) => (typeof value === "string" ? Date.parse(value) : Number.NaN))
    .filter((value) => Number.isFinite(value));
  return times.length > 0 ? Math.max(...times) : null;
}

/** A start position that changes each day, so a capped walk reaches every workspace in time. */
function dailyRotation(now: Date): number {
  const day = Math.floor(now.getTime() / 86_400_000);
  return Math.imul(day, 2_654_435_761) >>> 0;
}

async function sweepBucket(
  client: SweepClient,
  target: { bucket: string; extension: string },
  cutoffMs: number,
  limits: { pageSize: number; maxListRequests: number; maxRemovals: number; rotation: number }
): Promise<StagedSweepBucketResult> {
  const result: StagedSweepBucketResult = {
    bucket: target.bucket,
    workspaces: 0,
    examined: 0,
    removed: 0,
    tooRecent: 0,
    unknownAge: 0,
    notStaged: 0,
    listRequests: 0,
    more: false,
    failure: null,
  };
  const storage = client.storage.from(target.bucket);
  let removalsSent = 0;

  // Every page of one folder. Storage pages its listing, so this keeps asking
  // until a page comes back empty rather than trusting any page size. At the
  // request budget it returns what it has and sets `more`.
  const listFolder = async (prefix: string): Promise<ListedEntry[]> => {
    const entries: ListedEntry[] = [];
    for (let offset = 0; ; ) {
      if (result.listRequests >= limits.maxListRequests) {
        result.more = true;
        return entries;
      }
      result.listRequests += 1;
      const { data, error } = await storage.list(prefix, {
        limit: limits.pageSize,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new StagedSweepStop(`listing ${prefix || "the bucket"}: ${error.message}`);
      const page = (data ?? []) as ListedEntry[];
      if (page.length === 0) return entries;
      entries.push(...page);
      offset += page.length;
    }
  };

  const remove = async (paths: string[]) => {
    for (let index = 0; index < paths.length; index += REMOVE_BATCH_SIZE) {
      const room = limits.maxRemovals - removalsSent;
      if (room <= 0) {
        result.more = true;
        return;
      }
      const batch = paths.slice(index, index + Math.min(REMOVE_BATCH_SIZE, room));
      removalsSent += batch.length;
      const removal = await storage.remove(batch);
      if (removal.error) throw new StagedSweepStop(`removing staged uploads: ${removal.error.message}`);
      result.removed += (removal.data ?? []).length;
    }
  };

  try {
    const folders = (await listFolder("")).filter((entry) => entry.id === null && UUID.test(entry.name));
    const start = folders.length > 0 ? limits.rotation % folders.length : 0;
    const workspaces = [...folders.slice(start), ...folders.slice(0, start)].map((entry) => entry.name);

    for (const workspace of workspaces) {
      if (result.more) break;
      result.workspaces += 1;
      const users: string[] = [];
      for (const entry of await listFolder(`${workspace}/staged`)) {
        result.examined += 1;
        if (entry.id === null && UUID.test(entry.name)) users.push(entry.name);
        else result.notStaged += 1;
      }

      for (const user of users) {
        if (result.more) break;
        const due: string[] = [];
        for (const entry of await listFolder(`${workspace}/staged/${user}`)) {
          result.examined += 1;
          const objectPath = `${workspace}/staged/${user}/${entry.name}`;
          if (entry.id === null || !isStagedUploadPath(objectPath, target.extension)) {
            result.notStaged += 1;
            continue;
          }
          const newest = newestTimestamp(entry);
          if (newest === null) result.unknownAge += 1;
          else if (newest >= cutoffMs) result.tooRecent += 1;
          else due.push(objectPath);
        }
        await remove(due);
      }
    }
  } catch (error) {
    result.failure = error instanceof Error ? error.message : String(error);
  }

  return result;
}

/**
 * One sweep over every staged bucket. Never throws for a Storage failure: a
 * bucket that fails reports it in `failure`, keeps its counts, and the rest run.
 */
export async function sweepAbandonedStagedUploads(
  client: SweepClient,
  options: StagedSweepOptions = {}
): Promise<StagedSweepResult> {
  const now = options.now ?? new Date();
  const cutoffMs = now.getTime() - STAGED_UPLOAD_MAX_AGE_HOURS * 60 * 60 * 1000;
  const limits = {
    pageSize: options.pageSize ?? STAGED_SWEEP_PAGE_SIZE,
    maxListRequests: options.maxListRequests ?? STAGED_SWEEP_MAX_LIST_REQUESTS_PER_BUCKET,
    maxRemovals: options.maxRemovals ?? STAGED_SWEEP_MAX_REMOVALS_PER_BUCKET,
    rotation: options.rotation ?? dailyRotation(now),
  };

  const buckets: StagedSweepBucketResult[] = [];
  for (const target of STAGED_UPLOAD_BUCKETS) {
    buckets.push(await sweepBucket(client, target, cutoffMs, limits));
  }

  return {
    cutoff: new Date(cutoffMs).toISOString(),
    removed: buckets.reduce((sum, bucket) => sum + bucket.removed, 0),
    more: buckets.some((bucket) => bucket.more),
    failed: buckets.some((bucket) => bucket.failure !== null),
    buckets,
  };
}
