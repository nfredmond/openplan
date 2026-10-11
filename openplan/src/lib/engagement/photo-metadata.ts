import "server-only";
import sharp from "sharp";
import type { EngagementPhotoContentType } from "@/lib/engagement/photo";

// A 64 MP phone sensor (9248 x 6936) is about 64.1 million pixels, so full
// resolution photos from current phones decode. The cap exists because a
// 5 MB JPEG or PNG of a flat colour can declare far more pixels than that,
// and decoding it would hold gigabytes of memory on a public, unauthenticated
// route. Nothing is resized: a photo under the cap keeps its dimensions.
export const ENGAGEMENT_PHOTO_MAX_INPUT_PIXELS = 80_000_000;

export type StripPhotoMetadataResult =
  | { ok: true; bytes: Uint8Array; contentType: EngagementPhotoContentType }
  | { ok: false };

/**
 * Re-encode a participant's photo so the stored object carries pixels and
 * nothing else. Phone photos routinely embed EXIF GPS coordinates (often the
 * participant's home), device make and model, and capture times; approved
 * photos are served to the public, so the original bytes are never stored.
 *
 * The orientation tag is applied to the pixels first, because dropping it
 * would otherwise turn portrait phone photos sideways. Output stays in the
 * sniffed format. sharp removes EXIF, XMP, IPTC and the ICC profile by
 * default (converting to sRGB); never add withMetadata/keepExif here.
 *
 * Anything sharp cannot decode, or that exceeds the pixel cap, comes back as
 * `{ ok: false }` so the caller refuses it instead of storing it raw.
 */
export async function stripPhotoMetadata(
  bytes: Uint8Array,
  contentType: EngagementPhotoContentType
): Promise<StripPhotoMetadataResult> {
  try {
    const pipeline = sharp(bytes, { limitInputPixels: ENGAGEMENT_PHOTO_MAX_INPUT_PIXELS }).autoOrient();
    const encoded =
      contentType === "image/jpeg"
        ? pipeline.jpeg()
        : contentType === "image/png"
          ? pipeline.png()
          : pipeline.webp();
    const output = await encoded.toBuffer();
    return { ok: true, bytes: new Uint8Array(output), contentType };
  } catch {
    return { ok: false };
  }
}
