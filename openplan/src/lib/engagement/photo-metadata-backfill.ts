import "server-only";
import sharp from "sharp";
import { ENGAGEMENT_PHOTO_MAX_BYTES, sniffEngagementPhotoContentType } from "@/lib/engagement/photo";
import { stripPhotoMetadata } from "@/lib/engagement/photo-metadata";

/**
 * Removing location and device metadata from engagement photos stored BEFORE
 * uploads were re-encoded (2026-10-10). New uploads are already clean; this is
 * for the ones a deployment collected earlier.
 *
 * Dry run unless `apply` is set, because applying replaces each affected
 * photo's bytes in place and the original cannot be recovered afterwards.
 * That loss is the point: the original is what carries a resident's GPS
 * position. Each rewritten photo is downloaded again and checked.
 */

type StorageError = { message: string } | null;

/** The slice of a Supabase storage bucket this needs; the real client fits it. */
export type PhotoBucket = {
  list(
    prefix: string,
    options: { limit: number; offset: number }
  ): Promise<{ data: Array<{ name: string; id: string | null }> | null; error: StorageError }>;
  download(path: string): Promise<{ data: Blob | null; error: StorageError }>;
  upload(
    path: string,
    body: Uint8Array,
    options: { contentType: string; upsert: boolean }
  ): Promise<{ error: StorageError }>;
};

export type PhotoBackfillReport = {
  applied: boolean;
  scanned: number;
  /** Already free of EXIF, XMP and IPTC. */
  clean: number;
  /** Carrying metadata; rewritten when applied, counted only on a dry run. */
  withMetadata: number;
  stripped: number;
  failures: Array<{ path: string; reason: string }>;
};

const MAX_FOLDER_DEPTH = 4;

async function carriesMetadata(bytes: Uint8Array): Promise<boolean> {
  const metadata = await sharp(bytes).metadata();
  return Boolean(metadata.exif || metadata.xmp || metadata.iptc);
}

/** Every entry under a prefix, page by page, so no folder is silently cut short. */
async function listAll(
  bucket: PhotoBucket,
  prefix: string,
  pageSize: number
): Promise<Array<{ name: string; id: string | null }>> {
  const entries: Array<{ name: string; id: string | null }> = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await bucket.list(prefix, { limit: pageSize, offset });
    if (error) throw new Error(`Could not list "${prefix || "/"}": ${error.message}`);
    const page = data ?? [];
    entries.push(...page);
    if (page.length < pageSize) return entries;
  }
}

export async function backfillEngagementPhotoMetadata(
  bucket: PhotoBucket,
  options: { apply: boolean; pageSize?: number; onProgress?: (path: string, outcome: string) => void }
): Promise<PhotoBackfillReport> {
  const pageSize = options.pageSize ?? 100;
  const report: PhotoBackfillReport = {
    applied: options.apply,
    scanned: 0,
    clean: 0,
    withMetadata: 0,
    stripped: 0,
    failures: [],
  };
  const fail = (path: string, reason: string) => {
    report.failures.push({ path, reason });
    options.onProgress?.(path, `failed: ${reason}`);
  };

  // Photos live at <campaignId>/<uuid>.<ext>, but the walk does not rely on
  // that depth: a folder (an entry with no id) is opened, to a fixed limit.
  const paths: string[] = [];
  const walk = async (prefix: string, depth: number) => {
    for (const entry of await listAll(bucket, prefix, pageSize)) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id !== null) paths.push(path);
      else if (depth < MAX_FOLDER_DEPTH) await walk(path, depth + 1);
      else fail(path, "folder nested deeper than expected; not scanned");
    }
  };
  await walk("", 0);

  for (const path of paths) {
    report.scanned += 1;

    const downloaded = await bucket.download(path);
    if (downloaded.error || !downloaded.data) {
      fail(path, `download failed${downloaded.error ? `: ${downloaded.error.message}` : ""}`);
      continue;
    }
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    const contentType = sniffEngagementPhotoContentType(bytes);
    if (!contentType) {
      fail(path, "not a JPEG, PNG or WebP image");
      continue;
    }

    let hasMetadata: boolean;
    try {
      hasMetadata = await carriesMetadata(bytes);
    } catch {
      fail(path, "image could not be decoded");
      continue;
    }
    if (!hasMetadata) {
      report.clean += 1;
      options.onProgress?.(path, "clean");
      continue;
    }
    report.withMetadata += 1;
    if (!options.apply) {
      options.onProgress?.(path, "carries metadata (dry run, unchanged)");
      continue;
    }

    const stripped = await stripPhotoMetadata(bytes, contentType);
    if (!stripped.ok) {
      fail(path, "image could not be re-encoded");
      continue;
    }
    if (stripped.bytes.byteLength > ENGAGEMENT_PHOTO_MAX_BYTES) {
      fail(path, "re-encoded image exceeds the bucket's size limit; left unchanged");
      continue;
    }
    const uploaded = await bucket.upload(path, stripped.bytes, {
      contentType: stripped.contentType,
      upsert: true,
    });
    if (uploaded.error) {
      fail(path, `upload failed: ${uploaded.error.message}`);
      continue;
    }

    // Read back what storage now holds, rather than trusting the upload.
    const check = await bucket.download(path);
    const checkBytes = check.data ? new Uint8Array(await check.data.arrayBuffer()) : null;
    let stillCarries = true;
    try {
      stillCarries = !checkBytes || (await carriesMetadata(checkBytes));
    } catch {
      // Unreadable after the rewrite: reported below as a failure.
    }
    if (check.error || stillCarries) {
      fail(path, "rewritten photo still carries metadata or could not be read back");
      continue;
    }
    report.stripped += 1;
    options.onProgress?.(path, "stripped");
  }
  return report;
}
