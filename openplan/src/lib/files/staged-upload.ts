/**
 * A FILE THE BROWSER PUTS IN PRIVATE STORAGE ITSELF, THEN ASKS THE APP TO READ.
 *
 * Vercel refuses a function request body above about 4.5 MB before any handler
 * runs (KI-2026-10-12-017). A route that receives a planner's file as its body
 * therefore cannot take most agency PDFs or drone photos on the hosted site.
 * The staged door splits one upload into three requests:
 *
 *   1. `.../upload/start` settles the caller, the role, the declared size and
 *      the workspace's storage room, then issues a signed upload URL for one
 *      new object under `<workspace>/staged/<user>/<upload>`.
 *   2. The browser PUTs the file to that URL. The bytes never pass through an
 *      app function.
 *   3. `.../upload/complete` checks the path is this user's in this workspace,
 *      reads the object back with a running byte cap, compares it with the
 *      declared size, removes it, and only then runs the same checks and the
 *      same write the body route runs on those bytes.
 *
 * GTFS archives (`lib/gtfs/staged-upload.ts`), aerial photos and Knowledge Base
 * documents use this. Each body route stays for API clients and for installs
 * without the platform limit.
 *
 * WHERE A STAGED OBJECT LIVES. `staged` is not a UUID, so a staged path never
 * collides with a stored object's `<workspace>/<uuid>/...` path, and it sits
 * under the workspace prefix, so `workspace_storage_bytes` counts it while it
 * exists. The complete step removes it before the final write re-checks the
 * workspace's room, so one file is never counted twice.
 *
 * A STAGED OBJECT WHOSE COMPLETE CALL NEVER CAME (a closed tab, a failed PUT
 * that left a partial object) stays after its signed upload URL expires two
 * hours later. The daily sweep in `staged-upload-sweep.ts` removes one once it
 * is a day old, and touches only names `isStagedUploadPath` accepts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The content type a staged object is PUT with. Every bucket that takes staged
 * uploads accepts it (kb-documents lists it; aerial-imagery lists nothing), and
 * the type a stored copy is recorded under is decided again at complete time,
 * from the same inputs the body route uses.
 */
export const STAGED_UPLOAD_CONTENT_TYPE = "application/octet-stream";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function stagedPathPattern(extension: string): RegExp {
  const suffix = extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^(${UUID})/staged/(${UUID})/(${UUID})${suffix}$`);
}

/**
 * Whether `objectPath` has the shape of a staged upload in any workspace, for
 * any user: the same grammar `isOwnStagedUploadPath` applies. The sweep uses
 * it so it can never remove a stored object.
 */
export function isStagedUploadPath(objectPath: string, extension = ""): boolean {
  return stagedPathPattern(extension).test(objectPath);
}

/** The private object key for one staged upload. */
export function stagedUploadPath(workspaceId: string, userId: string, uploadId: string, extension = ""): string {
  return `${workspaceId}/staged/${userId}/${uploadId}${extension}`;
}

/**
 * Whether `objectPath` is a staged upload that THIS user started in THIS
 * workspace. Anything else, including a stored object's own path, is false.
 */
export function isOwnStagedUploadPath(
  objectPath: string,
  workspaceId: string,
  userId: string,
  extension = ""
): boolean {
  const match = stagedPathPattern(extension).exec(objectPath);
  return Boolean(match && match[1] === workspaceId.toLowerCase() && match[2] === userId.toLowerCase());
}

/** A signed download link only needs to outlive one read. */
const STAGED_READ_URL_TTL_SECONDS = 60;
const STAGED_READ_TIMEOUT_MS = 120_000;

export type StagedUploadRead =
  | { status: "read"; bytes: Uint8Array }
  | { status: "missing" }
  | { status: "too_large"; bytesRead: number }
  | { status: "unavailable"; message: string };

type StagedStorageClient = Pick<SupabaseClient, "storage">;

/**
 * Read a staged object back, stopping as soon as it runs past `maxBytes`.
 *
 * Read through a short signed URL and a streamed fetch rather than
 * `download()`, because `download()` buffers the whole object before anything
 * can look at its size.
 */
export async function readStagedUpload(
  service: StagedStorageClient,
  bucket: string,
  objectPath: string,
  maxBytes: number,
  fetchImpl: typeof fetch = fetch
): Promise<StagedUploadRead> {
  const signed = await service.storage.from(bucket).createSignedUrl(objectPath, STAGED_READ_URL_TTL_SECONDS);
  // Storage refuses to sign a missing object; that is "not uploaded", not an outage.
  if (signed.error && /not.?found/i.test(signed.error.message)) return { status: "missing" };
  if (signed.error || !signed.data?.signedUrl) {
    return { status: "unavailable", message: signed.error?.message ?? "No signed URL was returned." };
  }

  const response = await fetchImpl(signed.data.signedUrl, {
    signal: AbortSignal.timeout(STAGED_READ_TIMEOUT_MS),
    cache: "no-store",
  });
  if (response.status === 400 || response.status === 404) return { status: "missing" };
  if (!response.ok || !response.body) {
    return { status: "unavailable", message: `Storage answered ${response.status}.` };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {
        // The stream was already gone. Nothing to release.
      });
      return { status: "too_large", bytesRead: total };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { status: "read", bytes };
}

/** Remove a staged object. False when Storage reports an error. */
export async function removeStagedUpload(
  service: StagedStorageClient,
  bucket: string,
  objectPath: string
): Promise<boolean> {
  try {
    const removed = await service.storage.from(bucket).remove([objectPath]);
    return !removed.error;
  } catch {
    return false;
  }
}

export type StagedUploadConsumption =
  | { status: "read"; bytes: Uint8Array; removed: boolean }
  | { status: "missing" }
  | { status: "unavailable"; message: string }
  | { status: "too_large"; bytesRead: number; removed: boolean }
  | { status: "size_mismatch"; declaredBytes: number; storedBytes: number; removed: boolean };

/**
 * Read a staged object, measure it, and remove it, in that order.
 *
 * The object is removed on every outcome that read it: one that runs past the
 * ceiling, one that is not the size declared when its URL was issued, and one
 * that passed both (so a repeated complete call finds nothing to write twice,
 * and the final write's storage check does not count the same bytes again).
 * Only "missing" and "unavailable" leave anything behind, because nothing was
 * read: there is nothing to remove, or Storage could not be asked.
 *
 * `removed` is false when Storage refused the removal. The caller logs it; the
 * object then waits for the daily sweep (`staged-upload-sweep.ts`).
 */
export async function consumeStagedUpload(
  service: StagedStorageClient,
  bucket: string,
  objectPath: string,
  limits: { maxBytes: number; declaredBytes: number },
  fetchImpl: typeof fetch = fetch
): Promise<StagedUploadConsumption> {
  const stored = await readStagedUpload(service, bucket, objectPath, limits.maxBytes, fetchImpl);
  if (stored.status === "missing" || stored.status === "unavailable") return stored;

  const removed = await removeStagedUpload(service, bucket, objectPath);
  if (stored.status === "too_large") return { status: "too_large", bytesRead: stored.bytesRead, removed };
  if (stored.bytes.byteLength !== limits.declaredBytes) {
    return {
      status: "size_mismatch",
      declaredBytes: limits.declaredBytes,
      storedBytes: stored.bytes.byteLength,
      removed,
    };
  }
  return { status: "read", bytes: stored.bytes, removed };
}
