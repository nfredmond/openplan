/**
 * Remove location and device metadata from engagement photos uploaded before
 * 2026-10-10, when uploads started being re-encoded.
 *
 *   npm run ops:strip-engagement-photo-metadata            # dry run: report only
 *   npm run ops:strip-engagement-photo-metadata -- --apply # rewrite affected photos
 *
 * --apply replaces each affected photo in place and cannot be undone; take the
 * storage backup your restore procedure describes first. Reads
 * NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
 */
import { createServiceRoleClient } from "../../src/lib/supabase/server";
import { ENGAGEMENT_PHOTO_BUCKET } from "../../src/lib/engagement/photo";
import { backfillEngagementPhotoMetadata } from "../../src/lib/engagement/photo-metadata-backfill";

async function main() {
  const apply = process.argv.includes("--apply");
  const bucket = createServiceRoleClient().storage.from(ENGAGEMENT_PHOTO_BUCKET);
  const report = await backfillEngagementPhotoMetadata(bucket, {
    apply,
    onProgress: (path, outcome) => console.error(`${path}: ${outcome}`),
  });
  console.log(JSON.stringify(report, null, 2));
  if (!apply && report.withMetadata > 0) {
    console.error(`${report.withMetadata} photo(s) carry metadata. Run again with --apply to remove it.`);
  }
  process.exitCode = report.failures.length > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
