/**
 * A GTFS ZIP THE BROWSER PUTS IN STORAGE ITSELF, THEN ASKS THE APP TO READ.
 *
 * WHY THIS DOOR EXISTS. Vercel refuses a function request body above about
 * 4.5 MB before any handler runs, so a hosted install could not receive most
 * agency feeds through `POST /api/gtfs/feeds/upload` (CTA publishes 94 MiB).
 * The Data Hub panel therefore asks `/api/gtfs/feeds/upload/start` for a signed
 * upload URL, PUTs the file straight to the private `gtfs-uploads` bucket, and
 * calls `/api/gtfs/feeds/upload/complete`, which reads the object back and runs
 * the same `runGtfsIngest` the body route runs. Map packages, aerial photos and
 * Knowledge Base documents use the same pattern (`lib/files/staged-upload.ts`).
 * The body route stays for API clients and managed imports.
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

import {
  isOwnStagedUploadPath,
  readStagedUpload,
  removeStagedUpload,
  stagedUploadPath,
  type StagedUploadRead,
} from "@/lib/files/staged-upload";

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

/** The private object key for one staged upload. */
export function stagedGtfsUploadPath(workspaceId: string, userId: string, uploadId: string): string {
  return stagedUploadPath(workspaceId, userId, uploadId, ".zip");
}

/**
 * Whether `objectPath` is a staged upload that THIS user started in THIS
 * workspace. Anything else, including a real ingested archive's path, is false.
 */
export function isOwnStagedGtfsUploadPath(objectPath: string, workspaceId: string, userId: string): boolean {
  return isOwnStagedUploadPath(objectPath, workspaceId, userId, ".zip");
}

export type StagedGtfsUploadRead = StagedUploadRead;

/**
 * Read a staged object back, stopping as soon as it runs past `maxBytes`.
 * The reader is shared with the other staged doors (`lib/files/staged-upload.ts`).
 */
export async function readStagedGtfsUpload(
  service: SupabaseClient,
  objectPath: string,
  maxBytes: number,
  fetchImpl: typeof fetch = fetch
): Promise<StagedGtfsUploadRead> {
  return readStagedUpload(service, GTFS_UPLOADS_BUCKET, objectPath, maxBytes, fetchImpl);
}

/** Remove a staged object. False when Storage reports an error. */
export async function removeStagedGtfsUpload(service: SupabaseClient, objectPath: string): Promise<boolean> {
  return removeStagedUpload(service, GTFS_UPLOADS_BUCKET, objectPath);
}
