/**
 * Photo attachments for public engagement comments.
 *
 * Privacy model (end to end):
 * - The 'engagement-photos' bucket is PRIVATE with zero storage.objects
 *   policies (migration 20260717000084) — only the service-role key can
 *   touch it.
 * - Uploads go through POST /api/engage/[shareToken]/photo-upload, which
 *   validates content type AND magic bytes, size-caps the body, and writes
 *   to <campaignId>/<uuid>.<ext> via the service role. The client only ever
 *   learns the resulting storage path, never a URL.
 * - The submit route re-validates that a client-provided path matches the
 *   campaign prefix pattern and that the object actually exists and was
 *   created recently before persisting it on the item.
 * - Reads happen exclusively through short-TTL signed URLs minted
 *   server-side: the public portal only signs paths of APPROVED items; the
 *   staff moderation queue signs after an RLS-scoped campaign read proves
 *   workspace membership. Pending/rejected photos are never publicly
 *   reachable.
 */

export const ENGAGEMENT_PHOTO_BUCKET = "engagement-photos";
export const ENGAGEMENT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const ENGAGEMENT_PHOTO_SIGNED_URL_TTL_SECONDS = 15 * 60;
// A photo path referenced by a submission must have been uploaded recently —
// stale paths (scraped or replayed from an old session) are rejected.
export const ENGAGEMENT_PHOTO_UPLOAD_LOOKBACK_MINUTES = 120;

export const PUBLIC_PHOTO_UPLOAD_RATE_WINDOW_MINUTES = 10;
export const PUBLIC_PHOTO_UPLOAD_MAX_PER_WINDOW = 5;

export const ENGAGEMENT_PHOTO_CONTENT_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type EngagementPhotoContentType = keyof typeof ENGAGEMENT_PHOTO_CONTENT_TYPES;

export function isEngagementPhotoContentType(value: string): value is EngagementPhotoContentType {
  return Object.prototype.hasOwnProperty.call(ENGAGEMENT_PHOTO_CONTENT_TYPES, value);
}

/**
 * Content sniffing via magic bytes — the declared content type is only
 * accepted when the actual bytes agree, so renaming an .html payload to
 * .jpg (or lying in the content-type header) does not get it stored.
 */
export function sniffEngagementPhotoContentType(bytes: Uint8Array): EngagementPhotoContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return "image/webp";
  }

  return null;
}

const UUID_SEGMENT = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PHOTO_PATH_PATTERN = new RegExp(`^(${UUID_SEGMENT})/(${UUID_SEGMENT})\\.(jpg|png|webp)$`);

export function buildEngagementPhotoPath(
  campaignId: string,
  objectId: string,
  contentType: EngagementPhotoContentType
): string {
  return `${campaignId}/${objectId}.${ENGAGEMENT_PHOTO_CONTENT_TYPES[contentType]}`;
}

/**
 * A client-provided photo path is only ever accepted when it matches the
 * strict <campaignId>/<uuid>.<ext> shape for THIS campaign. Anything else —
 * traversal characters, another campaign's prefix, unexpected extensions —
 * is rejected before any storage call happens.
 */
export function isEngagementPhotoPathForCampaign(path: string, campaignId: string): boolean {
  const match = PHOTO_PATH_PATTERN.exec(path);
  if (!match) return false;
  return match[1] === campaignId.toLowerCase();
}

export function splitEngagementPhotoPath(path: string): { folder: string; fileName: string } | null {
  const match = PHOTO_PATH_PATTERN.exec(path);
  if (!match) return null;
  return { folder: match[1], fileName: `${match[2]}.${match[3]}` };
}

// Per-instance upload rate limiter keyed by the same IP+UA fingerprint as
// public submissions. Serverless caveat: this map is per-lambda-instance, so
// it is a soft brake, not the hard guard — the hard guards are the 5 MB body
// cap, the DB-backed submission rate limit, and the bucket's file_size_limit.
const uploadTimestampsByFingerprint = new Map<string, number[]>();

export function registerEngagementPhotoUpload(
  fingerprint: string,
  now: number = Date.now()
): { allowed: boolean; recentCount: number } {
  const windowMs = PUBLIC_PHOTO_UPLOAD_RATE_WINDOW_MINUTES * 60 * 1000;
  const recent = (uploadTimestampsByFingerprint.get(fingerprint) ?? []).filter(
    (timestamp) => now - timestamp <= windowMs
  );

  if (recent.length >= PUBLIC_PHOTO_UPLOAD_MAX_PER_WINDOW) {
    uploadTimestampsByFingerprint.set(fingerprint, recent);
    return { allowed: false, recentCount: recent.length };
  }

  recent.push(now);
  uploadTimestampsByFingerprint.set(fingerprint, recent);
  return { allowed: true, recentCount: recent.length };
}

export function resetEngagementPhotoUploadRateLimiter(): void {
  uploadTimestampsByFingerprint.clear();
}
