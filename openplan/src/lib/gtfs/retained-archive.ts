import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveGtfsLimits, type GtfsLimitEnv } from "./limits";
import { GTFS_UPLOADS_BUCKET } from "./persist";

export type RetainedGtfsArchive = {
  workspaceId: string;
  feedId: string;
  versionId: string;
  storagePath: string | null;
  checksumSha256: string | null;
  byteSize: number | null;
};
export type RetainedGtfsArchiveResult =
  | { ok: true; bytes: Uint8Array; checksumSha256: string }
  | { ok: false; code: "invalid_identity" | "archive_too_large" | "archive_unavailable"
      | "archive_mismatch" | "cancelled" | "timed_out" };

// Abort even when a transport or reader fails to settle after cancellation.
async function whileActive<T>(operation: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([operation, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** Read the retained object only. The caller must authorize the version and check its lease. */
export async function readRetainedGtfsArchive(
  service: Pick<SupabaseClient, "storage">,
  identity: RetainedGtfsArchive,
  options: { signal?: AbortSignal; env?: GtfsLimitEnv } = {},
): Promise<RetainedGtfsArchiveResult> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const { workspaceId, feedId, versionId, storagePath, checksumSha256, byteSize } = identity;
  if (![workspaceId, feedId, versionId].every((id) => uuid.test(id))
    || storagePath !== `${workspaceId}/${feedId}/${versionId}.zip`
    || !checksumSha256 || !/^[0-9a-f]{64}$/.test(checksumSha256)
    || byteSize === null || !Number.isSafeInteger(byteSize) || byteSize <= 0) {
    return { ok: false, code: "invalid_identity" };
  }
  const limits = resolveGtfsLimits(options.env);
  if (byteSize > limits.maxArchiveBytes) return { ok: false, code: "archive_too_large" };
  if (options.signal?.aborted) return { ok: false, code: "cancelled" };
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(limits.parseBudgetMs, 2_147_483_647));
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let complete = false;
  try {
    const result = await whileActive(service.storage.from(GTFS_UPLOADS_BUCKET)
      .download(storagePath, {}, { signal: controller.signal, cache: "no-store" }).asStream(), controller.signal);
    if (result.error || !result.data) return { ok: false, code: "archive_unavailable" };
    reader = (result.data as ReadableStream<Uint8Array>).getReader();
    const bytes = new Uint8Array(byteSize);
    const hash = createHash("sha256");
    let received = 0;
    while (true) {
      const chunk = await whileActive(reader.read(), controller.signal);
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) return { ok: false, code: "archive_unavailable" };
      if (chunk.value.byteLength > byteSize - received) return { ok: false, code: "archive_mismatch" };
      bytes.set(chunk.value, received);
      hash.update(chunk.value);
      received += chunk.value.byteLength;
    }
    if (received !== byteSize || hash.digest("hex") !== checksumSha256) {
      return { ok: false, code: "archive_mismatch" };
    }
    complete = true;
    return { ok: true, bytes, checksumSha256 };
  } catch {
    return { ok: false, code: options.signal?.aborted ? "cancelled" : timedOut ? "timed_out" : "archive_unavailable" };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
    if (!complete) {
      controller.abort();
      void reader?.cancel().catch(() => {});
    }
    reader?.releaseLock();
  }
}
