import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * How many bytes one workspace may keep in Storage on this deployment.
 *
 * Abuse protection for a deployment with public signup, set by whoever runs
 * it. It is not a tier: OpenPlan is free, and nothing here can be bought.
 * Per-file ceilings already exist (body-limit.ts and each module's own env);
 * this bounds the total, so one workspace cannot fill the deployment's Storage
 * for everyone else.
 *
 * Current use comes from `workspace_storage_bytes` (migration 20261017000010),
 * which sums Storage's own recorded size for every object whose path begins
 * with the workspace id. Engagement photos, run artifacts and network packages
 * are not under that prefix and are not counted; the migration says why.
 *
 * Every caller checks BEFORE it issues an upload URL or stores a body. When
 * current use cannot be read, the upload is refused: an unknown total is not
 * room to spare.
 */

/** The environment, or any plain map of settings a test passes instead. */
type Env = Readonly<Record<string, string | undefined>>;

const WORKSPACE_STORAGE_QUOTA_ENV = "OPENPLAN_WORKSPACE_STORAGE_QUOTA_BYTES";
export const DEFAULT_WORKSPACE_STORAGE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;

/**
 * The configured limit in bytes. Anything that is not a positive whole number
 * falls back to the default, so a typo can neither stop every upload (0) nor
 * remove the limit.
 */
export function resolveWorkspaceStorageQuotaBytes(env: Env = process.env): number {
  const raw = env[WORKSPACE_STORAGE_QUOTA_ENV]?.trim();
  if (!raw || !/^[0-9]+$/.test(raw)) return DEFAULT_WORKSPACE_STORAGE_QUOTA_BYTES;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_WORKSPACE_STORAGE_QUOTA_BYTES;
}

/** Bytes in the binary units the per-file refusals already use (MiB, GiB). */
export function formatStorageBytes(bytes: number): string {
  const units = ["bytes", "KiB", "MiB", "GiB", "TiB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} bytes`;
  const rounded = value >= 10 || Number.isInteger(value) ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

type StorageUsageClient = Pick<SupabaseClient, "rpc">;

export type WorkspaceStorageUsage =
  | { status: "read"; usedBytes: number; quotaBytes: number }
  | { status: "unreadable"; quotaBytes: number; message: string };

function parseUsedBytes(data: unknown): number | null {
  if (typeof data === "number") return Number.isSafeInteger(data) && data >= 0 ? data : null;
  if (typeof data === "string" && /^[0-9]{1,15}$/.test(data)) return Number(data);
  return null;
}

/** Current use and the limit, or why use could not be read. */
export async function readWorkspaceStorageUsage(
  service: StorageUsageClient,
  workspaceId: string,
  env: Env = process.env
): Promise<WorkspaceStorageUsage> {
  const quotaBytes = resolveWorkspaceStorageQuotaBytes(env);
  try {
    const { data, error } = await service.rpc("workspace_storage_bytes", { p_workspace_id: workspaceId });
    if (error) return { status: "unreadable", quotaBytes, message: error.message ?? "storage use lookup failed" };
    const usedBytes = parseUsedBytes(data);
    if (usedBytes === null) return { status: "unreadable", quotaBytes, message: "unexpected storage use reply" };
    return { status: "read", usedBytes, quotaBytes };
  } catch (error) {
    return { status: "unreadable", quotaBytes, message: error instanceof Error ? error.message : "storage use lookup failed" };
  }
}

export type WorkspaceStorageRoom =
  | { status: "room"; usedBytes: number; quotaBytes: number }
  | { status: "full"; usedBytes: number; quotaBytes: number; message: string }
  | { status: "unreadable"; message: string; detail: string };

export const WORKSPACE_STORAGE_UNREADABLE_MESSAGE =
  "Storage use could not be checked, so nothing was uploaded. Try again in a minute.";

export function workspaceStorageFullMessage(usedBytes: number, quotaBytes: number, incomingBytes: number): string {
  const opening = incomingBytes > 0
    ? `This file would put the workspace over its ${formatStorageBytes(quotaBytes)} storage limit (${formatStorageBytes(usedBytes)} used).`
    : `This workspace has reached its ${formatStorageBytes(quotaBytes)} storage limit (${formatStorageBytes(usedBytes)} used).`;
  return `${opening} Delete files you no longer need, or ask whoever runs this OpenPlan site to raise the limit.`;
}

/**
 * Whether `incomingBytes` more fit under the workspace's limit.
 *
 * Pass 0 when the size is not known yet (a feed fetched from an address); the
 * check then refuses only a workspace that is already at its limit, and the
 * per-file ceiling bounds the overshoot.
 */
export async function checkWorkspaceStorageRoom(
  service: StorageUsageClient,
  workspaceId: string,
  incomingBytes: number,
  env: Env = process.env
): Promise<WorkspaceStorageRoom> {
  const usage = await readWorkspaceStorageUsage(service, workspaceId, env);
  if (usage.status === "unreadable") {
    return { status: "unreadable", message: WORKSPACE_STORAGE_UNREADABLE_MESSAGE, detail: usage.message };
  }
  const incoming = Math.max(0, incomingBytes);
  const over = incoming > 0 ? usage.usedBytes + incoming > usage.quotaBytes : usage.usedBytes >= usage.quotaBytes;
  if (!over) return { status: "room", usedBytes: usage.usedBytes, quotaBytes: usage.quotaBytes };
  return {
    status: "full",
    usedBytes: usage.usedBytes,
    quotaBytes: usage.quotaBytes,
    message: workspaceStorageFullMessage(usage.usedBytes, usage.quotaBytes, incoming),
  };
}

/** One file a retryable writer is about to store, at a path that never changes between attempts. */
export type PendingStorageFile = { path: string; bytes: number };

type StorageListClient = Pick<SupabaseClient, "storage">;

function parentAndName(path: string): { parent: string; name: string } {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? { parent: "", name: path } : { parent: path.slice(0, slash), name: path.slice(slash + 1) };
}

/**
 * How many of `files`' bytes are not already in the bucket.
 *
 * For a writer that retries after a partial upload. A file whose path already
 * holds an object with the same recorded size is already counted in the
 * workspace's use, and an `upsert: false` upload cannot add to it, so it costs
 * nothing more. The size compared is Storage's own `metadata.size`, the same
 * figure `workspace_storage_bytes` sums. A missing object, a different size or
 * a failed lookup charges the file in full: the check never assumes room it
 * cannot see.
 */
export async function storageBytesNotYetStored(
  service: StorageListClient,
  bucket: string,
  files: readonly PendingStorageFile[]
): Promise<number> {
  let pending = 0;
  for (const file of files) {
    const { parent, name } = parentAndName(file.path);
    let stored = false;
    try {
      const { data, error } = await service.storage.from(bucket).list(parent, { limit: 100, search: name });
      stored = !error && (data ?? []).some((entry) => entry.name === name && entry.metadata?.size === file.bytes);
    } catch {
      stored = false;
    }
    if (!stored) pending += Math.max(0, file.bytes);
  }
  return pending;
}

/**
 * The storage-limit check for a retryable writer: only bytes not already at
 * their paths are charged. Returns "stored" when every file is already there,
 * so a retry that has nothing left to add is never refused for the bytes its
 * own earlier attempt stored.
 */
export async function checkWorkspaceStorageRoomForFiles(
  service: StorageUsageClient & StorageListClient,
  workspaceId: string,
  bucket: string,
  files: readonly PendingStorageFile[],
  env: Env = process.env
): Promise<WorkspaceStorageRoom | { status: "stored" }> {
  const pendingBytes = await storageBytesNotYetStored(service, bucket, files);
  if (pendingBytes === 0) return { status: "stored" };
  return checkWorkspaceStorageRoom(service, workspaceId, pendingBytes, env);
}

/** The HTTP refusal for a route that answers `{ error }`: 413 when full, 503 when unreadable. */
export function workspaceStorageRefusal(room: Exclude<WorkspaceStorageRoom, { status: "room" }>): NextResponse {
  return room.status === "full"
    ? NextResponse.json({ error: room.message, usedBytes: room.usedBytes, quotaBytes: room.quotaBytes }, { status: 413 })
    : NextResponse.json({ error: room.message }, { status: 503 });
}
