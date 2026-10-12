/**
 * A GTFS ZIP THE BROWSER PUTS IN STORAGE ITSELF, THEN ASKS THE APP TO READ.
 *
 * WHY THIS DOOR EXISTS. Vercel refuses a function request body above about
 * 4.5 MB before any handler runs, so a hosted install could not receive most
 * agency feeds through `POST /api/gtfs/feeds/upload` (CTA publishes 94 MiB).
 * The Data Hub panel therefore asks `/api/gtfs/feeds/upload/start` for a signed
 * upload URL, PUTs the file straight to the private `gtfs-uploads` bucket, and
 * calls `/api/gtfs/feeds/upload/complete`, which reads the object back and runs
 * the same `runGtfsIngest` the body route runs. Map packages use the same
 * pattern. The body route stays for API clients and managed imports.
 *
 * WHERE A STAGED OBJECT LIVES. `<workspace>/staged/<user>/<upload>.zip`. The
 * workspace and user segments are what the complete route checks before it
 * reads anything, so one member cannot ingest another member's staged file and
 * no one can name an object in another workspace. `staged` is not a UUID, so a
 * staged path can never collide with an ingested archive's
 * `<workspace>/<feed>/<version>.zip`.
 *
 * WHAT IS MEASURED. The complete route trusts nothing the browser said about
 * the file. It reads the stored object with a running byte cap, compares the
 * byte count with the size declared when the URL was issued, and only then
 * ingests. `runGtfsIngest` computes the SHA-256 of the exact bytes it parses
 * and records it with the stored copy, as it does for every door.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { GTFS_UPLOADS_BUCKET } from "./persist";

/** Exactly the `gtfs-uploads` bucket's `allowed_mime_types` (20260805000006). */
export const GTFS_UPLOAD_CONTENT_TYPES = [
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
] as const;

/**
 * The content type Storage will accept for this archive, or null.
 *
 * A type outside the bucket's list is refused by Storage at the end of an
 * upload with a message a planner cannot act on, so it is refused before. A
 * `.zip` filename with a missing or unhelpful declared type is accepted as
 * `application/zip`, because a browser's guess is not the planner's fault and
 * the parser decides whether these bytes are a feed.
 */
export function resolveGtfsUploadContentType(
  declared: string | null | undefined,
  filename: string | null | undefined
): string | null {
  const type = (declared ?? "").split(";")[0].trim().toLowerCase();
  if ((GTFS_UPLOAD_CONTENT_TYPES as readonly string[]).includes(type)) return type;
  return /\.zip$/i.test(filename ?? "") ? "application/zip" : null;
}

/**
 * A name to show while the ingest runs, from what the planner actually gave us.
 *
 * Never a guess at an agency. A filename is a fact about the file they chose;
 * anything inferred from its contents is a claim, and this runs before anything
 * has been read.
 */
export function provisionalUploadedFeedName(label: string | undefined, filename: string | undefined): string {
  if (label) return label;
  const base = (filename ?? "").split(/[\\/]/).pop() ?? "";
  const withoutExtension = base.replace(/\.[^.]+$/, "").trim();
  return withoutExtension || "Uploaded transit feed";
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const STAGED_PATH = new RegExp(`^(${UUID})/staged/(${UUID})/(${UUID})\\.zip$`);

/** The private object key for one staged upload. */
export function stagedGtfsUploadPath(workspaceId: string, userId: string, uploadId: string): string {
  return `${workspaceId}/staged/${userId}/${uploadId}.zip`;
}

/**
 * Whether `objectPath` is a staged upload that THIS user started in THIS
 * workspace. Anything else, including a real ingested archive's path, is false.
 */
export function isOwnStagedGtfsUploadPath(objectPath: string, workspaceId: string, userId: string): boolean {
  const match = STAGED_PATH.exec(objectPath);
  return Boolean(match && match[1] === workspaceId.toLowerCase() && match[2] === userId.toLowerCase());
}

/** A signed download link only needs to outlive one read. */
const STAGED_READ_URL_TTL_SECONDS = 60;
const STAGED_READ_TIMEOUT_MS = 120_000;

export type StagedGtfsUploadRead =
  | { status: "read"; bytes: Uint8Array }
  | { status: "missing" }
  | { status: "too_large"; bytesRead: number }
  | { status: "unavailable"; message: string };

/**
 * Read a staged object back, stopping as soon as it runs past `maxBytes`.
 *
 * Read through a short signed URL and a streamed fetch rather than
 * `download()`, because `download()` buffers the whole object before anything
 * can look at its size.
 */
export async function readStagedGtfsUpload(
  service: SupabaseClient,
  objectPath: string,
  maxBytes: number,
  fetchImpl: typeof fetch = fetch
): Promise<StagedGtfsUploadRead> {
  const signed = await service.storage
    .from(GTFS_UPLOADS_BUCKET)
    .createSignedUrl(objectPath, STAGED_READ_URL_TTL_SECONDS);
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
export async function removeStagedGtfsUpload(service: SupabaseClient, objectPath: string): Promise<boolean> {
  const removed = await service.storage.from(GTFS_UPLOADS_BUCKET).remove([objectPath]);
  return !removed.error;
}
